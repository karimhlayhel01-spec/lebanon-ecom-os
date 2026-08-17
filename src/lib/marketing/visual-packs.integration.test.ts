/**
 * Postgres IDOR + default-pack uniqueness for Phase 6b photo packs.
 * Skips when DATABASE_URL is unset.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  addPhotoToPack,
  createPhotoPack,
  deletePhotoPack,
  listPhotoPacksForSku,
  setDefaultPhotoPack,
  setPackMotionClip,
} from "@/lib/marketing/visual-packs";
import { readOwnedFile } from "@/lib/marketing/visual-storage";
import {
  createTestWorkspace,
  insertLiveSku,
  postgresIntegrationEnabled,
  type TestWorkspace,
} from "@/lib/test/pg";

const describePg = postgresIntegrationEnabled() ? describe : describe.skip;
const PG_TIMEOUT_MS = 45_000;

describePg("postgres integration — photo packs", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  }, PG_TIMEOUT_MS);

  async function track(ws: TestWorkspace): Promise<TestWorkspace> {
    cleanups.push(ws.cleanup);
    return ws;
  }

  it(
    "refuses foreign skuId (IDOR) and shop null",
    async () => {
      const victim = await track(await createTestWorkspace("victim-pack"));
      const attacker = await track(await createTestWorkspace("attacker-pack"));
      const { skuId } = await insertLiveSku(victim.workspaceId);

      const foreign = await createPhotoPack(
        attacker.workspaceId,
        skuId,
        "Stolen look",
      );
      expect(foreign).toEqual({ ok: false, error: "not_found" });

      const shop = await createPhotoPack(
        victim.workspaceId,
        null,
        "Shop folder",
      );
      expect(shop).toEqual({ ok: false, error: "not_found" });

      const rows = await db
        .select({ id: schema.marketingSkuPhotoPacks.id })
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.skuId, skuId));
      expect(rows).toHaveLength(0);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "first pack is default; setDefault switches to exactly one",
    async () => {
      const ws = await track(await createTestWorkspace("pack-default"));
      const { skuId } = await insertLiveSku(ws.workspaceId);

      const first = await createPhotoPack(ws.workspaceId, skuId, "Look A");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await createPhotoPack(ws.workspaceId, skuId, "Look B");
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const afterCreate = await db
        .select({
          id: schema.marketingSkuPhotoPacks.id,
          isDefault: schema.marketingSkuPhotoPacks.isDefault,
        })
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.skuId, skuId));
      expect(afterCreate.find((p) => p.id === first.value.packId)?.isDefault).toBe(
        true,
      );
      expect(
        afterCreate.find((p) => p.id === second.value.packId)?.isDefault,
      ).toBe(false);

      const switched = await setDefaultPhotoPack(
        ws.workspaceId,
        skuId,
        second.value.packId,
      );
      expect(switched.ok).toBe(true);

      const afterSwitch = await db
        .select({
          id: schema.marketingSkuPhotoPacks.id,
          isDefault: schema.marketingSkuPhotoPacks.isDefault,
        })
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.skuId, skuId));
      const defaults = afterSwitch.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(second.value.packId);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "blank create assigns Pack 1 then Pack 2; typed name still works",
    async () => {
      const ws = await track(await createTestWorkspace("pack-auto-name"));
      const { skuId } = await insertLiveSku(ws.workspaceId);

      const shop = await createPhotoPack(ws.workspaceId, null, "");
      expect(shop).toEqual({ ok: false, error: "not_found" });

      const first = await createPhotoPack(ws.workspaceId, skuId, "");
      expect(first.ok).toBe(true);
      const second = await createPhotoPack(ws.workspaceId, skuId, "   ");
      expect(second.ok).toBe(true);
      const named = await createPhotoPack(ws.workspaceId, skuId, "Gift box");
      expect(named.ok).toBe(true);
      if (!first.ok || !second.ok || !named.ok) return;

      const rows = await db
        .select({
          id: schema.marketingSkuPhotoPacks.id,
          name: schema.marketingSkuPhotoPacks.name,
        })
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.skuId, skuId));
      expect(rows.find((p) => p.id === first.value.packId)?.name).toBe("Pack 1");
      expect(rows.find((p) => p.id === second.value.packId)?.name).toBe("Pack 2");
      expect(rows.find((p) => p.id === named.value.packId)?.name).toBe("Gift box");
    },
    PG_TIMEOUT_MS,
  );

  it(
    "deletePhotoPack refuses foreign workspace and shop null skuId",
    async () => {
      const victim = await track(await createTestWorkspace("victim-del-pack"));
      const attacker = await track(await createTestWorkspace("attacker-del-pack"));
      const { skuId } = await insertLiveSku(victim.workspaceId);
      const created = await createPhotoPack(victim.workspaceId, skuId, "Look A");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const foreign = await deletePhotoPack(
        attacker.workspaceId,
        skuId,
        created.value.packId,
      );
      expect(foreign).toEqual({ ok: false, error: "not_found" });

      const shop = await deletePhotoPack(
        victim.workspaceId,
        null,
        created.value.packId,
      );
      expect(shop).toEqual({ ok: false, error: "not_found" });

      const stillThere = await db
        .select({ id: schema.marketingSkuPhotoPacks.id })
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.id, created.value.packId));
      expect(stillThere).toHaveLength(1);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "deleting the default pack promotes the oldest remaining and clears pack choices",
    async () => {
      const ws = await track(await createTestWorkspace("pack-delete-default"));
      const { skuId } = await insertLiveSku(ws.workspaceId);

      const first = await createPhotoPack(ws.workspaceId, skuId, "Look A");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await createPhotoPack(ws.workspaceId, skuId, "Look B");
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const third = await createPhotoPack(ws.workspaceId, skuId, "Look C");
      expect(third.ok).toBe(true);
      if (!third.ok) return;

      const photo = new File([Uint8Array.from([1, 2, 3, 4])], "shot.jpg", {
        type: "image/jpeg",
      });
      const added = await addPhotoToPack(
        ws.workspaceId,
        skuId,
        first.value.packId,
        photo,
      );
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      const clip = new File([Uint8Array.from([5, 6, 7, 8])], "pour.mp4", {
        type: "video/mp4",
      });
      const motion = await setPackMotionClip(
        ws.workspaceId,
        skuId,
        first.value.packId,
        clip,
      );
      expect(motion.ok).toBe(true);

      const asset = await db
        .select()
        .from(schema.marketingSkuPhotoPackAssets)
        .where(eq(schema.marketingSkuPhotoPackAssets.id, added.value.assetId))
        .then((rows) => rows[0]);
      const packRow = await db
        .select()
        .from(schema.marketingSkuPhotoPacks)
        .where(eq(schema.marketingSkuPhotoPacks.id, first.value.packId))
        .then((rows) => rows[0]);
      expect(asset?.storagePath).toBeTruthy();
      expect(packRow?.motionClipStoragePath).toBeTruthy();
      expect(await readOwnedFile(asset!.storagePath)).not.toBeNull();
      expect(await readOwnedFile(packRow!.motionClipStoragePath!)).not.toBeNull();

      const now = nowIso();
      const kitId = newId();
      await db.insert(schema.marketingKits).values({
        id: kitId,
        workspaceId: ws.workspaceId,
        skuId,
        stage: "launch",
        capacityTier: "6",
        items: "[]",
        language: "en",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.marketingCreativeVisuals).values({
        id: newId(),
        workspaceId: ws.workspaceId,
        skuId,
        kitId,
        creativeId: "c1",
        packId: first.value.packId,
        storagePath: "",
        kind: "still",
        regenerateCount: 0,
        generatedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const deleted = await deletePhotoPack(
        ws.workspaceId,
        skuId,
        first.value.packId,
      );
      expect(deleted.ok).toBe(true);

      const listed = await listPhotoPacksForSku(ws.workspaceId, skuId);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value.map((p) => p.id).sort()).toEqual(
        [second.value.packId, third.value.packId].sort(),
      );
      const defaults = listed.value.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(
        [second.value.packId, third.value.packId].includes(defaults[0]!.id),
      ).toBe(true);

      const choice = await db
        .select({ packId: schema.marketingCreativeVisuals.packId })
        .from(schema.marketingCreativeVisuals)
        .where(eq(schema.marketingCreativeVisuals.kitId, kitId))
        .then((rows) => rows[0]);
      expect(choice?.packId).toBeNull();

      const goneAssets = await db
        .select({ id: schema.marketingSkuPhotoPackAssets.id })
        .from(schema.marketingSkuPhotoPackAssets)
        .where(eq(schema.marketingSkuPhotoPackAssets.packId, first.value.packId));
      expect(goneAssets).toHaveLength(0);
      expect(await readOwnedFile(asset!.storagePath)).toBeNull();
      expect(await readOwnedFile(packRow!.motionClipStoragePath!)).toBeNull();
    },
    PG_TIMEOUT_MS,
  );

  it(
    "deleting the last pack leaves the SKU with no packs",
    async () => {
      const ws = await track(await createTestWorkspace("pack-delete-last"));
      const { skuId } = await insertLiveSku(ws.workspaceId);
      const only = await createPhotoPack(ws.workspaceId, skuId, "Only look");
      expect(only.ok).toBe(true);
      if (!only.ok) return;

      const deleted = await deletePhotoPack(
        ws.workspaceId,
        skuId,
        only.value.packId,
      );
      expect(deleted.ok).toBe(true);

      const listed = await listPhotoPacksForSku(ws.workspaceId, skuId);
      expect(listed).toEqual({ ok: true, value: [] });
    },
    PG_TIMEOUT_MS,
  );
});
