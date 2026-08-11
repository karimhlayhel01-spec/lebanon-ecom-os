import { eq } from "drizzle-orm";
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
import { getSkuView } from "@/lib/sku/service";
import { canCheckStoreChecklistKey } from "@/lib/store/gating";
import { isGeminiConfigured } from "@/lib/discovery/explain/llm";
import { getMarketingLlmProvider } from "@/lib/marketing/intro-llm";
import {
  buildTemplateStorePageCopy,
  parseDiscoverabilityPack,
  parseStoredPackSource,
  serializeDiscoverabilityPack,
  type DiscoverabilityPack,
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
 * gate is side-only (no journey transition). Content/policy drafts are
 * system-written starter text (Wave 4: AI-improved on click); the founder
 * edits checklist marks, URLs, and draft text.
 */

type Checklist = Record<StoreChecklistKey, boolean>;

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

function contentEn(name: string): string {
  return buildTemplateStorePageCopy({ name, category: "" }).contentDraftEn;
}

function contentAr(name: string): string {
  return buildTemplateStorePageCopy({ name, category: "" }).contentDraftAr;
}

function policiesDraft(): string {
  return buildTemplateStorePageCopy({
    name: "your product",
    category: "",
  }).policiesDraft;
}

async function ensureStoreRow(workspaceId: string) {
  await ensureMigrated();
  const existing = await db
    .select()
    .from(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  if (existing) return existing;

  const sku = await getSkuView(workspaceId);
  const name = sku?.name ?? "your product";
  const now = nowIso();
  await db.insert(schema.storeReadiness).values({
    id: newId(),
    workspaceId,
    checklist: JSON.stringify(emptyChecklist()),
    storeUrl: null,
    whatsappNumber: null,
    courierChoice: null,
    policiesDraft: policiesDraft(),
    contentDraftEn: contentEn(name),
    contentDraftAr: contentAr(name),
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
  /** Active / orientation SKU name for copy context. */
  skuName: string | null;
  /** Version picker: baseline + ≤3 AI. */
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

export async function getStorePanel(
  workspaceId: string,
): Promise<StorePanelView | null> {
  const row = await ensureStoreRow(workspaceId);
  if (!row) return null;

  const [side, sku] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    getSkuView(workspaceId),
  ]);

  const checklist = parseChecklist(row.checklist);
  const packRaw = row.discoverabilityPack ?? "";
  const versionsState = parsePageCopyVersions(row.pageCopyVersions ?? "");
  return {
    checklist,
    checklistKeys: STORE_CHECKLIST_KEYS,
    percent: percentOf(checklist),
    storeUrl: row.storeUrl,
    whatsappNumber: row.whatsappNumber,
    courierChoice: row.courierChoice,
    couriers: COURIERS_TBD,
    policiesDraft: row.policiesDraft,
    contentDraftEn: row.contentDraftEn,
    contentDraftAr: row.contentDraftAr,
    discoverability: parseDiscoverabilityPack(packRaw),
    pageCopySource: parseStoredPackSource(packRaw),
    geminiConfigured: isGeminiConfigured(),
    storeReady: side?.storeReady ?? false,
    skuName: sku?.name ?? null,
    pageCopyVersions: versionSummaries(versionsState),
    pageCopyActiveIndex: versionsState.activeIndex,
    pageCopyAiCount: countAiVersions(versionsState),
    pageCopyAiLeft: aiImprovesLeft(versionsState),
    pageCopyMaxAi: MAX_AI_STORE_PAGE_COPY_VERSIONS,
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

/**
 * Approach A: explicit click — Gemini improve (consumes 1 of 3 AI slots) or
 * template fallback (does not consume). Cap refuses before LLM when full.
 */
export async function improveStorePageCopy(
  workspaceId: string,
): Promise<ImproveStorePageCopyResult> {
  await ensureMigrated();
  const row = await ensureStoreRow(workspaceId);
  if (!row) return { ok: false, error: "not_found" };
  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "no_sku" };

  const now = nowIso();
  let versions = parsePageCopyVersions(row.pageCopyVersions ?? "");
  versions = ensureBaseline(versions, {
    contentDraftEn: row.contentDraftEn,
    contentDraftAr: row.contentDraftAr,
    policiesDraft: row.policiesDraft,
    discoverabilityPackRaw: row.discoverabilityPack ?? "",
    createdAt: now,
  });

  if (countAiVersions(versions) >= MAX_AI_STORE_PAGE_COPY_VERSIONS) {
    // Persist baseline capture if we just created it, then refuse.
    await db
      .update(schema.storeReadiness)
      .set({
        pageCopyVersions: serializePageCopyVersions(versions),
        updatedAt: now,
      })
      .where(eq(schema.storeReadiness.workspaceId, workspaceId));
    return { ok: false, error: "ai_cap" };
  }

  const input = {
    name: sku.name,
    category: sku.basics.category,
    differentiation: sku.basics.differentiation,
    hooks: sku.marketingHooks.hooks,
    sellPrice: sku.basics.sellPrice,
  };

  const llm = getMarketingLlmProvider();
  const filled = await llm.improveStorePageCopy(input);

  if (filled.ok && filled.payload.source === "gemini") {
    const snap = snapshotFromPayload(filled.payload, now);
    const appended = appendAiVersion(versions, snap);
    if (!appended.ok) {
      return { ok: false, error: "ai_cap" };
    }
    versions = appended.state;
    const live = applyLiveFields({
      ...filled.payload,
      source: "gemini",
    });
    await db
      .update(schema.storeReadiness)
      .set({
        ...live,
        pageCopyVersions: serializePageCopyVersions(versions),
        updatedAt: now,
      })
      .where(eq(schema.storeReadiness.workspaceId, workspaceId));

    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId,
      kind: "store_page_copy",
      message: `Store page copy AI improve for ${sku.name} (${countAiVersions(versions)}/${MAX_AI_STORE_PAGE_COPY_VERSIONS})`,
      meta: JSON.stringify({
        source: "gemini",
        skuId: sku.id,
        aiCount: countAiVersions(versions),
        activeIndex: versions.activeIndex,
      }),
      createdAt: now,
    });

    return {
      ok: true,
      source: "gemini",
      aiLeft: aiImprovesLeft(versions),
    };
  }

  // Template fallback / LLM miss — refresh live fields, do NOT burn an AI slot.
  const template = buildTemplateStorePageCopy(input);
  const live = applyLiveFields(template);
  await db
    .update(schema.storeReadiness)
    .set({
      ...live,
      pageCopyVersions: serializePageCopyVersions(versions),
      updatedAt: now,
    })
    .where(eq(schema.storeReadiness.workspaceId, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "store_page_copy",
    message: `Store page copy template refresh for ${sku.name} (no AI slot used)`,
    meta: JSON.stringify({
      source: "template",
      skuId: sku.id,
      aiCount: countAiVersions(versions),
    }),
    createdAt: now,
  });

  return {
    ok: true,
    source: "template",
    aiLeft: aiImprovesLeft(versions),
  };
}

export type SelectStorePageCopyVersionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "bad_index" };

export async function selectStorePageCopyVersion(
  workspaceId: string,
  index: number,
): Promise<SelectStorePageCopyVersionResult> {
  await ensureMigrated();
  const row = await ensureStoreRow(workspaceId);
  if (!row) return { ok: false, error: "not_found" };

  const state = parsePageCopyVersions(row.pageCopyVersions ?? "");
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
    .update(schema.storeReadiness)
    .set({
      ...live,
      pageCopyVersions: serializePageCopyVersions(next),
      updatedAt: now,
    })
    .where(eq(schema.storeReadiness.workspaceId, workspaceId));

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
