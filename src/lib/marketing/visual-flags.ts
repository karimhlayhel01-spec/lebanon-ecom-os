/**
 * Wave 4 Phase 6a — in-OS visual gen flag.
 * Default off until MARKETING_VISUAL_GEN=1|true. Do not reuse Discovery flags.
 */

function isTruthyEnvFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/** In-OS Nano/Seedance Generate. Unset / 0 / false / other → off. */
export function isMarketingVisualGenEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isTruthyEnvFlag(env.MARKETING_VISUAL_GEN);
}

/** Higgsfield keys present (never log values). */
export function isHiggsfieldConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.HF_API_KEY_ID?.trim() && env.HF_API_KEY_SECRET?.trim());
}

/** Show Generate: flag on AND keys present. Cap is checked at click. */
export function isMarketingVisualGenReady(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isMarketingVisualGenEnabled(env) && isHiggsfieldConfigured(env);
}
