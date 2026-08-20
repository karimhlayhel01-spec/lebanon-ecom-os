/**
 * WAVE-2 §14 PR3 — Explore more (same session) helpers.
 * Not Refresh. Not Show more. Counter increments only on a successful
 * keep_looking batch (append). not_convinced still replaces after narrowing.
 */

import { DISCOVERY_INITIAL_COUNT } from "@/lib/constants";

export const AGENT_EXPLORE_MORE_MAX = 5;
export const AGENT_HELD_RANK_BASE = 10_000;
export const AGENT_WHY_NOTE_MAX_CHARS = 80;

export function parseShownCatalogKeys(
  raw: string | null | undefined,
): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((k): k is string => typeof k === "string" && k.length > 0),
      ),
    ];
  } catch {
    return [];
  }
}

export function serializeShownCatalogKeys(keys: readonly string[]): string {
  return JSON.stringify([...new Set(keys.filter(Boolean))]);
}

export function unionCatalogKeys(
  a: readonly string[],
  b: readonly string[],
): string[] {
  return [...new Set([...a, ...b].filter(Boolean))];
}

export function excludeShownFromRanked<T extends { key: string }>(
  ranked: readonly T[],
  shown: ReadonlySet<string>,
): T[] {
  return ranked.filter((p) => !shown.has(p.key));
}

export function takeExploreBatch<T>(
  items: readonly T[],
  limit: number = DISCOVERY_INITIAL_COUNT,
): T[] {
  return items.slice(0, Math.max(0, limit));
}

/** Inclusive start / exclusive end of the visible agent grid for this count. */
export function agentWindowRange(exploreMoreCount: number): {
  start: number;
  end: number;
} {
  const start = Math.max(0, Math.floor(exploreMoreCount)) * DISCOVERY_INITIAL_COUNT;
  return { start, end: start + DISCOVERY_INITIAL_COUNT };
}

export function isInAgentGridWindow(
  rank: number,
  exploreMoreCount: number,
): boolean {
  if (rank >= AGENT_HELD_RANK_BASE) return false;
  const { start, end } = agentWindowRange(exploreMoreCount);
  return rank >= start && rank < end;
}

/**
 * Keep looking APPEND: every revealed rank from 0 through the current
 * window end stays on the photo grid. Basket held ranks stay off the grid.
 */
export function isInAgentVisibleGrid(
  rank: number,
  exploreMoreCount: number,
): boolean {
  if (rank >= AGENT_HELD_RANK_BASE) return false;
  const { end } = agentWindowRange(exploreMoreCount);
  return rank >= 0 && rank < end;
}

/** True when this session still has unrevealed grid ranks past the current window. */
export function sessionHasAgentTail(
  gridCount: number,
  exploreMoreCount: number,
): boolean {
  return gridCount > agentWindowRange(exploreMoreCount).end;
}

/**
 * Shown rows behind productsShown were never on screen (old 5-card freeze).
 * Keep looking must not treat them as already seen.
 */
export function wasCandidatePresented(
  status: string,
  rank: number,
  productsShown: number,
): boolean {
  if (status === "accepted" || status === "rejected") return true;
  if (status !== "shown") return false;
  if (rank >= AGENT_HELD_RANK_BASE) return true;
  return rank < productsShown;
}

/** True when the next keep_looking would be the 6th dump batch. */
export function keepLookingRequiresNarrowing(exploreMoreCount: number): boolean {
  return exploreMoreCount >= AGENT_EXPLORE_MORE_MAX;
}

export function gridKeysInRetrieveSet(
  gridKeys: readonly string[],
  retrieveSet: ReadonlySet<string>,
): boolean {
  return gridKeys.every((k) => retrieveSet.has(k));
}
