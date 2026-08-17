/**
 * Wave 4 Phase 6b — per-SKU named photo packs (not whole-shop).
 * Server-only: db + owned-file IO. Browser helpers live in visual-pack-ui.ts.
 * Fail-closed: no skuId null. Uploads on explicit click. No Higgsfield.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema, withTxResult } from "@/db";
import { TxRollback } from "@/db/executor";
import { newId, nowIso } from "@/lib/ids";
import { assertSkuOwned } from "@/lib/sku/ownership";
import {
  deleteOwnedFile,
  photoPackAssetRelPath,
  photoPackMotionRelPath,
  readOwnedFile,
  writeOwnedFile,
} from "@/lib/marketing/visual-storage";
import {
  PHOTO_PACK_MAX_PACKS,
  PHOTO_PACK_MAX_PHOTOS,
  PHOTO_PACK_MAX_PHOTO_BYTES,
  PHOTO_PACK_MAX_MOTION_BYTES,
  isBlankPhotoPackName,
  newPackIsDefault,
  nextAutoPhotoPackName,
  parsePhotoPackSkuId,
  photoPackAssetHref,
  packIdToPromoteAfterDelete,
  photoPackMotionHref,
  resolveMotionMime,
  resolvePhotoMime,
  sanitizePhotoPackName,
  type CreativePackChoice,
  type PhotoPackAssetView,
  type PhotoPackDetail,
  type PhotoPackError,
  type PhotoPackOption,
  type PhotoPackResult,
} from "@/lib/marketing/visual-pack-ui";

export * from "@/lib/marketing/visual-pack-ui";

/**
 * Workspace + SKU ownership before any pack / visual file read or write.
 * Maps wiped / foreign to not_found.
 */
export async function requirePhotoPackSku(
  workspaceId: string,
  skuId: unknown,
): Promise<{ ok: true; skuId: string } | { ok: false; error: "not_found" }> {
  const parsed = parsePhotoPackSkuId(skuId);
  if (!parsed.ok) return parsed;
  const owned = await assertSkuOwned(workspaceId, parsed.skuId);
  if (!owned.ok) return { ok: false, error: "not_found" };
  if (owned.card.lifecycleStatus !== "live") {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, skuId: parsed.skuId };
}

function pgCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  if ("code" in err && (err as { code: unknown }).code) {
    return String((err as { code: unknown }).code);
  }
  const cause = "cause" in err ? (err as { cause: unknown }).cause : null;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as { code: unknown }).code);
  }
  return "";
}

function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === "23505";
}

function originalNameOf(file: File): string {
  return file.name.trim().slice(0, 200);
}

async function requireOwnedPack(
  workspaceId: string,
  skuId: unknown,
  packId: string,
): Promise<
  | {
      ok: true;
      skuId: string;
      pack: typeof schema.marketingSkuPhotoPacks.$inferSelect;
    }
  | { ok: false; error: "not_found" }
> {
  const scoped = await requirePhotoPackSku(workspaceId, skuId);
  if (!scoped.ok) return scoped;
  if (!packId.trim()) return { ok: false, error: "not_found" };
  const pack = await db
    .select()
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.id, packId.trim()),
        eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPacks.skuId, scoped.skuId),
      ),
    )
    .then((rows) => rows[0]);
  if (!pack) return { ok: false, error: "not_found" };
  return { ok: true, skuId: scoped.skuId, pack };
}

function toOption(
  pack: typeof schema.marketingSkuPhotoPacks.$inferSelect,
  photoCount: number,
): PhotoPackOption {
  return {
    id: pack.id,
    name: pack.name,
    isDefault: pack.isDefault,
    photoCount,
    hasMotionClip: Boolean(pack.motionClipStoragePath),
  };
}

export async function listPhotoPacksForSku(
  workspaceId: string,
  skuId: unknown,
): Promise<PhotoPackResult<PhotoPackOption[]>> {
  await ensureMigrated();
  const scoped = await requirePhotoPackSku(workspaceId, skuId);
  if (!scoped.ok) return scoped;
  const packs = await db
    .select()
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPacks.skuId, scoped.skuId),
      ),
    )
    .orderBy(
      desc(schema.marketingSkuPhotoPacks.isDefault),
      asc(schema.marketingSkuPhotoPacks.createdAt),
    );
  if (packs.length === 0) return { ok: true, value: [] };
  const assets = await db
    .select({
      packId: schema.marketingSkuPhotoPackAssets.packId,
    })
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPackAssets.skuId, scoped.skuId),
        eq(schema.marketingSkuPhotoPackAssets.kind, "photo"),
      ),
    );
  const counts = new Map<string, number>();
  for (const a of assets) {
    counts.set(a.packId, (counts.get(a.packId) ?? 0) + 1);
  }
  return {
    ok: true,
    value: packs.map((p) => toOption(p, counts.get(p.id) ?? 0)),
  };
}

export async function listPhotoPackDetailsForSku(
  workspaceId: string,
  skuId: unknown,
): Promise<PhotoPackResult<PhotoPackDetail[]>> {
  await ensureMigrated();
  const listed = await listPhotoPacksForSku(workspaceId, skuId);
  if (!listed.ok) return listed;
  const scoped = await requirePhotoPackSku(workspaceId, skuId);
  if (!scoped.ok) return scoped;
  if (listed.value.length === 0) return { ok: true, value: [] };
  const packIds = listed.value.map((p) => p.id);
  const assets = await db
    .select()
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPackAssets.skuId, scoped.skuId),
        inArray(schema.marketingSkuPhotoPackAssets.packId, packIds),
      ),
    )
    .orderBy(asc(schema.marketingSkuPhotoPackAssets.createdAt));
  const photosByPack = new Map<string, PhotoPackAssetView[]>();
  for (const a of assets) {
    if (a.kind !== "photo") continue;
    const list = photosByPack.get(a.packId) ?? [];
    list.push({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      href: photoPackAssetHref(a.id),
    });
    photosByPack.set(a.packId, list);
  }
  const packRows = await db
    .select()
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPacks.skuId, scoped.skuId),
      ),
    );
  const byId = new Map(packRows.map((p) => [p.id, p]));
  return {
    ok: true,
    value: listed.value.map((opt) => {
      const row = byId.get(opt.id);
      return {
        ...opt,
        photos: photosByPack.get(opt.id) ?? [],
        motionClip:
          row?.motionClipStoragePath
            ? {
                id: opt.id,
                originalName: row.motionClipOriginalName ?? "",
                mimeType: row.motionClipMimeType ?? "",
                href: photoPackMotionHref(opt.id),
              }
            : null,
      };
    }),
  };
}

export async function listCreativePackChoices(
  workspaceId: string,
  skuId: string,
  kitIds: string[],
): Promise<CreativePackChoice[]> {
  if (kitIds.length === 0) return [];
  await ensureMigrated();
  const rows = await db
    .select({
      kitId: schema.marketingCreativeVisuals.kitId,
      creativeId: schema.marketingCreativeVisuals.creativeId,
      packId: schema.marketingCreativeVisuals.packId,
    })
    .from(schema.marketingCreativeVisuals)
    .where(
      and(
        eq(schema.marketingCreativeVisuals.workspaceId, workspaceId),
        eq(schema.marketingCreativeVisuals.skuId, skuId),
        inArray(schema.marketingCreativeVisuals.kitId, kitIds),
      ),
    );
  return rows
    .filter((r): r is typeof r & { packId: string } => Boolean(r.packId))
    .map((r) => ({
      kitId: r.kitId,
      creativeId: r.creativeId,
      packId: r.packId,
    }));
}

export async function createPhotoPack(
  workspaceId: string,
  skuId: unknown,
  rawName: unknown,
): Promise<PhotoPackResult<{ packId: string }>> {
  await ensureMigrated();
  const scoped = await requirePhotoPackSku(workspaceId, skuId);
  if (!scoped.ok) return scoped;
  const blank = isBlankPhotoPackName(rawName);
  const typed = sanitizePhotoPackName(rawName);
  if (!blank && !typed) return { ok: false, error: "invalid" };

  const existing = await db
    .select({
      id: schema.marketingSkuPhotoPacks.id,
      name: schema.marketingSkuPhotoPacks.name,
    })
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPacks.skuId, scoped.skuId),
      ),
    );
  if (existing.length >= PHOTO_PACK_MAX_PACKS) {
    return { ok: false, error: "too_many" };
  }

  const names = existing.map((p) => p.name);
  let name = typed ?? nextAutoPhotoPackName(names);
  const isDefault = newPackIsDefault(existing.length);
  const now = nowIso();

  for (let attempt = 0; attempt < PHOTO_PACK_MAX_PACKS; attempt++) {
    const id = newId();
    try {
      await db.insert(schema.marketingSkuPhotoPacks).values({
        id,
        workspaceId,
        skuId: scoped.skuId,
        name,
        isDefault,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, value: { packId: id } };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (typed) return { ok: false, error: "duplicate_name" };
      names.push(name);
      name = nextAutoPhotoPackName(names);
    }
  }
  return { ok: false, error: "duplicate_name" };
}

export async function renamePhotoPack(
  workspaceId: string,
  skuId: unknown,
  packId: string,
  rawName: unknown,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;
  const name = sanitizePhotoPackName(rawName);
  if (!name) return { ok: false, error: "invalid" };
  try {
    await db
      .update(schema.marketingSkuPhotoPacks)
      .set({ name, updatedAt: nowIso() })
      .where(eq(schema.marketingSkuPhotoPacks.id, owned.pack.id));
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate_name" };
    throw err;
  }
  return { ok: true, value: true };
}

export async function setDefaultPhotoPack(
  workspaceId: string,
  skuId: unknown,
  packId: string,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;
  return withTxResult<PhotoPackResult>(
    async (tx) => {
      const now = nowIso();
      await tx
        .update(schema.marketingSkuPhotoPacks)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
            eq(schema.marketingSkuPhotoPacks.skuId, owned.skuId),
            eq(schema.marketingSkuPhotoPacks.isDefault, true),
          ),
        );
      const updated = await tx
        .update(schema.marketingSkuPhotoPacks)
        .set({ isDefault: true, updatedAt: now })
        .where(
          and(
            eq(schema.marketingSkuPhotoPacks.id, owned.pack.id),
            eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
            eq(schema.marketingSkuPhotoPacks.skuId, owned.skuId),
          ),
        )
        .returning({ id: schema.marketingSkuPhotoPacks.id });
      if (!updated[0]) {
        throw new TxRollback<PhotoPackResult>({
          ok: false,
          error: "not_found",
        });
      }
      return { ok: true, value: true };
    },
    () => ({ ok: false, error: "not_found" }),
  );
}

export async function addPhotoToPack(
  workspaceId: string,
  skuId: unknown,
  packId: string,
  file: File,
): Promise<PhotoPackResult<{ assetId: string }>> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;
  if (!(file instanceof File) || file.size <= 0) {
    return { ok: false, error: "invalid" };
  }
  if (file.size > PHOTO_PACK_MAX_PHOTO_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const originalName = originalNameOf(file);
  const mime = resolvePhotoMime(file.type, originalName);
  if (!mime) return { ok: false, error: "bad_type" };

  const photoCount = await db
    .select({ id: schema.marketingSkuPhotoPackAssets.id })
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.packId, owned.pack.id),
        eq(schema.marketingSkuPhotoPackAssets.kind, "photo"),
      ),
    );
  if (photoCount.length >= PHOTO_PACK_MAX_PHOTOS) {
    return { ok: false, error: "too_many" };
  }

  const assetId = newId();
  const rel = photoPackAssetRelPath({
    workspaceId,
    skuId: owned.skuId,
    packId: owned.pack.id,
    assetId,
  });
  const buf = Buffer.from(await file.arrayBuffer());
  const written = await writeOwnedFile(rel, buf);
  if (!written.ok) return { ok: false, error: "invalid" };
  try {
    await db.insert(schema.marketingSkuPhotoPackAssets).values({
      id: assetId,
      workspaceId,
      skuId: owned.skuId,
      packId: owned.pack.id,
      kind: "photo",
      storagePath: rel,
      originalName,
      mimeType: mime,
      createdAt: nowIso(),
    });
  } catch (err) {
    await deleteOwnedFile(rel);
    throw err;
  }
  return { ok: true, value: { assetId } };
}

export async function removePhotoFromPack(
  workspaceId: string,
  skuId: unknown,
  assetId: string,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const scoped = await requirePhotoPackSku(workspaceId, skuId);
  if (!scoped.ok) return scoped;
  if (!assetId.trim()) return { ok: false, error: "not_found" };
  const asset = await db
    .select()
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.id, assetId.trim()),
        eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPackAssets.skuId, scoped.skuId),
      ),
    )
    .then((rows) => rows[0]);
  if (!asset) return { ok: false, error: "not_found" };
  await db
    .delete(schema.marketingSkuPhotoPackAssets)
    .where(eq(schema.marketingSkuPhotoPackAssets.id, asset.id));
  await deleteOwnedFile(asset.storagePath);
  return { ok: true, value: true };
}

export async function deletePhotoPack(
  workspaceId: string,
  skuId: unknown,
  packId: string,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;

  const assets = await db
    .select()
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.packId, owned.pack.id),
        eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
        eq(schema.marketingSkuPhotoPackAssets.skuId, owned.skuId),
      ),
    );
  const motionPath = owned.pack.motionClipStoragePath;
  const wasDefault = owned.pack.isDefault;

  const dbRes = await withTxResult<PhotoPackResult>(
    async (tx) => {
      const now = nowIso();
      await tx
        .update(schema.marketingCreativeVisuals)
        .set({ packId: null, updatedAt: now })
        .where(
          and(
            eq(schema.marketingCreativeVisuals.workspaceId, workspaceId),
            eq(schema.marketingCreativeVisuals.skuId, owned.skuId),
            eq(schema.marketingCreativeVisuals.packId, owned.pack.id),
          ),
        );
      await tx
        .delete(schema.marketingSkuPhotoPackAssets)
        .where(
          and(
            eq(schema.marketingSkuPhotoPackAssets.packId, owned.pack.id),
            eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
          ),
        );
      await tx
        .delete(schema.marketingSkuPhotoPacks)
        .where(
          and(
            eq(schema.marketingSkuPhotoPacks.id, owned.pack.id),
            eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
            eq(schema.marketingSkuPhotoPacks.skuId, owned.skuId),
          ),
        );
      const remaining = await tx
        .select({
          id: schema.marketingSkuPhotoPacks.id,
          createdAt: schema.marketingSkuPhotoPacks.createdAt,
        })
        .from(schema.marketingSkuPhotoPacks)
        .where(
          and(
            eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
            eq(schema.marketingSkuPhotoPacks.skuId, owned.skuId),
          ),
        )
        .orderBy(asc(schema.marketingSkuPhotoPacks.createdAt));
      const promoteId = packIdToPromoteAfterDelete({
        deletedWasDefault: wasDefault,
        remaining,
      });
      if (promoteId) {
        await tx
          .update(schema.marketingSkuPhotoPacks)
          .set({ isDefault: true, updatedAt: now })
          .where(
            and(
              eq(schema.marketingSkuPhotoPacks.id, promoteId),
              eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
              eq(schema.marketingSkuPhotoPacks.skuId, owned.skuId),
            ),
          );
      }
      return { ok: true, value: true };
    },
    () => ({ ok: false, error: "not_found" }),
  );
  if (!dbRes.ok) return dbRes;

  for (const asset of assets) {
    await deleteOwnedFile(asset.storagePath);
  }
  if (motionPath) await deleteOwnedFile(motionPath);
  return { ok: true, value: true };
}

export async function setPackMotionClip(
  workspaceId: string,
  skuId: unknown,
  packId: string,
  file: File,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;
  if (!(file instanceof File) || file.size <= 0) {
    return { ok: false, error: "invalid" };
  }
  if (file.size > PHOTO_PACK_MAX_MOTION_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const originalName = originalNameOf(file);
  const mime = resolveMotionMime(file.type, originalName);
  if (!mime) return { ok: false, error: "bad_type" };

  const rel = photoPackMotionRelPath({
    workspaceId,
    skuId: owned.skuId,
    packId: owned.pack.id,
  });
  const buf = Buffer.from(await file.arrayBuffer());
  const written = await writeOwnedFile(rel, buf);
  if (!written.ok) return { ok: false, error: "invalid" };
  const prev = owned.pack.motionClipStoragePath;
  await db
    .update(schema.marketingSkuPhotoPacks)
    .set({
      motionClipStoragePath: rel,
      motionClipOriginalName: originalName,
      motionClipMimeType: mime,
      updatedAt: nowIso(),
    })
    .where(eq(schema.marketingSkuPhotoPacks.id, owned.pack.id));
  if (prev && prev !== rel) await deleteOwnedFile(prev);
  return { ok: true, value: true };
}

export async function clearPackMotionClip(
  workspaceId: string,
  skuId: unknown,
  packId: string,
): Promise<PhotoPackResult> {
  await ensureMigrated();
  const owned = await requireOwnedPack(workspaceId, skuId, packId);
  if (!owned.ok) return owned;
  const prev = owned.pack.motionClipStoragePath;
  await db
    .update(schema.marketingSkuPhotoPacks)
    .set({
      motionClipStoragePath: null,
      motionClipOriginalName: null,
      motionClipMimeType: null,
      updatedAt: nowIso(),
    })
    .where(eq(schema.marketingSkuPhotoPacks.id, owned.pack.id));
  if (prev) await deleteOwnedFile(prev);
  return { ok: true, value: true };
}

export async function setCreativePackChoice(args: {
  workspaceId: string;
  skuId: unknown;
  kitId: string;
  creativeId: string;
  packId: string;
}): Promise<PhotoPackResult> {
  await ensureMigrated();
  const scoped = await requirePhotoPackSku(args.workspaceId, args.skuId);
  if (!scoped.ok) return scoped;
  const kitId = args.kitId.trim();
  const creativeId = args.creativeId.trim();
  const packId = args.packId.trim();
  if (!kitId || !creativeId || !packId) return { ok: false, error: "not_found" };

  const kit = await db
    .select()
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.id, kitId),
        eq(schema.marketingKits.workspaceId, args.workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!kit || kit.skuId !== scoped.skuId) {
    return { ok: false, error: "not_found" };
  }

  const pack = await db
    .select({ id: schema.marketingSkuPhotoPacks.id })
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.id, packId),
        eq(schema.marketingSkuPhotoPacks.workspaceId, args.workspaceId),
        eq(schema.marketingSkuPhotoPacks.skuId, scoped.skuId),
      ),
    )
    .then((rows) => rows[0]);
  if (!pack) return { ok: false, error: "not_found" };

  const now = nowIso();
  await db
    .insert(schema.marketingCreativeVisuals)
    .values({
      id: newId(),
      workspaceId: args.workspaceId,
      skuId: scoped.skuId,
      kitId,
      creativeId,
      packId,
      storagePath: "",
      kind: "still",
      regenerateCount: 0,
      generatedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.marketingCreativeVisuals.workspaceId,
        schema.marketingCreativeVisuals.kitId,
        schema.marketingCreativeVisuals.creativeId,
      ],
      set: {
        packId,
        skuId: scoped.skuId,
        updatedAt: now,
      },
    });
  return { ok: true, value: true };
}

export async function loadOwnedPhotoAsset(
  workspaceId: string,
  assetId: string,
): Promise<
  | {
      ok: true;
      bytes: Buffer;
      mimeType: string;
      originalName: string;
    }
  | { ok: false; error: "not_found" }
> {
  await ensureMigrated();
  if (!assetId.trim()) return { ok: false, error: "not_found" };
  const asset = await db
    .select()
    .from(schema.marketingSkuPhotoPackAssets)
    .where(
      and(
        eq(schema.marketingSkuPhotoPackAssets.id, assetId.trim()),
        eq(schema.marketingSkuPhotoPackAssets.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!asset) return { ok: false, error: "not_found" };
  const scoped = await requirePhotoPackSku(workspaceId, asset.skuId);
  if (!scoped.ok) return scoped;
  const bytes = await readOwnedFile(asset.storagePath);
  if (!bytes) return { ok: false, error: "not_found" };
  return {
    ok: true,
    bytes,
    mimeType: asset.mimeType || "application/octet-stream",
    originalName: asset.originalName,
  };
}

export async function loadOwnedMotionClip(
  workspaceId: string,
  packId: string,
): Promise<
  | {
      ok: true;
      bytes: Buffer;
      mimeType: string;
      originalName: string;
    }
  | { ok: false; error: "not_found" }
> {
  await ensureMigrated();
  if (!packId.trim()) return { ok: false, error: "not_found" };
  const pack = await db
    .select()
    .from(schema.marketingSkuPhotoPacks)
    .where(
      and(
        eq(schema.marketingSkuPhotoPacks.id, packId.trim()),
        eq(schema.marketingSkuPhotoPacks.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!pack?.motionClipStoragePath) return { ok: false, error: "not_found" };
  const scoped = await requirePhotoPackSku(workspaceId, pack.skuId);
  if (!scoped.ok) return scoped;
  const bytes = await readOwnedFile(pack.motionClipStoragePath);
  if (!bytes) return { ok: false, error: "not_found" };
  return {
    ok: true,
    bytes,
    mimeType: pack.motionClipMimeType || "application/octet-stream",
    originalName: pack.motionClipOriginalName ?? "motion",
  };
}
