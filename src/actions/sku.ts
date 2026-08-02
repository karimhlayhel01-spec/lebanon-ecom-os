"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { founderEditSkuCard } from "@/lib/memory/repos";
import { requireOnboardedWorkspace } from "@/lib/workspace";
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
import { assertSkuOwned } from "@/lib/sku/ownership";
import { parseSkuNotesForm } from "@/lib/sku/save-notes";
import { startDiscoverySession } from "@/lib/discovery/service";

export type SkuNotesState = { ok?: boolean; error?: string };

export async function saveSkuNotesAction(
  _prev: SkuNotesState,
  formData: FormData,
): Promise<SkuNotesState> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { error: ctx.error };

  const parsed = parseSkuNotesForm({
    skuId: formData.get("skuId"),
    founderNotes: formData.get("founderNotes"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const owned = await assertSkuOwned(ctx.workspace.id, parsed.skuId);
  if (!owned.ok) return { error: "not_found" };
  // Notes only on live cards (archived/wiped are read-only).
  if (owned.card.lifecycleStatus !== "live") return { error: "not_found" };

  await founderEditSkuCard(parsed.skuId, { founderNotes: parsed.notes });
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
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { error: ctx.error };
  const result = await evaluateAddSku(ctx.workspace.id);
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
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { error: ctx.error };

  const ackSerious = formData.get("ackSerious") === "1";
  const evaluation = await evaluateAddSku(ctx.workspace.id);
  if (!evaluation.ok) return { error: evaluation.error };
  if (evaluation.seriousnessWarning && !ackSerious) {
    return {
      ok: false,
      error: "need_serious_ack",
      seriousnessWarning: true,
      warning: evaluation.warning,
    };
  }

  const started = await startAddSku(ctx.workspace.id);
  if (!started.ok) return { error: started.error };

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, ctx.workspace.id))
    .then((rows) => rows[0]);
  if (!onboarding) return { error: "not_found" };

  await startDiscoverySession(ctx.workspace.id, onboarding);
  revalidatePath("/", "layout");
  const locale = await getLocale();
  redirect({ href: "/dashboard?hub=1&addSku=1#discovery", locale });
  return { ok: true, warning: started.warning };
}

export async function archiveSkuAction(
  skuId: string,
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!(await assertSkuOwned(ctx.workspace.id, skuId)).ok) {
    return { ok: false, error: "not_found" };
  }
  const res = await archiveSku(ctx.workspace.id, skuId);
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
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!(await assertSkuOwned(ctx.workspace.id, skuId)).ok) {
    return { ok: false, error: "not_found" };
  }
  const res = await restoreSku(ctx.workspace.id, skuId);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function wipeSkuAction(
  skuId: string,
): Promise<{ ok: boolean; error?: string }> {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!(await assertSkuOwned(ctx.workspace.id, skuId)).ok) {
    return { ok: false, error: "not_found" };
  }
  const res = await wipeSku(ctx.workspace.id, skuId);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function pauseShopAction() {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;
  await setShopPaused(ctx.workspace.id, true);
  revalidatePath("/", "layout");
}

export async function resumeShopAction() {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;
  await setShopPaused(ctx.workspace.id, false);
  revalidatePath("/", "layout");
}

export async function pauseSkusAction(skuIds: string[]) {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const owned = await listOwnedLiveIds(ctx.workspace.id, skuIds);
  await pauseSelectedSkus(owned);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resumeSkusAction(skuIds: string[]) {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const owned = await listOwnedLiveIds(ctx.workspace.id, skuIds);
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
