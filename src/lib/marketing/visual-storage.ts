/**
 * Wave 4 Phase 6 — local durable paths we own (not Higgsfield URLs, not /public).
 * Serve via authenticated routes. Never write under /public.
 */

import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

export const MARKETING_VISUAL_STORAGE_ROOT = "data/marketing-visuals";

function segment(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Resolve a relative owned path to an absolute file under the storage root.
 * Rejects traversal, absolute paths, and anything outside the root.
 */
export function resolveOwnedStorageAbs(relPath: string): string | null {
  const trimmed = relPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0") || trimmed.includes("\\")) return null;
  const prefix = `${MARKETING_VISUAL_STORAGE_ROOT}/`;
  if (!trimmed.startsWith(prefix)) return null;
  if (trimmed.split("/").includes("..")) return null;
  const root = path.resolve(process.cwd(), MARKETING_VISUAL_STORAGE_ROOT);
  const abs = path.resolve(process.cwd(), trimmed);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

export async function writeOwnedFile(
  relPath: string,
  bytes: Buffer,
): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  const abs = resolveOwnedStorageAbs(relPath);
  if (!abs) return { ok: false, error: "invalid" };
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return { ok: true };
}

export async function readOwnedFile(relPath: string): Promise<Buffer | null> {
  const abs = resolveOwnedStorageAbs(relPath);
  if (!abs) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export async function deleteOwnedFile(relPath: string): Promise<void> {
  const abs = resolveOwnedStorageAbs(relPath);
  if (!abs) return;
  try {
    await unlink(abs);
  } catch {
    /* missing file is fine */
  }
}

/** Pack photo: workspace/sku/pack/photos/assetId */
export function photoPackAssetRelPath(args: {
  workspaceId: string;
  skuId: string;
  packId: string;
  assetId: string;
}): string {
  return [
    MARKETING_VISUAL_STORAGE_ROOT,
    segment(args.workspaceId),
    segment(args.skuId),
    segment(args.packId),
    "photos",
    segment(args.assetId),
  ].join("/");
}

/** Optional product-motion clip on the pack (not a social Reel). */
export function photoPackMotionRelPath(args: {
  workspaceId: string;
  skuId: string;
  packId: string;
}): string {
  return [
    MARKETING_VISUAL_STORAGE_ROOT,
    segment(args.workspaceId),
    segment(args.skuId),
    segment(args.packId),
    "motion",
  ].join("/");
}

/** Generated still/clip for one kit card (replace, never stack). */
export function creativeVisualRelPath(args: {
  workspaceId: string;
  skuId: string;
  kitId: string;
  creativeId: string;
}): string {
  return [
    MARKETING_VISUAL_STORAGE_ROOT,
    segment(args.workspaceId),
    segment(args.skuId),
    "kits",
    segment(args.kitId),
    segment(args.creativeId),
  ].join("/");
}
