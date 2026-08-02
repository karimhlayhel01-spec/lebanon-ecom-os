/**
 * Next-batch reorder (slice 1) — pure helpers.
 *
 * Side-flow while primary stays `selling`. Never advances the first-batch FSM.
 * Economics: beginner hard-blocks until **per-SKU** invest-next tone would say
 * `reinvest` ("healthier"); some/experienced may proceed with a warning ack.
 * Shop Finance invest-next stays Mode C shop roll-up — see reorder-economics.ts.
 */

import type { ExperienceLevel } from "@/lib/sku/add-sku-gate";

/** Soft nudge when runway weeks of stock ≤ this (~4 weeks). */
export const REORDER_RUNWAY_WEEKS_THRESHOLD = 4;

/** Weeks of recent Topic A sell-through used for runway (matches invest-next window). */
export const REORDER_RUNWAY_LOOKBACK_WEEKS = 4;

export const REORDER_STATUSES = ["idle", "ordered"] as const;
export type ReorderStatus = (typeof REORDER_STATUSES)[number];

export type InvestNextTone = "reinvest" | "hold" | "fix_economics";

export type RunwayConfidence = "known" | "degraded" | "unknown";

export type SkuRunwayView = {
  /** skuLeft / avg weekly sold; null when unknown. */
  weeks: number | null;
  /** Soft nudge when weeks ≤ threshold (or unknown with leftover stock signal). */
  nudge: boolean;
  confidence: RunwayConfidence;
  skuLeft: number | null;
  avgWeeklySold: number | null;
};

/**
 * Runway ≈ units left ÷ recent weekly sold for that SKU.
 * Degrades when sold history is thin; unknown when both sides missing.
 */
export function computeSkuRunway(args: {
  skuLeft: number | null | undefined;
  /** Recent weekly units sold for this SKU (oldest → newest). */
  recentWeeklySold: readonly number[];
  thresholdWeeks?: number;
}): SkuRunwayView {
  const threshold = args.thresholdWeeks ?? REORDER_RUNWAY_WEEKS_THRESHOLD;
  const left =
    args.skuLeft == null || !Number.isFinite(args.skuLeft)
      ? null
      : Math.max(0, args.skuLeft);

  const soldSamples = args.recentWeeklySold
    .map((n) => (Number.isFinite(n) ? Math.max(0, n) : 0))
    .filter((n) => n > 0);
  const avgWeeklySold =
    soldSamples.length > 0
      ? soldSamples.reduce((a, b) => a + b, 0) / soldSamples.length
      : null;

  if (left == null && avgWeeklySold == null) {
    return {
      weeks: null,
      nudge: false,
      confidence: "unknown",
      skuLeft: null,
      avgWeeklySold: null,
    };
  }

  if (left != null && avgWeeklySold != null && avgWeeklySold > 0) {
    const weeks = left / avgWeeklySold;
    const confidence: RunwayConfidence =
      soldSamples.length >= 2 ? "known" : "degraded";
    return {
      weeks,
      nudge: weeks <= threshold,
      confidence,
      skuLeft: left,
      avgWeeklySold,
    };
  }

  // Degraded: left known but no sell-through — nudge if stock looks thin
  // (≤ typical first-batch leftover threshold heuristic: left ≤ 40 units).
  if (left != null && avgWeeklySold == null) {
    const thinStock = left <= 40;
    return {
      weeks: null,
      nudge: thinStock,
      confidence: "degraded",
      skuLeft: left,
      avgWeeklySold: null,
    };
  }

  // Sold known, left unknown — cannot compute weeks; no automatic nudge.
  return {
    weeks: null,
    nudge: false,
    confidence: "degraded",
    skuLeft: left,
    avgWeeklySold,
  };
}

/**
 * "Healthier" for next-batch = per-SKU invest-next tone would recommend reinvest
 * (profitable + estimated after-ads margin ≥ 35%). Null tone (too few weeks
 * for that SKU) is not healthier yet. Shop Finance invest-next is separate.
 */
export function isReorderEconomicsHealthy(
  recommendation: InvestNextTone | null | undefined,
): boolean {
  return recommendation === "reinvest";
}

export type ReorderEconomicsGateResult =
  | { ok: true; warning?: "weak_economics" }
  | { ok: false; error: "beginner_blocked" };

/**
 * Experience × per-SKU invest-next gate for marking next-batch ordered.
 * Beginner: HARD BLOCK until healthier (`reinvest`).
 * some / experienced: WARN when weak; proceed with ack.
 */
export function evaluateReorderEconomicsGate(args: {
  experience: ExperienceLevel;
  investNextRecommendation: InvestNextTone | null | undefined;
}): ReorderEconomicsGateResult {
  const healthy = isReorderEconomicsHealthy(args.investNextRecommendation);
  if (healthy) return { ok: true };

  if (args.experience === "beginner") {
    return { ok: false, error: "beginner_blocked" };
  }
  return { ok: true, warning: "weak_economics" };
}

export function normalizeReorderStatus(
  raw: string | null | undefined,
): ReorderStatus {
  if (raw === "ordered") return "ordered";
  return "idle";
}

/**
 * Conditional UPDATE matched exactly one row (CAS success).
 * 0 rows → concurrent double-submit lost the race; reject.
 */
export function casUpdateSucceeded(returningCount: number): boolean {
  return returningCount === 1;
}

/** Prior reorder_status required for a CAS claim. */
export function reorderCasPriorStatus(
  action: "mark_ordered" | "mark_arrived",
): ReorderStatus {
  return action === "mark_ordered" ? "idle" : "ordered";
}

/** Error when a reorder CAS UPDATE matches 0 rows (double-submit). */
export function reorderCasMissError(
  action: "mark_ordered",
): "reorder_active";
export function reorderCasMissError(
  action: "mark_arrived",
): "reorder_not_ordered";
export function reorderCasMissError(
  action: "mark_ordered" | "mark_arrived",
): "reorder_active" | "reorder_not_ordered" {
  return action === "mark_ordered" ? "reorder_active" : "reorder_not_ordered";
}

/** Mark ordered only while selling and reorder is idle. */
export function canMarkReorderOrdered(args: {
  primaryState: string;
  reorderStatus: ReorderStatus;
  /** First batch already arrived (selling path). */
  firstBatchArrived: boolean;
  sampleApproved: boolean;
}): boolean {
  return (
    args.primaryState === "selling" &&
    args.firstBatchArrived &&
    args.sampleApproved &&
    args.reorderStatus === "idle"
  );
}

/** Mark arrived only while a reorder is in transit (ordered). */
export function canMarkReorderArrived(args: {
  primaryState: string;
  reorderStatus: ReorderStatus;
}): boolean {
  return args.primaryState === "selling" && args.reorderStatus === "ordered";
}

/** ETA editable while next-batch is ordered (in transit). */
export function canEditReorderArrivalEta(args: {
  reorderStatus: ReorderStatus;
}): boolean {
  return args.reorderStatus === "ordered";
}

/**
 * Per-SKU invest-next tone for coaching while selling:
 * reinvest strengthens restock coaching; hold / fix_economics warn.
 */
export function reorderInvestNextTone(args: {
  recommendation: InvestNextTone | null | undefined;
  runwayNudge: boolean;
}): "strengthen" | "warn" | "neutral" {
  if (args.recommendation === "reinvest" && args.runwayNudge) {
    return "strengthen";
  }
  if (
    args.recommendation === "hold" ||
    args.recommendation === "fix_economics"
  ) {
    return "warn";
  }
  return "neutral";
}
