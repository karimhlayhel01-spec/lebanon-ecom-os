"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { db, ensureMigrated, schema } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  DISCOVERY_PASS_REASONS,
  type DiscoveryPassReason,
} from "@/lib/discovery/ladder";
import {
  acceptProduct,
  continueDiscoverySession,
  refreshDiscoverySuggestions,
  rejectCandidate,
  resolveTier1,
  showMore,
  startDiscoverySession,
  submitDiscoveryPassFeedback,
  type AcceptResult,
} from "@/lib/discovery/service";
import type { AppLocale } from "@/i18n/routing";

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return null;
  return ctx.workspace;
}

export async function startDiscoveryAction() {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .then((rows) => rows[0]);
  if (!onboarding) return;

  await startDiscoverySession(workspace.id, onboarding);
  revalidatePath("/", "layout");
}

export async function showMoreAction() {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await showMore(workspace.id);
  revalidatePath("/", "layout");
}

export async function continueDiscoveryAction() {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false as const, error: "not_found" };

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .then((rows) => rows[0]);
  if (!onboarding) return { ok: false as const, error: "not_found" };

  const result = await continueDiscoverySession(workspace.id, onboarding);
  revalidatePath("/", "layout");
  return result;
}

export async function refreshSuggestionsAction() {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false as const, error: "not_found" };

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .then((rows) => rows[0]);
  if (!onboarding) return { ok: false as const, error: "not_found" };

  const result = await refreshDiscoverySuggestions(workspace.id, onboarding);
  revalidatePath("/", "layout");
  return result;
}

export type PassFeedbackState = {
  ok?: boolean;
  error?: string;
};

export async function submitDiscoveryPassFeedbackAction(
  _prev: PassFeedbackState,
  formData: FormData,
): Promise<PassFeedbackState> {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const reasons = DISCOVERY_PASS_REASONS.filter((r) => formData.get(`reason_${r}`) === "on");
  const otherNote = String(formData.get("otherNote") ?? "").trim();

  const result = await submitDiscoveryPassFeedback(workspace.id, {
    reasons: reasons as DiscoveryPassReason[],
    otherNote: otherNote || undefined,
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : { error: result.error };
}

export async function resolveTier1Action(
  candidateId: string,
  choice: "customize" | "drop",
) {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await resolveTier1(workspace.id, candidateId, choice);
  revalidatePath("/", "layout");
}

export async function rejectCandidateAction(candidateId: string) {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await rejectCandidate(workspace.id, candidateId);
  revalidatePath("/", "layout");
}

export async function acceptProductAction(
  candidateId: string,
  riskReadAck: boolean,
): Promise<AcceptResult> {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };

  const result = await acceptProduct(workspace.id, candidateId, riskReadAck);
  if (!result.ok) return result;

  revalidatePath("/", "layout");
  // Leave hub/?addSku=1 discovery behind — land on the new product spine.
  const locale = await getLocale();
  redirect({ href: `/sku/${result.skuId}`, locale });
  return result;
}

export type WhyPickActionState = {
  ok?: boolean;
  error?: string;
  body?: string;
  source?: "template" | "llm";
  honestyKey?:
    | "whySuggestedHonestyLive"
    | "whySuggestedHonestyEstimate"
    | "whySuggestedHonesty";
  cached?: boolean;
  /** Server WHY_PICK_CACHE_VERSION so client can invalidate stale body. */
  cacheVersion?: string;
  /** Fail-closed missing Gemini key (§6.1). */
  missingKey?: boolean;
};

export async function explainWhyThisPickAction(
  candidateId: string,
): Promise<WhyPickActionState> {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const locale = (await getLocale()) as AppLocale;
  const { explainWhyThisPick } = await import(
    "@/lib/discovery/explain/service"
  );
  const { WHY_PICK_CACHE_VERSION } = await import(
    "@/lib/discovery/explain/cache"
  );
  const result = await explainWhyThisPick({
    workspaceId: workspace.id,
    candidateId,
    locale: locale === "ar" ? "ar" : "en",
  });

  if (!result.ok) {
    return {
      error: result.error,
      missingKey: result.error === "missing_key",
      cacheVersion: WHY_PICK_CACHE_VERSION,
    };
  }
  // Do not revalidatePath — explain must not reshuffle Discovery / scores.
  return {
    ok: true,
    body: result.result.body,
    source: result.result.source,
    honestyKey:
      result.result.honestyKey === "whySuggestedHonestyLive" ||
      result.result.honestyKey === "whySuggestedHonestyEstimate"
        ? result.result.honestyKey
        : "whySuggestedHonesty",
    cached: result.cached,
    cacheVersion: WHY_PICK_CACHE_VERSION,
  };
}

export type CompareActionState = {
  ok?: boolean;
  error?: string;
  body?: string;
  honestyKey?:
    | "whySuggestedHonestyLive"
    | "whySuggestedHonestyEstimate"
    | "whySuggestedHonesty";
  cached?: boolean;
  cacheVersion?: string;
  missingKey?: boolean;
  advisedCandidateId?: string;
  advisedCatalogKey?: string;
  advisedName?: string;
};

export async function compareWorthConsideringAction(
  candidateIds: string[],
): Promise<CompareActionState> {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const locale = (await getLocale()) as AppLocale;
  const { explainWorthConsideringCompare } = await import(
    "@/lib/discovery/explain/compare-service"
  );
  const { COMPARE_CACHE_VERSION } = await import(
    "@/lib/discovery/explain/cache"
  );
  const result = await explainWorthConsideringCompare({
    workspaceId: workspace.id,
    candidateIds,
    locale: locale === "ar" ? "ar" : "en",
  });

  if (!result.ok) {
    return {
      error: result.error,
      missingKey: result.error === "missing_key",
      cacheVersion: COMPARE_CACHE_VERSION,
    };
  }
  // Do not revalidatePath — compare must not reshuffle Discovery / scores.
  return {
    ok: true,
    body: result.result.body,
    honestyKey:
      result.result.honestyKey === "whySuggestedHonestyLive" ||
      result.result.honestyKey === "whySuggestedHonestyEstimate"
        ? result.result.honestyKey
        : "whySuggestedHonesty",
    cached: result.cached,
    cacheVersion: COMPARE_CACHE_VERSION,
    advisedCandidateId: result.result.advisedCandidateId,
    advisedCatalogKey: result.result.advisedCatalogKey,
    advisedName: result.result.advisedName,
  };
}
