import { describe, expect, it } from "vitest";
import {
  DEMAND_ABROAD_STRONG,
  DEMAND_LEBANON_STRONG,
  DEMAND_LEBANON_WEAK,
  DEMAND_NEUTRAL,
  SOFT_MARGIN_AFTER_FLOOR,
  SOFT_MARGIN_AFTER_LIST_MIN,
  SOFT_MARGIN_BEFORE_FLOOR,
  SOFT_MARGIN_BEFORE_LIST_MIN,
} from "@/lib/discovery/scoring/constants";
import { scoreDemand } from "@/lib/discovery/scoring/demand";
import { scoreCompetition } from "@/lib/discovery/scoring/competition";
import { scoreBudgetFight } from "@/lib/discovery/scoring/budget-fight";
import { computeSoftMargin } from "@/lib/discovery/scoring/soft-margin";
import { computeComposite } from "@/lib/discovery/scoring/composite";
import { heuristicScoresFromPoolProduct } from "@/lib/discovery/scoring/heuristics";
import { rankWave2Shortlist } from "@/lib/discovery/scoring/rank";
import { DISCOVERY_FALLBACK_SHORTLIST_MIN } from "@/lib/constants";
import { computeMargin } from "@/lib/skills/margin";
import { computeFit } from "@/lib/skills/fit";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";

describe("soft margin calibration constants", () => {
  it("documents soft band under Wave 1 hard targets and floor below soft", () => {
    expect(SOFT_MARGIN_BEFORE_LIST_MIN).toBe(0.65);
    expect(SOFT_MARGIN_AFTER_LIST_MIN).toBe(0.3);
    expect(SOFT_MARGIN_BEFORE_FLOOR).toBeLessThan(SOFT_MARGIN_BEFORE_LIST_MIN);
    expect(SOFT_MARGIN_AFTER_FLOOR).toBeLessThan(SOFT_MARGIN_AFTER_LIST_MIN);
    expect(SOFT_MARGIN_BEFORE_LIST_MIN).toBeLessThan(0.7);
    expect(SOFT_MARGIN_AFTER_LIST_MIN).toBeLessThan(0.35);
  });
});

describe("scoreDemand", () => {
  it("uses whitespace path when abroad strong and Lebanon weak", () => {
    const r = scoreDemand({
      abroadDemandScore: DEMAND_ABROAD_STRONG + 0.1,
      lebanonDemandScore: DEMAND_LEBANON_WEAK - 0.1,
    });
    expect(r.path).toBe("whitespace");
    expect(r.score).toBeGreaterThan(0.4);
  });

  it("uses local-proven when Lebanon strong", () => {
    const r = scoreDemand({
      abroadDemandScore: 0.2,
      lebanonDemandScore: DEMAND_LEBANON_STRONG + 0.1,
    });
    expect(r.path).toBe("local_proven");
    expect(r.score).toBeGreaterThanOrEqual(DEMAND_LEBANON_STRONG);
  });

  it("fills missing legs with neutral", () => {
    const r = scoreDemand({
      abroadDemandScore: null,
      lebanonDemandScore: null,
    });
    expect(r.usedNeutral).toBe(true);
    expect(r.abroad).toBe(DEMAND_NEUTRAL);
    expect(r.lebanon).toBe(DEMAND_NEUTRAL);
  });
});

describe("scoreCompetition", () => {
  it("never zeroes high competition (still listable)", () => {
    const high = scoreCompetition(0.95);
    expect(high.level).toBe("high");
    expect(high.multiplier).toBeGreaterThan(0.4);
    expect(high.multiplier).toBeLessThan(1);
  });

  it("treats missing competition as neutral", () => {
    const r = scoreCompetition(null);
    expect(r.intensity).toBe(DEMAND_NEUTRAL);
    expect(r.level).toBe("medium");
  });
});

describe("scoreBudgetFight", () => {
  it("applies soft rank penalty only when soft mode and thin budget", () => {
    const soft = scoreBudgetFight({
      competitionLevel: "high",
      budgetUsd: 200,
      monthlyFollowOnBudget: 50,
      moqHint: null,
      sampleCostHint: null,
      softMode: true,
    });
    expect(soft.wouldExclude).toBe(false);
    expect(soft.multiplier).toBeLessThan(1);
    expect(soft.missingHintsNeutral).toBe(true);
  });

  it("missing MOQ/sample stays neutral (no exclude solely for missing)", () => {
    const r = scoreBudgetFight({
      competitionLevel: "low",
      budgetUsd: 5000,
      monthlyFollowOnBudget: 500,
      moqHint: null,
      sampleCostHint: null,
      softMode: true,
    });
    expect(r.multiplier).toBe(1);
    expect(r.missingHintsNeutral).toBe(true);
  });

  it("hard mode shadows would-exclude without requiring hide", () => {
    const hard = scoreBudgetFight({
      competitionLevel: "high",
      budgetUsd: 100,
      monthlyFollowOnBudget: 10,
      softMode: false,
    });
    expect(hard.wouldExclude).toBe(true);
    expect(hard.multiplier).toBeLessThan(1);
  });
});

describe("computeSoftMargin", () => {
  const base = {
    sellPrice: 100,
    productCost: 0,
    intlShip: 0,
    clearanceTaxes: 0,
    localCourier: 0,
    monthlyFollowOnBudget: 0,
  };

  it("pass when hard Wave 1 margins clear", () => {
    // landed 20 → before 0.80; mkt 0 → after 0.80
    const margin = computeMargin({ ...base, productCost: 20 });
    expect(margin.pass).toBe(true);
    expect(computeSoftMargin(margin).band).toBe("pass");
  });

  it("soft_ok slightly under Wave 1 targets", () => {
    // before = 0.66, after ≈ 0.66 with zero ads
    const margin = computeMargin({ ...base, productCost: 34 });
    expect(margin.pass).toBe(false);
    expect(margin.marginBefore).toBeGreaterThanOrEqual(SOFT_MARGIN_BEFORE_LIST_MIN);
    expect(computeSoftMargin(margin).band).toBe("soft_ok");
    expect(computeSoftMargin(margin).note).toBe("margins_tight_vs_target");
  });

  it("far_below when under floor", () => {
    const margin = computeMargin({ ...base, productCost: 50 });
    expect(margin.marginBefore).toBeLessThan(SOFT_MARGIN_BEFORE_FLOOR);
    expect(computeSoftMargin(margin).band).toBe("far_below");
  });
});

function fitOk() {
  return computeFit(
    {
      maxLandedCost: 50,
      experience: "some",
      riskTolerance: "medium",
      hoursPerWeek: 20,
      categoryLikes: [],
    },
    {
      category: "home_kitchen",
      landedCost: 20,
      difficulty: 0,
      risk: 0,
      timeNeed: 4,
      workload: 0,
      storageFootprint: "small",
    },
  );
}

describe("computeComposite", () => {
  it("multiplies demand × competition × budget × Fit then adds soft margin", () => {
    const margin = computeMargin({
      sellPrice: 100,
      productCost: 20,
      intlShip: 0,
      clearanceTaxes: 0,
      localCourier: 0,
      monthlyFollowOnBudget: 300,
    });
    const fit = fitOk();
    const r = computeComposite({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      competitionScore: 0.2,
      confidence: 0.7,
      fit,
      margin,
      budgetUsd: 5000,
      monthlyFollowOnBudget: 500,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "heuristic_seed",
    });
    expect(r.listable).toBe(true);
    expect(r.compositeScore).toBeGreaterThan(0);
    expect(r.explain.demandPath).toBe("whitespace");
    expect(r.explain.explainLine.length).toBeGreaterThan(10);
  });

  it("caps Strong → Okay on high competition", () => {
    const margin = computeMargin({
      sellPrice: 100,
      productCost: 20,
      intlShip: 0,
      clearanceTaxes: 0,
      localCourier: 0,
      monthlyFollowOnBudget: 500,
    });
    const fit = fitOk();
    expect(fit.strength).toBe("Strong");
    const r = computeComposite({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      competitionScore: 0.9,
      confidence: 0.9,
      fit,
      margin,
      budgetUsd: 8000,
      monthlyFollowOnBudget: 800,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "score_cache",
    });
    expect(r.competition.level).toBe("high");
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("high_competition");
    expect(r.listable).toBe(true);
  });

  it("marks soft_ok (under hard margins) as not listable", () => {
    const margin = computeMargin({
      sellPrice: 100,
      productCost: 34,
      intlShip: 0,
      clearanceTaxes: 0,
      localCourier: 0,
      monthlyFollowOnBudget: 0,
    });
    expect(margin.pass).toBe(false);
    const r = computeComposite({
      abroadDemandScore: 0.9,
      lebanonDemandScore: 0.1,
      competitionScore: 0.1,
      confidence: 0.8,
      fit: fitOk(),
      margin,
      budgetUsd: 5000,
      monthlyFollowOnBudget: 500,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "neutral",
    });
    expect(r.softMargin.band).toBe("soft_ok");
    expect(r.listable).toBe(false);
  });

  it("marks far_below soft margin as not listable", () => {
    const margin = computeMargin({
      sellPrice: 100,
      productCost: 55,
      intlShip: 0,
      clearanceTaxes: 0,
      localCourier: 0,
      monthlyFollowOnBudget: 0,
    });
    const r = computeComposite({
      abroadDemandScore: 0.9,
      lebanonDemandScore: 0.1,
      competitionScore: 0.1,
      confidence: 0.8,
      fit: fitOk(),
      margin,
      budgetUsd: 5000,
      monthlyFollowOnBudget: 500,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "neutral",
    });
    expect(r.softMargin.band).toBe("far_below");
    expect(r.listable).toBe(false);
  });
});

describe("heuristicScoresFromPoolProduct", () => {
  it("is deterministic for the same seed row", () => {
    const input = {
      catalogKey: "led_facial_wand",
      category: "beauty_personal_care",
      difficulty: 1,
      risk: 1,
      tier1Marketplaces: "[]",
      nameEn: "LED Facial Wand",
    };
    const a = heuristicScoresFromPoolProduct(input);
    const b = heuristicScoresFromPoolProduct(input);
    expect(a).toEqual(b);
    expect(a.abroadDemandScore).toBeGreaterThan(0);
    expect(a.competitionScore).toBeGreaterThan(0);
    expect(a.confidence).toBeLessThan(0.5);
  });

  it("raises competition when Tier-1 markets are present", () => {
    const plain = heuristicScoresFromPoolProduct({
      catalogKey: "x_plain",
      category: "home_kitchen",
      difficulty: 0,
      risk: 0,
      tier1Marketplaces: "[]",
      nameEn: "Plain",
    });
    const crowded = heuristicScoresFromPoolProduct({
      catalogKey: "x_crowded",
      category: "home_kitchen",
      difficulty: 0,
      risk: 0,
      tier1Marketplaces: JSON.stringify(["Ishtari", "EGLOW"]),
      nameEn: "Crowded",
    });
    expect(crowded.competitionScore!).toBeGreaterThan(plain.competitionScore!);
  });
});

function stubProduct(
  key: string,
  category: CatalogProduct["category"],
  overrides: Partial<CatalogProduct> = {},
): CatalogProduct {
  return {
    key,
    category,
    en: { name: key, summary: "s", differentiation: "d" },
    ar: { name: key, summary: "s", differentiation: "d" },
    sellPrice: 40,
    productCost: 5,
    intlShip: 2,
    clearanceTaxes: 1,
    localCourier: 2,
    difficulty: 0,
    risk: 0,
    timeNeed: 4,
    workload: 0,
    storageFootprint: "small",
    oversized: false,
    tier1Marketplaces: [],
    ...overrides,
  };
}

function stubScore(partial: Partial<ScoreRow> & { id: string }): ScoreRow {
  return {
    poolProductId: partial.id,
    abroadDemandScore: 0.7,
    lebanonDemandScore: 0.2,
    competitionScore: 0.2,
    budgetFightPenalty: null,
    compositeScore: 0.5,
    demandPath: "whitespace",
    confidence: 0.35,
    explainLine: "t",
    lastScoredAt: "t",
    lastScoreStatus: "ok",
    lastError: null,
    shadowWouldExclude: false,
    shadowExcludeReason: null,
    rawEvidenceJson: null,
    createdAt: "t",
    updatedAt: "t",
    ...partial,
  };
}

describe("rankWave2Shortlist accept-ready only", () => {
  it("does not soft-fill when fewer than 5 passers — empty or accept-ready only", () => {
    // Only 2 products with hard margins; rest far_below via huge cost.
    const catalog = [
      stubProduct("a", "home_kitchen"),
      stubProduct("b", "beauty_personal_care"),
      stubProduct("c", "fitness_lifestyle", {
        productCost: 80,
        sellPrice: 40,
      }),
      stubProduct("d", "pet_accessories", {
        productCost: 80,
        sellPrice: 40,
      }),
      stubProduct("e", "car_accessories", {
        productCost: 80,
        sellPrice: 40,
      }),
    ];
    const scores = new Map<string, ScoreRow>([
      ["a", stubScore({ id: "1" })],
      ["b", stubScore({ id: "2" })],
    ]);

    const ranked = rankWave2Shortlist(
      {
        maxLandedCost: 100,
        experience: "experienced",
        riskTolerance: "high",
        hoursPerWeek: 40,
        categoryLikes: [],
        budgetUsd: 8000,
        monthlyFollowOnBudget: 800,
      },
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked.map((r) => r.p.key).sort()).toEqual(["a", "b"]);
    expect(ranked.every((r) => r.margin.pass)).toBe(true);
    expect(ranked.every((r) => !r.fallbackUsed)).toBe(true);
    expect(ranked.filter((r) => r.explain.softMarginBand === "far_below").length).toBe(0);
    expect(DISCOVERY_FALLBACK_SHORTLIST_MIN).toBe(5);
  });

  it("keeps high-competition products listable as Okay when accept-ready", () => {
    const catalog = [
      stubProduct("hi", "phone_tech_accessories", {
        tier1Marketplaces: ["Ishtari", "EGLOW"],
      }),
    ];
    const scores = new Map<string, ScoreRow>([
      [
        "hi",
        stubScore({
          id: "h",
          competitionScore: 0.92,
          abroadDemandScore: 0.75,
          lebanonDemandScore: 0.25,
          confidence: 0.8,
        }),
      ],
    ]);
    const ranked = rankWave2Shortlist(
      {
        maxLandedCost: 100,
        experience: "experienced",
        riskTolerance: "high",
        hoursPerWeek: 40,
        categoryLikes: ["phone_tech_accessories"],
        budgetUsd: 10000,
        monthlyFollowOnBudget: 1000,
      },
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );
    expect(ranked[0].strength).toBe("Okay");
    expect(ranked[0].okayReason).toBe("high_competition");
    expect(ranked[0].riskRead).toBe("@listing.highCompetition");
    expect(ranked[0].notRecommended).toBe(false);
  });
});
