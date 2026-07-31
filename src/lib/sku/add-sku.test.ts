import { describe, expect, it } from "vitest";
import { computeHealth } from "@/lib/finance/service";
import {
  extractWeekVerdictsOrderedByWeekStart,
  previousSkuLooksWeakFromRows,
  weeklyInputForPreviousSku,
} from "@/lib/sku/add-sku";

describe("extractWeekVerdictsOrderedByWeekStart", () => {
  it("orders by weekStart even when createdAt / insert order differs", () => {
    // Inserted newest-first by createdAt, but weekStart chronology is reverse.
    const rows = [
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-02-03",
          health: { verdict: "healthy" },
        }),
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-01-06",
          health: { verdict: "watch" },
        }),
        createdAt: "2026-03-02T00:00:00.000Z",
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-01-13",
          health: { verdict: "healthy" },
        }),
        createdAt: "2026-03-03T00:00:00.000Z",
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-01-20",
          health: { verdict: "healthy" },
        }),
        createdAt: "2026-03-04T00:00:00.000Z",
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-01-27",
          health: { verdict: "healthy" },
        }),
        createdAt: "2026-03-05T00:00:00.000Z",
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-02-10",
          health: { verdict: "healthy" },
        }),
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    const ordered = extractWeekVerdictsOrderedByWeekStart(rows);
    expect(ordered).toEqual([
      "watch",
      "healthy",
      "healthy",
      "healthy",
      "healthy",
      "healthy",
    ]);
    // Last 5 consecutive by weekStart are all healthy (not by createdAt).
    expect(ordered.slice(-5)).toEqual([
      "healthy",
      "healthy",
      "healthy",
      "healthy",
      "healthy",
    ]);
    // If we had followed createdAt insert order, last-5 would include the early watch.
    const byCreatedAtPayloadOrder = rows.map((r) => {
      const p = JSON.parse(r.payload) as { health: { verdict: string } };
      return p.health.verdict;
    });
    expect(byCreatedAtPayloadOrder.slice(-5)).not.toEqual(ordered.slice(-5));
  });

  it("sorts missing weekStart last", () => {
    const rows = [
      {
        kind: "weekly_health",
        payload: JSON.stringify({ health: { verdict: "risk" } }),
      },
      {
        kind: "weekly_health",
        payload: JSON.stringify({
          weekStart: "2026-01-06",
          health: { verdict: "healthy" },
        }),
      },
    ];
    expect(extractWeekVerdictsOrderedByWeekStart(rows)).toEqual([
      "healthy",
      "risk",
    ]);
  });
});

describe("weeklyInputForPreviousSku / previousSkuLooksWeakFromRows", () => {
  it("Mode C: allocates ads+courier by sales share — small SKU not charged full shop ads", () => {
    const row = {
      weekStart: "2026-01-06",
      storeTotalsUsd: 1000,
      metaSpend: 400,
      tiktokSpend: 0,
      courierFees: 100,
      codCollected: 800,
      codOutstanding: 0,
      perSkuSoldLeft: JSON.stringify({
        orders: 40,
        skus: {
          prev: { sold: 5, left: 20, sales: 100 },
          other: { sold: 45, left: 50, sales: 900 },
        },
      }),
    };

    const input = weeklyInputForPreviousSku("prev", row);
    expect(input).not.toBeNull();
    expect(input!.sales).toBe(100);
    expect(input!.skuSold).toBe(5);
    // 100/1000 share → 10% of 400 ads + 100 courier
    expect(input!.metaSpend).toBeCloseTo(40);
    expect(input!.courierFees).toBeCloseTo(10);

    const basis = { importCogsPerUnit: 5, usesQuotes: true };
    // Full-shop ads would be watch (100/400 ROAS < 2); fair share is healthy.
    const fair = computeHealth(input!, basis);
    expect(fair.verdict).toBe("healthy");

    const unfair = computeHealth(
      {
        ...input!,
        metaSpend: 400,
        tiktokSpend: 0,
        courierFees: 100,
      },
      basis,
    );
    expect(unfair.verdict).not.toBe("healthy");
  });

  it("Mode C soft signal: high shop ads + small share → not falsely weak", () => {
    const weeks = [1, 2, 3, 4, 5].map((n) => ({
      weekStart: `2026-0${n}-01`,
      storeTotalsUsd: 1000,
      metaSpend: 400,
      tiktokSpend: 0,
      courierFees: 50,
      codCollected: 900,
      codOutstanding: 0,
      perSkuSoldLeft: JSON.stringify({
        orders: 40,
        skus: {
          prev: { sold: 5, left: 20, sales: 100 },
          other: { sold: 45, left: 50, sales: 900 },
        },
      }),
    }));

    expect(
      previousSkuLooksWeakFromRows("prev", weeks, {
        importCogsPerUnit: 5,
        usesQuotes: true,
      }),
    ).toBe(false);
  });

  it("legacy weeks still attribute the whole week to previousId", () => {
    const input = weeklyInputForPreviousSku("prev", {
      weekStart: "2026-01-06",
      storeTotalsUsd: 500,
      metaSpend: 50,
      tiktokSpend: 10,
      courierFees: 30,
      codCollected: 400,
      codOutstanding: 50,
      perSkuSoldLeft: JSON.stringify({
        orders: 20,
        sku: { sold: 25, left: 40 },
      }),
    });
    expect(input).toMatchObject({
      sales: 500,
      skuSold: 25,
      metaSpend: 50,
      tiktokSpend: 10,
      courierFees: 30,
    });
  });
});
