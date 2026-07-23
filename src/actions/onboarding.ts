"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, ensureMigrated, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/workspace";
import { newId, nowIso } from "@/lib/ids";
import { INDUSTRY_OPTIONS, MIN_BUDGET_USD } from "@/lib/constants";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

const industryIdSchema = z.enum(INDUSTRY_OPTIONS);

const onboardingSchema = z.object({
  budgetUsd: z.coerce.number().min(MIN_BUDGET_USD),
  monthlyFollowOnBudget: z.coerce.number().min(0),
  hoursPerWeek: z.coerce.number().int().min(1).max(168),
  experience: z.enum(["beginner", "some", "experienced"]),
  uiLanguage: z.enum(["en", "ar", "both"]),
  storageDescription: z.string().min(1).max(500),
  storageLimits: z.string().min(1).max(500),
  riskTolerance: z.enum(["low", "medium", "high"]),
  categoryLikes: z.array(industryIdSchema).min(1),
  lebanonSellabilityAck: z
    .union([z.literal("on"), z.literal("true"), z.literal("1"), z.boolean()])
    .transform((v) => v === true || v === "on" || v === "true" || v === "1"),
  codComfort: z.string().min(1).max(1000),
  shopifyStatus: z.enum(["not_started", "in_progress", "ready"]),
  maxLandedCost: z.coerce.number().min(0),
  deliveryBandDays: z.string().min(1).max(40),
  sampleClearanceReady: z
    .union([z.literal("on"), z.literal("true"), z.literal("1"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true" || v === "1"),
});

export type OnboardingActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function completeOnboardingAction(
  _prev: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return { error: "errorGeneric" };
  }

  const raw = {
    budgetUsd: formData.get("budgetUsd"),
    monthlyFollowOnBudget: formData.get("monthlyFollowOnBudget"),
    hoursPerWeek: formData.get("hoursPerWeek"),
    experience: formData.get("experience"),
    uiLanguage: formData.get("uiLanguage"),
    storageDescription: formData.get("storageDescription"),
    storageLimits: formData.get("storageLimits"),
    riskTolerance: formData.get("riskTolerance"),
    categoryLikes: formData.getAll("categoryLikes").filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
    lebanonSellabilityAck: formData.get("lebanonSellabilityAck") ?? false,
    codComfort: formData.get("codComfort"),
    shopifyStatus: formData.get("shopifyStatus"),
    maxLandedCost: formData.get("maxLandedCost"),
    deliveryBandDays: formData.get("deliveryBandDays"),
    sampleClearanceReady: formData.get("sampleClearanceReady") ?? false,
  };

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        if (key === "budgetUsd") fieldErrors[key] = "budgetError";
        else if (key === "lebanonSellabilityAck")
          fieldErrors[key] = "lebanonRequired";
        else if (key === "categoryLikes")
          fieldErrors[key] = "categoryLikesRequired";
        else fieldErrors[key] = "errorGeneric";
      }
    }
    const firstError = Object.values(fieldErrors)[0] ?? "errorGeneric";
    return { error: firstError, fieldErrors };
  }

  if (!parsed.data.lebanonSellabilityAck) {
    return {
      error: "lebanonRequired",
      fieldErrors: { lebanonSellabilityAck: "lebanonRequired" },
    };
  }

  const updatedAt = nowIso();
  const categories = parsed.data.categoryLikes;

  const existing = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .get();

  const priorSide = await db
    .select()
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspace.id))
    .get();
  const isFirstCompletion = !priorSide?.onboardingComplete;

  const profileValues = {
    budgetUsd: parsed.data.budgetUsd,
    monthlyFollowOnBudget: parsed.data.monthlyFollowOnBudget,
    hoursPerWeek: parsed.data.hoursPerWeek,
    experience: parsed.data.experience,
    uiLanguage: parsed.data.uiLanguage,
    storageDescription: parsed.data.storageDescription,
    storageLimits: parsed.data.storageLimits,
    riskTolerance: parsed.data.riskTolerance,
    categoryLikes: JSON.stringify(categories),
    lebanonSellabilityAck: true,
    codComfort: parsed.data.codComfort,
    shopifyStatus: parsed.data.shopifyStatus,
    maxLandedCost: parsed.data.maxLandedCost,
    deliveryBandDays: parsed.data.deliveryBandDays,
    sampleClearanceReady: Boolean(parsed.data.sampleClearanceReady),
    completedAt: updatedAt,
    updatedAt,
  };

  if (existing) {
    await db
      .update(schema.onboardingProfiles)
      .set(profileValues)
      .where(eq(schema.onboardingProfiles.id, existing.id));
  } else {
    await db.insert(schema.onboardingProfiles).values({
      id: newId(),
      workspaceId: workspace.id,
      ...profileValues,
    });
  }

  await db
    .update(schema.workspaces)
    .set({
      language: parsed.data.uiLanguage,
      shopifyStatus: parsed.data.shopifyStatus,
    })
    .where(eq(schema.workspaces.id, workspace.id));

  // Only set the starting journey state on first completion; editing later
  // must not reset an in-progress journey.
  if (isFirstCompletion) {
    await db
      .update(schema.journeyStates)
      .set({
        primaryState: "discovery",
        pausedFromState: null,
        blockedReason: null,
        updatedAt,
      })
      .where(eq(schema.journeyStates.workspaceId, workspace.id));
  }

  await db
    .update(schema.sideStatuses)
    .set({
      onboardingComplete: true,
      // Meaningful profile edit resets the Discovery reject-all ladder (Fix #13).
      ...(!isFirstCompletion ? { discoveryExhaustedRounds: 0 } : {}),
      updatedAt,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspace.id));

  const locale = await getLocale();
  redirect({ href: "/dashboard", locale });
  return {};
}
