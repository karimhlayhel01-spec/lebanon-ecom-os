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
export const PREVIEW_USER_NAME = "Preview Founder";

/** Ordered QA stages (A→E). Each stage is cumulative of the ones before it. */
export const PREVIEW_STAGES = [
  "discovery",
  "accepted",
  "sample_approved",
  "batch_arrived_ready",
  "selling",
] as const;

export type PreviewStage = (typeof PREVIEW_STAGES)[number];

export function isPreviewStage(value: string): value is PreviewStage {
  return (PREVIEW_STAGES as readonly string[]).includes(value);
}
