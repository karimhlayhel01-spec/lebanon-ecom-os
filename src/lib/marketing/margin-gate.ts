import {
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
  type MarketingStage,
} from "@/lib/constants";
import { computeMargin } from "@/lib/skills/margin";
import type {
  MoneySnapshotSection,
  QuotedCostsSection,
} from "@/lib/sku/service";

/**
 * Paid marketing margin coaching (Fix #2).
 *
 * 70%/35% bars are targets — informational note only. Never hard-block or
 * require ack on kit generate. Discovery accept hard gate stays separate.
 */

export function isPaidMarketingStage(stage: MarketingStage): boolean {
  return (
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "weekly_refresh"
  );
}

export type MarginPair = {
  before: number;
  after: number;
};

/**
 * Per-SKU planning margins for the coaching note.
 * Quotes saved → recompute via Margin skill (same ad-estimate convention).
 * Else → Discovery / Topic B moneySnapshot margins.
 */
export function resolveSkuPlanningMargins(args: {
  quotedCosts: QuotedCostsSection | null;
  moneySnapshot: MoneySnapshotSection;
  monthlyFollowOnBudget: number;
}): MarginPair {
  const q = args.quotedCosts;
  if (q) {
    const m = computeMargin({
      sellPrice: q.sellPrice,
      productCost: q.productCost,
      intlShip: q.intlShip,
      clearanceTaxes: q.clearanceTaxes,
      localCourier: q.localCourier,
      monthlyFollowOnBudget: args.monthlyFollowOnBudget,
    });
    return { before: m.marginBefore, after: m.marginAfter };
  }
  return {
    before: args.moneySnapshot.marginBefore,
    after: args.moneySnapshot.marginAfter,
  };
}

export function marginsPassBothThresholds(
  before: number,
  after: number,
): boolean {
  return before >= MARGIN_BEFORE_ADS_MIN && after >= MARGIN_AFTER_ADS_MIN;
}

/**
 * Classify margins for coaching (not a generate gate).
 * - skip: non-paid stage (intro)
 * - unknown: no usable numbers
 * - pass / fail: known numbers vs 70% / 35% bars
 */
export type PaidMarginCheckStatus = "skip" | "unknown" | "pass" | "fail";

export function classifyPaidMarketingMargins(args: {
  stage: MarketingStage;
  marginBefore: number | null | undefined;
  marginAfter: number | null | undefined;
}): PaidMarginCheckStatus {
  if (!isPaidMarketingStage(args.stage)) return "skip";
  if (
    args.marginBefore == null ||
    args.marginAfter == null ||
    !Number.isFinite(args.marginBefore) ||
    !Number.isFinite(args.marginAfter)
  ) {
    return "unknown";
  }
  return marginsPassBothThresholds(args.marginBefore, args.marginAfter)
    ? "pass"
    : "fail";
}

/** True when known margins miss bars — drives fail variant of the top note. */
export function needsMarginAckForPaidUi(args: {
  marginBefore: number | null | undefined;
  marginAfter: number | null | undefined;
}): boolean {
  if (
    args.marginBefore == null ||
    args.marginAfter == null ||
    !Number.isFinite(args.marginBefore) ||
    !Number.isFinite(args.marginAfter)
  ) {
    return false;
  }
  return !marginsPassBothThresholds(args.marginBefore, args.marginAfter);
}
