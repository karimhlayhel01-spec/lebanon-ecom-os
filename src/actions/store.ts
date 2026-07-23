"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  markStoreReady,
  saveStoreFields,
  toggleChecklistItem,
} from "@/lib/store/service";
import type { StoreChecklistKey } from "@/lib/constants";

async function workspaceForRequest() {
  const user = await requireUser();
  return getWorkspaceForUser(user.id);
}

export async function toggleStoreChecklistAction(
  key: StoreChecklistKey,
  value: boolean,
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, percent: 0 };
  const res = await toggleChecklistItem(workspace.id, key, value);
  revalidatePath("/", "layout");
  return res;
}

export type StoreFieldsState = { ok?: boolean; error?: string };

export async function saveStoreFieldsAction(
  _prev: StoreFieldsState,
  formData: FormData,
): Promise<StoreFieldsState> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { error: "not_found" };

  const storeUrl = String(formData.get("storeUrl") ?? "").trim();
  const whatsappNumber = String(formData.get("whatsappNumber") ?? "").trim();
  const courierChoice = String(formData.get("courierChoice") ?? "").trim();

  await saveStoreFields(workspace.id, {
    storeUrl: storeUrl || null,
    whatsappNumber: whatsappNumber || null,
    courierChoice: courierChoice || null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markStoreReadyAction() {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await markStoreReady(workspace.id);
  revalidatePath("/", "layout");
  return res;
}
