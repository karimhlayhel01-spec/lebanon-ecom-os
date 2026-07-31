/**
 * Wave 1 SKU page section visibility — mirrors deep-page gates on
 * `/marketing` (sample approved) and `/finance` (batch arrived || selling).
 */

const SAMPLE_APPROVED_STATES = new Set([
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
]);

/** Effective journey state when paused (use pausedFromState). */
export function effectiveJourneyState(args: {
  primaryState: string;
  pausedFromState?: string | null;
}): string {
  if (args.primaryState === "paused") {
    return args.pausedFromState ?? "paused";
  }
  return args.primaryState;
}

/**
 * Marketing unlocks after this SKU’s sample is approved
 * (same bar as `/marketing` → sampleApproved).
 */
export function isSkuMarketingSectionUnlocked(args: {
  sampleStatus?: string | null;
  primaryState: string;
  pausedFromState?: string | null;
}): boolean {
  if (args.sampleStatus === "approved") return true;
  const state = effectiveJourneyState(args);
  return SAMPLE_APPROVED_STATES.has(state);
}

/**
 * Store setup (shop-level side status) is reachable after this SKU’s sample
 * is approved — same unlock bar as `/store`.
 */
export function isSkuStoreSectionUnlocked(args: {
  sampleStatus?: string | null;
  primaryState: string;
  pausedFromState?: string | null;
}): boolean {
  return isSkuMarketingSectionUnlocked(args);
}

/**
 * Finance / Topic A unlocks after batch arrived ready OR selling
 * (same bar as `/finance`).
 */
export function isSkuFinanceSectionUnlocked(args: {
  batchArrivedReady: boolean;
  primaryState: string;
  pausedFromState?: string | null;
}): boolean {
  if (args.batchArrivedReady) return true;
  const state = effectiveJourneyState(args);
  return state === "selling";
}

/** Drop hero anchors whose target section is not rendered. */
export function filterSkuHeroCtas<T extends { href: string }>(
  ctas: readonly T[],
  unlocked: { marketing: boolean; finance: boolean },
): T[] {
  return ctas.filter((cta) => {
    if (cta.href === "#marketing" || cta.href.endsWith("#marketing")) {
      return unlocked.marketing;
    }
    if (cta.href === "#finance" || cta.href.endsWith("#finance")) {
      return unlocked.finance;
    }
    return true;
  });
}
