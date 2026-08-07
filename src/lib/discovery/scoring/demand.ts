/**
 * Demand skill — dual path (whitespace OR local-proven). WAVE-2 §3.
 * Missing evidence legs → neutral for ranking only (WAVE-2 §7): neutral fill
 * never excludes a product and never counts as proof, so it can never earn a
 * qualified path label (§3.2). Pure / unit-testable.
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
  /**
   * Path label the evidence actually earns; null when the leg the label would
   * claim was neutral-filled. Never label a path from missing evidence (§3.2).
   */
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

  // A qualified path must rest on real evidence for every leg it claims.
  // Whitespace claims abroad traction *and* a thin Lebanon footprint, so both
  // legs must be real. Local-proven claims Lebanon only, and must sit strictly
  // above DEMAND_NEUTRAL — the neutral fill value is never proof, even when a
  // calibration constant happens to equal it.
  const whitespaceOk =
    !abroadMissing &&
    !lebanonMissing &&
    abroad >= DEMAND_ABROAD_STRONG &&
    lebanon < DEMAND_LEBANON_WEAK;
  const localOk =
    !lebanonMissing &&
    lebanon >= DEMAND_LEBANON_STRONG &&
    lebanon > DEMAND_NEUTRAL;

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
    // Neither path qualifies — rank on the better leg so nothing is excluded
    // (§7), but only label when that leg is real evidence rather than fill.
    if (abroad >= lebanon) {
      path = abroadMissing || lebanonMissing ? null : "whitespace";
    } else {
      path = lebanonMissing ? null : "local_proven";
    }
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
