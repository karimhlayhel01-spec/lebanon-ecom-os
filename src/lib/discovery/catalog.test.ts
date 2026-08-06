import { describe, expect, it } from "vitest";
import { CATALOG, curatedDemandProvider } from "@/lib/discovery/catalog";
import {
  landedCostOf,
  selectLandedCostPool,
} from "@/lib/discovery/service";
import { MAX_LANDED_SOFT_OVERAGE } from "@/lib/constants";
import { computeMargin } from "@/lib/skills/margin";

function evaluate() {
  return CATALOG.map((p) => {
    const margin = computeMargin({
      sellPrice: p.sellPrice,
      productCost: p.productCost,
      intlShip: p.intlShip,
      clearanceTaxes: p.clearanceTaxes,
      localCourier: p.localCourier,
      monthlyFollowOnBudget: 500,
    });
    const acceptable = margin.pass && !p.oversized;
    return { p, margin, acceptable };
  });
}

describe("curated catalog", () => {
  it("uses stable unique keys", () => {
    const keys = new Set(CATALOG.map((p) => p.key));
    expect(keys.size).toBe(CATALOG.length);
  });

  it("has enough acceptable products so the first page can be accept-ready", () => {
    const evaluated = evaluate();
    const acceptable = evaluated.filter((e) => e.acceptable);
    // Ranking lists accept-ready only; >= 5 supports a full first page.
    expect(acceptable.length).toBeGreaterThanOrEqual(5);
  });

  it("still includes blocked and oversized products in catalog for realism", () => {
    const evaluated = evaluate();
    expect(evaluated.some((e) => !e.margin.pass)).toBe(true);
    expect(evaluated.some((e) => e.p.oversized)).toBe(true);
  });

  it("flags Tier-1 conflicts only against Ishtari / EGLOW / Platza", () => {
    const allowed = new Set(["Ishtari", "EGLOW", "Platza"]);
    for (const p of CATALOG) {
      for (const m of p.tier1Marketplaces) {
        expect(allowed.has(m)).toBe(true);
      }
    }
  });
});

describe("discovery landed-cost pool (Fix #2)", () => {
  it("hard-excludes products way over maxLandedCost (> 1.2×)", () => {
    // Seed profile: maxLandedCost = 18 → ceiling 21.6.
    const pool = selectLandedCostPool(CATALOG, 18);
    const keys = new Set(pool.map((p) => p.key));
    // smart_scale ($22) and premium_blender ($25) are way over 21.6.
    expect(keys.has("smart_scale")).toBe(false);
    expect(keys.has("premium_blender")).toBe(false);
    // Every product left is within the 1.2× band.
    for (const p of pool) {
      expect(landedCostOf(p)).toBeLessThanOrEqual(18 * MAX_LANDED_SOFT_OVERAGE);
    }
  });

  it("keeps products only slightly over maxLandedCost (<= 1.2×)", () => {
    // maxLandedCost = 20 → ceiling 24. smart_scale ($22) is slightly over → stays.
    const pool = selectLandedCostPool(CATALOG, 20);
    const keys = new Set(pool.map((p) => p.key));
    expect(keys.has("smart_scale")).toBe(true);
    // premium_blender ($25) is still over 24 → excluded.
    expect(keys.has("premium_blender")).toBe(false);
  });

  it("never returns an empty pool — falls back to least-over products", () => {
    // maxLandedCost so low every product is way over → fallback to least-over.
    const pool = selectLandedCostPool(CATALOG, 1);
    expect(pool.length).toBeGreaterThan(0);
    // Fallback is sorted cheapest landed cost first.
    const costs = pool.map(landedCostOf);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });
});

describe("curated demand provider", () => {
  it("produces a structured bilingual summary with higher confidence for more signals", () => {
    const one = curatedDemandProvider.summarize({
      productName: "Test",
      category: "home_kitchen",
      note: "seen trending",
      locale: "en",
    });
    const three = curatedDemandProvider.summarize({
      productName: "Test",
      category: "home_kitchen",
      url: "https://x",
      note: "seen trending",
      screenshotNote: "screenshot",
      locale: "en",
    });
    expect(one.summary).toContain("Test");
    expect(three.confidence).toBeGreaterThan(one.confidence);

    const ar = curatedDemandProvider.summarize({
      productName: "منتج",
      category: "home_kitchen",
      note: "رائج",
      locale: "ar",
    });
    expect(ar.summary).toContain("منتج");
  });
});
