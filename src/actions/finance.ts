"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import { addWeeklyEntry, startSelling } from "@/lib/finance/service";

async function workspaceForRequest() {
  const user = await requireUser();
  return getWorkspaceForUser(user.id);
}

export async function startSellingAction() {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await startSelling(workspace.id);
  revalidatePath("/", "layout");
  return res;
}

export type WeeklyEntryState = { ok?: boolean; error?: string };

function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}

export async function addWeeklyEntryAction(
  _prev: WeeklyEntryState,
  formData: FormData,
): Promise<WeeklyEntryState> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const weekStart = String(formData.get("weekStart") ?? "").trim();
  if (!weekStart) return { error: "missing_week" };

  const res = await addWeeklyEntry(workspace.id, {
    weekStart,
    sales: num(formData, "sales"),
    orders: num(formData, "orders"),
    metaSpend: num(formData, "metaSpend"),
    tiktokSpend: num(formData, "tiktokSpend"),
    codCollected: num(formData, "codCollected"),
    codOutstanding: num(formData, "codOutstanding"),
    courierFees: num(formData, "courierFees"),
    skuSold: num(formData, "skuSold"),
    skuLeft: num(formData, "skuLeft"),
  });

  revalidatePath("/", "layout");
  return { ok: res.ok, error: res.error };
}
