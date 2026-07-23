"use server";

/**
 * REMOVABLE PREVIEW ACTIONS — local QA only.
 *
 * Server actions behind the /preview page. Each seeds the demo workspace to a
 * stage, logs in as the preview founder, and drops you on the dashboard. All
 * are hard no-ops unless PREVIEW_MODE is on. Delete `src/lib/preview/` to remove.
 */

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSession } from "@/lib/auth";
import { isPreviewMode, isPreviewStage } from "@/lib/preview/config";
import { seedPreview } from "@/lib/preview/seed";

export type PreviewActionState = { error?: string };

export async function seedAndEnterAction(
  _prev: PreviewActionState,
  formData: FormData,
): Promise<PreviewActionState> {
  if (!isPreviewMode()) return { error: "disabled" };

  const stage = String(formData.get("stage") ?? "");
  if (!isPreviewStage(stage)) return { error: "bad_stage" };

  const result = await seedPreview(stage);
  if (!result.ok) return { error: "seed_failed" };

  await createSession(result.userId);
  const locale = await getLocale();
  redirect({ href: "/dashboard", locale });
  return {};
}
