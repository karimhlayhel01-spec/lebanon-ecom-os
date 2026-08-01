import { describe, expect, it } from "vitest";
import {
  computeRunwayForSkuFromEntries,
  computeRunwayForSkuWithImportBatch,
  computeUnitsLeftFromReceivedSold,
  extractSkuTopicASeries,
  extractSkuInventoryLedger,
  resolveUnitsLeftGlance,
  shouldShowUnitsLeftOnHub,
  batchInventoryUnitsFromImportBatch,
  resolveSkuLeftWithBatchBootstrap,
  resolveTotalUnitsReceived,
  resolvePriorLeftForReorderArrive,
  bumpTopicALeftAfterReorder,
  findTopicARowIndexToBumpLeft,
} from "@/lib/finance/sku-runway";
import {
  computePersistedUnitsLeft,
  parsePerSkuSoldLeft,
} from "@/lib/finance/service";

describe("computeUnitsLeftFromReceivedSold", () => {
  it("received 150, week1 sold 30 → left 120", () => {
    expect(computeUnitsLeftFromReceivedSold(150, 30)).toBe(120);
    expect(
      computePersistedUnitsLeft({
        totalUnitsReceived: 150,
        priorUnitsSold: 0,
        thisWeekSold: 30,
      }),
    ).toBe(120);
  });

  it("week2 sold 20 after prior 30 → left 100", () => {
    expect(computeUnitsLeftFromReceivedSold(150, 50)).toBe(100);
    expect(
      computePersistedUnitsLeft({
        totalUnitsReceived: 150,
        priorUnitsSold: 30,
        thisWeekSold: 20,
      }),
    ).toBe(100);
  });

  it("reorder +150 then sold 10 → left 240 (300 − 60)", () => {
    expect(computeUnitsLeftFromReceivedSold(300, 60)).toBe(240);
    expect(
      computePersistedUnitsLeft({
        totalUnitsReceived: 300,
        priorUnitsSold: 50,
        thisWeekSold: 10,
      }),
    ).toBe(240);
  });

  it("received unknown → null persisted (never invent 0)", () => {
    expect(computeUnitsLeftFromReceivedSold(null, 10)).toBeNull();
    expect(
      computePersistedUnitsLeft({
        totalUnitsReceived: null,
        priorUnitsSold: 0,
        thisWeekSold: 10,
      }),
    ).toBeNull();
  });

  it("unknown received → save week left stays unknown (not glance 0)", () => {
    const left = computePersistedUnitsLeft({
      totalUnitsReceived: null,
      priorUnitsSold: 0,
      thisWeekSold: 30,
    });
    expect(left).toBeNull();

    const serialized = JSON.stringify({
      orders: 10,
      skus: { "sku-a": { sold: 30, left, sales: 900 } },
    });
    const entries = [{ perSkuSoldLeft: serialized }];
    const runway = computeRunwayForSkuWithImportBatch(entries, "sku-a", {
      liveSkuCount: 1,
      importBatch: {
        totalUnitsReceived: null,
        unitsLeft: null,
        suggestedFirstBatch: null,
      },
      batchArrivedReady: true,
    });
    expect(runway.skuLeft).toBeNull();
    expect(resolveUnitsLeftGlance(runway)).toEqual({ kind: "unknown" });
    expect(resolveUnitsLeftGlance(runway)).not.toMatchObject({ unitsLeft: 0 });
  });

  it("manual left cannot override computed left", () => {
    const computed = computePersistedUnitsLeft({
      totalUnitsReceived: 150,
      priorUnitsSold: 0,
      thisWeekSold: 30,
    });
    const manualOverrideAttempt = 999;
    expect(computed).toBe(120);
    expect(computed).not.toBe(manualOverrideAttempt);
  });
});

describe("extractSkuInventoryLedger multi-SKU isolation", () => {
  it("sums sold per skuId only", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: {
            a: { sold: 30, left: 120, sales: 900 },
            b: { sold: 5, left: 40, sales: 150 },
          },
        }),
      },
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 12,
          skus: {
            a: { sold: 20, left: 100, sales: 600 },
            b: { sold: 6, left: 34, sales: 180 },
          },
        }),
      },
    ];
    expect(extractSkuInventoryLedger(entries, "a", { liveSkuCount: 2 })).toEqual(
      { cumulativeSold: 50, lastLeft: 100 },
    );
    expect(extractSkuInventoryLedger(entries, "b", { liveSkuCount: 2 })).toEqual(
      { cumulativeSold: 11, lastLeft: 34 },
    );
  });
});

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

  it("prefers totalUnitsReceived, then unitsLeft, over suggestedFirstBatch", () => {
    expect(
      batchInventoryUnitsFromImportBatch(
        { suggestedFirstBatch: 100, unitsLeft: 150, totalUnitsReceived: 300 },
        { batchArrivedReady: true },
      ),
    ).toBe(300);
    expect(
      batchInventoryUnitsFromImportBatch(
        { suggestedFirstBatch: 100, unitsLeft: 150 },
        { batchArrivedReady: true },
      ),
    ).toBe(150);
  });

  it("Topic A left wins over batch bootstrap once weeks exist (legacy helper)", () => {
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
      totalUnitsReceived: 150,
    });
    expect(runway.skuLeft).toBe(150);
    const glance = resolveUnitsLeftGlance(runway);
    expect(glance).toEqual({ kind: "known", unitsLeft: 150, weeks: null });

    const other = computeRunwayForSkuFromEntries(empty, "sku-b", {
      liveSkuCount: 2,
      totalUnitsReceived: null,
    });
    expect(other.skuLeft).toBeNull();
    expect(resolveUnitsLeftGlance(other)).toEqual({ kind: "unknown" });
  });

  it("after Topic A log week, left = received − sold (not founder-typed left)", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: { "sku-a": { sold: 10, left: 999, sales: 300 } },
        }),
      },
    ];
    const runway = computeRunwayForSkuFromEntries(entries, "sku-a", {
      liveSkuCount: 1,
      totalUnitsReceived: 150,
    });
    expect(runway.skuLeft).toBe(140);
  });
});

describe("reorder arrive inventory ledger", () => {
  it("received 100 + reorder 150, sold 30 → glance 220 (no Topic A bump needed)", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 20,
          skus: {
            "sku-a": { sold: 30, left: 70, sales: 900 },
            "sku-b": { sold: 5, left: 40, sales: 150 },
          },
        }),
      },
    ];
    const { cumulativeSold, lastLeft } = extractSkuInventoryLedger(
      entries,
      "sku-a",
      { liveSkuCount: 2 },
    );
    expect(cumulativeSold).toBe(30);
    const priorReceived = resolveTotalUnitsReceived(
      { totalUnitsReceived: 100, unitsLeft: 70 },
      {
        batchArrivedReady: true,
        topicALeft: lastLeft,
        cumulativeSold,
      },
    );
    expect(priorReceived).toBe(100);
    const afterReceived = priorReceived! + 150;
    const left = computeUnitsLeftFromReceivedSold(afterReceived, cumulativeSold);
    expect(left).toBe(220);

    const runway = computeRunwayForSkuWithImportBatch(entries, "sku-a", {
      liveSkuCount: 2,
      importBatch: { totalUnitsReceived: afterReceived, unitsLeft: left },
      batchArrivedReady: true,
    });
    expect(resolveUnitsLeftGlance(runway)).toEqual({
      kind: "known",
      unitsLeft: 220,
      weeks: runway.weeks,
    });

    const other = computeRunwayForSkuWithImportBatch(entries, "sku-b", {
      liveSkuCount: 2,
      importBatch: { totalUnitsReceived: 45, unitsLeft: 40 },
      batchArrivedReady: true,
    });
    expect(other.skuLeft).toBe(40);
  });

  it("legacy reconstruct: Topic A left + sold ≈ received when ledger field missing", () => {
    const entries = [
      {
        perSkuSoldLeft: JSON.stringify({
          orders: 10,
          skus: { "sku-a": { sold: 30, left: 70, sales: 900 } },
        }),
      },
    ];
    const { cumulativeSold, lastLeft } = extractSkuInventoryLedger(
      entries,
      "sku-a",
      { liveSkuCount: 1 },
    );
    const received = resolveTotalUnitsReceived(
      { unitsLeft: 70, suggestedFirstBatch: 100 },
      {
        batchArrivedReady: true,
        topicALeft: lastLeft,
        cumulativeSold,
      },
    );
    expect(received).toBe(100);
    expect(computeUnitsLeftFromReceivedSold(received, cumulativeSold)).toBe(70);
  });
});

describe("deprecated Topic A left bump helpers (legacy)", () => {
  it("Topic A left 70 + reorder qty 150 → 220 (Mode C, other SKU unchanged)", () => {
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
    // No received ledger → fall back to last stored left.
    const runway = computeRunwayForSkuFromEntries(entries, "sku");
    const glance = resolveUnitsLeftGlance(runway);
    expect(glance.kind).toBe("known");
    if (glance.kind === "known") {
      expect(glance.unitsLeft).toBe(20);
      expect(glance.weeks).toBe(runway.weeks);
    }
  });

  it("with received ledger: left = received − cumulative sold", () => {
    const entries = [
      { perSkuSoldLeft: JSON.stringify({ orders: 24, sold: 24, left: 126 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 30, sold: 30, left: 96 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 36, sold: 36, left: 60 }) },
      { perSkuSoldLeft: JSON.stringify({ orders: 40, sold: 40, left: 20 }) },
    ];
    const runway = computeRunwayForSkuFromEntries(entries, "sku", {
      totalUnitsReceived: 150,
    });
    // 24+30+36+40 = 130 sold → 150−130 = 20
    expect(runway.skuLeft).toBe(20);
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
