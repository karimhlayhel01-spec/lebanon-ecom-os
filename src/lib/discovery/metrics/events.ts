/**
 * WAVE-2 §7 "Measure" — Discovery counters and the rates tuned from them.
 *
 * Append-only and one-way: nothing here is read by scoring, ranking, or an
 * accept gate. Thresholds are tuned by a human reading these numbers, never by
 * the product scoring itself — that would make Discovery grade its own work.
 *
 * Every event carries a `dedupeKey` built from its natural identity, so a
 * re-render, a revalidate, or a retried request records the same event once.
 * Kept pure so both the dedupe rule and the rate maths are unit-testable.
 */

export const DISCOVERY_METRIC_KINDS = [
  "shortlist_shown",
  "shortlist_empty",
  /**
   * WAVE-2 §8 — the subset of empty sessions caused by missing / failed scores
   * rather than by the founder's profile. Recorded **beside** `shortlist_empty`
   * (never instead of it), so the sessions-viewed denominator is unchanged and
   * the edit-onboarding rate keeps counting profile-driven nags only.
   */
  "shortlist_empty_no_scores",
  "accept",
  "reject",
  "edit_onboarding_shown",
  "why_explain_opened",
  "compare_run",
  "explain_failed",
  "compare_failed",
] as const;

export type DiscoveryMetricKind = (typeof DISCOVERY_METRIC_KINDS)[number];

export type DiscoveryMetricEvent = {
  kind: DiscoveryMetricKind;
  sessionId: string | null;
  /** Typed action error code (never founder text) for the failure kinds. */
  errorCode: string | null;
  createdAt: string;
};

/**
 * A session opens with either something to show or nothing, never both, so the
 * two outcome kinds share one dedupe key: whichever the founder actually landed
 * on is recorded, and later views of the same session cannot add a second
 * outcome. That keeps `shortlist_shown + shortlist_empty` equal to the number
 * of sessions viewed, which is what the empty rate divides by.
 */
const SHORTLIST_OUTCOME_SLOT = "shortlist_outcome";

/** Stable ids for one compare selection, order-independent. */
function selectionKey(candidateIds: readonly string[]): string {
  return [...new Set(candidateIds.filter(Boolean))].sort().join(",");
}

export function shortlistOutcomeDedupeKey(sessionId: string): string {
  return `${sessionId}|${SHORTLIST_OUTCOME_SLOT}`;
}

export function sessionMetricDedupeKey(
  sessionId: string,
  kind: DiscoveryMetricKind,
): string {
  return `${sessionId}|${kind}`;
}

export function candidateMetricDedupeKey(
  candidateId: string,
  kind: DiscoveryMetricKind,
): string {
  return `${candidateId}|${kind}`;
}

/** One explain failure per card per error code — a retry is the same failure. */
export function explainFailureDedupeKey(
  candidateId: string,
  errorCode: string,
): string {
  return `${candidateId}|explain_failed|${errorCode}`;
}

/**
 * Comparing a different set of marks is a new run; re-running one is not.
 * Candidate ids are minted per session row, so the selection already identifies
 * its session — no session prefix (and no extra lookup) is needed.
 */
export function compareRunDedupeKey(candidateIds: readonly string[]): string {
  return `compare_run|${selectionKey(candidateIds)}`;
}

export function compareFailureDedupeKey(
  candidateIds: readonly string[],
  errorCode: string,
): string {
  return `compare_failed|${selectionKey(candidateIds)}|${errorCode}`;
}

export type DiscoveryMetricWindow = {
  /** ISO bounds, both inclusive. Absent bound = unbounded on that side. */
  from?: string | null;
  to?: string | null;
};

export function filterEventsInWindow<T extends { createdAt: string }>(
  events: readonly T[],
  window: DiscoveryMetricWindow = {},
): T[] {
  const from = window.from ? Date.parse(window.from) : null;
  const to = window.to ? Date.parse(window.to) : null;
  return events.filter((e) => {
    const at = Date.parse(e.createdAt);
    if (!Number.isFinite(at)) return false;
    if (from != null && Number.isFinite(from) && at < from) return false;
    if (to != null && Number.isFinite(to) && at > to) return false;
    return true;
  });
}

export type DiscoveryMetricTotals = Record<DiscoveryMetricKind, number>;

export type DiscoveryMetricsSummary = {
  window: DiscoveryMetricWindow;
  events: number;
  totals: DiscoveryMetricTotals;
  /** Failure counts by typed error code, split by surface. */
  failuresByCode: {
    explain: Record<string, number>;
    compare: Record<string, number>;
  };
  /** Denominator for empty / edit-onboarding rates. */
  sessionsViewed: number;
  /** Denominator for accept rate: accepts + rejects. */
  decisions: number;
  /** Null rather than 0 when the denominator is empty — no data is not 0%. */
  emptyRate: number | null;
  /** Share of viewed sessions that were empty because scoring had no data. */
  noScoresEmptyRate: number | null;
  acceptRate: number | null;
  editOnboardingRate: number | null;
};

function emptyTotals(): DiscoveryMetricTotals {
  return Object.fromEntries(
    DISCOVERY_METRIC_KINDS.map((k) => [k, 0]),
  ) as DiscoveryMetricTotals;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * §7 measurement loop: empty rate, accept rate, edit-onboarding rate over a
 * window. Read by a human (or the metrics CLI) to tune thresholds — never fed
 * back into scoring in this pass.
 */
export function aggregateDiscoveryMetrics(
  events: readonly DiscoveryMetricEvent[],
  window: DiscoveryMetricWindow = {},
): DiscoveryMetricsSummary {
  const inWindow = filterEventsInWindow(events, window);
  const totals = emptyTotals();
  const failuresByCode = {
    explain: {} as Record<string, number>,
    compare: {} as Record<string, number>,
  };

  for (const event of inWindow) {
    if (!DISCOVERY_METRIC_KINDS.includes(event.kind)) continue;
    totals[event.kind] += 1;
    const code = event.errorCode?.trim() || "unknown";
    if (event.kind === "explain_failed") {
      failuresByCode.explain[code] = (failuresByCode.explain[code] ?? 0) + 1;
    } else if (event.kind === "compare_failed") {
      failuresByCode.compare[code] = (failuresByCode.compare[code] ?? 0) + 1;
    }
  }

  const sessionsViewed = totals.shortlist_shown + totals.shortlist_empty;
  const decisions = totals.accept + totals.reject;

  return {
    window,
    events: inWindow.length,
    totals,
    failuresByCode,
    sessionsViewed,
    decisions,
    emptyRate: rate(totals.shortlist_empty, sessionsViewed),
    noScoresEmptyRate: rate(totals.shortlist_empty_no_scores, sessionsViewed),
    acceptRate: rate(totals.accept, decisions),
    editOnboardingRate: rate(totals.edit_onboarding_shown, sessionsViewed),
  };
}
