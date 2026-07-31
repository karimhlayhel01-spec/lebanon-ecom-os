/**
 * REMOVABLE PREVIEW MODULE — local QA only.
 *
 * Everything under `src/lib/preview/` (plus `scripts/seed-preview.ts`, the
 * `/preview` page, the PreviewBanner component, and the README section) exists
 * only to let us walk the guided path end-to-end without hand-filling every
 * form. It is gated behind the `PREVIEW_MODE` env flag and is safe to delete in
 * one pass before shipping a clean v1. See README → "Preview (local QA)".
 */

/** Preview is OFF unless PREVIEW_MODE=1 (or "true"). Never on by default. */
export function isPreviewMode(): boolean {
  const v = process.env.PREVIEW_MODE;
  return v === "1" || v === "true";
}

/** Known demo credentials — documented in the README preview section. */
export const PREVIEW_EMAIL = "preview@local.dev";
export const PREVIEW_PASSWORD = "preview1234";
export const PREVIEW_FIRST_NAME = "Preview";
export const PREVIEW_LAST_NAME = "Founder";
export const PREVIEW_USER_NAME = `${PREVIEW_FIRST_NAME} ${PREVIEW_LAST_NAME}`;

/** Classic guided-path stages (A→E). Each is cumulative of the ones before it. */
export const CLASSIC_PREVIEW_STAGES = [
  "discovery",
  "accepted",
  "sample_approved",
  "batch_arrived_ready",
  "selling",
] as const;

/**
 * Wave 1 multi-SKU QA fixtures. Each re-seeds the demo user from scratch to a
 * fixed shape (not cumulative with each other).
 *
 * Wave 2 (Import | Local | Both): classic `sample_approved` / `selling` and
 * `wave1_*` stages keep working. Opening Supplier backfills a Local 3+2 pool
 * alongside Import via ensureSuppliers — request a Local sample from the Local
 * tab (or Both) after Reset → accepted / sample stage. No dedicated wave2_*
 * stage required for smoke.
 */
export const WAVE1_PREVIEW_STAGES = [
  "wave1_two_sku",
  "wave1_beginner_blocked",
  "wave1_ready_add",
  "wave1_archived",
  "wave1_marketing_paths",
] as const;

/** All seedable stages (classic path + Wave 1 fixtures). */
export const PREVIEW_STAGES = [
  ...CLASSIC_PREVIEW_STAGES,
  ...WAVE1_PREVIEW_STAGES,
] as const;

export type ClassicPreviewStage = (typeof CLASSIC_PREVIEW_STAGES)[number];
export type Wave1PreviewStage = (typeof WAVE1_PREVIEW_STAGES)[number];
export type PreviewStage = (typeof PREVIEW_STAGES)[number];

export function isPreviewStage(value: string): value is PreviewStage {
  return (PREVIEW_STAGES as readonly string[]).includes(value);
}

export function isWave1PreviewStage(value: string): value is Wave1PreviewStage {
  return (WAVE1_PREVIEW_STAGES as readonly string[]).includes(value);
}

export function isClassicPreviewStage(
  value: string,
): value is ClassicPreviewStage {
  return (CLASSIC_PREVIEW_STAGES as readonly string[]).includes(value);
}

/** Cookie set by stage-jump so banners can warn about sticky fixture side effects. */
export const PREVIEW_LAST_STAGE_COOKIE = "preview_last_stage";
