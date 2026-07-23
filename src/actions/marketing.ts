"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  generateKit,
  saveKitCreatives,
  type Creative,
  type GenerateKitResult,
} from "@/lib/marketing/service";
import type { MarketingStage } from "@/lib/constants";

async function workspaceForRequest() {
  const user = await requireUser();
  return getWorkspaceForUser(user.id);
}

export async function generateKitAction(
  stage: MarketingStage,
  launchBudgetAck: boolean,
): Promise<GenerateKitResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await generateKit(workspace.id, stage, launchBudgetAck);
  revalidatePath("/", "layout");
  return res;
}

export async function saveKitCreativesAction(
  kitId: string,
  creatives: Creative[],
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await saveKitCreatives(workspace.id, kitId, creatives);
  revalidatePath("/", "layout");
  return res;
}
