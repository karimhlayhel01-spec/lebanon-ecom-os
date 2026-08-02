"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  markStoreReady,
  saveStoreFields,
  toggleChecklistItem,
} from "@/lib/store/service";
import type { StoreChecklistKey } from "@/lib/constants";

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return ctx;
  return { ok: true as const, workspace: ctx.workspace };
}

export async function toggleStoreChecklistAction(
  key: StoreChecklistKey,
  value: boolean,
) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, percent: 0 };
  const res = await toggleChecklistItem(ctx.workspace.id, key, value);
  revalidatePath("/", "layout");
  return res;
}

export type StoreFieldsState = { ok?: boolean; error?: string };

export async function saveStoreFieldsAction(
  _prev: StoreFieldsState,
  formData: FormData,
): Promise<StoreFieldsState> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { error: ctx.error };

  const storeUrl = String(formData.get("storeUrl") ?? "").trim();
  const whatsappNumber = String(formData.get("whatsappNumber") ?? "").trim();
  const courierChoice = String(formData.get("courierChoice") ?? "").trim();

  await saveStoreFields(ctx.workspace.id, {
    storeUrl: storeUrl || null,
    whatsappNumber: whatsappNumber || null,
    courierChoice: courierChoice || null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markStoreReadyAction() {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await markStoreReady(ctx.workspace.id);
  revalidatePath("/", "layout");
  return res;
}
