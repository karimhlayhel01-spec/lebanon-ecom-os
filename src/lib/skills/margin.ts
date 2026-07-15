import {
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
  MARKETING_BUDGET_DAYS,
  MARKETING_COST_PCT_OF_PRICE,
} from "@/lib/constants";

/**
 * Shared Margin Skill — the single deterministic margin module used by both
 * Product Discovery and Finance. There is exactly one 70% / 35% math here.
 *
 * Rules (from the approved v1 plan):
 *   landed_cost   = product + intl_ship + clearance_taxes + local_courier
 *   margin_before = (price - landed_cost) / price
 *   est_mkt/order = min(20% * price, monthly_follow_on_budget / 30)
 *   margin_after  = (price - landed_cost - est_mkt) / price
 *   pass_before: margin_before >= 0.70
 *   pass_after:  margin_after  >= 0.35
 *
 * On failure the result carries a human-readable `blockReason` — Discovery must
 * show "blocked with explanation" and never present an all-blocked dead end.
 * This module is pure (no I/O) and fully unit-tested.
 */

export type MarginInput = {
  sellPrice: number;
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  /** Founder's monthly follow-on budget, used for the marketing estimate. */
  monthlyFollowOnBudget: number;
};

export type MarginResult = {
  landedCost: number;
  marginBefore: number;
  estimatedMktPerOrder: number;
  marginAfter: number;
  passBefore: boolean;
  passAfter: boolean;
  pass: boolean;
  blockReason: string | null;
};

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function computeLandedCost(input: MarginInput): number {
  return (
    input.productCost +
    input.intlShip +
    input.clearanceTaxes +
    input.localCourier
  );
}

export function estimatedMarketingPerOrder(input: MarginInput): number {
  const priceCap = MARKETING_COST_PCT_OF_PRICE * input.sellPrice;
  const perOrderFromBudget =
    input.monthlyFollowOnBudget / MARKETING_BUDGET_DAYS;
  return Math.min(priceCap, perOrderFromBudget);
}

export function computeMargin(input: MarginInput): MarginResult {
  const landedCost = computeLandedCost(input);

  if (!(input.sellPrice > 0)) {
    return {
      landedCost,
      marginBefore: 0,
      estimatedMktPerOrder: 0,
      marginAfter: 0,
      passBefore: false,
      passAfter: false,
      pass: false,
      blockReason: "Sell price must be greater than zero.",
    };
  }

  const estimatedMktPerOrder = estimatedMarketingPerOrder(input);
  const marginBefore = (input.sellPrice - landedCost) / input.sellPrice;
  const marginAfter =
    (input.sellPrice - landedCost - estimatedMktPerOrder) / input.sellPrice;

  const passBefore = marginBefore >= MARGIN_BEFORE_ADS_MIN;
  const passAfter = marginAfter >= MARGIN_AFTER_ADS_MIN;
  const pass = passBefore && passAfter;

  const reasons: string[] = [];
  if (!passBefore) {
    reasons.push(
      `Margin before ads is ${pct(marginBefore)} (needs \u2265 ${pct(
        MARGIN_BEFORE_ADS_MIN,
      )}).`,
    );
  }
  if (!passAfter) {
    reasons.push(
      `Margin after ads is ${pct(marginAfter)} (needs \u2265 ${pct(
        MARGIN_AFTER_ADS_MIN,
      )}).`,
    );
  }

  return {
    landedCost,
    marginBefore,
    estimatedMktPerOrder,
    marginAfter,
    passBefore,
    passAfter,
    pass,
    blockReason: pass ? null : reasons.join(" "),
  };
}
