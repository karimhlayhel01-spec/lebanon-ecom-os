/**
 * Postgres integration tests for critical paths (IDOR, Topic A txn, ledger, demo reset).
 * Skips entirely when DATABASE_URL is unset — unit CI stays fast / offline.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  decideApproval,
} from "@/lib/approvals/engine";
import { resetWorkspaceJourney } from "@/lib/demo/reset-journey";
import { addWeeklyEntry, startSelling } from "@/lib/finance/service";
import { serializePerSkuSoldLeft } from "@/lib/finance/per-sku-sold-left";
import { advanceJourney, founderEditSkuCard } from "@/lib/memory/repos";
import { assertSkuOwned } from "@/lib/sku/ownership";
import { markReorderArrived } from "@/lib/supplier/service";
import {
  createTestWorkspace,
  insertLiveSku,
  postgresIntegrationEnabled,
  type TestWorkspace,
} from "@/lib/test/pg";
import { newId, nowIso } from "@/lib/ids";
const describePg = postgresIntegrationEnabled() ? describe : describe.skip;

/** Neon / remote Postgres needs headroom beyond unit-test defaults. */
const PG_TIMEOUT_MS = 45_000;

/** Mirrors saveSkuNotesAction ownership gate (no session cookie needed). */
async function saveNotesIfOwned(
  workspaceId: string,
  skuId: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const owned = await assertSkuOwned(workspaceId, skuId);
  if (!owned.ok || owned.card.lifecycleStatus !== "live") {
    return { ok: false, error: "not_found" };
  }
  await founderEditSkuCard(skuId, { founderNotes: notes });
  return { ok: true };
}

describePg("postgres integration — critical paths", () => {
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
    "rejects foreign skuId on startSelling and notes (IDOR)",
    async () => {
      const victim = await track(await createTestWorkspace("victim"));
      const attacker = await track(await createTestWorkspace("attacker"));
      const { skuId } = await insertLiveSku(victim.workspaceId, {
        primaryState: "batch_arrived_ready",
        batchArrivedReady: true,
        founderNotes: "keep-me",
      });

      const sell = await startSelling(attacker.workspaceId, skuId);
      expect(sell).toEqual({ ok: false, error: "not_found" });

      const notes = await saveNotesIfOwned(
        attacker.workspaceId,
        skuId,
        "pwned",
      );
      expect(notes).toEqual({ ok: false, error: "not_found" });

      const card = await db
        .select({
          notes: schema.skuCards.founderNotes,
          workspaceId: schema.skuCards.workspaceId,
        })
        .from(schema.skuCards)
        .where(eq(schema.skuCards.id, skuId))
        .then((rows) => rows[0]);
      expect(card?.workspaceId).toBe(victim.workspaceId);
      expect(card?.notes).toBe("keep-me");

      const journey = await db
        .select({ primaryState: schema.skuJourneys.primaryState })
        .from(schema.skuJourneys)
        .where(eq(schema.skuJourneys.skuId, skuId))
        .then((rows) => rows[0]);
      expect(journey?.primaryState).toBe("batch_arrived_ready");
    },
    PG_TIMEOUT_MS,
  );

  it(
    "addWeeklyEntry inserts week and sets topicAWeekCount from COUNT (atomic)",
    async () => {
      const ws = await track(await createTestWorkspace("week"));
      await insertLiveSku(ws.workspaceId, { primaryState: "selling" });

      // Stale mirror must not drive +1 math — SoT is COUNT(topic_a_entries).
      await db
        .update(schema.sideStatuses)
        .set({ topicAWeekCount: 5, updatedAt: new Date().toISOString() })
        .where(eq(schema.sideStatuses.workspaceId, ws.workspaceId));

      const res = await addWeeklyEntry(ws.workspaceId, {
        weekStart: "2026-01-05",
        sales: 100,
        orders: 4,
        metaSpend: 10,
        tiktokSpend: 0,
        codCollected: 80,
        codOutstanding: 20,
        courierFees: 8,
        skuSold: 4,
        skuLeft: 96,
      });
      expect(res).toEqual({ ok: true });

      const weeks = await db
        .select({ id: schema.topicAEntries.id })
        .from(schema.topicAEntries)
        .where(eq(schema.topicAEntries.workspaceId, ws.workspaceId));
      expect(weeks).toHaveLength(1);

      const side = await db
        .select({ topicAWeekCount: schema.sideStatuses.topicAWeekCount })
        .from(schema.sideStatuses)
        .where(eq(schema.sideStatuses.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(side?.topicAWeekCount).toBe(1);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "markReorderArrived bumps received and sets unitsLeft = received − sold",
    async () => {
      const ws = await track(await createTestWorkspace("reorder"));
      const { skuId } = await insertLiveSku(ws.workspaceId, {
        primaryState: "selling",
        totalUnitsReceived: 100,
        unitsLeft: 70,
        reorderStatus: "ordered",
        reorderQty: 50,
        reorderSupplierId: "sup-it",
      });

      // Prior sold = 30 → left glance 70. Arrive +50 → received 150, left 120.
      await db.insert(schema.topicAEntries).values({
        id: `it-week-${skuId.slice(0, 8)}`,
        workspaceId: ws.workspaceId,
        weekStart: "2026-01-06",
        storeTotalsUsd: 300,
        perSkuSoldLeft: serializePerSkuSoldLeft({
          orders: 30,
          skuSold: 30,
          skuLeft: 70,
        }),
        metaSpend: 0,
        tiktokSpend: 0,
        codCollected: 300,
        codOutstanding: 0,
        courierFees: 0,
        createdAt: new Date().toISOString(),
      });

      const res = await markReorderArrived(ws.workspaceId, skuId, true);
      expect(res).toEqual({ ok: true });

      const card = await db
        .select({ importBatch: schema.skuCards.importBatch })
        .from(schema.skuCards)
        .where(eq(schema.skuCards.id, skuId))
        .then((rows) => rows[0]);
      const batch = JSON.parse(card!.importBatch) as {
        totalUnitsReceived: number;
        unitsLeft: number;
      };
      expect(batch.totalUnitsReceived).toBe(150);
      expect(batch.unitsLeft).toBe(120);

      const journey = await db
        .select({
          reorderStatus: schema.skuJourneys.reorderStatus,
          reorderQty: schema.skuJourneys.reorderQty,
          primaryState: schema.skuJourneys.primaryState,
        })
        .from(schema.skuJourneys)
        .where(eq(schema.skuJourneys.skuId, skuId))
        .then((rows) => rows[0]);
      expect(journey?.reorderStatus).toBe("idle");
      expect(journey?.reorderQty).toBeNull();
      expect(journey?.primaryState).toBe("selling");
    },
    PG_TIMEOUT_MS,
  );

  it(
    "demo restore keeps onboarding and seeds Discovery 5→25",
    async () => {
      const { restoreDemoDiscovery } = await import(
        "@/lib/demo/seed-discovery"
      );
      const { getDiscoveryView, showMore } = await import(
        "@/lib/discovery/service"
      );
      const {
        DISCOVERY_INITIAL_COUNT,
        DISCOVERY_SESSION_CAP,
        DISCOVERY_SHOW_MORE_MAX,
      } = await import("@/lib/constants");

      const ws = await track(await createTestWorkspace("demo-restore"));
      await insertLiveSku(ws.workspaceId, { primaryState: "selling" });

      const seeded = await restoreDemoDiscovery(ws.workspaceId);
      expect(seeded.productsShown).toBe(DISCOVERY_INITIAL_COUNT);
      expect(seeded.showMoreUsed).toBe(0);
      expect(seeded.poolSize).toBe(DISCOVERY_SESSION_CAP);

      const onboarding = await db
        .select({
          storageDescription: schema.onboardingProfiles.storageDescription,
        })
        .from(schema.onboardingProfiles)
        .where(eq(schema.onboardingProfiles.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(onboarding?.storageDescription).toBe("test storage");

      const side = await db
        .select({
          onboardingComplete: schema.sideStatuses.onboardingComplete,
          productAccepted: schema.sideStatuses.productAccepted,
        })
        .from(schema.sideStatuses)
        .where(eq(schema.sideStatuses.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(side?.onboardingComplete).toBe(true);
      expect(side?.productAccepted).toBe(false);

      const skus = await db
        .select({ id: schema.skuCards.id })
        .from(schema.skuCards)
        .where(eq(schema.skuCards.workspaceId, ws.workspaceId));
      expect(skus).toHaveLength(0);

      let view = await getDiscoveryView(ws.workspaceId, "en");
      expect(view).not.toBeNull();
      expect(view!.candidates.length).toBe(DISCOVERY_INITIAL_COUNT);
      expect(view!.productsShown).toBe(DISCOVERY_INITIAL_COUNT);
      expect(view!.canShowMore).toBe(true);
      expect(view!.shortlistEmptyState).toBeNull();

      for (let i = 0; i < DISCOVERY_SHOW_MORE_MAX; i += 1) {
        await showMore(ws.workspaceId);
      }
      view = await getDiscoveryView(ws.workspaceId, "en");
      expect(view).not.toBeNull();
      expect(view!.candidates.length).toBeLessThanOrEqual(DISCOVERY_SESSION_CAP);
      expect(view!.productsShown).toBe(DISCOVERY_SESSION_CAP);
      expect(view!.canShowMore).toBe(false);
      expect(view!.shortlistEmptyState).toBeNull();
    },
    PG_TIMEOUT_MS,
  );

  it(
    "demo reset keeps onboarding and clears SKUs",
    async () => {
      const ws = await track(await createTestWorkspace("reset"));
      await insertLiveSku(ws.workspaceId, { primaryState: "selling" });

      await resetWorkspaceJourney(ws.workspaceId);

      const onboarding = await db
        .select({
          storageDescription: schema.onboardingProfiles.storageDescription,
        })
        .from(schema.onboardingProfiles)
        .where(eq(schema.onboardingProfiles.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(onboarding?.storageDescription).toBe("test storage");

      const side = await db
        .select({
          onboardingComplete: schema.sideStatuses.onboardingComplete,
          productAccepted: schema.sideStatuses.productAccepted,
          topicAWeekCount: schema.sideStatuses.topicAWeekCount,
        })
        .from(schema.sideStatuses)
        .where(eq(schema.sideStatuses.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(side?.onboardingComplete).toBe(true);
      expect(side?.productAccepted).toBe(false);
      expect(side?.topicAWeekCount).toBe(0);

      const skus = await db
        .select({ id: schema.skuCards.id })
        .from(schema.skuCards)
        .where(eq(schema.skuCards.workspaceId, ws.workspaceId));
      expect(skus).toHaveLength(0);

      const workspace = await db
        .select({ activeSkuId: schema.workspaces.activeSkuId })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(workspace?.activeSkuId).toBeNull();

      const sessions = await db
        .select({ id: schema.discoverySessions.id })
        .from(schema.discoverySessions)
        .where(eq(schema.discoverySessions.workspaceId, ws.workspaceId));
      expect(sessions).toHaveLength(0);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "advanceJourney / decideApproval fail closed without skuId when live SKUs exist",
    async () => {
      const ws = await track(await createTestWorkspace("fail-closed"));
      const a = await insertLiveSku(ws.workspaceId, {
        name: "SKU A",
        primaryState: "sample_approved",
        batchArrivedReady: false,
      });
      const b = await insertLiveSku(ws.workspaceId, {
        name: "SKU B",
        primaryState: "sample_approved",
        batchArrivedReady: false,
      });

      // Point active at A — soft preference must not be used for mutations.
      await db
        .update(schema.workspaces)
        .set({ activeSkuId: a.skuId })
        .where(eq(schema.workspaces.id, ws.workspaceId));

      const missing = await advanceJourney(
        ws.workspaceId,
        "batch_ordered",
      );
      expect(missing).toEqual({ ok: false, error: "invalid_transition" });

      const owned = await advanceJourney(
        ws.workspaceId,
        "batch_ordered",
        a.skuId,
      );
      expect(owned.ok).toBe(true);

      // Reset A so both stay at sample_approved for the decideApproval check.
      await db
        .update(schema.skuJourneys)
        .set({ primaryState: "sample_approved", updatedAt: nowIso() })
        .where(eq(schema.skuJourneys.skuId, a.skuId));

      const approvalId = newId();
      await db.insert(schema.approvalRequests).values({
        id: approvalId,
        workspaceId: ws.workspaceId,
        skuId: null,
        gateId: "batch_ordered",
        status: "pending",
        payload: JSON.stringify({ requiredAcks: [], data: {} }),
        acknowledgements: "[]",
        decisionNote: null,
        decidedAt: null,
        createdAt: nowIso(),
      });

      const decided = await decideApproval(approvalId, {
        type: "approve",
        acknowledgements: [],
      });
      expect(decided.ok).toBe(false);
      if (!decided.ok) {
        expect(decided.error).toBe("transition_failed");
      }

      const states = await db
        .select({
          skuId: schema.skuJourneys.skuId,
          primaryState: schema.skuJourneys.primaryState,
        })
        .from(schema.skuJourneys)
        .where(eq(schema.skuJourneys.workspaceId, ws.workspaceId));
      const byId = Object.fromEntries(
        states.map((r) => [r.skuId, r.primaryState]),
      );
      expect(byId[a.skuId]).toBe("sample_approved");
      expect(byId[b.skuId]).toBe("sample_approved");

      const pending = await db
        .select({ status: schema.approvalRequests.status })
        .from(schema.approvalRequests)
        .where(eq(schema.approvalRequests.id, approvalId))
        .then((rows) => rows[0]);
      expect(pending?.status).toBe("pending");
    },
    PG_TIMEOUT_MS,
  );

  it(
    "advanceJourney allows legacy workspace advance when zero live SKUs",
    async () => {
      const ws = await track(await createTestWorkspace("legacy-advance"));
      // Empty shop — journey_states starts at discovery.
      const result = await advanceJourney(
        ws.workspaceId,
        "supplier_sample",
      );
      // discovery → supplier_sample is legal on the spine.
      expect(result.ok).toBe(true);

      const row = await db
        .select({ primaryState: schema.journeyStates.primaryState })
        .from(schema.journeyStates)
        .where(eq(schema.journeyStates.workspaceId, ws.workspaceId))
        .then((rows) => rows[0]);
      expect(row?.primaryState).toBe("supplier_sample");
    },
    PG_TIMEOUT_MS,
  );
});
