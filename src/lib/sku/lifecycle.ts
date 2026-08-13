import { and, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { DbExecutor } from "@/db/executor";
import { SKU_WIPE_DELETE_ORDER } from "@/lib/account/cascade-order";
import { nowIso } from "@/lib/ids";
import { listLiveSkus } from "@/lib/sku/journey";

/** Delete SKU-scoped dependents in cascade order (card is marked wiped after). */
async function deleteSkuWipeDependents(
  exec: DbExecutor,
  skuId: string,
): Promise<void> {
  for (const table of SKU_WIPE_DELETE_ORDER) {
    switch (table) {
      case "sample_records":
        await exec
          .delete(schema.sampleRecords)
          .where(eq(schema.sampleRecords.skuId, skuId));
        break;
      case "supplier_options":
        await exec
          .delete(schema.supplierOptions)
          .where(eq(schema.supplierOptions.skuId, skuId));
        break;
      case "marketing_kits":
        await exec
          .delete(schema.marketingKits)
          .where(eq(schema.marketingKits.skuId, skuId));
        break;
      case "store_page_packs":
        // SKU wipe deletes only this SKU's pack. Shop pack (sku_id NULL) survives.
        await exec
          .delete(schema.storePagePacks)
          .where(eq(schema.storePagePacks.skuId, skuId));
        break;
      case "sku_journeys":
        await exec
          .delete(schema.skuJourneys)
          .where(eq(schema.skuJourneys.skuId, skuId));
        break;
      case "approval_requests":
        await exec
          .delete(schema.approvalRequests)
          .where(eq(schema.approvalRequests.skuId, skuId));
        break;
      default: {
        const _exhaustive: never = table;
        throw new Error(`Unexpected SKU wipe table: ${_exhaustive}`);
      }
    }
  }
}

export type ArchiveWarning = {
  sampleNotArrived: boolean;
  batchNotArrived: boolean;
};

export type ArchiveResult =
  | { ok: true; warnings: ArchiveWarning }
  | { ok: false; error: "not_found" | "already_archived" | "wiped" };

export type RestoreResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_archived" | "wiped" };

export type WipeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "must_archive_first" | "error" };

function warningsFor(journey: {
  sampleStatus: string;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
} | null): ArchiveWarning {
  const sampleNotArrived =
    !!journey &&
    journey.sampleStatus !== "none" &&
    journey.sampleStatus !== "approved" &&
    journey.sampleStatus !== "rejected";
  const batchNotArrived =
    !!journey && journey.batchOrdered && !journey.batchArrivedReady;
  return { sampleNotArrived, batchNotArrived };
}

/** Preview archive warnings without mutating (for UI confirms). */
export async function getArchiveWarnings(
  workspaceId: string,
  skuId: string,
): Promise<ArchiveWarning | null> {
  await ensureMigrated();
  const card = await db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.id, skuId),
        eq(schema.skuCards.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!card || card.lifecycleStatus !== "live") return null;
  const journey = await db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.skuId, skuId))
    .then((rows) => rows[0]);
  return warningsFor(journey ?? null);
}

/**
 * Soft-archive a live SKU. Restorable with full history.
 * WARN if sample in-flight and/or batch not marked arrived.
 */
export async function archiveSku(
  workspaceId: string,
  skuId: string,
): Promise<ArchiveResult> {
  await ensureMigrated();
  const card = await db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.id, skuId),
        eq(schema.skuCards.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!card) return { ok: false, error: "not_found" };
  if (card.lifecycleStatus === "wiped") return { ok: false, error: "wiped" };
  if (card.lifecycleStatus === "archived") {
    return { ok: false, error: "already_archived" };
  }

  const journey = await db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.skuId, skuId))
    .then((rows) => rows[0]);

  const warnings = warningsFor(journey ?? null);
  const now = nowIso();

  await db
    .update(schema.skuCards)
    .set({
      lifecycleStatus: "archived",
      archivedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, skuId));

  // If this was active, point activeSkuId at another live SKU (or null).
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
  if (workspace?.activeSkuId === skuId) {
    const live = await listLiveSkus(workspaceId);
    await db
      .update(schema.workspaces)
      .set({ activeSkuId: live[0]?.id ?? null })
      .where(eq(schema.workspaces.id, workspaceId));
  }

  // Refresh shop productAccepted from live set.
  const liveCount = (await listLiveSkus(workspaceId)).length;
  await db
    .update(schema.sideStatuses)
    .set({
      productAccepted: liveCount > 0,
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  return { ok: true, warnings };
}

/** Restore an archived SKU with full history. */
export async function restoreSku(
  workspaceId: string,
  skuId: string,
): Promise<RestoreResult> {
  await ensureMigrated();
  const card = await db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.id, skuId),
        eq(schema.skuCards.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!card) return { ok: false, error: "not_found" };
  if (card.lifecycleStatus === "wiped") return { ok: false, error: "wiped" };
  if (card.lifecycleStatus !== "archived") {
    return { ok: false, error: "not_archived" };
  }

  const now = nowIso();
  await db
    .update(schema.skuCards)
    .set({
      lifecycleStatus: "live",
      archivedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, skuId));

  await db
    .update(schema.sideStatuses)
    .set({ productAccepted: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
  if (!workspace?.activeSkuId) {
    await db
      .update(schema.workspaces)
      .set({ activeSkuId: skuId })
      .where(eq(schema.workspaces.id, workspaceId));
  }

  return { ok: true };
}

/**
 * Hard wipe after archive — cannot bring back. Deletes SKU-scoped rows;
 * Topic A shop history is kept (cancelled SKU weeks remain in roll-up JSON).
 */
export async function wipeSku(
  workspaceId: string,
  skuId: string,
): Promise<WipeResult> {
  await ensureMigrated();
  const card = await db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.id, skuId),
        eq(schema.skuCards.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!card) return { ok: false, error: "not_found" };
  if (card.lifecycleStatus === "live") {
    return { ok: false, error: "must_archive_first" };
  }
  if (card.lifecycleStatus === "wiped") return { ok: true };

  // Delete dependent rows in SKU_WIPE_DELETE_ORDER, then mark card wiped.
  try {
    await db.transaction(async (tx) => {
      await deleteSkuWipeDependents(tx, skuId);

      const now = nowIso();
      await tx
        .update(schema.skuCards)
        .set({
          lifecycleStatus: "wiped",
          name: "[wiped]",
          founderNotes: "",
          updatedAt: now,
        })
        .where(eq(schema.skuCards.id, skuId));

      const live = await tx
        .select({ id: schema.skuCards.id })
        .from(schema.skuCards)
        .where(
          and(
            eq(schema.skuCards.workspaceId, workspaceId),
            eq(schema.skuCards.lifecycleStatus, "live"),
          ),
        );
      await tx
        .update(schema.workspaces)
        .set({ activeSkuId: live[0]?.id ?? null })
        .where(eq(schema.workspaces.id, workspaceId));
    });
  } catch {
    return { ok: false, error: "error" };
  }

  return { ok: true };
}

export function archiveWarningsMessage(w: ArchiveWarning): string[] {
  const keys: string[] = [];
  if (w.sampleNotArrived) keys.push("sampleNotArrived");
  if (w.batchNotArrived) keys.push("batchNotArrived");
  return keys;
}
