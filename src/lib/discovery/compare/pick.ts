/**
 * WAVE-2 §6.2 — skills pick among founder “worth considering” marks.
 * Deterministic ranking only; Gemini must narrate this winner, never override.
 */

import {
  DISCOVERY_COMPARE_MAX,
  DISCOVERY_COMPARE_MIN,
} from "@/lib/constants";

export type CompareCandidateSignal = {
  candidateId: string;
  catalogKey: string;
  name: string;
  /** Wave 2 composite when present; null falls back to Fit. */
  compositeScore: number | null;
  fitScore: number;
  /** Session pool rank (lower = shown earlier). */
  rank: number;
  strength: "Strong" | "Okay";
  marginsPass: boolean;
};

export type ComparePickResult = {
  advised: CompareCandidateSignal;
  ordered: CompareCandidateSignal[];
  others: CompareCandidateSignal[];
};

export function isValidCompareSelectionCount(n: number): boolean {
  return n >= DISCOVERY_COMPARE_MIN && n <= DISCOVERY_COMPARE_MAX;
}

/**
 * Toggle a worth-considering mark. Hard-caps at max (4th selection blocked).
 */
export function toggleWorthConsideringMark(
  selectedIds: readonly string[],
  candidateId: string,
  max: number = DISCOVERY_COMPARE_MAX,
): { ids: string[]; blockedAtMax: boolean } {
  if (selectedIds.includes(candidateId)) {
    return {
      ids: selectedIds.filter((id) => id !== candidateId),
      blockedAtMax: false,
    };
  }
  if (selectedIds.length >= max) {
    return { ids: [...selectedIds], blockedAtMax: true };
  }
  return { ids: [...selectedIds, candidateId], blockedAtMax: false };
}

/** Drop marks that are no longer on the visible shortlist (reject / refresh). */
export function revalidateWorthConsideringMarks(
  selectedIds: readonly string[],
  visibleCandidateIds: ReadonlySet<string> | readonly string[],
): string[] {
  const visible =
    visibleCandidateIds instanceof Set
      ? visibleCandidateIds
      : new Set(visibleCandidateIds);
  return selectedIds.filter((id) => visible.has(id));
}

function scoreOf(c: CompareCandidateSignal): number {
  if (c.compositeScore != null && Number.isFinite(c.compositeScore)) {
    return c.compositeScore;
  }
  // Fit is 0..100 — normalize so Fit-only rows still sort stably vs composite.
  return c.fitScore / 100;
}

/**
 * Skills winner among selected only. Higher composite (then Fit), then
 * earlier session rank, then stable candidateId.
 */
export function pickCompareWinner(
  selected: readonly CompareCandidateSignal[],
): ComparePickResult {
  if (!isValidCompareSelectionCount(selected.length)) {
    throw new Error(
      `compare requires ${DISCOVERY_COMPARE_MIN}–${DISCOVERY_COMPARE_MAX} candidates`,
    );
  }

  const ordered = [...selected].sort((a, b) => {
    const scoreDiff = scoreOf(b) - scoreOf(a);
    if (scoreDiff !== 0) return scoreDiff;
    const fitDiff = b.fitScore - a.fitScore;
    if (fitDiff !== 0) return fitDiff;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.candidateId.localeCompare(b.candidateId);
  });

  const advised = ordered[0]!;
  return {
    advised,
    ordered,
    others: ordered.slice(1),
  };
}

/** Parse compositeScore + catalogKey from candidate fitBreakdown JSON. */
export function signalsFromFitBreakdown(
  fitBreakdownJson: string,
  base: Omit<CompareCandidateSignal, "catalogKey" | "compositeScore">,
): CompareCandidateSignal {
  let catalogKey = "";
  let compositeScore: number | null = null;
  try {
    const breakdown = JSON.parse(fitBreakdownJson) as {
      catalogKey?: string;
      wave2?: { compositeScore?: number };
    };
    if (typeof breakdown.catalogKey === "string") {
      catalogKey = breakdown.catalogKey;
    }
    const raw = breakdown.wave2?.compositeScore;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      compositeScore = raw;
    }
  } catch {
    /* keep defaults */
  }
  return { ...base, catalogKey, compositeScore };
}
