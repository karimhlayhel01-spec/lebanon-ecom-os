/**
 * Wave 2 Discovery feature flags (engineering-risk foundation).
 * Defaults keep Wave 1 curated Discovery until explicitly enabled.
 */

function isTruthyEnvFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

function isFalsyEnvFlag(v: string | undefined): boolean {
  return v === "0" || v === "false";
}

/** Read Postgres product pool / score cache instead of in-memory catalog only. */
export function isDiscoveryPoolV2Enabled(): boolean {
  return isTruthyEnvFlag(process.env.DISCOVERY_POOL_V2);
}

/**
 * Allow scheduled jobs to call a live search/shopping provider.
 * Default off — Discovery page loads must never live-search (Approach A).
 */
export function isDiscoveryLiveSearchEnabled(): boolean {
  return isTruthyEnvFlag(process.env.DISCOVERY_LIVE_SEARCH);
}

/**
 * Competition×budget as rank penalty (soft) vs hard exclude.
 * Soft is the WAVE-2 default; set DISCOVERY_SOFT_COMPETITION_BUDGET=0 to signal
 * hard mode is allowed (still prefer shadow logs before enforcing).
 */
export function isSoftCompetitionBudgetEnabled(): boolean {
  if (isFalsyEnvFlag(process.env.DISCOVERY_SOFT_COMPETITION_BUDGET)) {
    return false;
  }
  // Unset or truthy → soft (safe default per WAVE-2 §7).
  return true;
}
