/**
 * BudgetFight skill — “can they afford this fight?” WAVE-2 §4.3.
 * Soft mode = rank penalty only. Missing MOQ/sample = neutral (no exclude).
 */

import {
  BUDGET_FIGHT_HIGH_ADS_MIN_USD,
  BUDGET_FIGHT_LOW_MIN_USD,
  BUDGET_FIGHT_MED_ADS_MIN_USD,
  BUDGET_FIGHT_PENALTY_HARD_SHADOW,
  BUDGET_FIGHT_PENALTY_SOFT,
} from "@/lib/discovery/scoring/constants";
import type { CompetitionLevel } from "@/lib/discovery/scoring/competition";

export type BudgetFightInput = {
  competitionLevel: CompetitionLevel;
  budgetUsd: number;
  monthlyFollowOnBudget: number;
  /** Missing → neutral (do not exclude). */
  moqHint?: number | null;
  sampleCostHint?: number | null;
  /** Soft = WAVE-2 default (penalty). Hard = shadow would-exclude only this pass. */
  softMode: boolean;
};

export type BudgetFightResult = {
  /** 0..1 multiplier (1 = no penalty). */
  multiplier: number;
  wouldExclude: boolean;
  excludeReason: string | null;
  /** True when MOQ/sample were absent and treated as neutral. */
  missingHintsNeutral: boolean;
};

export function scoreBudgetFight(input: BudgetFightInput): BudgetFightResult {
  const missingHintsNeutral =
    input.moqHint == null && input.sampleCostHint == null;

  // Optional soft affordability signal only when hints exist — never sole exclude.
  let hintOk = true;
  if (input.sampleCostHint != null && Number.isFinite(input.sampleCostHint)) {
    hintOk = input.sampleCostHint <= input.budgetUsd * 0.25;
  }

  const budget = Math.max(0, input.budgetUsd);
  const ads = Math.max(0, input.monthlyFollowOnBudget);

  let canFight = true;
  let reason: string | null = null;

  switch (input.competitionLevel) {
    case "low":
      // Sample + small first batch spirit.
      canFight = budget >= BUDGET_FIGHT_LOW_MIN_USD && hintOk;
      if (!canFight) reason = "thin_budget_low_competition_fight";
      break;
    case "medium":
      canFight =
        budget >= BUDGET_FIGHT_LOW_MIN_USD &&
        ads >= BUDGET_FIGHT_MED_ADS_MIN_USD &&
        hintOk;
      if (!canFight) reason = "thin_budget_medium_competition_fight";
      break;
    case "high":
      canFight =
        budget >= BUDGET_FIGHT_LOW_MIN_USD * 1.25 &&
        ads >= BUDGET_FIGHT_HIGH_ADS_MIN_USD &&
        hintOk;
      if (!canFight) reason = "thin_budget_high_competition_fight";
      break;
  }

  if (canFight) {
    return {
      multiplier: 1,
      wouldExclude: false,
      excludeReason: null,
      missingHintsNeutral,
    };
  }

  if (input.softMode) {
    return {
      multiplier: BUDGET_FIGHT_PENALTY_SOFT,
      wouldExclude: false,
      excludeReason: reason,
      missingHintsNeutral,
    };
  }

  // Hard mode (flag off): still shadow-only this pass — do not hard-hide.
  return {
    multiplier: BUDGET_FIGHT_PENALTY_HARD_SHADOW,
    wouldExclude: true,
    excludeReason: reason,
    missingHintsNeutral,
  };
}
