/**
 * WAVE-2 §8 — why the Discovery shortlist is empty.
 *
 * "Edit onboarding" answers a PROFILE problem: budget, Fit, or category answers
 * filtered every product out, and widening them is a fix the founder can make.
 * An empty board caused by missing or failed score rows is an ops problem —
 * editing onboarding cannot fix it, and §8 already forbids the nag there ("low
 * search confidence alone — data issue, not onboarding"). Sending a founder to
 * rewrite a profile that was never the blocker wastes their time and teaches
 * them to distrust the banner the one time it is right.
 *
 * Kept pure so the founder-facing state and the §7.1 counters are decided by
 * one rule, without a database.
 */

import { DISCOVERY_FALLBACK_SHORTLIST_MIN } from "@/lib/constants";
import type { SystemDemandGateResult } from "@/lib/discovery/dual-gate";

/** Why one product is not on the shortlist. Null when it is listed. */
export type ShortlistBlocker =
  | "profile"
  | "score_cache_missing"
  | "score_refresh_failed";

export type ShortlistBlockerTally = {
  scoreCacheMissing: number;
  scoreRefreshFailed: number;
  profile: number;
};

export type ShortlistEmptyCause = "no_scores" | "profile_filtered";

export type ShortlistEmptyState = {
  cause: ShortlistEmptyCause;
  /**
   * Ops next step for a data outage — never scored yet vs a refresh that
   * failed. Null for profile filtering, which has no ops action.
   */
  reason: "score_cache_missing" | "score_refresh_failed" | null;
};

/** Soft Edit-onboarding banner when accept-ready shortlist is empty or thin. */
export type EditOnboardingBanner = "zero_accept_ready" | "thin_accept_ready";

export type ShortlistEmptyDecision = {
  emptyState: ShortlistEmptyState | null;
  editOnboardingBanner: EditOnboardingBanner | null;
};

/**
 * Classify one excluded product. `included` is shortlist membership, not just
 * the accept gate, so a product dropped by the listing band is still counted.
 */
export function classifyShortlistBlocker(input: {
  included: boolean;
  marginsPass: boolean;
  oversized: boolean;
  fitNotRecommended: boolean;
  systemDemand?: SystemDemandGateResult | null;
}): ShortlistBlocker | null {
  if (input.included) return null;

  // Profile gates first: a product excluded by budget / Fit / size stays
  // excluded after a perfect score refresh, so it is never evidence that the
  // scoring pipeline is what emptied the board.
  if (input.oversized || !input.marginsPass || input.fitNotRecommended) {
    return "profile";
  }

  if (input.systemDemand?.status === "missing") {
    return input.systemDemand.reason === "score_refresh_failed"
      ? "score_refresh_failed"
      : "score_cache_missing";
  }

  // Scored and too weak is a real measurement (§3.2) — that is the pool and
  // the profile talking, not an outage.
  return "profile";
}

export function emptyBlockerTally(): ShortlistBlockerTally {
  return { scoreCacheMissing: 0, scoreRefreshFailed: 0, profile: 0 };
}

export function tallyShortlistBlockers(
  blockers: readonly (ShortlistBlocker | null)[],
): ShortlistBlockerTally {
  const tally = emptyBlockerTally();
  for (const blocker of blockers) {
    if (blocker === "score_cache_missing") tally.scoreCacheMissing += 1;
    else if (blocker === "score_refresh_failed") tally.scoreRefreshFailed += 1;
    else if (blocker === "profile") tally.profile += 1;
  }
  return tally;
}

export function mergeBlockerTallies(
  a: ShortlistBlockerTally,
  b: ShortlistBlockerTally,
): ShortlistBlockerTally {
  return {
    scoreCacheMissing: a.scoreCacheMissing + b.scoreCacheMissing,
    scoreRefreshFailed: a.scoreRefreshFailed + b.scoreRefreshFailed,
    profile: a.profile + b.profile,
  };
}

/** Products the board lost to a data outage rather than to the profile. */
export function scoreDataBlockedCount(tally: ShortlistBlockerTally): number {
  return tally.scoreCacheMissing + tally.scoreRefreshFailed;
}

/**
 * Decide the empty-board story and whether the Edit onboarding banner is
 * honest here (§8).
 *
 * Only an empty board with nothing left in the pool can be either cause: while
 * accept-ready products remain, the A–D ladder already offers show-more /
 * continue and no banner is shown, so there is nothing to misattribute.
 */
export function resolveShortlistEmptyDecision(input: {
  acceptReadyVisible: number;
  remainingEligible: number;
  blockers: ShortlistBlockerTally;
}): ShortlistEmptyDecision {
  const { acceptReadyVisible, remainingEligible, blockers } = input;

  if (acceptReadyVisible === 0 && remainingEligible <= 0) {
    const scoreData = scoreDataBlockedCount(blockers);
    // A tie goes to the data outage: with half the pool unmeasured we cannot
    // honestly say the profile is the problem, and the §8 rule is a floor, not
    // a preference. A missed nag is recoverable; blaming a founder's profile
    // for our own pipeline is not.
    if (scoreData > 0 && scoreData >= blockers.profile) {
      return {
        emptyState: {
          cause: "no_scores",
          // A refresh that failed is the louder, more specific ops signal than
          // a pool that was simply never scored, so it wins when both appear.
          reason:
            blockers.scoreRefreshFailed > 0
              ? "score_refresh_failed"
              : "score_cache_missing",
        },
        editOnboardingBanner: null,
      };
    }
    return {
      emptyState: { cause: "profile_filtered", reason: null },
      editOnboardingBanner: "zero_accept_ready",
    };
  }

  if (
    acceptReadyVisible > 0 &&
    acceptReadyVisible + remainingEligible < DISCOVERY_FALLBACK_SHORTLIST_MIN
  ) {
    return { emptyState: null, editOnboardingBanner: "thin_accept_ready" };
  }

  return { emptyState: null, editOnboardingBanner: null };
}
