"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { db, ensureMigrated, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  acceptProduct,
  confirmDemand,
  rejectCandidate,
  resolveTier1,
  showMore,
  startDiscoverySession,
  type AcceptResult,
} from "@/lib/discovery/service";
import type { AppLocale } from "@/i18n/routing";

async function workspaceForRequest() {
  const user = await requireUser();
  return getWorkspaceForUser(user.id);
}

export async function startDiscoveryAction() {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .get();
  if (!onboarding) return;

  await startDiscoverySession(workspace.id, onboarding);
  revalidatePath("/", "layout");
}

export async function showMoreAction() {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await showMore(workspace.id);
  revalidatePath("/", "layout");
}

export type DemandActionState = { ok?: boolean; error?: string };

export async function confirmDemandAction(
  _prev: DemandActionState,
  formData: FormData,
): Promise<DemandActionState> {
  ensureMigrated();
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
  return { ok: result.ok, error: result.error };
}

export async function resolveTier1Action(
  candidateId: string,
  choice: "customize" | "drop",
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await resolveTier1(workspace.id, candidateId, choice);
  revalidatePath("/", "layout");
}

export async function rejectCandidateAction(candidateId: string) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return;
  await rejectCandidate(workspace.id, candidateId);
  revalidatePath("/", "layout");
}

export async function acceptProductAction(
  candidateId: string,
  riskReadAck: boolean,
): Promise<AcceptResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };

  const result = await acceptProduct(workspace.id, candidateId, riskReadAck);
  revalidatePath("/", "layout");
  return result;
}
