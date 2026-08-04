import { describe, expect, it } from "vitest";
import { DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX } from "@/lib/constants";
import {
  buildScoreRefreshQueryPlan,
  scoreAbroadDemandFromItems,
  scoreCompetitionFromItems,
  scoreLebanonDemandFromItems,
  scoresFromSearchEvidence,
} from "@/lib/discovery/scoring/evidence";
import { scoreDemand } from "@/lib/discovery/scoring/demand";

describe("score refresh query plan", () => {
  it("caps queries and covers abroad + Lebanon + Tier-1/local", () => {
    const plan = buildScoreRefreshQueryPlan(
      {
        nameEn: "LED Facial Wand",
        category: "beauty_personal_care",
        tier1Marketplaces: "[]",
      },
      DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
    );
    expect(plan.length).toBe(DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX);
    expect(plan.some((q) => q.kind === "abroad_demand")).toBe(true);
    expect(plan.some((q) => q.kind === "lebanon_demand")).toBe(true);
    expect(plan.some((q) => q.kind === "tier1_competition")).toBe(true);
    expect(plan.some((q) => q.kind === "local_competition")).toBe(true);
    expect(buildScoreRefreshQueryPlan(
      { nameEn: "X", category: "c", tier1Marketplaces: "[]" },
      2,
    )).toHaveLength(2);
  });
});

describe("evidence → demand / competition scores", () => {
  it("scores abroad from US/EU marketplace hits (Gulf not primary)", () => {
    const abroad = scoreAbroadDemandFromItems([
      {
        title: "Best seller on Amazon",
        url: "https://www.amazon.com/dp/x",
        snippet: "United States",
      },
      {
        title: "Gulf listing",
        url: "https://www.amazon.ae/dp/y",
      },
    ]);
    expect(abroad).toBeGreaterThan(0.4);

    const empty = scoreAbroadDemandFromItems([]);
    expect(empty).toBeLessThan(0.3);
  });

  it("scores Lebanon demand and competition intensity", () => {
    const leb = scoreLebanonDemandFromItems([
      {
        title: "Buy in Beirut",
        url: "https://shop.lb/example",
        snippet: "Lebanon delivery",
      },
    ]);
    expect(leb).toBeGreaterThan(0.35);

    const competition = scoreCompetitionFromItems({
      tier1Items: [
        {
          title: "Ishtari listing",
          url: "https://www.ishtari.com/p/1",
        },
      ],
      localItems: [
        { title: "Local shop", url: "https://beirut.shop/p" },
        { title: "Another seller", url: "https://lb.store/p" },
      ],
      poolTier1: ["Ishtari"],
    });
    expect(competition).toBeGreaterThan(0.4);
  });

  it("dual demand paths — whitespace OR local-proven, never require AND", () => {
    const whitespace = scoresFromSearchEvidence({
      productName: "Gap Product",
      abroadItems: [
        {
          title: "Amazon bestseller US",
          url: "https://www.amazon.com/dp/1",
        },
      ],
      lebanonItems: [],
      tier1Items: [],
      localItems: [],
      poolTier1Json: "[]",
      softCompetitionBudget: true,
      queriesUsed: 2,
    });
    expect(whitespace.demandPath).toBe("whitespace");
    expect(whitespace.shadowWouldExclude).toBe(false);

    const local = scoresFromSearchEvidence({
      productName: "Local Hit",
      abroadItems: [],
      lebanonItems: [
        {
          title: "Popular in Lebanon Beirut",
          url: "https://shop.example.lb/p",
          snippet: "Lebanon bestseller",
        },
        {
          title: "Beirut store",
          url: "https://beirut.example/p",
        },
      ],
      tier1Items: [],
      localItems: [],
      poolTier1Json: "[]",
      softCompetitionBudget: true,
      queriesUsed: 2,
    });
    // Local-proven when Lebanon strong enough; path from scoreDemand.
    const demand = scoreDemand({
      abroadDemandScore: local.abroadDemandScore,
      lebanonDemandScore: local.lebanonDemandScore,
    });
    expect(["local_proven", "whitespace"]).toContain(demand.path);
    // Must not require abroad AND lebanon simultaneously.
    expect(local.lebanonDemandScore).toBeGreaterThan(local.abroadDemandScore!);
  });

  it("empty evidence shadows would-exclude and keeps low confidence", () => {
    const empty = scoresFromSearchEvidence({
      productName: "Ghost",
      abroadItems: [],
      lebanonItems: [],
      tier1Items: [],
      localItems: [],
      poolTier1Json: "[]",
      softCompetitionBudget: true,
      queriesUsed: 3,
    });
    expect(empty.shadowWouldExclude).toBe(true);
    expect(empty.shadowExcludeReason).toBe("empty_search_evidence");
    expect(empty.confidence).toBeLessThan(0.3);
  });

  it("hard-mode high competition logs shadow would-exclude (soft stays penalty)", () => {
    const soft = scoresFromSearchEvidence({
      productName: "Crowded Soft",
      abroadItems: [
        { title: "Amazon US", url: "https://www.amazon.com/x" },
      ],
      lebanonItems: [
        { title: "Lebanon", url: "https://lb.example/x" },
      ],
      tier1Items: [
        { title: "Ishtari", url: "https://ishtari.com/a" },
        { title: "EGLOW", url: "https://eglow.com/b" },
        { title: "Platza", url: "https://platza.com/c" },
      ],
      localItems: [
        { title: "shop1", url: "https://a.lb/1" },
        { title: "shop2", url: "https://b.lb/2" },
      ],
      poolTier1Json: JSON.stringify(["Ishtari", "EGLOW", "Platza"]),
      softCompetitionBudget: true,
      queriesUsed: 4,
    });
    expect(soft.competitionScore).toBeGreaterThan(0.6);
    expect(soft.shadowWouldExclude).toBe(false);
    expect(soft.budgetFightPenalty).toBe(0);

    const hard = scoresFromSearchEvidence({
      productName: "Crowded Hard",
      abroadItems: soft.abroadDemandScore
        ? [{ title: "Amazon US", url: "https://www.amazon.com/x" }]
        : [],
      lebanonItems: [{ title: "Lebanon", url: "https://lb.example/x" }],
      tier1Items: [
        { title: "Ishtari", url: "https://ishtari.com/a" },
        { title: "EGLOW", url: "https://eglow.com/b" },
        { title: "Platza", url: "https://platza.com/c" },
      ],
      localItems: [
        { title: "shop1", url: "https://a.lb/1" },
        { title: "shop2", url: "https://b.lb/2" },
      ],
      poolTier1Json: JSON.stringify(["Ishtari", "EGLOW", "Platza"]),
      softCompetitionBudget: false,
      queriesUsed: 4,
    });
    expect(hard.shadowWouldExclude).toBe(true);
    expect(hard.shadowExcludeReason).toBe("high_competition_hard_mode_shadow");
  });
});
