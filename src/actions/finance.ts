"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import { addWeeklyEntry, startSelling } from "@/lib/finance/service";
import { parseWeeklyEntryFormData } from "@/lib/finance/validate";

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return ctx;
  return { ok: true as const, workspace: ctx.workspace };
}

export async function startSellingAction(skuId: string) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await startSelling(ctx.workspace.id, skuId);
  revalidatePath("/", "layout");
  return res;
}

export type WeeklyEntryState = { ok?: boolean; error?: string };

export async function addWeeklyEntryAction(
  _prev: WeeklyEntryState,
  formData: FormData,
): Promise<WeeklyEntryState> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { error: ctx.error };

  const parsed = parseWeeklyEntryFormData(formData);
  if (!parsed.ok) return { error: parsed.error };

  const { data } = parsed;
  // Client left is never trusted — server computes units left from ledger.
  const skuLines = data.skuLines?.map((l) => ({
    skuId: l.skuId,
    sold: l.sold,
    sales: l.sales,
    left: null as number | null,
  }));

  const res = await addWeeklyEntry(ctx.workspace.id, {
    weekStart: data.weekStart,
    sales: data.sales,
    orders: data.orders,
    metaSpend: data.metaSpend,
    tiktokSpend: data.tiktokSpend,
    codCollected: data.codCollected,
    codOutstanding: data.codOutstanding,
    courierFees: data.courierFees,
    skuSold: data.skuSold,
    // Placeholder only; addWeeklyEntry overwrites from inventory ledger.
    skuLeft: data.skuLeft ?? 0,
    skuLines,
  });

  revalidatePath("/", "layout");
  return { ok: res.ok, error: res.error };
}
