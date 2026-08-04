/**
 * Demand skill — dual path (whitespace OR local-proven). WAVE-2 §3.
 * Missing evidence legs → neutral (WAVE-2 §7). Pure / unit-testable.
 */

import {
  DEMAND_ABROAD_STRONG,
  DEMAND_LEBANON_STRONG,
  DEMAND_LEBANON_WEAK,
  DEMAND_NEUTRAL,
} from "@/lib/discovery/scoring/constants";

export type DemandPath = "whitespace" | "local_proven";

export type DemandSkillInput = {
  abroadDemandScore: number | null | undefined;
  lebanonDemandScore: number | null | undefined;
};

export type DemandSkillResult = {
  /** 0..1 multiplier for composite core. */
  score: number;
  path: DemandPath | null;
  abroad: number;
  lebanon: number;
  /** True when either leg was missing and filled with neutral. */
  usedNeutral: boolean;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEMAND_NEUTRAL;
  return Math.max(0, Math.min(1, n));
}

export function scoreDemand(input: DemandSkillInput): DemandSkillResult {
  const abroadMissing =
    input.abroadDemandScore == null || !Number.isFinite(input.abroadDemandScore);
  const lebanonMissing =
    input.lebanonDemandScore == null ||
    !Number.isFinite(input.lebanonDemandScore);

  const abroad = abroadMissing
    ? DEMAND_NEUTRAL
    : clamp01(input.abroadDemandScore as number);
  const lebanon = lebanonMissing
    ? DEMAND_NEUTRAL
    : clamp01(input.lebanonDemandScore as number);
  const usedNeutral = abroadMissing || lebanonMissing;

  const whitespaceOk =
    abroad >= DEMAND_ABROAD_STRONG && lebanon < DEMAND_LEBANON_WEAK;
  const localOk = lebanon >= DEMAND_LEBANON_STRONG;

  let path: DemandPath | null = null;
  let score: number;

  if (whitespaceOk && localOk) {
    // Prefer the stronger path when both qualify.
    const whitespaceScore = abroad * (1 - lebanon * 0.5);
    const localScore = lebanon;
    if (localScore >= whitespaceScore) {
      path = "local_proven";
      score = localScore;
    } else {
      path = "whitespace";
      score = whitespaceScore;
    }
  } else if (whitespaceOk) {
    path = "whitespace";
    score = abroad * (1 - lebanon * 0.5);
  } else if (localOk) {
    path = "local_proven";
    score = lebanon;
  } else {
    // Neither path strong — soft demand from the better leg (still rankable).
    path = abroad >= lebanon ? "whitespace" : "local_proven";
    score = Math.max(abroad, lebanon) * 0.85;
  }

  return {
    score: clamp01(score),
    path,
    abroad,
    lebanon,
    usedNeutral,
  };
}
