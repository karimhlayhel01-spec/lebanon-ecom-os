/**
 * Wave 4 Phase 6b — browser-safe photo-pack helpers.
 * No database, Drizzle, file storage, fs, or postgres. Safe for Client Components.
 */

import type { CreativeVisualTool } from "@/lib/marketing/visual-tool";
import { parseRequiredSkuId } from "@/lib/sku/require-sku-id";

export const PHOTO_PACK_MAX_PACKS = 20;
export const PHOTO_PACK_MAX_PHOTOS = 12;
export const PHOTO_PACK_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_PACK_MAX_MOTION_BYTES = 32 * 1024 * 1024;
export const PHOTO_PACK_NAME_MAX = 80;

export type PhotoPackError =
  | "not_found"
  | "invalid"
  | "duplicate_name"
  | "too_many"
  | "too_large"
  | "bad_type";

export type PhotoPackResult<T = true> =
  | { ok: true; value: T }
  | { ok: false; error: PhotoPackError };

export type PhotoPackOption = {
  id: string;
  name: string;
  isDefault: boolean;
  photoCount: number;
  hasMotionClip: boolean;
};

export type PhotoPackAssetView = {
  id: string;
  originalName: string;
  mimeType: string;
  href: string;
};

export type PhotoPackDetail = PhotoPackOption & {
  photos: PhotoPackAssetView[];
  motionClip: PhotoPackAssetView | null;
};

export type CreativePackChoice = {
  kitId: string;
  creativeId: string;
  packId: string;
};

const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MOTION_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const PHOTO_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MOTION_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Packs exist on per-SKU kits only. null / blank / non-string → not_found. */
export function parsePhotoPackSkuId(
  skuId: unknown,
): { ok: true; skuId: string } | { ok: false; error: "not_found" } {
  if (skuId === null) return { ok: false, error: "not_found" };
  return parseRequiredSkuId(skuId);
}

export function productPhotosPath(skuId: string): string {
  return `/sku/${skuId}/product-photos`;
}

export function photoPackAssetHref(assetId: string): string {
  return `/api/marketing/visual-asset/${encodeURIComponent(assetId)}`;
}

export function photoPackMotionHref(packId: string): string {
  return `/api/marketing/visual-motion/${encodeURIComponent(packId)}`;
}

/** Pack picker / empty pointer on Nano cards only. Seedance is Copy + Claude, not in-OS Generate. */
export function visualToolUsesPhotoPack(tool: CreativeVisualTool): boolean {
  return tool === "nano_banana";
}

/** Higgsfield MCP connector — teach on Seedance cards. Do not fetch from Next.js. */
export const HIGGSFIELD_MCP_CONNECTOR_URL = "https://mcp.higgsfield.ai";

/** 3 Regenerates after the first Generate (4 Higgsfield runs max per creative). */
export const VISUAL_GEN_MAX_REGENERATES = 3;

export type VisualGenError =
  | "flag_off"
  | "no_keys"
  | "monthly_cap"
  | "regen_cap"
  | "skipped"
  | "not_found"
  | "nsfw"
  | "hf_credits"
  | "hf_model"
  | "api_error";

export type VisualGenKind = "still" | "clip";

export type CreativeVisualFileView = {
  kitId: string;
  creativeId: string;
  href: string;
  kind: VisualGenKind;
  regenerateCount: number;
  generatedAt: string | null;
};

export function creativeVisualHref(kitId: string, creativeId: string): string {
  return `/api/marketing/visual-generate/${encodeURIComponent(kitId)}/${encodeURIComponent(creativeId)}`;
}

export function canRegenerateVisual(regenerateCount: number): boolean {
  return regenerateCount < VISUAL_GEN_MAX_REGENERATES;
}

export function nextRegenerateCount(current: number): number {
  return Math.max(0, current) + 1;
}

export function regenCountAfterDiscard(): number {
  return 0;
}

/**
 * Fail-closed gates before any Higgsfield call.
 * Shop / null skuId → not_found. Phone film and Seedance → skipped
 * (Seedance Generate is off; Copy prompt + Claude connector instead).
 */
export function evaluateVisualGenGate(args: {
  flagOn: boolean;
  keysPresent: boolean;
  monthlyCap: number;
  used: number;
  skuId: unknown;
  tool: CreativeVisualTool;
  mode: "generate" | "regenerate";
  regenerateCount: number;
  hasFile: boolean;
}): { ok: true } | { ok: false; error: VisualGenError } {
  if (parsePhotoPackSkuId(args.skuId).ok === false) {
    return { ok: false, error: "not_found" };
  }
  if (args.tool === "phone_film" || args.tool === "seedance") {
    return { ok: false, error: "skipped" };
  }
  if (!args.flagOn) return { ok: false, error: "flag_off" };
  if (!args.keysPresent) return { ok: false, error: "no_keys" };
  if (!canSpendMarketingVisualCallLocal(args.monthlyCap, args.used)) {
    return { ok: false, error: "monthly_cap" };
  }
  if (args.mode === "regenerate") {
    if (!args.hasFile) return { ok: false, error: "not_found" };
    if (!canRegenerateVisual(args.regenerateCount)) {
      return { ok: false, error: "regen_cap" };
    }
  }
  return { ok: true };
}

function canSpendMarketingVisualCallLocal(cap: number, used: number): boolean {
  return Math.max(0, cap - Math.max(0, used)) > 0;
}

/** First pack on a SKU is the default; later packs wait for setDefault. */
export function newPackIsDefault(existingPackCount: number): boolean {
  return existingPackCount === 0;
}

/**
 * After deleting a pack: if it was default and others remain, promote the
 * oldest remaining. Last pack → null (SKU has no packs). Non-default delete
 * leaves the existing default alone.
 */
export function packIdToPromoteAfterDelete(args: {
  deletedWasDefault: boolean;
  remaining: ReadonlyArray<{ id: string; createdAt: string }>;
}): string | null {
  if (!args.deletedWasDefault || args.remaining.length === 0) return null;
  const sorted = [...args.remaining].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return sorted[0]?.id ?? null;
}

/** Exactly one default: the chosen pack, everyone else false. */
export function packDefaultFlagsAfterSet(
  packs: ReadonlyArray<{ id: string }>,
  defaultId: string,
): Array<{ id: string; isDefault: boolean }> {
  return packs.map((p) => ({ id: p.id, isDefault: p.id === defaultId }));
}

export function sanitizePhotoPackName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > PHOTO_PACK_NAME_MAX) return null;
  return name;
}

/** Empty / whitespace / missing — create may auto-name Pack N. */
export function isBlankPhotoPackName(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw !== "string") return false;
  return raw.trim() === "";
}

/**
 * Next unused "Pack N" on this SKU (Pack 1, Pack 2, …).
 * Gaps count: Pack 1 + Pack 3 taken → Pack 2.
 */
export function nextAutoPhotoPackName(
  existingNames: ReadonlyArray<string>,
): string {
  const taken = new Set(existingNames);
  for (let n = 1; n <= existingNames.length + 1; n++) {
    const name = `Pack ${n}`;
    if (!taken.has(name)) return name;
  }
  return `Pack ${existingNames.length + 1}`;
}

/** Default chip / Set as default only matter when there is a choice. */
export function showPhotoPackDefaultControls(packCount: number): boolean {
  return packCount >= 2;
}

export function resolveSelectedPackId(args: {
  chosenPackId: string | null | undefined;
  packs: ReadonlyArray<{ id: string; isDefault: boolean }>;
}): string | null {
  if (
    args.chosenPackId &&
    args.packs.some((p) => p.id === args.chosenPackId)
  ) {
    return args.chosenPackId;
  }
  return args.packs.find((p) => p.isDefault)?.id ?? args.packs[0]?.id ?? null;
}

export function packIdForCreative(
  choices: ReadonlyArray<CreativePackChoice>,
  kitId: string,
  creativeId: string,
): string | null {
  return (
    choices.find((c) => c.kitId === kitId && c.creativeId === creativeId)
      ?.packId ?? null
  );
}

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function resolvePhotoMime(
  mimeType: string,
  originalName: string,
): string | null {
  const mime = mimeType.trim().toLowerCase();
  if (PHOTO_MIME.has(mime)) return mime;
  return PHOTO_EXT[fileExt(originalName)] ?? null;
}

export function resolveMotionMime(
  mimeType: string,
  originalName: string,
): string | null {
  const mime = mimeType.trim().toLowerCase();
  if (MOTION_MIME.has(mime)) return mime;
  return MOTION_EXT[fileExt(originalName)] ?? null;
}
