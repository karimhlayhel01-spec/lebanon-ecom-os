"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, ensureMigrated, schema } from "@/db";
import {
  createSession,
  destroyAllSessions,
  destroySession,
} from "@/lib/auth";
import {
  requireOnboardedWorkspace,
} from "@/lib/workspace";
import { founderEditWorkspace } from "@/lib/memory/repos";
import { deleteUserAndWorkspace } from "@/lib/account/delete-user";
import { isDemoResetEnabled, isDemoWipeEmptyEnabled } from "@/lib/demo/config";
import { resetWorkspaceJourney } from "@/lib/demo/reset-journey";
import { restoreDemoDiscovery } from "@/lib/demo/seed-discovery";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

export type SettingsActionState = {
  error?: string;
  success?: string;
};

/** Settings UI only knows errorGeneric for gate failures. */
function settingsGateFail(
  error: "not_found" | "onboarding_required",
): SettingsActionState {
  void error;
  return { error: "errorGeneric" };
}

const passwordSchema = z.string().min(8).max(200);

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "errorPasswordMismatch",
    path: ["confirmPassword"],
  });

const renameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1),
  confirmToken: z.literal("DELETE"),
});

const demoRestoreSchema = z.object({
  confirmToken: z.literal("RESTORE"),
});

const demoWipeSchema = z.object({
  confirmToken: z.literal("WIPE"),
});

export async function changePasswordAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return settingsGateFail(ctx.error);
  const user = ctx.user;

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some(
      (i) => i.message === "errorPasswordMismatch",
    );
    return { error: mismatch ? "errorPasswordMismatch" : "errorGeneric" };
  }

  const row = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .then((rows) => rows[0]);
  if (!row) {
    return { error: "errorGeneric" };
  }

  const ok = await bcrypt.compare(
    parsed.data.currentPassword,
    row.passwordHash,
  );
  if (!ok) {
    return { error: "errorCurrentPassword" };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .update(schema.users)
    .set({ passwordHash })
    .where(eq(schema.users.id, user.id));

  // Same wipe as logoutEverywhere (all sessions + cookie), then mint a fresh
  // session for this browser so stolen cookies die without forcing re-login here.
  await destroyAllSessions(user.id);
  await createSession(user.id);

  return { success: "passwordChanged" };
}

export async function renameWorkspaceAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return settingsGateFail(ctx.error);

  const parsed = renameSchema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: "errorGeneric" };
  }

  await founderEditWorkspace(ctx.workspace.id, { name: parsed.data.name });
  revalidatePath("/", "layout");
  return { success: "workspaceRenamed" };
}

export async function logoutEverywhereAction(): Promise<void> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;
  await destroyAllSessions(ctx.user.id);
  const locale = await getLocale();
  redirect({ href: "/auth/login", locale });
}

export async function deleteAccountAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return settingsGateFail(ctx.error);
  const user = ctx.user;

  const parsed = deleteAccountSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    confirmToken: formData.get("confirmToken"),
  });
  if (!parsed.success) {
    const badToken = parsed.error.issues.some(
      (i) => i.path[0] === "confirmToken",
    );
    return { error: badToken ? "errorDeleteConfirm" : "errorGeneric" };
  }

  const row = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .then((rows) => rows[0]);
  if (!row) {
    return { error: "errorGeneric" };
  }

  const ok = await bcrypt.compare(
    parsed.data.currentPassword,
    row.passwordHash,
  );
  if (!ok) {
    return { error: "errorCurrentPassword" };
  }

  await deleteUserAndWorkspace(user.id);
  await destroySession();
  const locale = await getLocale();
  redirect({ href: "/auth/signup", locale });
  return {};
}

/**
 * Temporary DEMO control: wipe journey → invent/catalog Discovery shortlist
 * (5 visible, Show more up to 25). No Serper/SerpAPI.
 * Hard no-op unless isDemoResetEnabled().
 */
export async function demoRestoreDiscoveryAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  if (!isDemoResetEnabled()) {
    return { error: "errorGeneric" };
  }

  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return settingsGateFail(ctx.error);

  const parsed = demoRestoreSchema.safeParse({
    confirmToken: formData.get("confirmToken"),
  });
  if (!parsed.success) {
    return { error: "errorDemoResetConfirm" };
  }

  try {
    await restoreDemoDiscovery(ctx.workspace.id);
  } catch {
    return { error: "errorGeneric" };
  }
  revalidatePath("/", "layout");
  const locale = await getLocale();
  redirect({ href: "/dashboard", locale });
  return {};
}

/**
 * Dev-only: wipe journey to empty Discovery (no seed).
 * Hidden in production even when DEMO_RESET is allowed.
 */
export async function demoWipeEmptyAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  if (!isDemoWipeEmptyEnabled()) {
    return { error: "errorGeneric" };
  }

  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return settingsGateFail(ctx.error);

  const parsed = demoWipeSchema.safeParse({
    confirmToken: formData.get("confirmToken"),
  });
  if (!parsed.success) {
    return { error: "errorDemoResetConfirm" };
  }

  await resetWorkspaceJourney(ctx.workspace.id);
  revalidatePath("/", "layout");
  const locale = await getLocale();
  redirect({ href: "/dashboard", locale });
  return {};
}
