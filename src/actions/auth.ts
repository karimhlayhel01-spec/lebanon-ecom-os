"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db, ensureMigrated, schema } from "@/db";
import { createSession, destroySession, setSessionCookie } from "@/lib/auth";
import {
  clearLoginRateLimits,
  isLoginRateLimited,
  loginRateLimitKey,
  recordLoginFailures,
} from "@/lib/auth/login-rate-limit";
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

/** Best-effort client IP for login throttle (proxy headers when present). */
async function clientIpForRateLimit(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

export async function signupAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  await ensureMigrated();
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
    .then((rows) => rows[0]);
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

  let sessionId: string;
  let sessionExpiresAt: string;
  try {
    const session = await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({
        id: userId,
        email,
        passwordHash,
        firstName,
        lastName,
        name: fullDisplayName(firstName, lastName),
        createdAt,
      });

      await tx.insert(schema.workspaces).values({
        id: workspaceId,
        founderUserId: userId,
        name: defaultWorkspaceName({ firstName, locale: nameLocale }),
        language: nameLocale,
        activeSkuId: null,
        shopifyStatus: "not_started",
        createdAt,
      });

      await tx.insert(schema.journeyStates).values({
        id: newId(),
        workspaceId,
        primaryState: "discovery",
        pausedFromState: null,
        blockedReason: null,
        updatedAt: createdAt,
      });

      await tx.insert(schema.sideStatuses).values({
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

      return createSession(userId, { exec: tx, skipCookie: true });
    });
    sessionId = session.id;
    sessionExpiresAt = session.expiresAt;
  } catch (err) {
    // Unique email race
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "23505") return { error: "errorEmailTaken" };
    return { error: "errorGeneric" };
  }

  await setSessionCookie(sessionId, sessionExpiresAt);
  redirect({ href: "/onboarding", locale });
  return {};
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  await ensureMigrated();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "errorCredentials" };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const emailKey = loginRateLimitKey("email", email);
  const ipKey = loginRateLimitKey("ip", await clientIpForRateLimit());
  if (isLoginRateLimited({ emailKey, ipKey })) {
    return { error: "errorRateLimited" };
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .then((rows) => rows[0]);
  if (!user) {
    recordLoginFailures({ emailKey, ipKey });
    return { error: "errorCredentials" };
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    recordLoginFailures({ emailKey, ipKey });
    return { error: "errorCredentials" };
  }

  clearLoginRateLimits({ emailKey, ipKey });

  const locale = await getLocale();
  await createSession(user.id);

  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, user.id))
    .then((rows) => rows[0]);

  if (!workspace) {
    redirect({ href: "/onboarding", locale });
    return {};
  }

  const side = await db
    .select()
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspace.id))
    .then((rows) => rows[0]);

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
