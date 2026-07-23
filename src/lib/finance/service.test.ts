import { describe, expect, it } from "vitest";
import {
  computeCurrentActual,
  computeHealth,
  computeWeekEconomics,
  computeWeeklyMargins,
  type CostBasis,
  type WeeklyInput,
} from "@/lib/finance/service";

function week(overrides: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    weekStart: "2026-01-06",
    sales: 1000,
    orders: 40,
    metaSpend: 100,
    tiktokSpend: 50,
    codCollected: 800,
    codOutstanding: 200,
    courierFees: 80,
    skuSold: 40,
    skuLeft: 60,
    ...overrides,
  };
}

describe("computeWeekEconomics / computeHealth (Fix #14)", () => {
  it("uses import COGS only — courier counted once via courierFees", () => {
    const basis: CostBasis = { importCogsPerUnit: 10, usesQuotes: true };
    // If localCourier were wrongly baked into unit COGS at +2, cogs would be 480.
    const eco = computeWeekEconomics(week(), basis);
    expect(eco.importCogsTotal).toBe(400); // 10 × 40
    expect(eco.netProfit).toBe(1000 - 400 - 80 - 150); // 370
    expect(eco.grossProfit).toBe(600);

    const health = computeHealth(week(), basis);
    expect(health.cogs).toBe(400);
    expect(health.netProfit).toBe(370);
    expect(health.adSpend).toBe(150);
  });

  it("prefers quoted import basis (usesQuotes) the same as weekly margins", () => {
    const quoted: CostBasis = { importCogsPerUnit: 8, usesQuotes: true };
    const planning: CostBasis = { importCogsPerUnit: 12, usesQuotes: false };
    const input = week();

    const healthQuoted = computeHealth(input, quoted);
    const marginsQuoted = computeWeeklyMargins(input, quoted);
    expect(healthQuoted.cogs).toBe(marginsQuoted.importCogsTotal);
    expect(healthQuoted.netProfit).toBe(
      Math.round(input.sales * (marginsQuoted.after ?? 0)),
    );

    const healthPlan = computeHealth(input, planning);
    expect(healthPlan.cogs).toBe(12 * 40);
    expect(healthPlan.netProfit).toBeLessThan(healthQuoted.netProfit);
  });

  it("health net reconciles with after-ads margin × sales", () => {
    const basis: CostBasis = { importCogsPerUnit: 7.5, usesQuotes: true };
    const input = week({ sales: 900, skuSold: 30, courierFees: 90 });
    const health = computeHealth(input, basis);
    const margins = computeWeeklyMargins(input, basis);
    expect(margins.after).not.toBeNull();
    expect(health.netProfit).toBe(Math.round((margins.after as number) * input.sales));
    expect(health.cogs).toBe(margins.importCogsTotal);
  });

  it("does not double-count courier when import unit cost is courier-free", () => {
    // Old bug: landedCost (= import + localCourier) × sold, THEN − courierFees.
    const importOnly: CostBasis = { importCogsPerUnit: 5, usesQuotes: false };
    const wronglyBundled: CostBasis = {
      importCogsPerUnit: 5 + 2,
      usesQuotes: false,
    };
    const input = week({ skuSold: 20, courierFees: 40, sales: 500, metaSpend: 0, tiktokSpend: 0 });
    const correct = computeHealth(input, importOnly);
    const doubled = computeHealth(input, wronglyBundled);
    // Correct: 500 − 100 − 40 − 0 = 360. Doubled unit COGS: 500 − 140 − 40 = 320.
    expect(correct.netProfit).toBe(360);
    expect(doubled.netProfit).toBe(320);
    expect(correct.netProfit - doubled.netProfit).toBe(40); // one extra courierFees-worth
  });
});

describe("computeCurrentActual salesByWeek", () => {
  it("exposes window week sales that sum exactly to sumSales", () => {
    const basis: CostBasis = { importCogsPerUnit: 10, usesQuotes: true };
    const entries = [
      week({ weekStart: "2026-03-17", sales: 720, skuSold: 24 }),
      week({ weekStart: "2026-03-24", sales: 900, skuSold: 30 }),
      week({ weekStart: "2026-03-31", sales: 1080, skuSold: 36 }),
      week({ weekStart: "2026-04-07", sales: 1200, skuSold: 40 }),
    ];
    const actual = computeCurrentActual(entries, basis);
    expect(actual.salesByWeek.map((w) => w.sales)).toEqual([
      720, 900, 1080, 1200,
    ]);
    expect(actual.salesByWeek.reduce((s, w) => s + w.sales, 0)).toBe(
      actual.sumSales,
    );
    expect(actual.sumSales).toBe(3900);
  });
});
