/**
 * Wave 2 shortlist ranking — composite + never-all-blocked fallback.
 * Pure over catalog + score cache maps (service loads I/O).
 */

import { DISCOVERY_FALLBACK_SHORTLIST_MIN } from "@/lib/constants";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";
import { isSoftCompetitionBudgetEnabled } from "@/lib/discovery/flags";
import { computeComposite } from "@/lib/discovery/scoring/composite";
import { applyDiversityReorder } from "@/lib/discovery/scoring/polish";
import { computeFit, type FitProfile } from "@/lib/skills/fit";
import { computeMargin } from "@/lib/skills/margin";

export type Wave2ScoreHints = {
  moqHint?: number | null;
  sampleCostHint?: number | null;
};

export type Wave2RankProfile = FitProfile & {
  budgetUsd: number;
  monthlyFollowOnBudget: number;
};

export type Wave2RankedProduct = {
  p: CatalogProduct;
  landedCost: number;
  fit: ReturnType<typeof computeFit>;
  margin: ReturnType<typeof computeMargin>;
  compositeScore: number;
  listingStrength: "Strong" | "Okay";
  /** Override Fit strength for candidate insert when Wave 2 caps Okay. */
  strength: "Strong" | "Okay";
  riskRead: string | null;
  notRecommended: boolean;
  explain: ReturnType<typeof computeComposite>["explain"];
  fallbackUsed: boolean;
};

function landedCostOf(p: CatalogProduct): number {
  return p.productCost + p.intlShip + p.clearanceTaxes + p.localCourier;
}

function scoreLookup(
  scoresByKey: ReadonlyMap<string, ScoreRow>,
  key: string,
): ScoreRow | undefined {
  return scoresByKey.get(key);
}

/**
 * Rank pool products with Wave 2 composite when score cache rows exist.
 * Core passers: listable (Fit OK + soft margin not far_below).
 * If passers &lt; DISCOVERY_FALLBACK_SHORTLIST_MIN → best Fit + soft-margin
 * (exclude far_below / oversized) + fallback message.
 */
export function rankWave2Shortlist(
  profile: Wave2RankProfile,
  catalog: readonly CatalogProduct[],
  scoresByKey: ReadonlyMap<string, ScoreRow>,
  hintsByKey: ReadonlyMap<string, Wave2ScoreHints> = new Map(),
  softCompetitionBudget: boolean = isSoftCompetitionBudgetEnabled(),
): Wave2RankedProduct[] {
  const evaluated: Wave2RankedProduct[] = [];

  for (const p of catalog) {
    if (p.oversized) continue;

    const landedCost = landedCostOf(p);
    const fit = computeFit(profile, {
      category: p.category,
      landedCost,
      difficulty: p.difficulty,
      risk: p.risk,
      timeNeed: p.timeNeed,
      workload: p.workload,
      storageFootprint: p.storageFootprint,
    });
    const margin = computeMargin({
      sellPrice: p.sellPrice,
      productCost: p.productCost,
      intlShip: p.intlShip,
      clearanceTaxes: p.clearanceTaxes,
      localCourier: p.localCourier,
      monthlyFollowOnBudget: profile.monthlyFollowOnBudget,
    });

    const cached = scoreLookup(scoresByKey, p.key);
    const hints = hintsByKey.get(p.key);
    const evidenceSource = cached?.lastScoreStatus === "ok"
      ? "score_cache"
      : cached
        ? "score_cache"
        : "neutral";

    const composite = computeComposite({
      abroadDemandScore: cached?.abroadDemandScore,
      lebanonDemandScore: cached?.lebanonDemandScore,
      competitionScore: cached?.competitionScore,
      confidence: cached?.confidence,
      fit,
      margin,
      budgetUsd: profile.budgetUsd,
      monthlyFollowOnBudget: profile.monthlyFollowOnBudget,
      moqHint: hints?.moqHint,
      sampleCostHint: hints?.sampleCostHint,
      softCompetitionBudget,
      category: p.category,
      evidenceSource: cached ? evidenceSource : "neutral",
    });

    const riskRead =
      composite.listingStrength === "Okay"
        ? fit.riskRead ??
          (composite.softMargin.note
            ? "@fit.moderateOkay"
            : "@fit.moderateOkay")
        : fit.riskRead;

    evaluated.push({
      p,
      landedCost,
      fit,
      margin,
      compositeScore: composite.compositeScore,
      listingStrength: composite.listingStrength,
      strength: composite.listingStrength,
      riskRead,
      notRecommended: !composite.listable,
      explain: composite.explain,
      fallbackUsed: false,
    });
  }

  const passers = evaluated
    .filter((e) => !e.notRecommended)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  let chosen: Wave2RankedProduct[];

  if (passers.length >= DISCOVERY_FALLBACK_SHORTLIST_MIN) {
    chosen = passers;
  } else {
    // Fallback: best Fit + soft-margin (exclude far_below via softMargin on recompute).
    const fallbackPool = evaluated
      .filter((e) => {
        // Soft margin far_below / Fit notRecommended already → notRecommended.
        // Fallback allows Fit-weak only if soft margin not far_below — recheck soft band.
        const soft = e.explain.softMarginBand;
        return soft !== "far_below" && !e.p.oversized;
      })
      .sort((a, b) => {
        if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
        const softRank = (band: string) =>
          band === "pass" ? 2 : band === "soft_ok" ? 1 : 0;
        const d =
          softRank(b.explain.softMarginBand) -
          softRank(a.explain.softMarginBand);
        if (d !== 0) return d;
        return b.compositeScore - a.compositeScore;
      });

    const msg =
      "Fewer than 5 Wave 2 passers — showing best Fit + soft-margin matches.";
    chosen = fallbackPool.map((e) => ({
      ...e,
      fallbackUsed: true,
      notRecommended: false,
      explain: {
        ...e.explain,
        fallbackUsed: true,
        fallbackMessage: msg,
        explainLine:
          "Fallback shortlist: best Fit + soft margin while Wave 2 passers are thin.",
      },
    }));

    // Prefer original passers first, then fill from fallback-ordered rest.
    const passerKeys = new Set(passers.map((p) => p.p.key));
    const head = passers.map((e) => ({
      ...e,
      fallbackUsed: true,
      explain: {
        ...e.explain,
        fallbackUsed: true,
        fallbackMessage: msg,
        explainLine:
          "Fallback shortlist: best Fit + soft margin while Wave 2 passers are thin.",
      },
    }));
    const rest = chosen.filter((e) => !passerKeys.has(e.p.key));
    chosen = [...head, ...rest];
  }

  return applyDiversityReorder(
    chosen.map((e) => ({ ...e, category: e.p.category })),
    DISCOVERY_FALLBACK_SHORTLIST_MIN,
  ).map(({ category: _c, ...rest }) => rest);
}
