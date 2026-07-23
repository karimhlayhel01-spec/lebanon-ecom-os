"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  founderEditSkuCard,
  getWorkspaceForUser,
} from "@/lib/memory/repos";
import { getActiveSku } from "@/lib/sku/service";

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
