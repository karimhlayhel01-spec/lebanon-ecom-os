/**
 * WAVE-2 §6.2 compare brief view state — a brief belongs to exactly ONE
 * selection. Kept pure so “never show a brief for marks the founder changed”
 * is unit-testable without a DOM.
 */

import { isCompleteCompareBody } from "@/lib/discovery/explain/compare";

export type CompareHonestyKey =
  | "whySuggestedHonesty"
  | "whySuggestedHonestyLive"
  | "whySuggestedHonestyEstimate";

export type CompareBriefState = {
  open: boolean;
  body: string | null;
  cacheVersion: string | null;
  /** Selection the body describes; null whenever there is no body. */
  fingerprint: string | null;
  advisedName: string | null;
  honestyKey: CompareHonestyKey;
  error: string | null;
  /**
   * Selection whose answer is in flight. An answer that arrives for anything
   * else is discarded — the founder has moved on.
   */
  pendingFingerprint: string | null;
};

export const EMPTY_COMPARE_BRIEF: CompareBriefState = {
  open: false,
  body: null,
  cacheVersion: null,
  fingerprint: null,
  advisedName: null,
  honestyKey: "whySuggestedHonestyEstimate",
  error: null,
  pendingFingerprint: null,
};

export type CompareBriefResponse =
  | {
      ok: true;
      body: string;
      cacheVersion: string;
      advisedName: string | null;
      honestyKey: CompareHonestyKey;
    }
  | {
      ok: false;
      error: string;
      /** Skills pick when the server already chose a winner. */
      advisedName?: string | null;
    };

/**
 * Identity of a compare selection. Sorted so mark order never forces a
 * refetch, and locale-scoped because the brief is written in one language.
 */
export function compareSelectionFingerprint(input: {
  sessionId: string;
  candidateIds: readonly string[];
  locale: string;
}): string {
  const ids = [...new Set(input.candidateIds.filter(Boolean))].sort();
  return `${input.sessionId}|${ids.join(",")}|${input.locale}`;
}

/**
 * A held body is reusable only for the exact selection it was generated from,
 * on the current cache version, and only while it is still a complete brief.
 */
export function compareBriefIsCurrent(
  state: CompareBriefState,
  input: { fingerprint: string; cacheVersion: string },
): boolean {
  if (!state.body) return false;
  if (state.fingerprint !== input.fingerprint) return false;
  if (state.cacheVersion !== input.cacheVersion) return false;
  return isCompleteCompareBody(state.body);
}

/**
 * Any mark change, prune, refresh, or new session drops the brief AND forgets
 * the in-flight request, so a late answer can no longer land.
 */
export function clearCompareBrief(): CompareBriefState {
  return EMPTY_COMPARE_BRIEF;
}

export function closeCompareBrief(state: CompareBriefState): CompareBriefState {
  return { ...state, open: false };
}

/** Pre-flight failure (missing key, invalid selection) — never a stale body. */
export function compareBriefError(error: string): CompareBriefState {
  return { ...EMPTY_COMPARE_BRIEF, open: true, error };
}

/**
 * Open the modal for `fingerprint`. Reuses a still-current body, otherwise
 * drops whatever is held and marks the new selection as the one being fetched.
 */
export function beginCompareRequest(
  state: CompareBriefState,
  input: { fingerprint: string; cacheVersion: string },
): CompareBriefState {
  if (compareBriefIsCurrent(state, input)) {
    return { ...state, open: true, error: null, pendingFingerprint: null };
  }
  return {
    ...EMPTY_COMPARE_BRIEF,
    open: true,
    pendingFingerprint: input.fingerprint,
  };
}

/** True when `beginCompareRequest` needs the server rather than a held body. */
export function compareBriefNeedsFetch(state: CompareBriefState): boolean {
  return state.pendingFingerprint != null;
}

/**
 * Apply an answer to the selection that asked for it. A response whose
 * fingerprint no longer matches the pending one is dropped on the floor.
 */
export function applyCompareResponse(
  state: CompareBriefState,
  input: { fingerprint: string; response: CompareBriefResponse },
): CompareBriefState {
  if (state.pendingFingerprint !== input.fingerprint) return state;
  if (!input.response.ok) {
    return {
      ...EMPTY_COMPARE_BRIEF,
      open: state.open,
      error: input.response.error,
      advisedName: input.response.advisedName ?? null,
    };
  }
  return {
    open: state.open,
    body: input.response.body,
    cacheVersion: input.response.cacheVersion,
    fingerprint: input.fingerprint,
    advisedName: input.response.advisedName,
    honestyKey: input.response.honestyKey,
    error: null,
    pendingFingerprint: null,
  };
}
