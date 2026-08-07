/**
 * Composite skill — demand × competition × budget × Fit + soft margin (+ polish).
 * WAVE-2 §2. Pure / unit-testable.
 */

import type { FitResult } from "@/lib/skills/fit";
import type { MarginResult } from "@/lib/skills/margin";
import {
  HEURISTIC_SEED_CONFIDENCE,
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

/**
 * Why listing strength is Okay (Wave 2 caps vs genuine Fit risk).
 * Distinct from Fit.score — Fit number stays operational truth.
 */
export type OkayReason =
  | "fit_risk"
  | "low_evidence_confidence"
  | "high_competition";

export type CompositeResult = {
  compositeScore: number;
  demand: DemandSkillResult;
  competition: CompetitionSkillResult;
  budgetFight: BudgetFightResult;
  softMargin: SoftMarginResult;
  polish: PolishResult;
  /** Listing strength after high-competition / low-confidence caps. */
  listingStrength: "Strong" | "Okay";
  /**
   * Why listing is Okay when listingStrength === "Okay"; null when Strong.
   * Never invents Fit-moderate copy for confidence/competition caps.
   */
  okayReason: OkayReason | null;
  /** Hard margin pass + Fit OK → accept-ready core (soft_ok / far_below excluded). */
  listable: boolean;
  explain: ExplainPayload;
};

/** Map Okay reason → Discovery.notes.* translation key (or Fit riskRead). */
export function riskReadForOkayReason(
  reason: OkayReason | null,
  fitRiskRead: string | null,
): string | null {
  if (!reason) return null;
  switch (reason) {
    case "fit_risk":
      return fitRiskRead ?? "@fit.moderateOkay";
    case "low_evidence_confidence":
      return "@listing.lowEvidenceConfidence";
    case "high_competition":
      return "@listing.highCompetition";
  }
}

export function resolveOkayReason(input: {
  listingStrength: "Strong" | "Okay";
  fitStrength: "Strong" | "Okay";
  capStrengthOkay: boolean;
  competitionHigh: boolean;
}): OkayReason | null {
  if (input.listingStrength !== "Okay") return null;
  // Keep one actionable founder-facing reason. Genuine Fit risk is primary;
  // otherwise competition is more concrete than a concurrent confidence cap.
  if (input.fitStrength === "Okay") return "fit_risk";
  if (input.competitionHigh) return "high_competition";
  if (input.capStrengthOkay) return "low_evidence_confidence";
  return "fit_risk";
}

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

  // Shortlist = accept-ready only: hard Wave 1 margins (band "pass"), not soft_ok.
  const listable =
    !input.fit.notRecommended && softMargin.band === "pass";

  // Neutral-filled demand evidence is not proof, so it caps strength the same
  // way low confidence does — a product we could not measure never reads Strong.
  const evidenceCapOkay = polish.capStrengthOkay || demand.usedNeutral;

  let listingStrength: "Strong" | "Okay" = input.fit.strength;
  if (competition.level === "high" || evidenceCapOkay) {
    listingStrength = "Okay";
  }
  const okayReason = resolveOkayReason({
    listingStrength,
    fitStrength: input.fit.strength,
    capStrengthOkay: evidenceCapOkay,
    competitionHigh: competition.level === "high",
  });

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
        : HEURISTIC_SEED_CONFIDENCE,
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
    okayReason,
    listable,
    explain,
  };
}
