/**
 * WAVE-2 §8 — an empty board caused by missing / failed scores is a data
 * outage, not a profile problem, so it must not raise the Edit onboarding nag
 * and must not land in the §7.1 edit-onboarding rate.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import { evaluateSystemDemandGate } from "@/lib/discovery/dual-gate";
import {
  classifyShortlistBlocker,
  emptyBlockerTally,
  mergeBlockerTallies,
  resolveShortlistEmptyDecision,
  scoreDataBlockedCount,
  tallyShortlistBlockers,
  type ShortlistBlockerTally,
} from "@/lib/discovery/empty-state";
import {
  aggregateDiscoveryMetrics,
  sessionMetricDedupeKey,
  shortlistOutcomeDedupeKey,
  DISCOVERY_METRIC_KINDS,
  type DiscoveryMetricEvent,
} from "@/lib/discovery/metrics/events";
import type { ScoreRow } from "@/lib/discovery/scores";
import { rankWave2ShortlistWithBlockers } from "@/lib/discovery/scoring/rank";

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

/** A refresh that failed before it ever produced a usable score. */
function failedScore(id: string): ScoreRow {
  return stubScore({
    id,
    abroadDemandScore: null,
    lebanonDemandScore: null,
    compositeScore: null,
    demandPath: null,
    confidence: null,
    lastScoredAt: null,
    lastScoreStatus: "failed",
  });
}

const easyProfile = {
  maxLandedCost: 100,
  experience: "experienced" as const,
  riskTolerance: "high" as const,
  hoursPerWeek: 40,
  categoryLikes: [] as string[],
  budgetUsd: 8000,
  monthlyFollowOnBudget: 800,
};

function tally(over: Partial<ShortlistBlockerTally>): ShortlistBlockerTally {
  return { ...emptyBlockerTally(), ...over };
}

const root = path.join(process.cwd(), "src");

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("classifyShortlistBlocker", () => {
  const listedProduct = {
    marginsPass: true,
    oversized: false,
    fitNotRecommended: false,
  };

  it("returns null for a product that made the shortlist", () => {
    expect(
      classifyShortlistBlocker({ ...listedProduct, included: true }),
    ).toBeNull();
  });

  it("names a never-scored product as a score-cache outage", () => {
    expect(
      classifyShortlistBlocker({
        ...listedProduct,
        included: false,
        systemDemand: evaluateSystemDemandGate(null),
      }),
    ).toBe("score_cache_missing");
  });

  it("names a failed refresh with no last-known score distinctly", () => {
    expect(
      classifyShortlistBlocker({
        ...listedProduct,
        included: false,
        systemDemand: evaluateSystemDemandGate({
          abroadDemandScore: null,
          lebanonDemandScore: null,
          lastScoreStatus: "failed",
        }),
      }),
    ).toBe("score_refresh_failed");
  });

  it("counts a profile gate first — editing onboarding could still fix it", () => {
    expect(
      classifyShortlistBlocker({
        ...listedProduct,
        marginsPass: false,
        included: false,
        systemDemand: evaluateSystemDemandGate(null),
      }),
    ).toBe("profile");
  });

  it("counts scored-but-weak demand as profile, not an outage", () => {
    expect(
      classifyShortlistBlocker({
        ...listedProduct,
        included: false,
        systemDemand: evaluateSystemDemandGate({
          abroadDemandScore: 0.1,
          lebanonDemandScore: 0.1,
          lastScoreStatus: "ok",
        }),
      }),
    ).toBe("profile");
  });
});

describe("rankWave2ShortlistWithBlockers traces why the pool is unlisted", () => {
  it("live search on + empty score cache reads as a data outage", () => {
    const catalog = [
      stubProduct("a", "home_kitchen"),
      stubProduct("b", "beauty_personal_care"),
    ];

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      new Map(),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked).toEqual([]);
    expect(blockers).toEqual(tally({ scoreCacheMissing: 2 }));
  });

  it("live search on + every row failed reads as a failed refresh", () => {
    const catalog = [
      stubProduct("a", "home_kitchen"),
      stubProduct("b", "beauty_personal_care"),
    ];
    const scores = new Map<string, ScoreRow>([
      ["a", failedScore("1")],
      ["b", failedScore("2")],
    ]);

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked).toEqual([]);
    expect(blockers).toEqual(tally({ scoreRefreshFailed: 2 }));
  });

  it("usable scores with failing margins / size read as profile filtering", () => {
    const catalog = [
      stubProduct("far_below", "home_kitchen", {
        sellPrice: 40,
        productCost: 80,
      }),
      stubProduct("huge", "pet_accessories", { oversized: true }),
    ];
    const scores = new Map<string, ScoreRow>([
      ["far_below", stubScore({ id: "1" })],
    ]);

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked).toEqual([]);
    expect(blockers).toEqual(tally({ profile: 2 }));
  });

  it("keeps ranking unchanged when part of the pool is scored", () => {
    const catalog = [
      stubProduct("scored", "home_kitchen"),
      stubProduct("unscored", "beauty_personal_care"),
    ];
    const scores = new Map<string, ScoreRow>([
      ["scored", stubScore({ id: "1" })],
    ]);

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked.map((r) => r.p.key)).toEqual(["scored"]);
    expect(blockers).toEqual(tally({ scoreCacheMissing: 1 }));
  });

  it("live search off still fills the board from heuristics (no outage)", () => {
    const catalog = [
      stubProduct("a", "home_kitchen"),
      stubProduct("b", "beauty_personal_care"),
    ];

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      new Map(),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: false },
    );

    expect(ranked.map((r) => r.p.key).sort()).toEqual(["a", "b"]);
    expect(scoreDataBlockedCount(blockers)).toBe(0);
  });
});

describe("the reported bug, end to end over the pure path", () => {
  it("live search on with an unpopulated cache stops asking for onboarding edits", () => {
    // Exactly the repro: POOL_V2 on, live search on, no score rows — every
    // product fails the demand gate as `missing`, so the board empties and the
    // old rule called that a profile problem.
    const catalog = [
      stubProduct("a", "home_kitchen"),
      stubProduct("b", "beauty_personal_care"),
      stubProduct("c", "fitness_lifestyle"),
    ];

    const { ranked, blockers } = rankWave2ShortlistWithBlockers(
      easyProfile,
      catalog,
      new Map(),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: ranked.length,
      remainingEligible: ranked.length,
      blockers,
    });

    expect(decision.editOnboardingBanner).toBeNull();
    expect(decision.emptyState).toEqual({
      cause: "no_scores",
      reason: "score_cache_missing",
    });
  });
});

describe("tallies", () => {
  it("counts blockers and ignores listed products", () => {
    expect(
      tallyShortlistBlockers([
        null,
        "profile",
        "score_cache_missing",
        "score_cache_missing",
        "score_refresh_failed",
      ]),
    ).toEqual(tally({ profile: 1, scoreCacheMissing: 2, scoreRefreshFailed: 1 }));
  });

  it("merges the session's dropped cards with the rest of the pool", () => {
    expect(
      mergeBlockerTallies(
        tally({ scoreCacheMissing: 2 }),
        tally({ profile: 1, scoreRefreshFailed: 3 }),
      ),
    ).toEqual(tally({ scoreCacheMissing: 2, scoreRefreshFailed: 3, profile: 1 }));
  });
});

describe("resolveShortlistEmptyDecision", () => {
  it("does not nag about onboarding when scores are missing", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 0,
      blockers: tally({ scoreCacheMissing: 6 }),
    });

    expect(decision.editOnboardingBanner).toBeNull();
    expect(decision.emptyState).toEqual({
      cause: "no_scores",
      reason: "score_cache_missing",
    });
  });

  it("names a failed refresh as the ops next step over a never-scored pool", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 0,
      blockers: tally({ scoreCacheMissing: 4, scoreRefreshFailed: 2 }),
    });

    expect(decision.emptyState).toEqual({
      cause: "no_scores",
      reason: "score_refresh_failed",
    });
  });

  it("still nags when the profile really did filter everything out", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 0,
      blockers: tally({ profile: 8 }),
    });

    expect(decision.editOnboardingBanner).toBe("zero_accept_ready");
    expect(decision.emptyState).toEqual({
      cause: "profile_filtered",
      reason: null,
    });
  });

  it("blames the profile when profile gates dominate a mostly-scored pool", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 0,
      blockers: tally({ profile: 9, scoreCacheMissing: 1 }),
    });

    expect(decision.editOnboardingBanner).toBe("zero_accept_ready");
    expect(decision.emptyState?.cause).toBe("profile_filtered");
  });

  it("gives a tie to the data outage rather than to the founder", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 0,
      blockers: tally({ profile: 3, scoreCacheMissing: 3 }),
    });

    expect(decision.editOnboardingBanner).toBeNull();
    expect(decision.emptyState?.cause).toBe("no_scores");
  });

  it("shows no empty state while cards are on the board", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 5,
      remainingEligible: 4,
      blockers: tally({ scoreCacheMissing: 12 }),
    });

    expect(decision.emptyState).toBeNull();
    expect(decision.editOnboardingBanner).toBeNull();
  });

  it("keeps the thin-shortlist banner for a shown but narrow board", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 2,
      remainingEligible: 0,
      blockers: tally({ profile: 5 }),
    });

    expect(decision.editOnboardingBanner).toBe("thin_accept_ready");
    expect(decision.emptyState).toBeNull();
  });

  it("leaves an empty page with products left to the A–D ladder", () => {
    const decision = resolveShortlistEmptyDecision({
      acceptReadyVisible: 0,
      remainingEligible: 3,
      blockers: tally({ scoreCacheMissing: 2 }),
    });

    expect(decision.emptyState).toBeNull();
    expect(decision.editOnboardingBanner).toBeNull();
  });
});

describe("§7.1 counters separate a data outage from a profile nag", () => {
  const at = "2026-08-07T10:00:00.000Z";

  function event(
    kind: DiscoveryMetricEvent["kind"],
    sessionId: string,
  ): DiscoveryMetricEvent {
    return { kind, sessionId, errorCode: null, createdAt: at };
  }

  it("registers the data-outage empty as its own kind", () => {
    expect(DISCOVERY_METRIC_KINDS).toContain("shortlist_empty_no_scores");
  });

  it("keeps the no-scores empty out of the edit-onboarding rate", () => {
    const summary = aggregateDiscoveryMetrics([
      event("shortlist_shown", "s1"),
      event("shortlist_empty", "s2"),
      event("shortlist_empty_no_scores", "s2"),
      event("shortlist_empty", "s3"),
      event("shortlist_empty_no_scores", "s3"),
      event("shortlist_empty", "s4"),
      event("edit_onboarding_shown", "s4"),
    ]);

    expect(summary.sessionsViewed).toBe(4);
    expect(summary.totals.shortlist_empty_no_scores).toBe(2);
    // One profile-driven nag out of four sessions — the two outages are not nags.
    expect(summary.editOnboardingRate).toBeCloseTo(0.25);
    expect(summary.noScoresEmptyRate).toBeCloseTo(0.5);
    expect(summary.emptyRate).toBeCloseTo(0.75);
  });

  it("does not disturb the sessions-viewed denominator", () => {
    const summary = aggregateDiscoveryMetrics([
      event("shortlist_empty", "s1"),
      event("shortlist_empty_no_scores", "s1"),
    ]);

    expect(summary.sessionsViewed).toBe(
      summary.totals.shortlist_shown + summary.totals.shortlist_empty,
    );
  });

  it("counts one outage per session, under its own key", () => {
    const key = sessionMetricDedupeKey("s1", "shortlist_empty_no_scores");
    expect(key).toBe(sessionMetricDedupeKey("s1", "shortlist_empty_no_scores"));
    expect(key).not.toBe(sessionMetricDedupeKey("s1", "edit_onboarding_shown"));
    expect(key).not.toBe(shortlistOutcomeDedupeKey("s1"));
    expect(key).not.toBe(
      sessionMetricDedupeKey("s2", "shortlist_empty_no_scores"),
    );
  });
});

describe("Discovery surfaces wire the §8 split", () => {
  it("service decides the banner from the empty cause, not from emptiness", () => {
    const src = readSrc("lib/discovery/service.ts");
    expect(src).toContain("resolveShortlistEmptyDecision");
    // The old unconditional nag on any empty board.
    expect(src).not.toContain('editOnboardingBanner = "zero_accept_ready"');
    expect(src).toContain("shortlist_empty_no_scores");
  });

  it("board shows the data state instead of the ladder and its edit CTA", () => {
    const src = readSrc("components/discovery/DiscoveryBoard.tsx");
    expect(src).toContain('view.shortlistEmptyState?.cause === "no_scores"');
    expect(src).toContain("emptyNoScoresTitle");
    expect(src).toContain("MarketDataNotReadyNote");
  });

  it("has founder copy for the data state in both locales", () => {
    const keys = [
      "emptyNoScoresTitle",
      "emptyNoScoresBody",
      "emptyNoScoresPending",
      "emptyNoScoresFailed",
      "emptyNoScoresOps",
    ] as const;
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ).Discovery as Record<string, string>;
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ).Discovery as Record<string, string>;

    for (const key of keys) {
      expect(en[key]?.length ?? 0).toBeGreaterThan(0);
      expect(ar[key]?.length ?? 0).toBeGreaterThan(0);
      // AR must be translated, never an English fallback string.
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/\p{Script=Arabic}/u);
    }
  });
});
