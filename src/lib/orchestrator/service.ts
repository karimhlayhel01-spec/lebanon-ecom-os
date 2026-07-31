import { asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { getJourney } from "@/lib/memory/repos";
import {
  getSkuJourney,
  listLiveSkus,
} from "@/lib/sku/journey";
import { effectiveJourneyState } from "@/lib/sku/page-sections";
import { costBasisForSku } from "@/lib/finance/service";
import { computeRunwayForSkuFromEntries } from "@/lib/finance/sku-runway";
import { getSkuViewById } from "@/lib/sku/service";
import { reorderInvestNextTone } from "@/lib/supplier/reorder";
import {
  resolveSkuInvestNextTone,
  topicAWeekFromRow,
} from "@/lib/supplier/reorder-economics";
import { shouldCoachWarmBackup } from "@/lib/supplier/reorder-escape";

/**
 * Orchestrator — next CTAs + coaching.
 *
 * Wave 1: never drive multi-SKU hub CTAs/coaching from workspace
 * journey/sideStatuses alone (stale single-SKU mirror). Hub uses shop-level
 * tips only (empty CTAs). SKU pages use that SKU’s journey flags.
 */

export type OrchestratorCta = {
  id: string;
  anchor: string;
  tone: "primary" | "parallel" | "side";
};

export type CoachingCard = {
  id: string;
  priority: number;
  tone: "safety" | "margins" | "budget" | "risk" | "likes";
};

export type Orchestration = {
  stateKey: string;
  parallel: boolean;
  ctas: OrchestratorCta[];
  coaching: CoachingCard[];
};

const PRIORITY = {
  safety: 0,
  margins: 1,
  budget: 2,
  risk: 3,
  likes: 4,
} as const;

/** Inputs for SKU-scoped CTA + coaching (no workspace bleed). */
export type SkuOrchestrationFlags = {
  primaryState: string;
  sampleStatus: string;
  costQuotesSaved: boolean;
  storeReady: boolean;
  anyOverLimit: boolean;
  /** Next-batch side-flow while selling. */
  reorderStatus?: "idle" | "ordered";
  reorderNudge?: boolean;
  reorderInvestTone?: "strengthen" | "warn" | "neutral";
  warmBackupCoach?: boolean;
};

/** Shop-level hub tips — never SKU CTAs like requestSample / orderBatch. */
export type ShopOrchestrationFlags = {
  liveSkuCount: number;
  anySelling: boolean;
  storeReady: boolean;
};

export function buildSkuCtas(flags: SkuOrchestrationFlags): {
  ctas: OrchestratorCta[];
  parallel: boolean;
  stateKey: string;
} {
  const state = flags.primaryState;
  const ctas: OrchestratorCta[] = [];
  let parallel = false;

  if (state === "paused") {
    ctas.push({ id: "resume", anchor: "top", tone: "primary" });
  } else if (state === "blocked") {
    ctas.push({ id: "unblock", anchor: "top", tone: "primary" });
  } else if (state === "discovery") {
    ctas.push({ id: "discovery", anchor: "discovery", tone: "primary" });
  } else if (state === "supplier_sample") {
    if (flags.sampleStatus === "in_flight") {
      ctas.push({ id: "sampleDecision", anchor: "supplier", tone: "primary" });
    } else if (flags.sampleStatus === "rejected") {
      ctas.push({ id: "sampleRetry", anchor: "supplier", tone: "primary" });
    } else {
      ctas.push({ id: "requestSample", anchor: "supplier", tone: "primary" });
    }
  } else if (state === "sample_approved" || state === "store_setup") {
    parallel = true;
    if (!flags.costQuotesSaved) {
      ctas.push({ id: "costQuotes", anchor: "supplier", tone: "primary" });
    }
    ctas.push({
      id: "orderBatch",
      anchor: "supplier",
      tone: flags.costQuotesSaved ? "primary" : "parallel",
    });
    ctas.push({ id: "storeSetup", anchor: "store", tone: "parallel" });
    ctas.push({ id: "marketingIntro", anchor: "marketing", tone: "side" });
  } else if (state === "batch_ordered") {
    parallel = true;
    ctas.push({ id: "markArrived", anchor: "supplier", tone: "primary" });
    ctas.push({ id: "preLaunch", anchor: "marketing", tone: "parallel" });
    if (!flags.storeReady) {
      ctas.push({ id: "storeSetup", anchor: "store", tone: "side" });
    }
  } else if (state === "batch_arrived_ready") {
    parallel = true;
    ctas.push({ id: "startSelling", anchor: "finance", tone: "primary" });
    ctas.push({ id: "launchKit", anchor: "marketing", tone: "parallel" });
  } else if (state === "selling") {
    parallel = true;
    ctas.push({ id: "logWeek", anchor: "finance", tone: "primary" });
    ctas.push({ id: "refreshKit", anchor: "marketing", tone: "parallel" });
    if (flags.reorderStatus === "ordered") {
      ctas.push({
        id: "markReorderArrived",
        anchor: "supplier",
        tone: "parallel",
      });
    } else if (flags.reorderNudge) {
      ctas.push({
        id: "reorderBatch",
        anchor: "supplier",
        tone: flags.reorderInvestTone === "strengthen" ? "parallel" : "side",
      });
    }
  }

  return { ctas, parallel, stateKey: state };
}

export function buildSkuCoaching(flags: SkuOrchestrationFlags): CoachingCard[] {
  const state = flags.primaryState;
  const coaching: CoachingCard[] = [];
  const preBatch = [
    "supplier_sample",
    "sample_approved",
    "store_setup",
  ].includes(state);

  if (preBatch) {
    coaching.push({
      id: "sampleFirst",
      priority: PRIORITY.safety,
      tone: "safety",
    });
  }
  if (state === "selling" || flags.storeReady) {
    coaching.push({ id: "codRisk", priority: PRIORITY.safety, tone: "safety" });
  }
  if (state === "selling" && flags.reorderInvestTone === "warn") {
    coaching.push({
      id: "reorderEconomicsWarn",
      priority: PRIORITY.margins,
      tone: "margins",
    });
  }
  if (
    state === "selling" &&
    flags.reorderNudge &&
    flags.reorderInvestTone === "strengthen"
  ) {
    coaching.push({
      id: "reorderReinvest",
      priority: PRIORITY.budget,
      tone: "budget",
    });
  }
  if (flags.warmBackupCoach) {
    coaching.push({
      id: "warmBackup",
      priority: PRIORITY.safety,
      tone: "safety",
    });
  }
  coaching.push({
    id: "protectMargins",
    priority: PRIORITY.margins,
    tone: "margins",
  });
  if (
    (state === "sample_approved" || state === "store_setup") &&
    !flags.costQuotesSaved
  ) {
    coaching.push({
      id: "costQuotesPending",
      priority: PRIORITY.margins,
      tone: "margins",
    });
  }
  if (preBatch || state === "batch_ordered") {
    coaching.push({
      id: "startSmall",
      priority: PRIORITY.budget,
      tone: "budget",
    });
  }
  if (
    flags.anyOverLimit &&
    (state === "sample_approved" || state === "store_setup")
  ) {
    coaching.push({ id: "over10k", priority: PRIORITY.risk, tone: "risk" });
  }

  coaching.sort((a, b) => a.priority - b.priority);
  return coaching;
}

/**
 * Hub / shop brain: cash, COD, multi-SKU, margins — never sample/batch CTAs
 * from a stale workspace mirror.
 */
export function buildShopOrchestration(
  flags: ShopOrchestrationFlags,
): Orchestration {
  const coaching: CoachingCard[] = [];

  if (flags.liveSkuCount === 0) {
    coaching.push({
      id: "likesSoft",
      priority: PRIORITY.likes,
      tone: "likes",
    });
  }

  if (flags.liveSkuCount >= 1) {
    coaching.push({
      id: "protectMargins",
      priority: PRIORITY.margins,
      tone: "margins",
    });
  }

  if (flags.liveSkuCount >= 2) {
    coaching.push({
      id: "multiSku",
      priority: PRIORITY.budget,
      tone: "budget",
    });
  }

  if (flags.anySelling || flags.storeReady) {
    coaching.push({ id: "codRisk", priority: PRIORITY.safety, tone: "safety" });
  }

  if (flags.anySelling) {
    coaching.push({ id: "cashCod", priority: PRIORITY.risk, tone: "risk" });
  }

  coaching.sort((a, b) => a.priority - b.priority);

  return {
    stateKey: flags.liveSkuCount === 0 ? "discovery" : "shop",
    parallel: false,
    // Hub never surfaces single-SKU next-CTAs (attention chips own those).
    ctas: [],
    coaching,
  };
}

export function buildSkuOrchestration(
  flags: SkuOrchestrationFlags,
): Orchestration {
  const { ctas, parallel, stateKey } = buildSkuCtas(flags);
  return {
    stateKey,
    parallel,
    ctas,
    coaching: buildSkuCoaching(flags),
  };
}

/** CTA ids that must not appear on a multi-SKU shop hub. */
export const SKU_SPECIFIC_CTA_IDS = new Set([
  "requestSample",
  "sampleDecision",
  "sampleRetry",
  "costQuotes",
  "orderBatch",
  "markArrived",
  "marketingIntro",
  "preLaunch",
  "launchKit",
  "startSelling",
  "logWeek",
  "refreshKit",
  "reorderBatch",
  "markReorderArrived",
]);

/**
 * @deprecated Prefer getShopOrchestration / getSkuOrchestration.
 * Kept as shop-scoped default so hub callers stay safe.
 */
export async function getOrchestration(
  workspaceId: string,
): Promise<Orchestration | null> {
  return getShopOrchestration(workspaceId);
}

/** Shop hub: tips only, empty CTAs. */
export async function getShopOrchestration(
  workspaceId: string,
): Promise<Orchestration | null> {
  ensureMigrated();
  const [side, live] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    listLiveSkus(workspaceId),
  ]);

  let anySelling = false;
  for (const sku of live) {
    const j = await getSkuJourney(sku.id);
    const state = j
      ? effectiveJourneyState({
          primaryState: j.primaryState,
          pausedFromState: j.pausedFromState,
        })
      : "discovery";
    if (state === "selling") anySelling = true;
  }

  return buildShopOrchestration({
    liveSkuCount: live.length,
    anySelling,
    storeReady: !!side?.storeReady,
  });
}

/** Per-SKU spine: CTAs + coaching from that SKU’s journey only. */
export async function getSkuOrchestration(
  workspaceId: string,
  skuId: string,
): Promise<Orchestration | null> {
  ensureMigrated();
  const [skuJourney, side, suppliers, topicRows, sku, samples, live] =
    await Promise.all([
    getSkuJourney(skuId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    db
      .select({
        id: schema.supplierOptions.id,
        role: schema.supplierOptions.role,
        moq: schema.supplierOptions.moq,
        unitPrice: schema.supplierOptions.unitPrice,
        source: schema.supplierOptions.source,
        skuId: schema.supplierOptions.skuId,
      })
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.skuId, skuId))
      .all(),
    db
      .select({
        weekStart: schema.topicAEntries.weekStart,
        storeTotalsUsd: schema.topicAEntries.storeTotalsUsd,
        metaSpend: schema.topicAEntries.metaSpend,
        tiktokSpend: schema.topicAEntries.tiktokSpend,
        courierFees: schema.topicAEntries.courierFees,
        perSkuSoldLeft: schema.topicAEntries.perSkuSoldLeft,
      })
      .from(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, workspaceId))
      .orderBy(asc(schema.topicAEntries.weekStart))
      .all(),
    getSkuViewById(workspaceId, skuId),
    db
      .select({
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
      })
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, skuId))
      .all(),
    listLiveSkus(workspaceId),
  ]);

  // Legacy single-SKU fallback only when no sku_journeys row yet.
  let primaryState = "discovery";
  let sampleStatus = "none";
  let costQuotesSaved = false;
  let reorderStatus: "idle" | "ordered" = "idle";

  if (skuJourney) {
    primaryState = effectiveJourneyState({
      primaryState: skuJourney.primaryState,
      pausedFromState: skuJourney.pausedFromState,
    });
    sampleStatus = skuJourney.sampleStatus;
    costQuotesSaved = skuJourney.costQuotesSaved;
    reorderStatus =
      skuJourney.reorderStatus === "ordered" ? "ordered" : "idle";
  } else {
    const journey = await getJourney(workspaceId);
    if (!journey) return null;
    primaryState = effectiveJourneyState({
      primaryState: journey.primaryState,
      pausedFromState: journey.pausedFromState,
    });
    sampleStatus = side?.sampleStatus ?? "none";
    costQuotesSaved = side?.costQuotesSaved ?? false;
  }

  const anyOverLimit = suppliers.some(
    (s) => (s.unitPrice + 2) * s.moq > 10000,
  );

  const runway =
    primaryState === "selling"
      ? computeRunwayForSkuFromEntries(topicRows, skuId, {
          liveSkuCount: live.length,
        })
      : { nudge: false };
  // Same per-SKU economics as Supplier reorder (not shop Finance invest-next).
  const investNextRecommendation =
    primaryState === "selling" && sku
      ? resolveSkuInvestNextTone({
          skuId,
          entries: topicRows.map(topicAWeekFromRow),
          importCogsPerUnit: costBasisForSku(sku).importCogsPerUnit,
        })
      : null;
  const investTone = reorderInvestNextTone({
    recommendation: investNextRecommendation,
    runwayNudge: !!runway.nudge,
  });

  const approvedIds = new Set(
    samples.filter((s) => s.status === "approved").map((s) => s.supplierId),
  );
  const hasWarm = suppliers.some(
    (s) => s.role === "backup" && approvedIds.has(s.id),
  );
  const sampleApproved =
    sampleStatus === "approved" ||
    ["sample_approved", "store_setup", "batch_ordered", "batch_arrived_ready", "selling"].includes(
      primaryState,
    );

  return buildSkuOrchestration({
    primaryState,
    sampleStatus,
    costQuotesSaved,
    storeReady: !!side?.storeReady,
    anyOverLimit,
    reorderStatus,
    reorderNudge: !!runway.nudge && reorderStatus === "idle",
    reorderInvestTone: investTone,
    warmBackupCoach: shouldCoachWarmBackup({
      primaryState,
      sampleApproved,
      hasWarmBackup: hasWarm,
    }),
  });
}
