import { describe, expect, it } from "vitest";
import {
  computeRunwayForSkuFromEntries,
  extractSkuTopicASeries,
  resolveUnitsLeftGlance,
  shouldShowUnitsLeftOnHub,
} from "@/lib/finance/sku-runway";

describe("extractSkuTopicASeries", () => {
  it("reads Mode C per-SKU lines only for that skuId", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: {
            a: { sold: 10, left: 90, sales: 300 },
            b: { sold: 5, left: 40, sales: 150 },
          },
        }),
      },
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 12,
          skus: {
            a: { sold: 12, left: 78, sales: 360 },
            b: { sold: 6, left: 34, sales: 180 },
          },
        }),
      },
    ];
    const seriesA = extractSkuTopicASeries(entries, "a");
    expect(seriesA.recentWeeklySold).toEqual([10, 12]);
    expect(seriesA.skuLeft).toBe(78);

    const seriesB = extractSkuTopicASeries(entries, "b");
    expect(seriesB.skuLeft).toBe(34);
    expect(seriesB.skuLeft).not.toBe(78 + 34);
  });

  it("never uses Mode C shop roll-up when skuId is missing", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: { a: { sold: 10, left: 90, sales: 300 } },
        }),
      },
    ];
    const series = extractSkuTopicASeries(entries, "missing");
    expect(series.skuLeft).toBeNull();
    expect(series.recentWeeklySold).toEqual([]);
  });

  it("falls back to legacy single-SKU when Mode C absent and sole live", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 24,
          sku: { sold: 24, left: 20 },
        }),
      },
    ];
    const series = extractSkuTopicASeries(entries, "any-id", undefined, {
      liveSkuCount: 1,
    });
    expect(series.recentWeeklySold).toEqual([24]);
    expect(series.skuLeft).toBe(20);
  });

  it("2 live / legacy week: does not bleed SKU A left/sold onto SKU B", () => {
    const legacy = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 24,
          sku: { sold: 24, left: 90 },
        }),
      },
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 30,
          sold: 30,
          left: 60,
        }),
      },
    ];
    const seriesA = extractSkuTopicASeries(legacy, "sku-a", undefined, {
      liveSkuCount: 2,
    });
    const seriesB = extractSkuTopicASeries(legacy, "sku-b", undefined, {
      liveSkuCount: 2,
    });
    // Neither SKU may claim the legacy series when 2+ live.
    expect(seriesA.skuLeft).toBeNull();
    expect(seriesA.recentWeeklySold).toEqual([]);
    expect(seriesB.skuLeft).toBeNull();
    expect(seriesB.recentWeeklySold).toEqual([]);
    expect(seriesB.skuLeft).not.toBe(60);
    expect(seriesB.recentWeeklySold).not.toEqual([24, 30]);
  });

  it("2 live / Mode C week still attributes each skuId correctly", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: {
            a: { sold: 10, left: 90, sales: 300 },
            b: { sold: 0, left: 0, sales: 0 },
          },
        }),
      },
    ];
    const seriesA = extractSkuTopicASeries(entries, "a", undefined, {
      liveSkuCount: 2,
    });
    const seriesB = extractSkuTopicASeries(entries, "b", undefined, {
      liveSkuCount: 2,
    });
    expect(seriesA).toEqual({ skuLeft: 90, recentWeeklySold: [10] });
    expect(seriesB).toEqual({ skuLeft: 0, recentWeeklySold: [0] });
  });
});

describe("resolveUnitsLeftGlance", () => {
  it("never fakes 0 when left is null", () => {
    const glance = resolveUnitsLeftGlance({
      weeks: null,
      nudge: false,
      confidence: "unknown",
      skuLeft: null,
      avgWeeklySold: null,
    });
    expect(glance).toEqual({ kind: "unknown" });
    expect(glance).not.toMatchObject({ unitsLeft: 0 });
  });

  it("shows truthful 0 when Topic A left is 0", () => {
    const glance = resolveUnitsLeftGlance({
      weeks: 0,
      nudge: true,
      confidence: "known",
      skuLeft: 0,
      avgWeeklySold: 10,
    });
    expect(glance).toEqual({ kind: "known", unitsLeft: 0, weeks: 0 });
  });

  it("matches runway helper for classic low-stock fixture", () => {
    const entries = [
      { perSkuSoldLeft: JSON.stringify({ orders: 24, sold: 24, left: 126 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 30, sold: 30, left: 96 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 36, sold: 36, left: 60 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 40, sold: 40, left: 20 }) },
    ];
    const runway = computeRunwayForSkuFromEntries(entries, "sku");
    const glance = resolveUnitsLeftGlance(runway);
    expect(glance.kind).toBe("known");
    if (glance.kind === "known") {
      expect(glance.unitsLeft).toBe(20);
      expect(glance.weeks).toBe(runway.weeks);
    }
  });
});

describe("shouldShowUnitsLeftOnHub", () => {
  it("shows for selling; batch_arrived only when left known", () => {
    expect(
      shouldShowUnitsLeftOnHub({ primaryState: "selling", unitsLeft: null }),
    ).toBe(true);
    expect(
      shouldShowUnitsLeftOnHub({
        primaryState: "batch_arrived_ready",
        unitsLeft: null,
      }),
    ).toBe(false);
    expect(
      shouldShowUnitsLeftOnHub({
        primaryState: "batch_arrived_ready",
        unitsLeft: 12,
      }),
    ).toBe(true);
    expect(
      shouldShowUnitsLeftOnHub({
        primaryState: "sample_approved",
        unitsLeft: 12,
      }),
    ).toBe(false);
  });
});
