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
  confirmDemand,
  continueDiscoverySession,
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

export type DemandActionState = {
  ok?: boolean;
  error?: string;
  /** Saved DemandProvider summary — shown immediately after confirm. */
  summary?: string;
};

export async function confirmDemandAction(
  _prev: DemandActionState,
  formData: FormData,
): Promise<DemandActionState> {
  await ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const candidateId = String(formData.get("candidateId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const screenshotNote = String(formData.get("screenshotNote") ?? "").trim();
  const locale = (await getLocale()) as AppLocale;

  const result = await confirmDemand(
    workspace.id,
    candidateId,
    {
      url: url || undefined,
      note: note || undefined,
      screenshotNote: screenshotNote || undefined,
    },
    locale,
  );

  revalidatePath("/", "layout");
  return { ok: result.ok, error: result.error, summary: result.summary };
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
