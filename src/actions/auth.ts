"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, ensureMigrated, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth";
import { newId, nowIso } from "@/lib/ids";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import {
  defaultWorkspaceName,
  fullDisplayName,
  type WorkspaceNameLocale,
} from "@/lib/workspace-name";

const namePart = z.string().trim().min(1).max(60);

const signupSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type AuthActionState = {
  error?: string;
};

export async function signupAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  ensureMigrated();
  const parsed = signupSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "errorGeneric" };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (existing) {
    return { error: "errorEmailTaken" };
  }

  const locale = await getLocale();
  const nameLocale: WorkspaceNameLocale = locale === "ar" ? "ar" : "en";
  const firstName = parsed.data.firstName;
  const lastName = parsed.data.lastName;
  const createdAt = nowIso();
  const userId = newId();
  const workspaceId = newId();
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await db.insert(schema.users).values({
    id: userId,
    email,
    passwordHash,
    firstName,
    lastName,
    name: fullDisplayName(firstName, lastName),
    createdAt,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    founderUserId: userId,
    name: defaultWorkspaceName({ firstName, locale: nameLocale }),
    language: nameLocale,
    activeSkuId: null,
    shopifyStatus: "not_started",
    createdAt,
  });

  await db.insert(schema.journeyStates).values({
    id: newId(),
    workspaceId,
    primaryState: "discovery",
    pausedFromState: null,
    blockedReason: null,
    updatedAt: createdAt,
  });

  await db.insert(schema.sideStatuses).values({
    id: newId(),
    workspaceId,
    onboardingComplete: false,
    productAccepted: false,
    okayRiskAck: false,
    tier1Resolved: false,
    sampleStatus: "none",
    storeReadyPercent: 0,
    storeReady: false,
    marketingStage: "none",
    batchOrdered: false,
    batchArrivedReady: false,
    topicAWeekCount: 0,
    cashLockAck: false,
    stuckOver10kAck: false,
    updatedAt: createdAt,
  });

  await createSession(userId);
  redirect({ href: "/onboarding", locale });
  return {};
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  ensureMigrated();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "errorCredentials" };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (!user) {
    return { error: "errorCredentials" };
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return { error: "errorCredentials" };
  }

  const locale = await getLocale();
  await createSession(user.id);

  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, user.id))
    .get();

  if (!workspace) {
    redirect({ href: "/onboarding", locale });
    return {};
  }

  const side = await db
    .select()
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspace.id))
    .get();

  if (!side?.onboardingComplete) {
    redirect({ href: "/onboarding", locale });
    return {};
  }

  const { listLiveSkus } = await import("@/lib/sku/journey");
  const { resolvePostLoginLanding } = await import("@/lib/sku/add-sku-gate");
  const live = await listLiveSkus(workspace.id);
  const landing = resolvePostLoginLanding(live.map((s) => ({ id: s.id })));
  if (landing.kind === "sku") {
    redirect({ href: `/sku/${landing.skuId}`, locale });
    return {};
  }
  redirect({ href: "/dashboard", locale });
  return {};
}

export async function logoutAction() {
  await destroySession();
  const locale = await getLocale();
  redirect({ href: "/auth/login", locale });
}
