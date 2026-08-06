import { afterEach, describe, expect, it } from "vitest";
import {
  isAcceptReadyForShortlist,
  isSoftListedHardAcceptBlocked,
  SYSTEM_DEMAND_GATE_MIN,
} from "@/lib/discovery/dual-gate";
import { rankWave2Shortlist } from "@/lib/discovery/scoring/rank";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";
import { scoreRankCatalog } from "@/lib/discovery/service";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
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

const easyProfile = {
  maxLandedCost: 100,
  experience: "experienced" as const,
  riskTolerance: "high" as const,
  hoursPerWeek: 40,
  categoryLikes: [] as string[],
  budgetUsd: 8000,
  monthlyFollowOnBudget: 800,
};

describe("isAcceptReadyForShortlist", () => {
  it("requires hard margins + !oversized", () => {
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: false,
        system: null,
        systemGateEnabled: false,
      }),
    ).toBe(true);
    expect(
      isAcceptReadyForShortlist({
        marginsPass: false,
        oversized: false,
        system: null,
        systemGateEnabled: false,
      }),
    ).toBe(false);
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: true,
        system: null,
        systemGateEnabled: false,
      }),
    ).toBe(false);
  });

  it("POOL_V2: requires system demand pass", () => {
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: false,
        system: null,
        systemGateEnabled: true,
      }),
    ).toBe(false);
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: false,
        system: {
          abroadDemandScore: 0.1,
          lebanonDemandScore: 0.1,
          lastScoreStatus: "ok",
        },
        systemGateEnabled: true,
      }),
    ).toBe(false);
    expect(
      isAcceptReadyForShortlist({
        marginsPass: true,
        oversized: false,
        system: {
          abroadDemandScore: 0.8,
          lebanonDemandScore: 0.2,
          lastScoreStatus: "ok",
        },
        systemGateEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("soft-list browsing retired", () => {
  it("isSoftListedHardAcceptBlocked always false", () => {
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: false,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
  });
});

describe("rankWave2Shortlist accept-ready only", () => {
  it("excludes soft_ok / far_below / oversized / weak demand; keeps accept-ready", () => {
    const catalog = [
      stubProduct("ready", "home_kitchen"),
      stubProduct("soft", "beauty_personal_care", {
        // soft_ok-ish: under hard 70/35 but not far_below
        sellPrice: 100,
        productCost: 28,
        intlShip: 2,
        clearanceTaxes: 2,
        localCourier: 2,
      }),
      stubProduct("weak_demand", "fitness_lifestyle"),
      stubProduct("huge", "pet_accessories", { oversized: true }),
      stubProduct("far", "car_accessories", {
        sellPrice: 40,
        productCost: 80,
      }),
    ];
    const scores = new Map<string, ScoreRow>([
      ["ready", stubScore({ id: "1" })],
      [
        "soft",
        stubScore({
          id: "2",
          abroadDemandScore: 0.8,
          lebanonDemandScore: 0.2,
        }),
      ],
      [
        "weak_demand",
        stubScore({
          id: "3",
          abroadDemandScore: 0.1,
          lebanonDemandScore: 0.1,
        }),
      ],
      ["far", stubScore({ id: "4" })],
    ]);

    const ranked = rankWave2Shortlist(
      easyProfile,
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    const keys = ranked.map((r) => r.p.key);
    expect(keys).toContain("ready");
    expect(keys).not.toContain("soft");
    expect(keys).not.toContain("weak_demand");
    expect(keys).not.toContain("huge");
    expect(keys).not.toContain("far");
    expect(ranked.every((r) => r.margin.pass)).toBe(true);
    expect(ranked.every((r) => r.explain.softMarginBand === "pass")).toBe(true);
  });

  it("returns empty when only non-accept-ready products exist (no soft fill)", () => {
    const catalog = [
      stubProduct("soft_only", "home_kitchen", {
        sellPrice: 100,
        productCost: 28,
        intlShip: 2,
        clearanceTaxes: 2,
        localCourier: 2,
      }),
      stubProduct("oversized_only", "beauty_personal_care", {
        oversized: true,
      }),
    ];
    const scores = new Map<string, ScoreRow>([
      ["soft_only", stubScore({ id: "1" })],
    ]);

    const ranked = rankWave2Shortlist(
      easyProfile,
      catalog,
      scores,
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: true },
    );

    expect(ranked).toEqual([]);
  });

  it("LIVE_SEARCH off may use heuristics so accept-ready still appears", () => {
    const catalog = [stubProduct("heuristic_ok", "home_kitchen")];
    const ranked = rankWave2Shortlist(
      easyProfile,
      catalog,
      new Map(),
      new Map(),
      true,
      { systemGateEnabled: true, liveSearchEnabled: false },
    );
    expect(ranked.map((r) => r.p.key)).toEqual(["heuristic_ok"]);
    expect(SYSTEM_DEMAND_GATE_MIN).toBeGreaterThan(0);
  });
});

describe("Wave 1 scoreRankCatalog accept-ready only", () => {
  it("never returns soft_ok / oversized / hard-margin-fail cards", () => {
    const onboarding = {
      id: "ob",
      workspaceId: "ws",
      budgetUsd: 8000,
      maxLandedCost: 100,
      monthlyFollowOnBudget: 800,
      experience: "experienced",
      riskTolerance: "high",
      hoursPerWeek: 40,
      categoryLikes: "[]",
      storageDescription: "",
      uiLanguage: "en",
      shopifyStatus: "not_started",
      createdAt: "t",
      updatedAt: "t",
      completedAt: null,
    } as unknown as Parameters<typeof scoreRankCatalog>[0];

    const catalog = [
      stubProduct("ok", "home_kitchen"),
      stubProduct("blocked_margin", "beauty_personal_care", {
        sellPrice: 40,
        productCost: 80,
      }),
      stubProduct("blocked_size", "fitness_lifestyle", { oversized: true }),
    ];

    const ranked = scoreRankCatalog(onboarding, new Set(), catalog);
    expect(ranked.every((r) => r.margin.pass && !r.p.oversized)).toBe(true);
    expect(ranked.map((r) => r.p.key)).toEqual(["ok"]);
  });
});
