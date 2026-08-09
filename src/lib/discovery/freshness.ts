/**
 * WAVE-2 §7 — how fresh the market read behind a Discovery card is.
 *
 * DISPLAY ONLY. Freshness never enters rank, strength, or an accept gate: a
 * card does not sink because its read aged, and it does not become acceptable
 * because a job just ran. The founder is simply told when we last looked, so
 * "we checked yesterday" and "we have never measured this" stop looking alike.
 *
 * Age is measured from the last SUCCESSFUL read (`lastScoredAt`), not the last
 * attempt: a failed refresh keeps last-known scores (§7), so the data on screen
 * is exactly as old as the read that produced it.
 */

import { DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT } from "@/lib/constants";

export const SCORE_FRESHNESS_STATES = ["fresh", "stale", "never"] as const;

export type ScoreFreshnessState = (typeof SCORE_FRESHNESS_STATES)[number];

export type ScoreFreshness = {
  /** never = no successful read yet, so the card is estimate-only (§6.1). */
  state: ScoreFreshnessState;
  /** Whole days since the last successful read; null when never measured. */
  ageDays: number | null;
  lastScoredAt: string | null;
  /** Window that decided `stale`, so founder copy can name it. */
  staleAfterDays: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Staleness window in days. A malformed or non-positive value falls back to the
 * safe default rather than being read as "never goes stale".
 */
export function resolveScoreStaleAfterDays(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.DISCOVERY_SCORE_STALE_AFTER_DAYS?.trim();
  if (!raw) return DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT;
  }
  return Math.floor(n);
}

function parseScoredAt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve the freshness of one score-cache row. An unparseable or absent
 * timestamp fails closed to `never` — we would rather admit we have not
 * measured than imply a read we cannot date.
 */
export function resolveScoreFreshness(input: {
  lastScoredAt?: string | null;
  now?: Date;
  staleAfterDays?: number;
}): ScoreFreshness {
  const staleAfterDays = input.staleAfterDays ?? resolveScoreStaleAfterDays();
  const scoredAtMs = parseScoredAt(input.lastScoredAt);

  if (scoredAtMs == null) {
    return {
      state: "never",
      ageDays: null,
      lastScoredAt: null,
      staleAfterDays,
    };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  // Clock skew must not read as "measured in the future" — floor the age at 0.
  const ageDays = Math.max(0, Math.floor((nowMs - scoredAtMs) / MS_PER_DAY));

  return {
    state: ageDays >= staleAfterDays ? "stale" : "fresh",
    ageDays,
    lastScoredAt: input.lastScoredAt ?? null,
    staleAfterDays,
  };
}

export type ScoreFreshnessNoteKey =
  | "scoreFreshnessToday"
  | "scoreFreshnessDays"
  | "scoreFreshnessStale"
  | "scoreFreshnessNever";

export type ScoreFreshnessNote = {
  key: ScoreFreshnessNoteKey;
  values: { days: number; window: number };
};

/**
 * Founder-facing copy key for a freshness state. Kept beside the resolver so
 * the "never measured" case can never be rendered with the same voice as a
 * dated read — it stays the estimate-only wording §6.1 uses.
 */
export function scoreFreshnessNote(
  freshness: ScoreFreshness,
): ScoreFreshnessNote {
  const values = {
    days: freshness.ageDays ?? 0,
    window: freshness.staleAfterDays,
  };
  if (freshness.state === "never") {
    return { key: "scoreFreshnessNever", values };
  }
  if (freshness.state === "stale") {
    return { key: "scoreFreshnessStale", values };
  }
  return {
    key: values.days === 0 ? "scoreFreshnessToday" : "scoreFreshnessDays",
    values,
  };
}
