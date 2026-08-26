"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { productPhotosPath } from "@/lib/marketing/visual-pack-ui";
import {
  discardCreativeVisual,
  generateOrRegenerateCreativeVisual,
  copyCreativeNanoPrompt,
  type CopyNanoPromptResult,
  type VisualGenActionResult,
} from "@/lib/marketing/visual-gen";
import { requireOnboardedWorkspace } from "@/lib/workspace";

function revalidateSku(skuId: string) {
  revalidatePath(productPhotosPath(skuId));
  revalidatePath(`/sku/${skuId}`);
  revalidatePath("/", "layout");
}

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false as const, error: "not_found" as const };
  return { ok: true as const, workspaceId: ctx.workspace.id };
}

export async function generateVisualAction(
  skuId: string,
  kitId: string,
  creativeId: string,
): Promise<VisualGenActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await generateOrRegenerateCreativeVisual({
    workspaceId: ctx.workspaceId,
    skuId,
    kitId,
    creativeId,
    mode: "generate",
  });
  if (res.ok) revalidateSku(skuId);
  return res;
}

export async function regenerateVisualAction(
  skuId: string,
  kitId: string,
  creativeId: string,
): Promise<VisualGenActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await generateOrRegenerateCreativeVisual({
    workspaceId: ctx.workspaceId,
    skuId,
    kitId,
    creativeId,
    mode: "regenerate",
  });
  if (res.ok) revalidateSku(skuId);
  return res;
}

export async function copyNanoVisualPromptAction(
  skuId: string,
  kitId: string,
  creativeId: string,
  locale: "en" | "ar",
): Promise<CopyNanoPromptResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  return copyCreativeNanoPrompt({
    workspaceId: ctx.workspaceId,
    skuId,
    kitId,
    creativeId,
    locale,
  });
}

export async function discardVisualAction(
  skuId: string,
  kitId: string,
  creativeId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await discardCreativeVisual({
    workspaceId: ctx.workspaceId,
    skuId,
    kitId,
    creativeId,
  });
  if (res.ok) revalidateSku(skuId);
  return res;
}
