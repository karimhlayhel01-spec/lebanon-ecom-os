/**
 * Pure onboarding completion gate for pages + mutating server actions.
 */

/** Pure gate: side_statuses.onboardingComplete must be true. */
export function evaluateOnboardingGate(
  side: { onboardingComplete: boolean } | null | undefined,
): { ok: true } | { ok: false; error: "onboarding_required" } {
  if (!side?.onboardingComplete) {
    return { ok: false, error: "onboarding_required" };
  }
  return { ok: true };
}
