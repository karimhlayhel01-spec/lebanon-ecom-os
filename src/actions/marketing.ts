"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  generateKit,
  saveKitCreatives,
  type Creative,
  type GenerateKitResult,
} from "@/lib/marketing/service";
import type { MarketingStage } from "@/lib/constants";
import { assertSkuOwned } from "@/lib/sku/ownership";

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return ctx;
  return { ok: true as const, workspace: ctx.workspace };
}

export async function generateKitAction(
  stage: MarketingStage,
  launchBudgetAck: boolean,
  skuId?: string | null,
): Promise<GenerateKitResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  // Shop kits pass null; SKU kits require an explicit owned id (no active fallback).
  if (skuId === undefined || (typeof skuId === "string" && !skuId.trim())) {
    return { ok: false, error: "not_found" };
  }
  if (typeof skuId === "string") {
    const owned = await assertSkuOwned(ctx.workspace.id, skuId.trim());
    if (!owned.ok) return { ok: false, error: "not_found" };
  }
  const res = await generateKit(
    ctx.workspace.id,
    stage,
    launchBudgetAck,
    skuId,
  );
  revalidatePath("/", "layout");
  return res;
}

export async function saveKitCreativesAction(
  kitId: string,
  creatives: Creative[],
) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await saveKitCreatives(ctx.workspace.id, kitId, creatives);
  revalidatePath("/", "layout");
  return res;
}
