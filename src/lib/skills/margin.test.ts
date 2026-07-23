import { describe, expect, it } from "vitest";
import {
  computeLandedCost,
  computeMargin,
  estimatedMarketingPerOrder,
  type MarginInput,
} from "@/lib/skills/margin";

function input(overrides: Partial<MarginInput> = {}): MarginInput {
  return {
    sellPrice: 100,
    productCost: 10,
    intlShip: 3,
    clearanceTaxes: 2,
    localCourier: 5,
    monthlyFollowOnBudget: 300,
    ...overrides,
  };
}

describe("shared margin skill — components", () => {
  it("sums landed cost", () => {
    expect(computeLandedCost(input())).toBe(20);
  });

  it("marketing estimate is capped at 20% of sell price", () => {
    // budget/30 = 900/30 = 30, but 20% of 100 = 20 → capped at 20
    expect(
      estimatedMarketingPerOrder(input({ monthlyFollowOnBudget: 900 })),
    ).toBe(20);
  });

  it("marketing estimate uses budget/30 when below the price cap", () => {
    // budget/30 = 150/30 = 5, below 20% cap → 5
    expect(
      estimatedMarketingPerOrder(input({ monthlyFollowOnBudget: 150 })),
    ).toBe(5);
  });
});

describe("shared margin skill — pass / fail", () => {
  it("passes when both thresholds are met", () => {
    const r = computeMargin(input()); // landed 20, before .80, mkt 10, after .70
    expect(r.marginBefore).toBeCloseTo(0.8, 10);
    expect(r.estimatedMktPerOrder).toBe(10);
    expect(r.marginAfter).toBeCloseTo(0.7, 10);
    expect(r.passBefore).toBe(true);
    expect(r.passAfter).toBe(true);
    expect(r.pass).toBe(true);
    expect(r.blockReason).toBeNull();
  });

  it("blocks with explanation when both thresholds fail", () => {
    const r = computeMargin(
      input({ productCost: 75, intlShip: 0, clearanceTaxes: 0, localCourier: 0 }),
    );
    // landed 75, before .25, mkt 10, after .15
    expect(r.passBefore).toBe(false);
    expect(r.passAfter).toBe(false);
    expect(r.pass).toBe(false);
    // Skills return stable note keys; DiscoveryBoard translates with % params.
    expect(r.blockReason).toBe("@margin.failBefore @margin.failAfter");
    expect(r.marginBefore).toBeCloseTo(0.25, 10);
    expect(r.marginAfter).toBeCloseTo(0.15, 10);
  });

  it("treats the 70% before-ads threshold as inclusive", () => {
    // landed 30, budget 0 → mkt 0, before exactly .70, after .70
    const r = computeMargin(
      input({
        productCost: 30,
        intlShip: 0,
        clearanceTaxes: 0,
        localCourier: 0,
        monthlyFollowOnBudget: 0,
      }),
    );
    expect(r.marginBefore).toBeCloseTo(0.7, 10);
    expect(r.passBefore).toBe(true);
    expect(r.pass).toBe(true);
  });

  it("treats the 35% after-ads threshold as inclusive and independent", () => {
    // landed 45, budget 900 → mkt 20; before .55 (fail), after exactly .35 (pass)
    const r = computeMargin(
      input({
        productCost: 45,
        intlShip: 0,
        clearanceTaxes: 0,
        localCourier: 0,
        monthlyFollowOnBudget: 900,
      }),
    );
    expect(r.marginBefore).toBeCloseTo(0.55, 10);
    expect(r.marginAfter).toBeCloseTo(0.35, 10);
    expect(r.passBefore).toBe(false);
    expect(r.passAfter).toBe(true);
    expect(r.pass).toBe(false);
    expect(r.blockReason).toBe("@margin.failBefore");
    expect(r.marginBefore).toBeCloseTo(0.55, 10);
  });

  it("guards against a zero or negative sell price", () => {
    const r = computeMargin(input({ sellPrice: 0 }));
    expect(r.pass).toBe(false);
    expect(r.blockReason).toBe("@margin.sellPrice");
  });
});
