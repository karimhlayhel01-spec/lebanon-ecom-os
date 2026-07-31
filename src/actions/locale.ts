"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  founderEditOnboardingProfile,
  founderEditWorkspace,
  getWorkspaceForUser,
} from "@/lib/memory/repos";
import type { AppLocale } from "@/i18n/routing";

/** Persist UI language preference when the founder switches EN ↔ AR in the header. */
export async function setUiLanguageAction(locale: AppLocale) {
  if (locale !== "en" && locale !== "ar") return;

  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await founderEditOnboardingProfile(workspace.id, { uiLanguage: locale });
  await founderEditWorkspace(workspace.id, { language: locale });
  revalidatePath("/", "layout");
}
