"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  founderEditOnboardingProfile,
  founderEditWorkspace,
} from "@/lib/memory/repos";
import type { AppLocale } from "@/i18n/routing";

/** Persist UI language preference when the founder switches EN ↔ AR in the header. */
export async function setUiLanguageAction(locale: AppLocale) {
  if (locale !== "en" && locale !== "ar") return;

  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;

  await founderEditOnboardingProfile(ctx.workspace.id, { uiLanguage: locale });
  await founderEditWorkspace(ctx.workspace.id, { language: locale });
  revalidatePath("/", "layout");
}
