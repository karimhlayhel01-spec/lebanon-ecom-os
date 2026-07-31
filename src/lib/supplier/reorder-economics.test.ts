import { describe, expect, it } from "vitest";
import { INVEST_NEXT_MIN_WEEKS } from "@/lib/constants";
import {
  evaluateReorderEconomicsGate,
} from "@/lib/supplier/reorder";
import {
  resolveSkuInvestNextTone,
  sliceTopicAWeekForSku,
  topicAWeekFromRow,
  type SkuTopicAWeekForEconomics,
} from "@/lib/supplier/reorder-economics";

function legacyWeek(
  n: number,
  opts: {
    sales: number;
    sold: number;
    ads?: number;
    courier?: number;
  },
): SkuTopicAWeekForEconomics {
  return {
    weekStart: `2026-0${n}-01`,
    sales: opts.sales,
    skuSold: opts.sold,
    metaSpend: opts.ads ?? 0,
    tiktokSpend: 0,
    courierFees: opts.courier ?? 0,
  };
}

function modeCWeek(
  n: number,
  opts: {
    shopAds?: number;
    shopCourier?: number;
    a: { sales: number; sold: number; left?: number };
    b: { sales: number; sold: number; left?: number };
  },
): SkuTopicAWeekForEconomics {
  const skus = {
    a: {
      sales: opts.a.sales,
      sold: opts.a.sold,
      left: opts.a.left ?? 10,
    },
    b: {
      sales: opts.b.sales,
      sold: opts.b.sold,
      left: opts.b.left ?? 10,
    },
  };
  return {
    weekStart: `2026-0${n}-01`,
    sales: opts.a.sales + opts.b.sales,
    skuSold: opts.a.sold + opts.b.sold,
    metaSpend: opts.shopAds ?? 0,
    tiktokSpend: 0,
    courierFees: opts.shopCourier ?? 0,
    skus,
  };
}

describe("topicAWeekFromRow / sliceTopicAWeekForSku", () => {
  it("parses Mode C and skips missing sku lines", () => {
    const week = topicAWeekFromRow({
      weekStart: "2026-01-06",
      storeTotalsUsd: 999,
      metaSpend: 40,
      tiktokSpend: 10,
      courierFees: 20,
      perSkuSoldLeft: JSON.stringify({
        orders: 5,
        skus: {
          a: { sold: 10, left: 5, sales: 200 },
          b: { sold: 20, left: 8, sales: 400 },
        },
      }),
    });
    expect(week.sales).toBe(600);
    expect(sliceTopicAWeekForSku(week, "a")?.sales).toBe(200);
    expect(sliceTopicAWeekForSku(week, "missing")).toBeNull();
  });

  it("legacy weeks treat whole week as this SKU", () => {
    const week = topicAWeekFromRow({
      weekStart: "2026-01-06",
      storeTotalsUsd: 500,
      metaSpend: 50,
      tiktokSpend: 0,
      courierFees: 30,
      perSkuSoldLeft: JSON.stringify({
        orders: 10,
        sku: { sold: 25, left: 40 },
      }),
    });
    expect(week.skus).toBeUndefined();
    expect(sliceTopicAWeekForSku(week, "any-id")).toEqual({
      sales: 500,
      sold: 25,
      shopSales: 500,
      ads: 50,
      courier: 30,
    });
  });
});

describe("resolveSkuInvestNextTone", () => {
  it("returns null with fewer than INVEST_NEXT_MIN_WEEKS usable weeks", () => {
    const entries = [1, 2, 3].map((n) =>
      legacyWeek(n, { sales: 400, sold: 20, ads: 20, courier: 10 }),
    );
    expect(
      resolveSkuInvestNextTone({
        skuId: "solo",
        entries,
        importCogsPerUnit: 5,
      }),
    ).toBeNull();
    expect(INVEST_NEXT_MIN_WEEKS).toBe(4);
  });

  it("single-SKU legacy: reinvest when profitable + after ≥ 35%", () => {
    // sales 400, sold 20, cogs 5*20=100, ads 20, courier 10
    // net = 400-100-30 = 270; after = 270/400 = 0.675 ≥ 0.35
    const entries = [1, 2, 3, 4].map((n) =>
      legacyWeek(n, { sales: 400, sold: 20, ads: 20, courier: 10 }),
    );
    expect(
      resolveSkuInvestNextTone({
        skuId: "solo",
        entries,
        importCogsPerUnit: 5,
      }),
    ).toBe("reinvest");
  });

  it("single-SKU legacy: fix_economics when net > 0 but after < 35%", () => {
    // sales 200, sold 20, cogs 5*20=100, ads 80, courier 20
    // net = 200-100-100 = 0… bump ads lower: ads 50 → net=30, after=30/200=0.15
    const entries = [1, 2, 3, 4].map((n) =>
      legacyWeek(n, { sales: 200, sold: 20, ads: 50, courier: 20 }),
    );
    expect(
      resolveSkuInvestNextTone({
        skuId: "solo",
        entries,
        importCogsPerUnit: 5,
      }),
    ).toBe("fix_economics");
  });

  it("single-SKU legacy: hold when not profitable", () => {
    const entries = [1, 2, 3, 4].map((n) =>
      legacyWeek(n, { sales: 100, sold: 20, ads: 40, courier: 20 }),
    );
    // cogs 100, shared 60 → net = 100-100-60 = -60
    expect(
      resolveSkuInvestNextTone({
        skuId: "solo",
        entries,
        importCogsPerUnit: 5,
      }),
    ).toBe("hold");
  });

  it("multi-SKU Mode C: weak SKU A blocked while healthy SKU B is reinvest", () => {
    // Shop blended looks strong (B dominates sales), but A is thin after share.
    // Each week: A sales 100 sold 10 cogs@8=80; B sales 500 sold 50 cogs@5=250
    // shop ads 40 + courier 20 = 60 shared
    // A share = 100/600 → allocated 10; net A = 100-80-10 = 10; after = 0.10 → fix_economics
    // B share = 500/600 → allocated 50; net B = 500-250-50 = 200; after = 0.40 → reinvest
    const entries = [1, 2, 3, 4].map((n) =>
      modeCWeek(n, {
        shopAds: 40,
        shopCourier: 20,
        a: { sales: 100, sold: 10 },
        b: { sales: 500, sold: 50 },
      }),
    );

    const toneA = resolveSkuInvestNextTone({
      skuId: "a",
      entries,
      importCogsPerUnit: 8,
    });
    const toneB = resolveSkuInvestNextTone({
      skuId: "b",
      entries,
      importCogsPerUnit: 5,
    });

    expect(toneA).toBe("fix_economics");
    expect(toneB).toBe("reinvest");

    // Shop would be healthy overall — but reorder must not bleed B into A.
    expect(
      evaluateReorderEconomicsGate({
        experience: "beginner",
        investNextRecommendation: toneA,
      }),
    ).toEqual({ ok: false, error: "beginner_blocked" });
    expect(
      evaluateReorderEconomicsGate({
        experience: "some",
        investNextRecommendation: toneA,
      }),
    ).toEqual({ ok: true, warning: "weak_economics" });
    expect(
      evaluateReorderEconomicsGate({
        experience: "beginner",
        investNextRecommendation: toneB,
      }),
    ).toEqual({ ok: true });
  });

  it("multi-SKU: SKU missing from Mode C weeks stays null (no bleed)", () => {
    const entries = [1, 2, 3, 4].map((n) =>
      modeCWeek(n, {
        shopAds: 10,
        a: { sales: 300, sold: 15 },
        b: { sales: 300, sold: 15 },
      }),
    );
    expect(
      resolveSkuInvestNextTone({
        skuId: "c-not-in-weeks",
        entries,
        importCogsPerUnit: 5,
      }),
    ).toBeNull();
  });
});
