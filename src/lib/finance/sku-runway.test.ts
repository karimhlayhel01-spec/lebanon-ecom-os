import { describe, expect, it } from "vitest";
import {
  computeRunwayForSkuFromEntries,
  extractSkuTopicASeries,
  resolveUnitsLeftGlance,
  shouldShowUnitsLeftOnHub,
  batchInventoryUnitsFromImportBatch,
  resolveSkuLeftWithBatchBootstrap,
  resolvePriorLeftForReorderArrive,
  bumpTopicALeftAfterReorder,
  findTopicARowIndexToBumpLeft,
} from "@/lib/finance/sku-runway";
import { parsePerSkuSoldLeft } from "@/lib/finance/service";

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

describe("batch inventory bootstrap for hub units-left", () => {
  it("uses ordered qty when Topic A has no left yet", () => {
    expect(
      resolveSkuLeftWithBatchBootstrap({
        topicALeft: null,
        batchInventoryUnits: 150,
      }),
    ).toBe(150);
    expect(
      batchInventoryUnitsFromImportBatch(
        { suggestedFirstBatch: 150, unitsLeft: null },
        { batchArrivedReady: true },
      ),
    ).toBe(150);
    expect(
      batchInventoryUnitsFromImportBatch(
        { suggestedFirstBatch: 150, unitsLeft: null },
        { batchArrivedReady: false },
      ),
    ).toBeNull();
  });

  it("prefers importBatch.unitsLeft over suggestedFirstBatch", () => {
    expect(
      batchInventoryUnitsFromImportBatch(
        { suggestedFirstBatch: 100, unitsLeft: 150 },
        { batchArrivedReady: true },
      ),
    ).toBe(150);
  });

  it("Topic A left wins over batch bootstrap once weeks exist", () => {
    expect(
      resolveSkuLeftWithBatchBootstrap({
        topicALeft: 70,
        batchInventoryUnits: 150,
      }),
    ).toBe(70);
  });

  it("order 150 → runway left 150 with empty Topic A; multi-SKU only that skuId", () => {
    const empty: { perSkuSoldLeft: string }[] = [];
    const runway = computeRunwayForSkuFromEntries(empty, "sku-a", {
      liveSkuCount: 2,
      batchInventoryUnits: 150,
    });
    expect(runway.skuLeft).toBe(150);
    const glance = resolveUnitsLeftGlance(runway);
    expect(glance).toEqual({ kind: "known", unitsLeft: 150, weeks: null });

    const other = computeRunwayForSkuFromEntries(empty, "sku-b", {
      liveSkuCount: 2,
      batchInventoryUnits: null,
    });
    expect(other.skuLeft).toBeNull();
    expect(resolveUnitsLeftGlance(other)).toEqual({ kind: "unknown" });
  });

  it("after Topic A log week, left follows Topic A not batch qty", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: { "sku-a": { sold: 10, left: 140, sales: 300 } },
        }),
      },
    ];
    const runway = computeRunwayForSkuFromEntries(entries, "sku-a", {
      liveSkuCount: 1,
      batchInventoryUnits: 150,
    });
    expect(runway.skuLeft).toBe(140);
  });
});

describe("reorder arrive Topic A left bump", () => {
  it("Topic A left 70 + reorder qty 150 → glance 220 (Mode C, other SKU unchanged)", () => {
    const latest = JSON.stringify({
      orders: 20,
      skus: {
        "sku-a": { sold: 30, left: 70, sales: 900 },
        "sku-b": { sold: 5, left: 40, sales: 150 },
      },
    });
    const priorLeft = resolvePriorLeftForReorderArrive({
      topicALeft: 70,
      batchInventoryUnits: 70,
    });
    expect(priorLeft).toBe(70);

    const bumped = bumpTopicALeftAfterReorder({
      perSkuSoldLeft: latest,
      skuId: "sku-a",
      addQty: 150,
      priorLeft,
      liveSkuCount: 2,
    });
    expect(bumped).not.toBeNull();
    if (!bumped) return;
    expect(bumped.newLeft).toBe(220);

    const parsed = parsePerSkuSoldLeft(bumped.perSkuSoldLeft);
    expect(parsed.skus["sku-a"]).toEqual({
      sold: 30,
      left: 220,
      sales: 900,
    });
    expect(parsed.skus["sku-b"]).toEqual({ sold: 5, left: 40, sales: 150 });

    const runway = computeRunwayForSkuFromEntries(
      [{ perSkuSoldLeft: bumped.perSkuSoldLeft }],
      "sku-a",
      { liveSkuCount: 2, batchInventoryUnits: 220 },
    );
    expect(resolveUnitsLeftGlance(runway)).toEqual({
      kind: "known",
      unitsLeft: 220,
      weeks: runway.weeks,
    });

    const other = computeRunwayForSkuFromEntries(
      [{ perSkuSoldLeft: bumped.perSkuSoldLeft }],
      "sku-b",
      { liveSkuCount: 2 },
    );
    expect(other.skuLeft).toBe(40);
  });

  it("bumps the week that owns this skuId’s left, not a later Mode C week missing it", () => {
    const entries = [
      {
        id: "w1",
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: { "sku-a": { sold: 10, left: 70, sales: 300 } },
        }),
      },
      {
        id: "w2",
        perSkuSoldLeft: JSON.stringify({
          orders: 8,
          skus: { "sku-b": { sold: 8, left: 40, sales: 240 } },
        }),
      },
    ];
    expect(findTopicARowIndexToBumpLeft(entries, "sku-a", 2)).toBe(0);
    const idx = findTopicARowIndexToBumpLeft(entries, "sku-a", 2);
    const bumped = bumpTopicALeftAfterReorder({
      perSkuSoldLeft: entries[idx]!.perSkuSoldLeft,
      skuId: "sku-a",
      addQty: 150,
      priorLeft: 70,
      liveSkuCount: 2,
    });
    expect(bumped?.newLeft).toBe(220);
    const after = [
      { perSkuSoldLeft: bumped!.perSkuSoldLeft },
      { perSkuSoldLeft: entries[1]!.perSkuSoldLeft },
    ];
    expect(
      computeRunwayForSkuFromEntries(after, "sku-a", { liveSkuCount: 2 })
        .skuLeft,
    ).toBe(220);
  });

  it("legacy sole-SKU Topic A bump keeps sold, only raises left", () => {
    const bumped = bumpTopicALeftAfterReorder({
      perSkuSoldLeft: JSON.stringify({
        orders: 24,
        sku: { sold: 24, left: 70 },
      }),
      skuId: "only",
      addQty: 150,
      priorLeft: 70,
      liveSkuCount: 1,
    });
    expect(bumped?.newLeft).toBe(220);
    const parsed = parsePerSkuSoldLeft(bumped!.perSkuSoldLeft);
    expect(parsed.skuSold).toBe(24);
    expect(parsed.skuLeft).toBe(220);
  });

  it("does not rewrite multi-live legacy weeks (no cross-SKU bleed)", () => {
    expect(
      bumpTopicALeftAfterReorder({
        perSkuSoldLeft: JSON.stringify({
          orders: 24,
          sku: { sold: 24, left: 70 },
        }),
        skuId: "sku-a",
        addQty: 150,
        priorLeft: 70,
        liveSkuCount: 2,
      }),
    ).toBeNull();
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
