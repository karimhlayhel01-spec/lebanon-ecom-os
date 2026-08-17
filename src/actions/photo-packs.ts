"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  addPhotoToPack,
  clearPackMotionClip,
  createPhotoPack,
  deletePhotoPack,
  productPhotosPath,
  removePhotoFromPack,
  renamePhotoPack,
  setCreativePackChoice,
  setDefaultPhotoPack,
  setPackMotionClip,
  type PhotoPackError,
} from "@/lib/marketing/visual-packs";

type ActionResult = { ok: true } | { ok: false; error: PhotoPackError };

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return { ok: false as const, error: "not_found" as const };
  return { ok: true as const, workspaceId: ctx.workspace.id };
}

function revalidatePackPaths(skuId: string) {
  revalidatePath(productPhotosPath(skuId));
  revalidatePath(`/sku/${skuId}`);
  revalidatePath("/", "layout");
}

function fileFromForm(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

export async function createPhotoPackAction(
  skuId: string,
  formData: FormData,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await createPhotoPack(
    ctx.workspaceId,
    skuId,
    formData.get("name"),
  );
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function renamePhotoPackAction(
  skuId: string,
  packId: string,
  formData: FormData,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await renamePhotoPack(
    ctx.workspaceId,
    skuId,
    packId,
    formData.get("name"),
  );
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function setDefaultPhotoPackAction(
  skuId: string,
  packId: string,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await setDefaultPhotoPack(ctx.workspaceId, skuId, packId);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function deletePhotoPackAction(
  skuId: string,
  packId: string,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await deletePhotoPack(ctx.workspaceId, skuId, packId);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function addPhotoToPackAction(
  skuId: string,
  packId: string,
  formData: FormData,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const file = fileFromForm(formData, "photo");
  if (!file) return { ok: false, error: "invalid" };
  const res = await addPhotoToPack(ctx.workspaceId, skuId, packId, file);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function removePhotoFromPackAction(
  skuId: string,
  assetId: string,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await removePhotoFromPack(ctx.workspaceId, skuId, assetId);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function setPackMotionClipAction(
  skuId: string,
  packId: string,
  formData: FormData,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const file = fileFromForm(formData, "clip");
  if (!file) return { ok: false, error: "invalid" };
  const res = await setPackMotionClip(ctx.workspaceId, skuId, packId, file);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function clearPackMotionClipAction(
  skuId: string,
  packId: string,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await clearPackMotionClip(ctx.workspaceId, skuId, packId);
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}

export async function setCreativePackChoiceAction(
  skuId: string,
  kitId: string,
  creativeId: string,
  packId: string,
): Promise<ActionResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return ctx;
  const res = await setCreativePackChoice({
    workspaceId: ctx.workspaceId,
    skuId,
    kitId,
    creativeId,
    packId,
  });
  if (!res.ok) return res;
  revalidatePackPaths(skuId);
  return { ok: true };
}
