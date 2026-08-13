import { and, eq, isNull } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  COURIERS_TBD,
  STORE_CHECKLIST_KEYS,
  type StoreChecklistKey,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import {
  founderEditStoreReadiness,
  getWorkspace,
} from "@/lib/memory/repos";
import { getSkuViewById } from "@/lib/sku/service";
import { listLiveSkus } from "@/lib/sku/journey";
import { assertSkuOwned } from "@/lib/sku/ownership";
import { parseGenerateKitSkuScope } from "@/lib/sku/require-sku-id";
import { canCheckStoreChecklistKey } from "@/lib/store/gating";
import { isGeminiConfigured } from "@/lib/discovery/explain/llm";
import { getMarketingLlmProvider } from "@/lib/marketing/intro-llm";
import {
  resolveStorePanelSkuId,
  shopPackAvailable,
} from "@/lib/store/page-pack-scope";
import {
  buildTemplateStorePageCopy,
  buildTemplateStoreShopPageCopy,
  parseDiscoverabilityPack,
  parseStoredPackSource,
  serializeDiscoverabilityPack,
  type DiscoverabilityPack,
  type StorePageCopyPayload,
  type StorePageCopySource,
} from "@/lib/store/page-copy";
import {
  MAX_AI_STORE_PAGE_COPY_VERSIONS,
  activeVersion,
  aiImprovesLeft,
  appendAiVersion,
  countAiVersions,
  ensureBaseline,
  parsePageCopyVersions,
  selectVersion,
  serializePageCopyVersions,
  snapshotFromPayload,
  versionSummaries,
  type StorePageCopyVersionSummary,
} from "@/lib/store/page-copy-versions";

/**
 * Store setup — a SIDE status. The Shopify readiness checklist lives here and
 * store readiness NEVER blocks batch ordering or selling. The `store_ready`
 * gate is side-only (no journey transition). Product-page AI packs are per
 * live SKU (`store_page_packs`) plus one shop pack (`sku_id` NULL) when ≥3
 * live SKUs. Checklist / URL / WhatsApp / courier stay workspace
 * `store_readiness`. Store Gemini is not on the Marketing Phase 7 ledger.
 */

type Checklist = Record<StoreChecklistKey, boolean>;

type StorePagePackRow = typeof schema.storePagePacks.$inferSelect;

function emptyChecklist(): Checklist {
  return Object.fromEntries(
    STORE_CHECKLIST_KEYS.map((k) => [k, false]),
  ) as Checklist;
}

function parseChecklist(raw: string): Checklist {
  const base = emptyChecklist();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const k of STORE_CHECKLIST_KEYS) base[k] = !!parsed[k];
    }
  } catch {
    /* keep empty */
  }
  return base;
}

function sortLiveSkus<T extends { id: string; createdAt: string; name: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

async function ensureStoreRow(workspaceId: string) {
  await ensureMigrated();
  const existing = await db
    .select()
    .from(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  if (existing) return existing;

  const now = nowIso();
  await db.insert(schema.storeReadiness).values({
    id: newId(),
    workspaceId,
    checklist: JSON.stringify(emptyChecklist()),
    storeUrl: null,
    whatsappNumber: null,
    courierChoice: null,
    policiesDraft: "",
    contentDraftEn: "",
    contentDraftAr: "",
    discoverabilityPack: "",
    pageCopyVersions: "",
    updatedAt: now,
  });
  return db
    .select()
    .from(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, workspaceId))
    .then((rows) => rows[0]);
}

async function loadPackRow(
  workspaceId: string,
  skuId: string | null,
): Promise<StorePagePackRow | undefined> {
  return db
    .select()
    .from(schema.storePagePacks)
    .where(
      and(
        eq(schema.storePagePacks.workspaceId, workspaceId),
        skuId === null
          ? isNull(schema.storePagePacks.skuId)
          : eq(schema.storePagePacks.skuId, skuId),
      ),
    )
    .then((rows) => rows[0]);
}

async function ensureStorePagePack(
  workspaceId: string,
  skuId: string,
): Promise<StorePagePackRow | null> {
  const existing = await loadPackRow(workspaceId, skuId);
  if (existing) return existing;

  const sku = await getSkuViewById(workspaceId, skuId);
  if (!sku) return null;

  const template = buildTemplateStorePageCopy({
    name: sku.name,
    category: sku.basics.category,
    differentiation: sku.basics.differentiation,
    hooks: sku.marketingHooks.hooks,
    sellPrice: sku.basics.sellPrice,
  });
  const now = nowIso();
  await db.insert(schema.storePagePacks).values({
    id: newId(),
    workspaceId,
    skuId,
    policiesDraft: template.policiesDraft,
    contentDraftEn: template.contentDraftEn,
    contentDraftAr: template.contentDraftAr,
    discoverabilityPack: serializeDiscoverabilityPack(
      template.discoverability,
      "template",
    ),
    pageCopyVersions: "",
    createdAt: now,
    updatedAt: now,
  });
  return (await loadPackRow(workspaceId, skuId)) ?? null;
}

async function ensureShopStorePagePack(
  workspaceId: string,
  shopName: string,
  liveSkuNames: string[],
): Promise<StorePagePackRow | null> {
  const existing = await loadPackRow(workspaceId, null);
  if (existing) return existing;

  const template = buildTemplateStoreShopPageCopy({
    shopName,
    liveSkuNames,
  });
  const now = nowIso();
  await db.insert(schema.storePagePacks).values({
    id: newId(),
    workspaceId,
    skuId: null,
    policiesDraft: template.policiesDraft,
    contentDraftEn: template.contentDraftEn,
    contentDraftAr: template.contentDraftAr,
    discoverabilityPack: serializeDiscoverabilityPack(
      template.discoverability,
      "template",
    ),
    pageCopyVersions: "",
    createdAt: now,
    updatedAt: now,
  });
  return (await loadPackRow(workspaceId, null)) ?? null;
}

export type StorePanelView = {
  checklist: Checklist;
  checklistKeys: readonly StoreChecklistKey[];
  percent: number;
  storeUrl: string | null;
  whatsappNumber: string | null;
  courierChoice: string | null;
  couriers: readonly string[];
  policiesDraft: string;
  contentDraftEn: string;
  contentDraftAr: string;
  discoverability: DiscoverabilityPack | null;
  pageCopySource: StorePageCopySource | null;
  geminiConfigured: boolean;
  storeReady: boolean;
  /** Selected live SKU name for copy context. */
  skuName: string | null;
  selectedSkuId: string | null;
  liveSkus: Array<{ id: string; name: string }>;
  shopPackAvailable: boolean;
  isShopPack: boolean;
  /** Version picker: baseline + ≤3 AI (per pack). */
  pageCopyVersions: StorePageCopyVersionSummary[];
  pageCopyActiveIndex: number;
  pageCopyAiCount: number;
  pageCopyAiLeft: number;
  pageCopyMaxAi: number;
};

function percentOf(checklist: Checklist): number {
  const total = STORE_CHECKLIST_KEYS.length;
  const done = STORE_CHECKLIST_KEYS.filter((k) => checklist[k]).length;
  return Math.round((done / total) * 100);
}

function emptyPackFields(): {
  policiesDraft: string;
  contentDraftEn: string;
  contentDraftAr: string;
  discoverability: DiscoverabilityPack | null;
  pageCopySource: StorePageCopySource | null;
  pageCopyVersions: StorePageCopyVersionSummary[];
  pageCopyActiveIndex: number;
  pageCopyAiCount: number;
  pageCopyAiLeft: number;
} {
  return {
    policiesDraft: "",
    contentDraftEn: "",
    contentDraftAr: "",
    discoverability: null,
    pageCopySource: null,
    pageCopyVersions: [],
    pageCopyActiveIndex: 0,
    pageCopyAiCount: 0,
    pageCopyAiLeft: MAX_AI_STORE_PAGE_COPY_VERSIONS,
  };
}

function packFieldsFromRow(pack: StorePagePackRow): ReturnType<typeof emptyPackFields> {
  const packRaw = pack.discoverabilityPack ?? "";
  const versionsState = parsePageCopyVersions(pack.pageCopyVersions ?? "");
  return {
    policiesDraft: pack.policiesDraft,
    contentDraftEn: pack.contentDraftEn,
    contentDraftAr: pack.contentDraftAr,
    discoverability: parseDiscoverabilityPack(packRaw),
    pageCopySource: parseStoredPackSource(packRaw),
    pageCopyVersions: versionSummaries(versionsState),
    pageCopyActiveIndex: versionsState.activeIndex,
    pageCopyAiCount: countAiVersions(versionsState),
    pageCopyAiLeft: aiImprovesLeft(versionsState),
  };
}

export async function getStorePanel(
  workspaceId: string,
  skuId?: string | null,
): Promise<StorePanelView | null> {
  const row = await ensureStoreRow(workspaceId);
  if (!row) return null;

  const [side, liveRaw, workspace] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    listLiveSkus(workspaceId),
    getWorkspace(workspaceId),
  ]);

  const live = sortLiveSkus(liveRaw);
  const liveIds = live.map((s) => s.id);
  const shopOk = shopPackAvailable(live.length);
  const isShopPack = skuId === null && shopOk;

  const checklist = parseChecklist(row.checklist);
  let packFields = emptyPackFields();
  let skuName: string | null = null;
  let selectedSkuId: string | null = null;

  if (isShopPack) {
    selectedSkuId = null;
    skuName = workspace?.name?.trim() || "My Store";
    const pack = await ensureShopStorePagePack(
      workspaceId,
      skuName,
      live.map((s) => s.name),
    );
    if (pack) packFields = packFieldsFromRow(pack);
  } else {
    selectedSkuId = resolveStorePanelSkuId(liveIds, skuId);
    if (selectedSkuId) {
      const sku = await getSkuViewById(workspaceId, selectedSkuId);
      skuName = sku?.name ?? null;
      const pack = await ensureStorePagePack(workspaceId, selectedSkuId);
      if (pack) packFields = packFieldsFromRow(pack);
    }
  }

  return {
    checklist,
    checklistKeys: STORE_CHECKLIST_KEYS,
    percent: percentOf(checklist),
    storeUrl: row.storeUrl,
    whatsappNumber: row.whatsappNumber,
    courierChoice: row.courierChoice,
    couriers: COURIERS_TBD,
    geminiConfigured: isGeminiConfigured(),
    storeReady: side?.storeReady ?? false,
    skuName,
    selectedSkuId,
    liveSkus: live.map((s) => ({ id: s.id, name: s.name })),
    shopPackAvailable: shopOk,
    isShopPack,
    pageCopyMaxAi: MAX_AI_STORE_PAGE_COPY_VERSIONS,
    ...packFields,
  };
}

/** Persist the new percent (and side storeReady when complete) after a change. */
async function syncSidePercent(workspaceId: string, checklist: Checklist) {
  const percent = percentOf(checklist);
  await db
    .update(schema.sideStatuses)
    .set({ storeReadyPercent: percent, updatedAt: nowIso() })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  return percent;
}

export async function toggleChecklistItem(
  workspaceId: string,
  key: StoreChecklistKey,
  value: boolean,
): Promise<{ ok: boolean; percent: number }> {
  await ensureMigrated();
  const row = await ensureStoreRow(workspaceId);
  if (!row) return { ok: false, percent: 0 };
  if (!STORE_CHECKLIST_KEYS.includes(key)) return { ok: false, percent: 0 };

  const checklist = parseChecklist(row.checklist);
  // v1 gating: checking ON requires prerequisites; unchecking is always allowed.
  if (value && !canCheckStoreChecklistKey(checklist, key)) {
    return { ok: false, percent: percentOf(checklist) };
  }
  checklist[key] = value;
  await founderEditStoreReadiness(workspaceId, {
    checklist: JSON.stringify(checklist),
  });
  const percent = await syncSidePercent(workspaceId, checklist);
  return { ok: true, percent };
}

export async function saveStoreFields(
  workspaceId: string,
  fields: {
    storeUrl?: string | null;
    whatsappNumber?: string | null;
    courierChoice?: string | null;
  },
): Promise<{ ok: boolean }> {
  await ensureMigrated();
  await ensureStoreRow(workspaceId);
  await founderEditStoreReadiness(workspaceId, fields);
  return { ok: true };
}

export type ImproveStorePageCopyResult =
  | { ok: true; source: StorePageCopySource; aiLeft: number }
  | {
      ok: false;
      error: "not_found" | "no_sku" | "ai_cap";
    };

function applyLiveFields(
  payload: {
    contentDraftEn: string;
    contentDraftAr: string;
    policiesDraft: string;
    discoverability: DiscoverabilityPack | null;
    source: StorePageCopySource | "baseline";
  },
) {
  return {
    contentDraftEn: payload.contentDraftEn,
    contentDraftAr: payload.contentDraftAr,
    policiesDraft: payload.policiesDraft,
    discoverabilityPack: payload.discoverability
      ? serializeDiscoverabilityPack(
          payload.discoverability,
          payload.source === "baseline" ? "template" : payload.source,
        )
      : "",
  };
}

async function persistPageCopyImprove(args: {
  workspaceId: string;
  pack: StorePagePackRow;
  filled: { ok: true; payload: StorePageCopyPayload } | { ok: false };
  template: StorePageCopyPayload;
  eventLabel: string;
  meta: Record<string, unknown>;
}): Promise<ImproveStorePageCopyResult> {
  const now = nowIso();
  let versions = parsePageCopyVersions(args.pack.pageCopyVersions ?? "");
  versions = ensureBaseline(versions, {
    contentDraftEn: args.pack.contentDraftEn,
    contentDraftAr: args.pack.contentDraftAr,
    policiesDraft: args.pack.policiesDraft,
    discoverabilityPackRaw: args.pack.discoverabilityPack ?? "",
    createdAt: now,
  });

  if (countAiVersions(versions) >= MAX_AI_STORE_PAGE_COPY_VERSIONS) {
    await db
      .update(schema.storePagePacks)
      .set({
        pageCopyVersions: serializePageCopyVersions(versions),
        updatedAt: now,
      })
      .where(eq(schema.storePagePacks.id, args.pack.id));
    return { ok: false, error: "ai_cap" };
  }

  if (args.filled.ok && args.filled.payload.source === "gemini") {
    const snap = snapshotFromPayload(args.filled.payload, now);
    const appended = appendAiVersion(versions, snap);
    if (!appended.ok) {
      return { ok: false, error: "ai_cap" };
    }
    versions = appended.state;
    const live = applyLiveFields({
      ...args.filled.payload,
      source: "gemini",
    });
    await db
      .update(schema.storePagePacks)
      .set({
        ...live,
        pageCopyVersions: serializePageCopyVersions(versions),
        updatedAt: now,
      })
      .where(eq(schema.storePagePacks.id, args.pack.id));

    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId: args.workspaceId,
      kind: "store_page_copy",
      message: args.eventLabel,
      meta: JSON.stringify({
        source: "gemini",
        aiCount: countAiVersions(versions),
        activeIndex: versions.activeIndex,
        ...args.meta,
      }),
      createdAt: now,
    });

    return {
      ok: true,
      source: "gemini",
      aiLeft: aiImprovesLeft(versions),
    };
  }

  const live = applyLiveFields(args.template);
  await db
    .update(schema.storePagePacks)
    .set({
      ...live,
      pageCopyVersions: serializePageCopyVersions(versions),
      updatedAt: now,
    })
    .where(eq(schema.storePagePacks.id, args.pack.id));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId: args.workspaceId,
    kind: "store_page_copy",
    message: args.eventLabel,
    meta: JSON.stringify({
      source: "template",
      aiCount: countAiVersions(versions),
      ...args.meta,
    }),
    createdAt: now,
  });

  return {
    ok: true,
    source: "template",
    aiLeft: aiImprovesLeft(versions),
  };
}

/**
 * Approach A: explicit click — Gemini improve (consumes 1 of 3 AI slots) or
 * template fallback (does not consume). Cap refuses before LLM when full.
 * Fail-closed without skuId (no workspace-active SKU fallback). Explicit
 * null = shop pack when ≥3 live. Store Gemini is not on the Marketing Phase 7 ledger.
 */
export async function improveStorePageCopy(
  workspaceId: string,
  skuId: unknown,
): Promise<ImproveStorePageCopyResult> {
  const scope = parseGenerateKitSkuScope(skuId);
  if (!scope.ok) return { ok: false, error: "not_found" };
  await ensureMigrated();
  await ensureStoreRow(workspaceId);

  const llm = getMarketingLlmProvider();

  if (scope.skuId === null) {
    const live = sortLiveSkus(await listLiveSkus(workspaceId));
    if (!shopPackAvailable(live.length)) {
      return { ok: false, error: "not_found" };
    }
    const workspace = await getWorkspace(workspaceId);
    const shopName = workspace?.name?.trim() || "My Store";
    const liveSkuNames = live.map((s) => s.name);
    const pack = await ensureShopStorePagePack(
      workspaceId,
      shopName,
      liveSkuNames,
    );
    if (!pack) return { ok: false, error: "not_found" };

    const shopInput = { shopName, liveSkuNames };
    const filled = await llm.improveStoreShopPageCopy(shopInput);
    return persistPageCopyImprove({
      workspaceId,
      pack,
      filled,
      template: buildTemplateStoreShopPageCopy(shopInput),
      eventLabel: filled.ok && filled.payload.source === "gemini"
        ? `Store shop copy AI improve for ${shopName} (${countAiVersions(parsePageCopyVersions(pack.pageCopyVersions ?? "")) + 1}/${MAX_AI_STORE_PAGE_COPY_VERSIONS})`
        : `Store shop copy template refresh for ${shopName} (no AI slot used)`,
      meta: { skuId: null, shopPack: true },
    });
  }

  const owned = await assertSkuOwned(workspaceId, scope.skuId);
  if (!owned.ok) return { ok: false, error: "not_found" };

  const sku = await getSkuViewById(workspaceId, scope.skuId);
  if (!sku) return { ok: false, error: "no_sku" };

  const pack = await ensureStorePagePack(workspaceId, scope.skuId);
  if (!pack) return { ok: false, error: "not_found" };

  const input = {
    name: sku.name,
    category: sku.basics.category,
    differentiation: sku.basics.differentiation,
    hooks: sku.marketingHooks.hooks,
    sellPrice: sku.basics.sellPrice,
  };

  const filled = await llm.improveStorePageCopy(input);
  return persistPageCopyImprove({
    workspaceId,
    pack,
    filled,
    template: buildTemplateStorePageCopy(input),
    eventLabel:
      filled.ok && filled.payload.source === "gemini"
        ? `Store page copy AI improve for ${sku.name} (${countAiVersions(parsePageCopyVersions(pack.pageCopyVersions ?? "")) + 1}/${MAX_AI_STORE_PAGE_COPY_VERSIONS})`
        : `Store page copy template refresh for ${sku.name} (no AI slot used)`,
    meta: { skuId: sku.id },
  });
}

export type SelectStorePageCopyVersionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "bad_index" };

export async function selectStorePageCopyVersion(
  workspaceId: string,
  skuId: unknown,
  index: number,
): Promise<SelectStorePageCopyVersionResult> {
  const scope = parseGenerateKitSkuScope(skuId);
  if (!scope.ok) return { ok: false, error: "not_found" };
  await ensureMigrated();

  if (scope.skuId === null) {
    const live = await listLiveSkus(workspaceId);
    if (!shopPackAvailable(live.length)) {
      return { ok: false, error: "not_found" };
    }
  } else {
    const owned = await assertSkuOwned(workspaceId, scope.skuId);
    if (!owned.ok) return { ok: false, error: "not_found" };
  }

  const pack = await loadPackRow(workspaceId, scope.skuId);
  if (!pack) return { ok: false, error: "not_found" };

  const state = parsePageCopyVersions(pack.pageCopyVersions ?? "");
  const next = selectVersion(state, index);
  if (!next) return { ok: false, error: "bad_index" };
  const active = activeVersion(next);
  if (!active) return { ok: false, error: "bad_index" };

  const live = applyLiveFields({
    contentDraftEn: active.contentDraftEn,
    contentDraftAr: active.contentDraftAr,
    policiesDraft: active.policiesDraft,
    discoverability: active.discoverability,
    source:
      active.source === "baseline"
        ? "template"
        : active.source === "gemini"
          ? "gemini"
          : "template",
  });
  const now = nowIso();
  await db
    .update(schema.storePagePacks)
    .set({
      ...live,
      pageCopyVersions: serializePageCopyVersions(next),
      updatedAt: now,
    })
    .where(eq(schema.storePagePacks.id, pack.id));

  return { ok: true };
}

export async function markStoreReady(
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await ensureMigrated();
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return { ok: false, error: "not_found" };

  // Side-only gate — records the decision, never advances the journey.
  const approval = await createApprovalRequest(workspaceId, "store_ready", {
    data: {},
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: [],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  await db
    .update(schema.sideStatuses)
    .set({ storeReady: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  await db
    .update(schema.workspaces)
    .set({ shopifyStatus: "ready" })
    .where(eq(schema.workspaces.id, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "store_ready",
    message: "Store marked ready (side status)",
    meta: "{}",
    createdAt: now,
  });

  return { ok: true };
}
