"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  founderEditSkuCard,
  getWorkspaceForUser,
} from "@/lib/memory/repos";
import { getActiveSku } from "@/lib/sku/service";
import { evaluateAddSku, startAddSku } from "@/lib/sku/add-sku";
import {
  archiveSku,
  restoreSku,
  wipeSku,
} from "@/lib/sku/lifecycle";
import {
  pauseSelectedSkus,
  resumeSelectedSkus,
  setShopPaused,
} from "@/lib/sku/journey";
import { startDiscoverySession } from "@/lib/discovery/service";

export type SkuNotesState = { ok?: boolean; error?: string };

export async function saveSkuNotesAction(
  _prev: SkuNotesState,
  formData: FormData,
): Promise<SkuNotesState> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { error: "not_found" };

  const sku = await getActiveSku(workspace.id);
  if (!sku) return { error: "not_found" };

  const notes = String(formData.get("founderNotes") ?? "");
  await founderEditSkuCard(sku.id, { founderNotes: notes });
  revalidatePath("/", "layout");
  return { ok: true };
}

export type AddSkuActionState = {
  ok?: boolean;
  error?: string;
  warning?: string;
  seriousnessWarning?: boolean;
};

export async function evaluateAddSkuAction(): Promise<AddSkuActionState> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { error: "not_found" };
  const result = await evaluateAddSku(workspace.id);
  if (!result.ok) return { error: result.error, seriousnessWarning: result.seriousnessWarning };
  return {
    ok: true,
    warning: result.warning,
    seriousnessWarning: result.seriousnessWarning,
  };
}

/** Gate check + open discovery for a new SKU. Redirects to dashboard discovery. */
export async function startAddSkuAction(
  _prev: AddSkuActionState,
  formData: FormData,
): Promise<AddSkuActionState> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { error: "not_found" };

  const ackSerious = formData.get("ackSerious") === "1";
  const evaluation = await evaluateAddSku(workspace.id);
  if (!evaluation.ok) return { error: evaluation.error };
  if (evaluation.seriousnessWarning && !ackSerious) {
    return {
      ok: false,
      error: "need_serious_ack",
      seriousnessWarning: true,
      warning: evaluation.warning,
    };
  }

  const started = await startAddSku(workspace.id);
  if (!started.ok) return { error: started.error };

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .get();
  if (!onboarding) return { error: "not_found" };

  await startDiscoverySession(workspace.id, onboarding);
  revalidatePath("/", "layout");
  const locale = await getLocale();
  redirect({ href: "/dashboard?hub=1&addSku=1#discovery", locale });
  return { ok: true, warning: started.warning };
}

export async function archiveSkuAction(
  skuId: string,
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await archiveSku(workspace.id, skuId);
  revalidatePath("/", "layout");
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    warnings: [
      ...(res.warnings.sampleNotArrived ? ["sampleNotArrived"] : []),
      ...(res.warnings.batchNotArrived ? ["batchNotArrived"] : []),
    ],
  };
}

export async function restoreSkuAction(
  skuId: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await restoreSku(workspace.id, skuId);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function wipeSkuAction(
  skuId: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await wipeSku(workspace.id, skuId);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function pauseShopAction() {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;
  await setShopPaused(workspace.id, true);
  revalidatePath("/", "layout");
}

export async function resumeShopAction() {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;
  await setShopPaused(workspace.id, false);
  revalidatePath("/", "layout");
}

export async function pauseSkusAction(skuIds: string[]) {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };
  const owned = await listOwnedLiveIds(workspace.id, skuIds);
  await pauseSelectedSkus(owned);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resumeSkusAction(skuIds: string[]) {
  ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };
  const owned = await listOwnedLiveIds(workspace.id, skuIds);
  await resumeSelectedSkus(owned);
  revalidatePath("/", "layout");
  return { ok: true };
}

async function listOwnedLiveIds(workspaceId: string, skuIds: string[]) {
  const { listLiveSkus } = await import("@/lib/sku/journey");
  const live = await listLiveSkus(workspaceId);
  const set = new Set(skuIds);
  return live.filter((s) => set.has(s.id)).map((s) => s.id);
}
