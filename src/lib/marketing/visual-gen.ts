/**
 * Wave 4 Phase 6c — Generate / Regenerate / Discard for per-SKU Nano/Seedance cards.
 * Fail-closed. Separate from MarketingLlmProvider. No Gemini ledger.
 */

import { and, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { parseCreativesKitItems } from "@/lib/marketing/creatives-ai";
import {
  checkMarketingVisualAllowance,
  loadMarketingVisualUsage,
  recordMarketingVisualCalls,
  resolveMarketingVisualMonthlyCap,
} from "@/lib/marketing/marketing-visual-usage";
import {
  isHiggsfieldConfigured,
  isMarketingVisualGenEnabled,
} from "@/lib/marketing/visual-flags";
import {
  runHiggsfieldVisualGen,
  type VisualGenRunnerInput,
  type VisualGenRunnerResult,
} from "@/lib/marketing/visual-higgsfield";
import {
  creativeVisualHref,
  evaluateVisualGenGate,
  nextRegenerateCount,
  parsePhotoPackSkuId,
  regenCountAfterDiscard,
  resolveSelectedPackId,
  type CreativeVisualFileView,
  type VisualGenError,
  type VisualGenKind,
} from "@/lib/marketing/visual-pack-ui";
import {
  listPhotoPackDetailsForSku,
  listPhotoPacksForSku,
  loadOwnedMotionClip,
  loadOwnedPhotoAsset,
  requirePhotoPackSku,
} from "@/lib/marketing/visual-packs";
import {
  creativeVisualRelPath,
  deleteOwnedFile,
  readOwnedFile,
  writeOwnedFile,
} from "@/lib/marketing/visual-storage";
import {
  routeCreativeVisualTool,
  suggestCreativeVisualTool,
} from "@/lib/marketing/visual-tool";
import type { MarketingStage } from "@/lib/constants";

export type VisualGenActionResult =
  | {
      ok: true;
      value: {
        href: string;
        kind: VisualGenKind;
        regenerateCount: number;
        usedGeneric: boolean;
      };
    }
  | { ok: false; error: VisualGenError };

type VisualGenRunner = (
  input: VisualGenRunnerInput,
  env?: Record<string, string | undefined>,
) => Promise<VisualGenRunnerResult>;

let visualGenRunner: VisualGenRunner = runHiggsfieldVisualGen;

export function setVisualGenRunner(runner: VisualGenRunner): void {
  visualGenRunner = runner;
}

export function resetVisualGenRunner(): void {
  visualGenRunner = runHiggsfieldVisualGen;
}

function kitStage(
  stage: string,
): Extract<MarketingStage, "pre_launch" | "launch" | "weekly_refresh"> | null {
  if (
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "weekly_refresh"
  ) {
    return stage;
  }
  return null;
}

async function loadKitCreative(args: {
  workspaceId: string;
  skuId: string;
  kitId: string;
  creativeId: string;
}) {
  const kit = await db
    .select()
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.id, args.kitId),
        eq(schema.marketingKits.workspaceId, args.workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!kit || kit.skuId !== args.skuId) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(kit.items);
  } catch {
    return null;
  }
  const creativesKit = parseCreativesKitItems(parsed);
  const creative = creativesKit?.creatives.find(
    (c) => c.id === args.creativeId,
  );
  if (!creative) return null;
  const stage = kitStage(kit.stage);
  if (!stage) return null;
  return { kit, creative, stage };
}

async function existingVisualRow(
  workspaceId: string,
  kitId: string,
  creativeId: string,
) {
  return db
    .select()
    .from(schema.marketingCreativeVisuals)
    .where(
      and(
        eq(schema.marketingCreativeVisuals.workspaceId, workspaceId),
        eq(schema.marketingCreativeVisuals.kitId, kitId),
        eq(schema.marketingCreativeVisuals.creativeId, creativeId),
      ),
    )
    .then((rows) => rows[0]);
}

async function loadPackMedia(
  workspaceId: string,
  skuId: string,
  packId: string | null,
): Promise<{
  packId: string | null;
  photos: Array<{ bytes: Buffer; mimeType: string }>;
  motionClip: { bytes: Buffer; mimeType: string } | null;
}> {
  if (!packId) {
    return { packId: null, photos: [], motionClip: null };
  }
  const details = await listPhotoPackDetailsForSku(workspaceId, skuId);
  if (!details.ok) return { packId: null, photos: [], motionClip: null };
  const pack = details.value.find((p) => p.id === packId);
  if (!pack) return { packId: null, photos: [], motionClip: null };
  const photos: Array<{ bytes: Buffer; mimeType: string }> = [];
  for (const photo of pack.photos) {
    const loaded = await loadOwnedPhotoAsset(workspaceId, photo.id);
    if (loaded.ok) {
      photos.push({ bytes: loaded.bytes, mimeType: loaded.mimeType });
    }
  }
  let motionClip: { bytes: Buffer; mimeType: string } | null = null;
  if (pack.motionClip) {
    const clip = await loadOwnedMotionClip(workspaceId, pack.id);
    if (clip.ok) {
      motionClip = { bytes: clip.bytes, mimeType: clip.mimeType };
    }
  }
  return { packId: pack.id, photos, motionClip };
}

async function persistGenerated(args: {
  workspaceId: string;
  skuId: string;
  kitId: string;
  creativeId: string;
  packId: string | null;
  kind: VisualGenKind;
  bytes: Buffer;
  regenerateCount: number;
}): Promise<VisualGenActionResult> {
  const rel = creativeVisualRelPath({
    workspaceId: args.workspaceId,
    skuId: args.skuId,
    kitId: args.kitId,
    creativeId: args.creativeId,
  });
  const written = await writeOwnedFile(rel, args.bytes);
  if (!written.ok) return { ok: false, error: "api_error" };
  await recordMarketingVisualCalls({ workspaceId: args.workspaceId, calls: 1 });
  const now = nowIso();
  const existing = await existingVisualRow(
    args.workspaceId,
    args.kitId,
    args.creativeId,
  );
  if (existing) {
    await db
      .update(schema.marketingCreativeVisuals)
      .set({
        skuId: args.skuId,
        packId: args.packId ?? existing.packId,
        storagePath: rel,
        kind: args.kind,
        regenerateCount: args.regenerateCount,
        generatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.marketingCreativeVisuals.id, existing.id));
  } else {
    await db.insert(schema.marketingCreativeVisuals).values({
      id: newId(),
      workspaceId: args.workspaceId,
      skuId: args.skuId,
      kitId: args.kitId,
      creativeId: args.creativeId,
      packId: args.packId,
      storagePath: rel,
      kind: args.kind,
      regenerateCount: args.regenerateCount,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    ok: true,
    value: {
      href: creativeVisualHref(args.kitId, args.creativeId),
      kind: args.kind,
      regenerateCount: args.regenerateCount,
      usedGeneric: !args.packId,
    },
  };
}

export async function generateOrRegenerateCreativeVisual(args: {
  workspaceId: string;
  skuId: unknown;
  kitId: string;
  creativeId: string;
  mode: "generate" | "regenerate";
  env?: Record<string, string | undefined>;
}): Promise<VisualGenActionResult> {
  await ensureMigrated();
  const env = args.env ?? process.env;
  const scoped = await requirePhotoPackSku(args.workspaceId, args.skuId);
  if (!scoped.ok) return scoped;
  const loaded = await loadKitCreative({
    workspaceId: args.workspaceId,
    skuId: scoped.skuId,
    kitId: args.kitId.trim(),
    creativeId: args.creativeId.trim(),
  });
  if (!loaded) return { ok: false, error: "not_found" };
  const tool = routeCreativeVisualTool(loaded.creative.format);
  const row = await existingVisualRow(
    args.workspaceId,
    loaded.kit.id,
    loaded.creative.id,
  );
  const usage = await loadMarketingVisualUsage(args.workspaceId);
  const gate = evaluateVisualGenGate({
    flagOn: isMarketingVisualGenEnabled(env),
    keysPresent: isHiggsfieldConfigured(env),
    monthlyCap: resolveMarketingVisualMonthlyCap(env),
    used: usage.callsUsed,
    skuId: scoped.skuId,
    tool,
    mode: args.mode,
    regenerateCount: row?.regenerateCount ?? 0,
    hasFile: Boolean(row?.storagePath),
  });
  if (!gate.ok) return gate;
  if (args.mode === "generate" && row?.storagePath) {
    const kind: VisualGenKind = row.kind === "clip" ? "clip" : "still";
    return {
      ok: true,
      value: {
        href: creativeVisualHref(loaded.kit.id, loaded.creative.id),
        kind,
        regenerateCount: row.regenerateCount,
        usedGeneric: !row.packId,
      },
    };
  }
  const allowance = await checkMarketingVisualAllowance(
    args.workspaceId,
    env,
  );
  if (!allowance.ok) return { ok: false, error: "monthly_cap" };

  const skuName = await db
    .select({ name: schema.skuCards.name })
    .from(schema.skuCards)
    .where(eq(schema.skuCards.id, scoped.skuId))
    .then((rows) => rows[0]?.name ?? "your product");
  const suggestion = suggestCreativeVisualTool({
    creative: loaded.creative,
    productName: skuName,
    stage: loaded.stage,
  });
  const packs = await listPhotoPacksForSku(args.workspaceId, scoped.skuId);
  const packId = resolveSelectedPackId({
    chosenPackId: row?.packId,
    packs: packs.ok ? packs.value : [],
  });
  const media = await loadPackMedia(args.workspaceId, scoped.skuId, packId);
  const usedGeneric = media.photos.length === 0;
  const prompt = usedGeneric
    ? `${suggestion.promptEn}\nNo product photos were attached — generate a generic still/clip. It will not look like their product.`
    : `${suggestion.promptEn}\nUse the attached product photos as this product’s look.`;

  const ran = await visualGenRunner(
    {
      tool: tool === "seedance" ? "seedance" : "nano_banana",
      prompt,
      photos: media.photos,
      motionClip: media.motionClip,
    },
    env,
  );
  if (!ran.ok) return ran;

  const regenerateCount =
    args.mode === "regenerate"
      ? nextRegenerateCount(row?.regenerateCount ?? 0)
      : 0;
  const persisted = await persistGenerated({
    workspaceId: args.workspaceId,
    skuId: scoped.skuId,
    kitId: loaded.kit.id,
    creativeId: loaded.creative.id,
    packId: media.packId,
    kind: ran.media.kind,
    bytes: ran.media.bytes,
    regenerateCount,
  });
  if (!persisted.ok) return persisted;
  return {
    ok: true,
    value: { ...persisted.value, usedGeneric },
  };
}

export async function discardCreativeVisual(args: {
  workspaceId: string;
  skuId: unknown;
  kitId: string;
  creativeId: string;
}): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  await ensureMigrated();
  const scoped = await requirePhotoPackSku(args.workspaceId, args.skuId);
  if (!scoped.ok) return scoped;
  const loaded = await loadKitCreative({
    workspaceId: args.workspaceId,
    skuId: scoped.skuId,
    kitId: args.kitId.trim(),
    creativeId: args.creativeId.trim(),
  });
  if (!loaded) return { ok: false, error: "not_found" };
  const row = await existingVisualRow(
    args.workspaceId,
    loaded.kit.id,
    loaded.creative.id,
  );
  if (!row) return { ok: true };
  const prev = row.storagePath;
  const now = nowIso();
  await db
    .update(schema.marketingCreativeVisuals)
    .set({
      storagePath: "",
      generatedAt: null,
      regenerateCount: regenCountAfterDiscard(),
      updatedAt: now,
    })
    .where(eq(schema.marketingCreativeVisuals.id, row.id));
  if (prev) await deleteOwnedFile(prev);
  return { ok: true };
}

export async function listCreativeVisualFiles(
  workspaceId: string,
  skuId: string,
  kitIds: string[],
): Promise<CreativeVisualFileView[]> {
  if (kitIds.length === 0) return [];
  if (!parsePhotoPackSkuId(skuId).ok) return [];
  await ensureMigrated();
  const rows = await db
    .select()
    .from(schema.marketingCreativeVisuals)
    .where(
      and(
        eq(schema.marketingCreativeVisuals.workspaceId, workspaceId),
        eq(schema.marketingCreativeVisuals.skuId, skuId),
      ),
    );
  return rows
    .filter(
      (r) =>
        Boolean(r.storagePath) &&
        kitIds.includes(r.kitId) &&
        (r.kind === "still" || r.kind === "clip"),
    )
    .map((r) => ({
      kitId: r.kitId,
      creativeId: r.creativeId,
      href: creativeVisualHref(r.kitId, r.creativeId),
      kind: r.kind as VisualGenKind,
      regenerateCount: r.regenerateCount,
      generatedAt: r.generatedAt,
    }));
}

export async function loadOwnedCreativeVisual(
  workspaceId: string,
  kitId: string,
  creativeId: string,
): Promise<
  | {
      ok: true;
      bytes: Buffer;
      mimeType: string;
      kind: VisualGenKind;
      originalName: string;
    }
  | { ok: false; error: "not_found" }
> {
  await ensureMigrated();
  if (!kitId.trim() || !creativeId.trim()) {
    return { ok: false, error: "not_found" };
  }
  const row = await existingVisualRow(workspaceId, kitId.trim(), creativeId.trim());
  if (!row?.storagePath) return { ok: false, error: "not_found" };
  const scoped = await requirePhotoPackSku(workspaceId, row.skuId);
  if (!scoped.ok) return scoped;
  const bytes = await readOwnedFile(row.storagePath);
  if (!bytes) return { ok: false, error: "not_found" };
  const kind: VisualGenKind = row.kind === "clip" ? "clip" : "still";
  return {
    ok: true,
    bytes,
    mimeType: kind === "clip" ? "video/mp4" : "image/jpeg",
    kind,
    originalName: kind === "clip" ? "product-clip.mp4" : "product-still.jpg",
  };
}
