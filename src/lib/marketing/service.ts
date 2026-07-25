import { and, asc, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  MARKETING_CAPACITY_TIERS,
  PRE_LAUNCH_MAX_DAILY_AD_SPEND,
  type MarketingCapacityTier,
  type MarketingStage,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney, founderEditMarketingKit } from "@/lib/memory/repos";
import { getSkuView } from "@/lib/sku/service";
import {
  buildIntroLesson,
  type IntroLessonPayload,
  type IntroLessonSection,
} from "@/lib/marketing/intro-lesson";
import {
  buildCreatives,
  creativeCountFor,
  normalizeCreative,
  type Creative,
} from "@/lib/marketing/creatives";
import { resolveBatchArrivalEta } from "@/lib/supplier/batch-eta";
import type { BatchArrivalEtaView } from "@/lib/supplier/batch-eta";
import {
  resolveDefaultFocusStage,
  resolveUnlockedStages,
  type MarketingStageInfo,
} from "@/lib/marketing/focus";

export type { MarketingStageInfo };

/**
 * Marketing — stage-aware kits.
 *
 * Stage gating follows the journey:
 *   sample approved      → intro          (organic lesson — not creatives)
 *   batch ordered        → pre-launch     (organic + max $5/day paid)
 *   batch arrived/ready  → launch         (real paid budget, gated ack)
 *   after launch         → weekly refresh (ongoing; stage id monthly_refresh)
 *
 * Intro stores a product-tailored beginner LESSON. Other stages store EN + AR
 * niche creatives (hook-first, WhatsApp CTA — never COD-as-wow). Counts:
 * pre_launch lighter (4/6/8); launch + monthly_refresh full tier (6/10/14).
 * Kits are creative/lesson plans only — NOT Topic A money advice (Finance).
 * Founder-facing copy says “weekly refresh”; keep stage id monthly_refresh.
 */

export type { IntroLessonPayload, IntroLessonSection, Creative };
export {
  buildCreatives,
  creativeCountFor,
  creativesHaveCodPitch,
  creativesContentKey,
  normalizeCreative,
  preLaunchHasForbiddenPitch,
  weekPhase,
} from "@/lib/marketing/creatives";

export function capacityTierFor(hoursPerWeek: number): MarketingCapacityTier {
  if (hoursPerWeek >= 20) return 14;
  if (hoursPerWeek >= 10) return 10;
  return 6;
}

// ---------------------------------------------------------------------------
// Stage resolution + read model
// ---------------------------------------------------------------------------

export type MarketingKitView = {
  id: string;
  stage: MarketingStage;
  capacityTier: number;
  /** Discriminator for UI branching — intro lessons vs creative kits. */
  kind: "creatives" | "intro_lesson";
  creatives: Creative[];
  lesson: IntroLessonPayload | null;
  createdAt: string;
};

export type MarketingPanelView = {
  currentStage: MarketingStage;
  capacityTier: MarketingCapacityTier;
  stages: MarketingStageInfo[];
  kits: MarketingKitView[];
  maxDailyPaid: number;
  whatsappSet: boolean;
  launchAckNeeded: boolean;
  /** Batch arrival ETA from Supplier (or default 1 month). */
  batchArrivalEta: BatchArrivalEtaView;
};

function parseKitItems(raw: string): {
  kind: "creatives" | "intro_lesson";
  creatives: Creative[];
  lesson: IntroLessonPayload | null;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as IntroLessonPayload).kind === "intro_lesson" &&
      Array.isArray((parsed as IntroLessonPayload).sections)
    ) {
      return {
        kind: "intro_lesson",
        creatives: [],
        lesson: parsed as IntroLessonPayload,
      };
    }
    if (Array.isArray(parsed)) {
      const creatives = parsed
        .map(normalizeCreative)
        .filter((c): c is Creative => c !== null);
      return {
        kind: "creatives",
        creatives,
        lesson: null,
      };
    }
  } catch {
    /* ignore */
  }
  return { kind: "creatives", creatives: [], lesson: null };
}

export async function getMarketingPanel(
  workspaceId: string,
): Promise<MarketingPanelView | null> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return null;

  const [side, journey, onboarding, store, kitRows] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.storeReadiness)
      .where(eq(schema.storeReadiness.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.marketingKits)
      .where(eq(schema.marketingKits.skuId, sku.id))
      .orderBy(asc(schema.marketingKits.createdAt))
      .all(),
  ]);

  const primaryState = journey?.primaryState ?? "";
  const sampleApproved =
    side?.sampleStatus === "approved" ||
    ["sample_approved", "store_setup", "batch_ordered", "batch_arrived_ready", "selling"].includes(
      primaryState,
    );
  const batchOrdered =
    (side?.batchOrdered ?? false) ||
    ["batch_ordered", "batch_arrived_ready", "selling"].includes(primaryState);
  const batchArrivedReady =
    (side?.batchArrivedReady ?? false) ||
    ["batch_arrived_ready", "selling"].includes(primaryState);

  // One kit per stage in the read model (legacy stacks collapse to newest).
  const kits: MarketingKitView[] = [];
  const latestByStage = new Map<MarketingStage, MarketingKitView>();
  for (const k of kitRows) {
    const items = parseKitItems(k.items);
    latestByStage.set(k.stage as MarketingStage, {
      id: k.id,
      stage: k.stage as MarketingStage,
      capacityTier: Number(k.capacityTier),
      kind: items.kind,
      creatives: items.creatives,
      lesson: items.lesson,
      createdAt: k.createdAt,
    });
  }
  for (const kit of latestByStage.values()) kits.push(kit);
  const hasLaunchKit = kits.some(
    (k) => k.stage === "launch" || k.stage === "monthly_refresh",
  );

  const stages = resolveUnlockedStages({
    sampleApproved,
    batchOrdered,
    batchArrivedReady,
    hasLaunchKit,
  });

  // Default FOCUS (not unlock map): journey-appropriate stage. Unlock can still
  // open monthly_refresh once a launch kit exists, but we must not treat
  // "furthest unlocked" as Current — that skipped Launch after seed/generate.
  const sideStage = (side?.marketingStage as MarketingStage) ?? "none";
  const currentStage = resolveDefaultFocusStage({
    primaryState,
    sampleApproved,
    batchOrdered,
    batchArrivedReady,
    stages,
    sideStage,
  });

  const launchAckNeeded = !kits.some((k) => k.stage === "launch");
  const batchArrivalEta = resolveBatchArrivalEta(
    side?.batchArrivalEta ?? null,
  );

  return {
    currentStage,
    capacityTier: capacityTierFor(onboarding?.hoursPerWeek ?? 8),
    stages,
    kits,
    maxDailyPaid: PRE_LAUNCH_MAX_DAILY_AD_SPEND,
    whatsappSet: !!store?.whatsappNumber,
    launchAckNeeded,
    batchArrivalEta,
  };
}

// ---------------------------------------------------------------------------
// Generate / refresh / edit
// ---------------------------------------------------------------------------

export type GenerateKitResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "stage_locked" | "needs_launch_ack" };

export async function generateKit(
  workspaceId: string,
  stage: MarketingStage,
  launchBudgetAck: boolean,
): Promise<GenerateKitResult> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const panel = await getMarketingPanel(workspaceId);
  if (!panel) return { ok: false, error: "not_found" };
  const info = panel.stages.find((s) => s.stage === stage);
  if (!info || !info.unlocked) return { ok: false, error: "stage_locked" };

  // Launch (and weekly refresh / monthly_refresh) require a budget-rules
  // acknowledgement the first time, via side-only start_launch_marketing.
  const needsAck =
    (stage === "launch" || stage === "monthly_refresh") &&
    panel.launchAckNeeded;
  if (needsAck) {
    if (!launchBudgetAck) return { ok: false, error: "needs_launch_ack" };
    const approval = await createApprovalRequest(
      workspaceId,
      "start_launch_marketing",
      { data: { stage } },
    );
    if (approval) {
      await decideApproval(approval.id, {
        type: "approve",
        acknowledgements: ["budget_rules_ack"],
      });
    }
  }

  // At most one kit per workspace + SKU + stage — replace, never stack.
  // Intro lesson is canonical once created: do not regenerate/replace.
  const existing = await db
    .select()
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        eq(schema.marketingKits.skuId, sku.id),
        eq(schema.marketingKits.stage, stage),
      ),
    )
    .orderBy(asc(schema.marketingKits.createdAt))
    .all();

  if (stage === "intro_pdf" && existing.length > 0) {
    const keep = existing[existing.length - 1]!;
    const extras = existing.slice(0, -1).map((r) => r.id);
    if (extras.length > 0) {
      await db
        .delete(schema.marketingKits)
        .where(inArray(schema.marketingKits.id, extras));
    }
    await db
      .update(schema.sideStatuses)
      .set({ marketingStage: stage, updatedAt: nowIso() })
      .where(eq(schema.sideStatuses.workspaceId, workspaceId));
    // Touch keep.updatedAt only if we pruned — otherwise pure no-op success.
    if (extras.length > 0) {
      await db
        .update(schema.marketingKits)
        .set({ updatedAt: nowIso() })
        .where(eq(schema.marketingKits.id, keep.id));
    }
    return { ok: true };
  }

  const now = nowIso();
  // Variance seed at generate time so regenerate rotates angles/series/captions.
  const varianceSeed =
    Date.now() ^ (existing.length > 0 ? existing.length * 7919 : 1);
  const creativeStage =
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "monthly_refresh"
      ? stage
      : null;
  const eta = panel.batchArrivalEta;
  const items =
    stage === "intro_pdf"
      ? buildIntroLesson({
          name: sku.name,
          category: sku.basics.category,
          differentiation: sku.basics.differentiation,
          hooks: sku.marketingHooks.hooks,
        })
      : creativeStage
        ? buildCreatives({
            name: sku.name,
            category: sku.basics.category,
            hooks: sku.marketingHooks.hooks,
            stage: creativeStage,
            capacityTier: panel.capacityTier,
            varianceSeed,
            weekCount:
              creativeStage === "pre_launch" ? eta.weekCount : undefined,
          })
        : [];

  const itemsJson = JSON.stringify(items);
  const capacityTier = String(panel.capacityTier);
  const creativeCount = Array.isArray(items) ? items.length : 0;

  if (existing.length > 0) {
    const keep = existing[existing.length - 1]!;
    await db
      .update(schema.marketingKits)
      .set({
        capacityTier,
        items: itemsJson,
        language: "both",
        updatedAt: now,
      })
      .where(eq(schema.marketingKits.id, keep.id));

    const extras = existing.slice(0, -1).map((r) => r.id);
    if (extras.length > 0) {
      await db
        .delete(schema.marketingKits)
        .where(inArray(schema.marketingKits.id, extras));
    }
  } else {
    await db.insert(schema.marketingKits).values({
      id: newId(),
      workspaceId,
      skuId: sku.id,
      stage,
      capacityTier,
      items: itemsJson,
      language: "both",
      createdAt: now,
      updatedAt: now,
    });
  }

  await db
    .update(schema.sideStatuses)
    .set({ marketingStage: stage, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  const replaced = existing.length > 0;
  const message =
    stage === "intro_pdf"
      ? `Generated intro lesson for ${sku.name}`
      : `${replaced ? "Replaced" : "Generated"} ${stage} kit (${creativeCount} creatives)`;

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "marketing_kit",
    message,
    meta: JSON.stringify({
      stage,
      kind: stage === "intro_pdf" ? "intro_lesson" : "creatives",
      replaced,
    }),
    createdAt: now,
  });

  return { ok: true };
}

export async function saveKitCreatives(
  workspaceId: string,
  kitId: string,
  creatives: Creative[],
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const kit = await db
    .select()
    .from(schema.marketingKits)
    .where(eq(schema.marketingKits.id, kitId))
    .get();
  if (!kit || kit.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }
  await founderEditMarketingKit(kitId, { items: JSON.stringify(creatives) });
  return { ok: true };
}

export { MARKETING_CAPACITY_TIERS };
