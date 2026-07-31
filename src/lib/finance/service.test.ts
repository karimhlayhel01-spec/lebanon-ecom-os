import { describe, expect, it } from "vitest";
import {
  computeCurrentActual,
  computeHealth,
  computeWeekEconomics,
  computeWeeklyMargins,
  parsePerSkuSoldLeft,
  partitionTopicAEntries,
  rollUpMultiSkuWeek,
  type CostBasis,
  type SkuCostLine,
  type WeeklyInput,
} from "@/lib/finance/service";
import { TOPIC_A_RECENT_WEEKS } from "@/lib/constants";

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

describe("partitionTopicAEntries (display split)", () => {
  it("keeps all weeks in recent when ≤ limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}` }));
    const { recent, older } = partitionTopicAEntries(rows, 20);
    expect(recent).toHaveLength(5);
    expect(older).toHaveLength(0);
  });

  it("puts oldest beyond limit into older; recent is newest window", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `w${i}`,
      weekStart: `2026-${String(i + 1).padStart(2, "0")}-01`,
    }));
    const { recent, older } = partitionTopicAEntries(rows, 20);
    expect(TOPIC_A_RECENT_WEEKS).toBe(20);
    expect(older).toHaveLength(5);
    expect(recent).toHaveLength(20);
    expect(older[0]?.id).toBe("w0");
    expect(older[4]?.id).toBe("w4");
    expect(recent[0]?.id).toBe("w5");
    expect(recent[19]?.id).toBe("w24");
  });

  it("default limit is TOPIC_A_RECENT_WEEKS", () => {
    const rows = Array.from({ length: TOPIC_A_RECENT_WEEKS + 3 }, (_, i) => ({
      id: i,
    }));
    const { recent, older } = partitionTopicAEntries(rows);
    expect(recent).toHaveLength(TOPIC_A_RECENT_WEEKS);
    expect(older).toHaveLength(3);
  });
});

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

describe("multi-SKU Topic A roll-up (Mode C)", () => {
  it("sums sales and COGS across 2 SKUs with different unit costs", () => {
    const lines: SkuCostLine[] = [
      {
        skuId: "a",
        sold: 10,
        left: 40,
        sales: 400,
        importCogsPerUnit: 8,
        usesQuotes: true,
      },
      {
        skuId: "b",
        sold: 20,
        left: 30,
        sales: 600,
        importCogsPerUnit: 12,
        usesQuotes: false,
      },
    ];
    const roll = rollUpMultiSkuWeek(lines);
    expect(roll.sales).toBe(1000);
    expect(roll.skuSold).toBe(30);
    expect(roll.skuLeft).toBe(70);
    expect(roll.importCogsTotal).toBe(8 * 10 + 12 * 20); // 320
    expect(roll.blendedBasis.importCogsPerUnit).toBeCloseTo(320 / 30);
    expect(roll.blendedBasis.usesQuotes).toBe(true);

    const input: WeeklyInput = {
      weekStart: "2026-04-07",
      sales: roll.sales,
      orders: 30,
      metaSpend: 100,
      tiktokSpend: 50,
      codCollected: 700,
      codOutstanding: 200,
      courierFees: 90,
      skuSold: roll.skuSold,
      skuLeft: roll.skuLeft,
    };
    const health = computeHealth(input, roll.blendedBasis);
    expect(health.cogs).toBe(320);
    // net = 1000 − 320 − 90 − 150 = 440
    expect(health.netProfit).toBe(440);
  });

  it("parses Mode C JSON and legacy single-sku shapes", () => {
    const multi = parsePerSkuSoldLeft(
      JSON.stringify({
        orders: 12,
        skus: {
          a: { sold: 5, left: 10, sales: 200 },
          b: { sold: 7, left: 3, sales: 280 },
        },
      }),
    );
    expect(multi.orders).toBe(12);
    expect(multi.skuSold).toBe(12);
    expect(multi.skuLeft).toBe(13);
    expect(multi.skus.a?.sales).toBe(200);

    const legacy = parsePerSkuSoldLeft(
      JSON.stringify({ orders: 8, sku: { sold: 8, left: 22 } }),
    );
    expect(legacy.skuSold).toBe(8);
    expect(legacy.skuLeft).toBe(22);
    expect(Object.keys(legacy.skus)).toHaveLength(0);

    const flat = parsePerSkuSoldLeft(
      JSON.stringify({ orders: 3, sold: 3, left: 7 }),
    );
    expect(flat.skuSold).toBe(3);
  });
});
