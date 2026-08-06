import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  computeComposite,
  resolveOkayReason,
  riskReadForOkayReason,
} from "@/lib/discovery/scoring/composite";
import { HEURISTIC_SEED_CONFIDENCE } from "@/lib/discovery/scoring/constants";
import { rankWave2Shortlist } from "@/lib/discovery/scoring/rank";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";
import { computeFit } from "@/lib/skills/fit";
import { computeMargin } from "@/lib/skills/margin";

function fitStrong100() {
  const fit = computeFit(
    {
      maxLandedCost: 100,
      experience: "experienced",
      riskTolerance: "high",
      hoursPerWeek: 40,
      categoryLikes: ["home_kitchen"],
    },
    {
      category: "home_kitchen",
      landedCost: 10,
      difficulty: 0,
      risk: 0,
      timeNeed: 2,
      workload: 0,
      storageFootprint: "small",
    },
  );
  expect(fit.strength).toBe("Strong");
  expect(fit.score).toBeGreaterThanOrEqual(100);
  return fit;
}

function fitModerate() {
  const fit = computeFit(
    {
      maxLandedCost: 25,
      experience: "beginner",
      riskTolerance: "medium",
      hoursPerWeek: 10,
      categoryLikes: [],
    },
    {
      category: "home_kitchen",
      landedCost: 50,
      difficulty: 2,
      risk: 0,
      timeNeed: 4,
      workload: 0,
      storageFootprint: "medium",
    },
  );
  expect(fit.score).toBeLessThan(70);
  expect(fit.strength).toBe("Okay");
  expect(fit.riskRead).toBe("@fit.moderateOkay");
  return fit;
}

function hardPassMargin() {
  return computeMargin({
    sellPrice: 100,
    productCost: 20,
    intlShip: 0,
    clearanceTaxes: 0,
    localCourier: 0,
    monthlyFollowOnBudget: 500,
  });
}

function stubProduct(
  key: string,
  overrides: Partial<CatalogProduct> = {},
): CatalogProduct {
  return {
    key,
    category: "home_kitchen",
    en: { name: key, summary: "s", differentiation: "d" },
    ar: { name: key, summary: "s", differentiation: "d" },
    sellPrice: 40,
    productCost: 5,
    intlShip: 2,
    clearanceTaxes: 1,
    localCourier: 2,
    difficulty: 0,
    risk: 0,
    timeNeed: 2,
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
    abroadDemandScore: 0.8,
    lebanonDemandScore: 0.2,
    competitionScore: 0.2,
    budgetFightPenalty: null,
    compositeScore: 0.5,
    demandPath: "whitespace",
    confidence: 0.8,
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

describe("Okay reason tracking", () => {
  it("resolveOkayReason chooses one actionable reason", () => {
    expect(
      resolveOkayReason({
        listingStrength: "Strong",
        fitStrength: "Strong",
        capStrengthOkay: false,
        competitionHigh: false,
      }),
    ).toBeNull();
    expect(
      resolveOkayReason({
        listingStrength: "Okay",
        fitStrength: "Strong",
        capStrengthOkay: true,
        competitionHigh: false,
      }),
    ).toBe("low_evidence_confidence");
    expect(
      resolveOkayReason({
        listingStrength: "Okay",
        fitStrength: "Strong",
        capStrengthOkay: false,
        competitionHigh: true,
      }),
    ).toBe("high_competition");
    expect(
      resolveOkayReason({
        listingStrength: "Okay",
        fitStrength: "Okay",
        capStrengthOkay: false,
        competitionHigh: false,
      }),
    ).toBe("fit_risk");
    expect(
      resolveOkayReason({
        listingStrength: "Okay",
        fitStrength: "Strong",
        capStrengthOkay: true,
        competitionHigh: true,
      }),
    ).toBe("high_competition");
  });

  it("Fit 100 + heuristic confidence 0.35 → Okay + low-confidence note, never Fit moderate", () => {
    const fit = fitStrong100();
    const r = computeComposite({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      competitionScore: 0.2,
      confidence: HEURISTIC_SEED_CONFIDENCE,
      fit,
      margin: hardPassMargin(),
      budgetUsd: 8000,
      monthlyFollowOnBudget: 800,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "heuristic_seed",
    });
    expect(fit.score).toBe(100);
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("low_evidence_confidence");
    expect(riskReadForOkayReason(r.okayReason, fit.riskRead)).toBe(
      "@listing.lowEvidenceConfidence",
    );
    expect(riskReadForOkayReason(r.okayReason, fit.riskRead)).not.toBe(
      "@fit.moderateOkay",
    );
  });

  it("Fit 100 + high competition → competition explanation", () => {
    const fit = fitStrong100();
    const r = computeComposite({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      competitionScore: 0.92,
      confidence: 0.9,
      fit,
      margin: hardPassMargin(),
      budgetUsd: 10000,
      monthlyFollowOnBudget: 1000,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "score_cache",
    });
    expect(r.competition.level).toBe("high");
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("high_competition");
    expect(riskReadForOkayReason(r.okayReason, fit.riskRead)).toBe(
      "@listing.highCompetition",
    );
  });

  it("genuine moderate Fit → Fit explanation", () => {
    const fit = fitModerate();
    const r = computeComposite({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      competitionScore: 0.2,
      confidence: 0.9,
      fit,
      margin: hardPassMargin(),
      budgetUsd: 5000,
      monthlyFollowOnBudget: 500,
      softCompetitionBudget: true,
      category: "home_kitchen",
      evidenceSource: "score_cache",
    });
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("fit_risk");
    expect(riskReadForOkayReason(r.okayReason, fit.riskRead)).toBe(
      "@fit.moderateOkay",
    );
  });

  it("rankWave2Shortlist wires Okay reason into riskRead", () => {
    const catalog = [stubProduct("led")];
    const scores = new Map<string, ScoreRow>([
      [
        "led",
        stubScore({
          id: "1",
          confidence: HEURISTIC_SEED_CONFIDENCE,
          competitionScore: 0.2,
        }),
      ],
    ]);
    const ranked = rankWave2Shortlist(
      {
        maxLandedCost: 100,
        experience: "experienced",
        riskTolerance: "high",
        hoursPerWeek: 40,
        categoryLikes: ["home_kitchen"],
        budgetUsd: 8000,
        monthlyFollowOnBudget: 800,
      },
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );
    expect(ranked[0]?.fit.score).toBe(100);
    expect(ranked[0]?.strength).toBe("Okay");
    expect(ranked[0]?.okayReason).toBe("low_evidence_confidence");
    expect(ranked[0]?.riskRead).toBe("@listing.lowEvidenceConfidence");
    expect(ranked[0]?.riskRead).not.toContain("moderateOkay");
  });

  it("EN + AR copy keys present for listing Okay reasons", () => {
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as {
      Discovery: {
        recommendationStrong: string;
        recommendationOkay: string;
        riskReadTitle: string;
        riskAck: string;
        notes: { listing: Record<string, string> };
      };
    };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as {
      Discovery: {
        recommendationStrong: string;
        recommendationOkay: string;
        riskReadTitle: string;
        riskAck: string;
        notes: { listing: Record<string, string> };
      };
    };
    for (const locale of [en, ar]) {
      expect(locale.Discovery.recommendationStrong).toMatch(/Strong|قوي/);
      expect(locale.Discovery.recommendationOkay).toMatch(/Okay|مقبول/);
      expect(locale.Discovery.riskReadTitle.length).toBeGreaterThan(5);
      expect(locale.Discovery.riskAck.length).toBeGreaterThan(5);
      expect(locale.Discovery.notes.listing.lowEvidenceConfidence).toContain(
        "{fitScore}",
      );
      expect(locale.Discovery.notes.listing.highCompetition).toContain(
        "{fitScore}",
      );
    }
    expect(en.Discovery.notes.listing.lowEvidenceConfidence).not.toMatch(
      /Fit is moderate/i,
    );
    expect(en.Discovery.riskReadTitle).toBe("Why this is marked Okay");
    expect(en.Discovery.riskAck).toBe(
      "I understand this and want to continue.",
    );
  });
});
