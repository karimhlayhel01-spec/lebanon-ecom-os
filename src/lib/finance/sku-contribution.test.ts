import { describe, expect, it } from "vitest";
import {
  computeSkuContributionBreakdown,
  computeWeekSkuContribution,
} from "@/lib/finance/sku-contribution";
import type { CostBasis } from "@/lib/finance/service";

const basisA: CostBasis = { importCogsPerUnit: 10, usesQuotes: true };
const basisB: CostBasis = { importCogsPerUnit: 5, usesQuotes: true };

function bases() {
  return new Map([
    ["a", basisA],
    ["b", basisB],
  ]);
}

function names() {
  return new Map([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
}

describe("computeSkuContributionBreakdown", () => {
  it("returns null when fewer than 2 SKUs in window", () => {
    const result = computeSkuContributionBreakdown({
      entries: [
        {
          weekStart: "2026-01-06",
          sales: 400,
          skuSold: 20,
          metaSpend: 50,
          tiktokSpend: 0,
          courierFees: 20,
          skuLines: [{ skuId: "a", sold: 20, left: 10, sales: 400 }],
        },
      ],
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(result).toBeNull();
  });

  it("ranks by sales and computes exact before-ads from SKU COGS", () => {
    const result = computeSkuContributionBreakdown({
      entries: [
        {
          weekStart: "2026-01-06",
          sales: 900,
          skuSold: 50,
          metaSpend: 100,
          tiktokSpend: 50,
          courierFees: 40,
          skuLines: [
            { skuId: "a", sold: 20, left: 10, sales: 400 },
            { skuId: "b", sold: 30, left: 20, sales: 500 },
          ],
        },
      ],
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(result).not.toBeNull();
    expect(result!.rankedBy).toBe("sales");
    expect(result!.rows.map((r) => r.skuId)).toEqual(["b", "a"]);
    expect(result!.rows[0].rank).toBe(1);
    expect(result!.rows[0].sales).toBe(500);
    expect(result!.rows[0].cogs).toBe(150); // 5 × 30
    expect(result!.rows[0].marginBefore).toBeCloseTo((500 - 150) / 500);
    expect(result!.rows[1].cogs).toBe(200); // 10 × 20
    expect(result!.rows[1].marginBefore).toBeCloseTo((400 - 200) / 400);
  });

  it("skips weeks without skuLines and counts them", () => {
    const result = computeSkuContributionBreakdown({
      entries: [
        {
          weekStart: "2026-01-06",
          sales: 300,
          skuSold: 10,
          metaSpend: 0,
          tiktokSpend: 0,
          courierFees: 0,
          // legacy — no lines
        },
        {
          weekStart: "2026-01-13",
          sales: 700,
          skuSold: 40,
          metaSpend: 80,
          tiktokSpend: 20,
          courierFees: 30,
          skuLines: [
            { skuId: "a", sold: 15, left: 5, sales: 300 },
            { skuId: "b", sold: 25, left: 5, sales: 400 },
          ],
        },
      ],
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(result!.weeksSkippedNoLines).toBe(1);
    expect(result!.weekStarts).toEqual(["2026-01-13"]);
    expect(result!.rows).toHaveLength(2);
  });

  it("estimates after-ads by sales share of shop ads+courier", () => {
    const result = computeSkuContributionBreakdown({
      entries: [
        {
          weekStart: "2026-01-06",
          sales: 1000,
          skuSold: 40,
          metaSpend: 80,
          tiktokSpend: 20,
          courierFees: 50, // shared 150
          skuLines: [
            { skuId: "a", sold: 20, left: 0, sales: 600 },
            { skuId: "b", sold: 20, left: 0, sales: 400 },
          ],
        },
      ],
      basisBySku: bases(),
      skuNames: names(),
    });
    // a gets 60% of 150 = 90 shared; cogs 200; after = (600-200-90)/600
    expect(result!.rows.find((r) => r.skuId === "a")!.estimatedMarginAfter).toBeCloseTo(
      (600 - 200 - 90) / 600,
    );
    // b gets 40% of 150 = 60; cogs 100; after = (400-100-60)/400
    expect(result!.rows.find((r) => r.skuId === "b")!.estimatedMarginAfter).toBeCloseTo(
      (400 - 100 - 60) / 400,
    );
  });

  it("uses last ≤4 weeks with lines (same window size as current actual)", () => {
    const weeks = Array.from({ length: 6 }, (_, i) => ({
      weekStart: `2026-0${i + 1}-01`,
      sales: 200,
      skuSold: 20,
      metaSpend: 10,
      tiktokSpend: 0,
      courierFees: 5,
      skuLines: [
        { skuId: "a", sold: 10, left: 0, sales: 100 },
        { skuId: "b", sold: 10, left: 0, sales: 100 },
      ],
    }));
    // Bump sales on last week for a so ranking differs if only last weeks count
    weeks[5].skuLines![0].sales = 180;
    weeks[5].skuLines![1].sales = 20;
    weeks[5].sales = 200;

    const result = computeSkuContributionBreakdown({
      entries: weeks,
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(result!.weekStarts).toHaveLength(4);
    expect(result!.weekStarts[0]).toBe("2026-03-01");
    expect(result!.weekStarts[3]).toBe("2026-06-01");
  });
});

describe("computeWeekSkuContribution", () => {
  it("returns null when skuLines missing or empty", () => {
    expect(
      computeWeekSkuContribution({
        skuLines: undefined,
        basisBySku: bases(),
        skuNames: names(),
      }),
    ).toBeNull();
    expect(
      computeWeekSkuContribution({
        skuLines: [],
        basisBySku: bases(),
        skuNames: names(),
      }),
    ).toBeNull();
  });

  it("ranks that week’s lines by sales with exact before-ads; no after-ads", () => {
    const week = computeWeekSkuContribution({
      skuLines: [
        { skuId: "a", sold: 10, left: 0, sales: 200 },
        { skuId: "b", sold: 20, left: 0, sales: 500 },
      ],
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(week).not.toBeNull();
    expect(week!.rows.map((r) => r.skuId)).toEqual(["b", "a"]);
    expect(week!.rows[0].cogs).toBe(100); // 5 × 20
    expect(week!.rows[0].marginBefore).toBeCloseTo((500 - 100) / 500);
    expect(week!.rows[1].cogs).toBe(100); // 10 × 10
    expect(week!.rows[1].marginBefore).toBeCloseTo((200 - 100) / 200);
    expect(week!.rows[0]).not.toHaveProperty("estimatedMarginAfter");
  });

  it("shows a single-line week split when only one SKU line exists", () => {
    const week = computeWeekSkuContribution({
      skuLines: [{ skuId: "a", sold: 8, left: 2, sales: 160 }],
      basisBySku: bases(),
      skuNames: names(),
    });
    expect(week!.rows).toHaveLength(1);
    expect(week!.rows[0].rank).toBe(1);
    expect(week!.rows[0].cogs).toBe(80);
  });
});
