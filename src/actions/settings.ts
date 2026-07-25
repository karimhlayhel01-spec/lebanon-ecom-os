"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, ensureMigrated, schema } from "@/db";
import {
  destroyAllSessions,
  destroySession,
  requireUser,
} from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/workspace";
import { founderEditWorkspace } from "@/lib/memory/repos";
import { deleteUserAndWorkspace } from "@/lib/account/delete-user";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

export type SettingsActionState = {
  error?: string;
  success?: string;
};

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

export async function changePasswordAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  ensureMigrated();
  const user = await requireUser();

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
    .get();
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

  return { success: "passwordChanged" };
}

export async function renameWorkspaceAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return { error: "errorGeneric" };
  }

  const parsed = renameSchema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: "errorGeneric" };
  }

  await founderEditWorkspace(workspace.id, { name: parsed.data.name });
  revalidatePath("/", "layout");
  return { success: "workspaceRenamed" };
}

export async function logoutEverywhereAction(): Promise<void> {
  ensureMigrated();
  const user = await requireUser();
  await destroyAllSessions(user.id);
  const locale = await getLocale();
  redirect({ href: "/auth/login", locale });
}

export async function deleteAccountAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  ensureMigrated();
  const user = await requireUser();

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
    .get();
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
