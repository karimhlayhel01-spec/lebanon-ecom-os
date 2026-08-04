/**
 * Polish hooks (WAVE-2 §6) — applied after core; mild nudges only.
 * Explain payload is for later §6.1 (“Why this pick?”) — not a scoring brain.
 */

import {
  CONFIDENCE_OKAY_CAP,
  POLISH_AFFORDABILITY_PENALTY,
  POLISH_LOW_CONFIDENCE_PENALTY,
} from "@/lib/discovery/scoring/constants";
import type { CompetitionLevel } from "@/lib/discovery/scoring/competition";
import type { DemandPath } from "@/lib/discovery/scoring/demand";
import type { SoftMarginBand } from "@/lib/discovery/scoring/soft-margin";

export type ExplainPayload = {
  demandPath: DemandPath | null;
  demandScore: number;
  competitionLevel: CompetitionLevel;
  budgetFightMultiplier: number;
  fitScore: number;
  softMarginBand: SoftMarginBand;
  softMarginNote: string | null;
  confidence: number;
  affordabilityNote: string | null;
  /** Category key for diversity polish. */
  diversityKey: string;
  fallbackUsed: boolean;
  fallbackMessage: string | null;
  evidenceSource: "heuristic_seed" | "score_cache" | "neutral";
  /** Stable one-liner for jobs / debug; §6.1 narrates this later. */
  explainLine: string;
};

export type PolishInput = {
  confidence: number | null | undefined;
  budgetUsd: number;
  sampleCostHint?: number | null;
  category: string;
};

export type PolishResult = {
  /** Additive adjustment (usually ≤ 0). */
  adjustment: number;
  affordabilityNote: string | null;
  /** When true, listing strength should not be Strong. */
  capStrengthOkay: boolean;
};

export function applyPolishHooks(input: PolishInput): PolishResult {
  let adjustment = 0;
  let affordabilityNote: string | null = null;
  const confidence =
    input.confidence != null && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0.5;

  if (confidence < CONFIDENCE_OKAY_CAP) {
    adjustment -= POLISH_LOW_CONFIDENCE_PENALTY;
  }

  if (
    input.sampleCostHint != null &&
    Number.isFinite(input.sampleCostHint) &&
    input.budgetUsd > 0 &&
    input.sampleCostHint > input.budgetUsd * 0.2
  ) {
    adjustment -= POLISH_AFFORDABILITY_PENALTY;
    affordabilityNote = "sample_heavy_vs_budget";
  }

  return {
    adjustment,
    affordabilityNote,
    capStrengthOkay: confidence < CONFIDENCE_OKAY_CAP,
  };
}

/**
 * Prefer category diversity in the first shortlist window (WAVE-2 §6.2).
 * Stable sort: keep relative order when categories already differ.
 */
export function applyDiversityReorder<T extends { category: string }>(
  ranked: readonly T[],
  windowSize = 5,
): T[] {
  if (ranked.length <= 1) return [...ranked];
  const remaining = [...ranked];
  const out: T[] = [];
  const seen = new Set<string>();

  while (remaining.length > 0 && out.length < windowSize) {
    const idx = remaining.findIndex((p) => !seen.has(p.category));
    const pick = idx >= 0 ? idx : 0;
    const [chosen] = remaining.splice(pick, 1);
    out.push(chosen);
    seen.add(chosen.category);
  }
  out.push(...remaining);
  return out;
}

export function buildExplainLine(parts: {
  path: DemandPath | null;
  competitionLevel: CompetitionLevel;
  softMarginBand: SoftMarginBand;
  fallbackUsed: boolean;
}): string {
  if (parts.fallbackUsed) {
    return "Fallback shortlist: best Fit + soft margin while Wave 2 passers are thin.";
  }
  const pathBit =
    parts.path === "whitespace"
      ? "abroad traction + Lebanon gap"
      : parts.path === "local_proven"
        ? "Lebanon demand signal"
        : "neutral demand";
  const marginBit =
    parts.softMarginBand === "soft_ok"
      ? "; margins tight vs target"
      : parts.softMarginBand === "far_below"
        ? "; margins far below target"
        : "";
  return `Listed via ${pathBit}; competition ${parts.competitionLevel}${marginBit}.`;
}
