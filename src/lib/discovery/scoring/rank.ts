/**
 * Wave 2 shortlist ranking — composite + accept-ready-only filter.
 * Pure over catalog + score cache maps (service loads I/O).
 */

import { DISCOVERY_FALLBACK_SHORTLIST_MIN } from "@/lib/constants";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import {
  isAcceptReadyForShortlist,
  resolveSystemDemandInput,
  type SystemDemandGateInput,
} from "@/lib/discovery/dual-gate";
import type { ScoreRow } from "@/lib/discovery/scores";
import { isSoftCompetitionBudgetEnabled } from "@/lib/discovery/flags";
import { computeComposite, riskReadForOkayReason, type OkayReason } from "@/lib/discovery/scoring/composite";
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
  /** Why Okay — never fake Fit-moderate when capped by confidence/competition. */
  okayReason: OkayReason | null;
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

function systemInputFromCache(
  cached: ScoreRow | undefined,
): SystemDemandGateInput | null {
  if (!cached) return null;
  return {
    abroadDemandScore: cached.abroadDemandScore,
    lebanonDemandScore: cached.lebanonDemandScore,
    demandPath: cached.demandPath,
    compositeScore: cached.compositeScore,
    lastScoreStatus: cached.lastScoreStatus,
    confidence: cached.confidence,
  };
}

/**
 * Rank pool products with Wave 2 composite when score cache rows exist.
 * Shortlist = **accept-ready only** (hard margins, !oversized, demand gate,
 * Fit OK). No soft_ok / far_below / demand-fail fillers. Thin/empty lists
 * surface Edit onboarding in the UI (WAVE-2 §5.2 / §7 / §8).
 */
export function rankWave2Shortlist(
  profile: Wave2RankProfile,
  catalog: readonly CatalogProduct[],
  scoresByKey: ReadonlyMap<string, ScoreRow>,
  hintsByKey: ReadonlyMap<string, Wave2ScoreHints> = new Map(),
  softCompetitionBudget: boolean = isSoftCompetitionBudgetEnabled(),
  opts: {
    systemGateEnabled?: boolean;
    liveSearchEnabled?: boolean;
  } = {},
): Wave2RankedProduct[] {
  const systemGateEnabled = opts.systemGateEnabled !== false;
  const liveSearchEnabled = opts.liveSearchEnabled;
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

    const system = resolveSystemDemandInput({
      cache: systemInputFromCache(cached),
      heuristicProduct: {
        catalogKey: p.key,
        category: p.category,
        difficulty: p.difficulty,
        risk: p.risk,
        tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
        nameEn: p.en.name,
      },
      liveSearchEnabled,
    });

    const composite = computeComposite({
      abroadDemandScore: cached?.abroadDemandScore,
      lebanonDemandScore: cached?.lebanonDemandScore,
      competitionScore: cached?.competitionScore,
      // With no usable cache row the gate falls back to heuristic confidence —
      // score the card with that same number so strength and gate agree.
      confidence: cached?.confidence ?? system?.confidence ?? null,
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

    const acceptReady = isAcceptReadyForShortlist({
      marginsPass: margin.pass,
      oversized: p.oversized,
      fitNotRecommended: fit.notRecommended,
      system,
      systemGateEnabled,
    });

    const riskRead = riskReadForOkayReason(
      composite.okayReason,
      fit.riskRead,
    );

    evaluated.push({
      p,
      landedCost,
      fit,
      margin,
      compositeScore: composite.compositeScore,
      listingStrength: composite.listingStrength,
      strength: composite.listingStrength,
      okayReason: composite.okayReason,
      riskRead,
      notRecommended: !acceptReady || !composite.listable,
      explain: composite.explain,
      fallbackUsed: false,
    });
  }

  const passers = evaluated
    .filter((e) => !e.notRecommended)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  // Accept-ready only — never fill with soft_ok / weak / oversized / demand-fail.
  return applyDiversityReorder(
    passers.map((e) => ({ ...e, category: e.p.category })),
    DISCOVERY_FALLBACK_SHORTLIST_MIN,
  ).map(({ category: _c, ...rest }) => rest);
}
