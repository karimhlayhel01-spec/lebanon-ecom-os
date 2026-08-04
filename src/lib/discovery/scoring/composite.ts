/**
 * Composite skill — demand × competition × budget × Fit + soft margin (+ polish).
 * WAVE-2 §2. Pure / unit-testable.
 */

import type { FitResult } from "@/lib/skills/fit";
import type { MarginResult } from "@/lib/skills/margin";
import {
  SOFT_MARGIN_ADDON_PASS,
  SOFT_MARGIN_ADDON_SOFT_OK,
} from "@/lib/discovery/scoring/constants";
import {
  scoreBudgetFight,
  type BudgetFightResult,
} from "@/lib/discovery/scoring/budget-fight";
import {
  scoreCompetition,
  type CompetitionLevel,
  type CompetitionSkillResult,
} from "@/lib/discovery/scoring/competition";
import {
  scoreDemand,
  type DemandSkillResult,
} from "@/lib/discovery/scoring/demand";
import {
  applyPolishHooks,
  buildExplainLine,
  type ExplainPayload,
  type PolishResult,
} from "@/lib/discovery/scoring/polish";
import {
  computeSoftMargin,
  type SoftMarginResult,
} from "@/lib/discovery/scoring/soft-margin";

export type CompositeInput = {
  abroadDemandScore: number | null | undefined;
  lebanonDemandScore: number | null | undefined;
  competitionScore: number | null | undefined;
  confidence: number | null | undefined;
  fit: FitResult;
  margin: MarginResult;
  budgetUsd: number;
  monthlyFollowOnBudget: number;
  moqHint?: number | null;
  sampleCostHint?: number | null;
  softCompetitionBudget: boolean;
  category: string;
  evidenceSource: ExplainPayload["evidenceSource"];
  fallbackUsed?: boolean;
  fallbackMessage?: string | null;
};

export type CompositeResult = {
  compositeScore: number;
  demand: DemandSkillResult;
  competition: CompetitionSkillResult;
  budgetFight: BudgetFightResult;
  softMargin: SoftMarginResult;
  polish: PolishResult;
  /** Listing strength after high-competition / low-confidence caps. */
  listingStrength: "Strong" | "Okay";
  /** Far-below soft margin or Fit notRecommended → exclude from core passers. */
  listable: boolean;
  explain: ExplainPayload;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function computeComposite(input: CompositeInput): CompositeResult {
  const demand = scoreDemand({
    abroadDemandScore: input.abroadDemandScore,
    lebanonDemandScore: input.lebanonDemandScore,
  });
  const competition = scoreCompetition(input.competitionScore);
  const budgetFight = scoreBudgetFight({
    competitionLevel: competition.level,
    budgetUsd: input.budgetUsd,
    monthlyFollowOnBudget: input.monthlyFollowOnBudget,
    moqHint: input.moqHint,
    sampleCostHint: input.sampleCostHint,
    softMode: input.softCompetitionBudget,
  });
  const softMargin = computeSoftMargin(input.margin);
  const polish = applyPolishHooks({
    confidence: input.confidence,
    budgetUsd: input.budgetUsd,
    sampleCostHint: input.sampleCostHint,
    category: input.category,
  });

  const fitMultiplier = clamp01(input.fit.score / 100);
  const core =
    demand.score *
    competition.multiplier *
    budgetFight.multiplier *
    fitMultiplier;

  const softAddon =
    softMargin.band === "pass"
      ? SOFT_MARGIN_ADDON_PASS
      : softMargin.band === "soft_ok"
        ? SOFT_MARGIN_ADDON_SOFT_OK
        : 0;

  const compositeScore = Math.max(
    0,
    core + softAddon + polish.adjustment,
  );

  const listable =
    !input.fit.notRecommended && softMargin.band !== "far_below";

  let listingStrength: "Strong" | "Okay" = input.fit.strength;
  if (competition.level === "high" || polish.capStrengthOkay) {
    listingStrength = "Okay";
  }
  if (softMargin.band === "soft_ok") {
    listingStrength = "Okay";
  }

  const fallbackUsed = Boolean(input.fallbackUsed);
  const explainLine = buildExplainLine({
    path: demand.path,
    competitionLevel: competition.level as CompetitionLevel,
    softMarginBand: softMargin.band,
    fallbackUsed,
  });

  const explain: ExplainPayload = {
    demandPath: demand.path,
    demandScore: demand.score,
    competitionLevel: competition.level,
    budgetFightMultiplier: budgetFight.multiplier,
    fitScore: input.fit.score,
    softMarginBand: softMargin.band,
    softMarginNote: softMargin.note,
    confidence:
      input.confidence != null && Number.isFinite(input.confidence)
        ? clamp01(input.confidence)
        : 0.5,
    affordabilityNote: polish.affordabilityNote,
    diversityKey: input.category,
    fallbackUsed,
    fallbackMessage: input.fallbackMessage ?? null,
    evidenceSource: input.evidenceSource,
    explainLine,
  };

  return {
    compositeScore,
    demand,
    competition,
    budgetFight,
    softMargin,
    polish,
    listingStrength,
    listable,
    explain,
  };
}
