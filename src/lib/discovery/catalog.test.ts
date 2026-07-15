import { describe, expect, it } from "vitest";
import { CATALOG, curatedDemandProvider } from "@/lib/discovery/catalog";
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

  it("has enough acceptable products so the first page is never all-blocked", () => {
    const evaluated = evaluate();
    const acceptable = evaluated.filter((e) => e.acceptable);
    // Ranking pushes acceptable products first; >= 5 guarantees a clean page.
    expect(acceptable.length).toBeGreaterThanOrEqual(5);
  });

  it("still includes blocked and oversized products for realism", () => {
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
