/**
 * WAVE-2 §3.2 / §6 / §7 trust correctness: "missing data = neutral" means
 * do-not-exclude, never counts-as-proven. Neutral fill earns no qualified
 * demand path, and unknown confidence never renders Strong.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  evaluateSystemDemandGate,
  isAcceptReadyForShortlist,
  SYSTEM_DEMAND_GATE_MIN,
} from "@/lib/discovery/dual-gate";
import { computeComposite } from "@/lib/discovery/scoring/composite";
import {
  CONFIDENCE_OKAY_CAP,
  DEMAND_LEBANON_STRONG,
  DEMAND_NEUTRAL,
  HEURISTIC_SEED_CONFIDENCE,
} from "@/lib/discovery/scoring/constants";
import { scoreDemand } from "@/lib/discovery/scoring/demand";
import { applyPolishHooks } from "@/lib/discovery/scoring/polish";
import { rankWave2Shortlist } from "@/lib/discovery/scoring/rank";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";
import { computeFit } from "@/lib/skills/fit";
import { computeMargin } from "@/lib/skills/margin";

function fitStrong() {
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

function compositeWith(overrides: {
  abroadDemandScore?: number | null;
  lebanonDemandScore?: number | null;
  confidence?: number | null;
}) {
  return computeComposite({
    abroadDemandScore:
      overrides.abroadDemandScore === undefined
        ? 0.8
        : overrides.abroadDemandScore,
    lebanonDemandScore:
      overrides.lebanonDemandScore === undefined
        ? 0.2
        : overrides.lebanonDemandScore,
    competitionScore: 0.2,
    confidence: overrides.confidence === undefined ? 0.9 : overrides.confidence,
    fit: fitStrong(),
    margin: hardPassMargin(),
    budgetUsd: 8000,
    monthlyFollowOnBudget: 800,
    softCompetitionBudget: true,
    category: "home_kitchen",
    evidenceSource: "score_cache",
  });
}

function stubProduct(key: string): CatalogProduct {
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
  };
}

const easyProfile = {
  maxLandedCost: 100,
  experience: "experienced" as const,
  riskTolerance: "high" as const,
  hoursPerWeek: 40,
  categoryLikes: ["home_kitchen"],
  budgetUsd: 8000,
  monthlyFollowOnBudget: 800,
};

function stubScore(partial: Partial<ScoreRow>): ScoreRow {
  return {
    id: "score-1",
    poolProductId: "pool-1",
    abroadDemandScore: 0.8,
    lebanonDemandScore: 0.2,
    competitionScore: 0.2,
    budgetFightPenalty: null,
    compositeScore: 0.5,
    demandPath: "whitespace",
    confidence: 0.9,
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

describe("scoreDemand — neutral fill is never proof", () => {
  it("missing Lebanon leg earns no local_proven path", () => {
    const r = scoreDemand({
      abroadDemandScore: 0.3,
      lebanonDemandScore: null,
    });
    expect(r.usedNeutral).toBe(true);
    expect(r.lebanon).toBe(DEMAND_NEUTRAL);
    expect(r.path).not.toBe("local_proven");
    expect(r.path).toBeNull();
    // Still rankable — missing data must not exclude (§7).
    expect(r.score).toBeGreaterThan(0);
  });

  it("missing abroad leg cannot claim a Lebanon gap (whitespace)", () => {
    const r = scoreDemand({
      abroadDemandScore: null,
      lebanonDemandScore: 0.1,
    });
    expect(r.usedNeutral).toBe(true);
    expect(r.path).not.toBe("whitespace");
    expect(r.path).toBeNull();
    expect(r.score).toBeGreaterThan(0);
  });

  it("missing both legs yields no qualified path but stays rankable", () => {
    const r = scoreDemand({
      abroadDemandScore: null,
      lebanonDemandScore: null,
    });
    expect(r.usedNeutral).toBe(true);
    expect(r.path).toBeNull();
    expect(r.score).toBeGreaterThan(0);
  });

  it("real Lebanon at the neutral value behaves differently from neutral fill", () => {
    // Regression guard: DEMAND_NEUTRAL === DEMAND_LEBANON_STRONG, so the
    // numeric threshold alone must never decide a qualified path.
    expect(DEMAND_NEUTRAL).toBe(DEMAND_LEBANON_STRONG);

    const real = scoreDemand({
      abroadDemandScore: 0.3,
      lebanonDemandScore: DEMAND_NEUTRAL,
    });
    const filled = scoreDemand({
      abroadDemandScore: 0.3,
      lebanonDemandScore: null,
    });

    expect(real.lebanon).toBe(filled.lebanon);
    expect(real.usedNeutral).toBe(false);
    expect(filled.usedNeutral).toBe(true);
    expect(real.path).toBe("local_proven");
    expect(filled.path).toBeNull();
  });

  it("real Lebanon strictly above neutral still qualifies local_proven", () => {
    const r = scoreDemand({
      abroadDemandScore: 0.2,
      lebanonDemandScore: DEMAND_NEUTRAL + 0.2,
    });
    expect(r.usedNeutral).toBe(false);
    expect(r.path).toBe("local_proven");
  });
});

describe("confidence floors — unknown confidence never reads Strong", () => {
  it("absent confidence is treated as heuristic-grade, not mid-confidence", () => {
    const missing = applyPolishHooks({
      confidence: null,
      budgetUsd: 5000,
      category: "home_kitchen",
    });
    expect(missing.capStrengthOkay).toBe(true);
    expect(
      applyPolishHooks({
        confidence: HEURISTIC_SEED_CONFIDENCE,
        budgetUsd: 5000,
        category: "home_kitchen",
      }).capStrengthOkay,
    ).toBe(true);
  });

  it("the cap boundary itself cannot slip through as confident enough", () => {
    expect(
      applyPolishHooks({
        confidence: CONFIDENCE_OKAY_CAP,
        budgetUsd: 5000,
        category: "home_kitchen",
      }).capStrengthOkay,
    ).toBe(true);
    expect(
      applyPolishHooks({
        confidence: CONFIDENCE_OKAY_CAP + 0.1,
        budgetUsd: 5000,
        category: "home_kitchen",
      }).capStrengthOkay,
    ).toBe(false);
  });

  it("composite reports the heuristic floor when confidence is absent", () => {
    const r = compositeWith({ confidence: null });
    expect(r.explain.confidence).toBe(HEURISTIC_SEED_CONFIDENCE);
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("low_evidence_confidence");
  });
});

describe("composite — missing demand evidence caps Strong to Okay", () => {
  it("missing Lebanon leg caps a Strong Fit to Okay with the evidence reason", () => {
    const r = compositeWith({
      abroadDemandScore: 0.3,
      lebanonDemandScore: null,
      confidence: 0.95,
    });
    expect(r.demand.usedNeutral).toBe(true);
    expect(r.demand.path).not.toBe("local_proven");
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("low_evidence_confidence");
    expect(r.explain.demandPath).toBeNull();
    // Not excluded: still accept-ready on margins/Fit.
    expect(r.listable).toBe(true);
  });

  it("missing both legs stays listable but never Strong", () => {
    const r = compositeWith({
      abroadDemandScore: null,
      lebanonDemandScore: null,
      confidence: 0.95,
    });
    expect(r.listingStrength).toBe("Okay");
    expect(r.okayReason).toBe("low_evidence_confidence");
    expect(r.listable).toBe(true);
  });

  it("real high-confidence evidence above the cap still produces Strong", () => {
    const r = compositeWith({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      confidence: 0.9,
    });
    expect(r.demand.usedNeutral).toBe(false);
    expect(r.demand.path).toBe("whitespace");
    expect(r.listingStrength).toBe("Strong");
    expect(r.okayReason).toBeNull();
  });
});

describe("system demand gate — neutral leg passes but is labelled unproven", () => {
  it("passes on score alone yet reports no path and neutral evidence", () => {
    const gate = evaluateSystemDemandGate({
      abroadDemandScore: 0.8,
      lebanonDemandScore: null,
      lastScoreStatus: "ok",
    });
    expect(gate.pass).toBe(true);
    expect(gate.demandScore!).toBeGreaterThanOrEqual(SYSTEM_DEMAND_GATE_MIN);
    expect(gate.demandPath).toBeNull();
    expect(gate.usedNeutral).toBe(true);
    // §7: never excluded for missing data.
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: false,
        system: {
          abroadDemandScore: 0.8,
          lebanonDemandScore: null,
          lastScoreStatus: "ok",
        },
        systemGateEnabled: true,
      }),
    ).toBe(true);
  });

  it("real qualified evidence reports its path without the neutral flag", () => {
    const gate = evaluateSystemDemandGate({
      abroadDemandScore: 0.2,
      lebanonDemandScore: 0.75,
      lastScoreStatus: "ok",
    });
    expect(gate.pass).toBe(true);
    expect(gate.demandPath).toBe("local_proven");
    expect(gate.usedNeutral).toBe(false);
  });
});

describe("rankWave2Shortlist — score-cache-less products are not Strong", () => {
  it("uses the gate's heuristic confidence when no score row exists", () => {
    const ranked = rankWave2Shortlist(
      easyProfile,
      [stubProduct("no_scores")],
      new Map(),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: false },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].fit.strength).toBe("Strong");
    expect(ranked[0].strength).toBe("Okay");
    expect(ranked[0].explain.confidence).toBe(HEURISTIC_SEED_CONFIDENCE);
    expect(ranked[0].notRecommended).toBe(false);
  });

  it("keeps Strong when the cache holds real high-confidence evidence", () => {
    const ranked = rankWave2Shortlist(
      easyProfile,
      [stubProduct("scored")],
      new Map([["scored", stubScore({})]]),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );
    expect(ranked[0].strength).toBe("Strong");
    expect(ranked[0].okayReason).toBeNull();
  });

  it("caps a cached row whose Lebanon leg was never measured", () => {
    const ranked = rankWave2Shortlist(
      easyProfile,
      [stubProduct("half_scored")],
      new Map([
        [
          "half_scored",
          stubScore({ lebanonDemandScore: null, demandPath: null }),
        ],
      ]),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );
    expect(ranked[0].strength).toBe("Okay");
    expect(ranked[0].okayReason).toBe("low_evidence_confidence");
    expect(ranked[0].riskRead).toBe("@listing.lowEvidenceConfidence");
    expect(ranked[0].notRecommended).toBe(false);
  });
});

describe("unproven demand copy — EN + AR", () => {
  it("labels an unearned path as estimate-only in both locales", () => {
    const read = (file: string) =>
      JSON.parse(
        readFileSync(path.join(process.cwd(), "messages", file), "utf8"),
      ) as { Discovery: Record<string, string> };
    const en = read("en.json").Discovery;
    const ar = read("ar.json").Discovery;

    expect(en.demandPathUnproven).toBe(
      "estimate only — demand not measured yet",
    );
    expect(ar.demandPathUnproven.length).toBeGreaterThan(5);
    // AR must not fall back to English copy.
    expect(ar.demandPathUnproven).not.toBe(en.demandPathUnproven);
    expect(ar.demandPathUnproven).toMatch(/[\u0600-\u06FF]/);
    expect(ar.demandPathUnproven).not.toMatch(/[A-Za-z]/);
    for (const locale of [en, ar]) {
      expect(locale.demandPathUnproven).not.toBe(locale.demandPathWhitespace);
      expect(locale.demandPathUnproven).not.toBe(locale.demandPathLocal);
    }
  });
});
