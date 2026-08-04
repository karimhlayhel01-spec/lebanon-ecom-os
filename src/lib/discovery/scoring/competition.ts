/**
 * Competition skill — Lebanon-only intensity → rank multiplier. WAVE-2 §4.
 * High competition stays listable (Okay path) — never zero out.
 */

import {
  COMPETITION_HIGH_MIN,
  COMPETITION_LOW_MAX,
  COMPETITION_RANK_PENALTY_WEIGHT,
  DEMAND_NEUTRAL,
} from "@/lib/discovery/scoring/constants";

export type CompetitionLevel = "low" | "medium" | "high";

export type CompetitionSkillResult = {
  /** Stored 0..1 intensity (missing → neutral). */
  intensity: number;
  level: CompetitionLevel;
  /** 0..1 multiplier for composite (high competition → lower, not zero). */
  multiplier: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEMAND_NEUTRAL;
  return Math.max(0, Math.min(1, n));
}

export function competitionLevelFromIntensity(
  intensity: number,
): CompetitionLevel {
  if (intensity <= COMPETITION_LOW_MAX) return "low";
  if (intensity >= COMPETITION_HIGH_MIN) return "high";
  return "medium";
}

export function scoreCompetition(
  competitionScore: number | null | undefined,
): CompetitionSkillResult {
  const missing =
    competitionScore == null || !Number.isFinite(competitionScore);
  const intensity = missing ? DEMAND_NEUTRAL : clamp01(competitionScore);
  const level = competitionLevelFromIntensity(intensity);
  const multiplier = clamp01(1 - COMPETITION_RANK_PENALTY_WEIGHT * intensity);
  return { intensity, level, multiplier };
}
