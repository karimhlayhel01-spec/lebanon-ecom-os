import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { nowIso } from "@/lib/ids";

/**
 * FK-safe wipe of journey data for demo reset (children → parents).
 * Same prefix as WORKSPACE_CASCADE_DELETE_ORDER, but stops before identity:
 * onboarding_profiles, journey_states, side_statuses, workspaces are KEPT
 * (journey/side rows are reset in place; onboarding + workspace identity untouched).
 */
export const DEMO_JOURNEY_RESET_DELETE_ORDER = [
  "sample_records",
  "supplier_options",
  "marketing_kits",
  "demand_signals",
  "sku_journeys",
  "approval_requests",
  "sku_cards",
  "product_candidates",
  "discovery_sessions",
  "topic_a_entries",
  "finance_verdicts",
  "orchestrator_events",
  "store_readiness",
] as const;

/**
 * Wipe workspace journey data → empty shop discovery.
 * Keeps: user, session, workspace row (id / Shopify slot / name),
 * onboarding_profiles, and side_statuses.onboardingComplete.
 */
export async function resetWorkspaceJourney(
  workspaceId: string,
): Promise<void> {
  await ensureMigrated();
  const id = workspaceId;
  const updatedAt = nowIso();

  await db
    .delete(schema.sampleRecords)
    .where(eq(schema.sampleRecords.workspaceId, id));
  await db
    .delete(schema.supplierOptions)
    .where(eq(schema.supplierOptions.workspaceId, id));
  await db
    .delete(schema.marketingKits)
    .where(eq(schema.marketingKits.workspaceId, id));
  await db
    .delete(schema.demandSignals)
    .where(eq(schema.demandSignals.workspaceId, id));
  await db
    .delete(schema.skuJourneys)
    .where(eq(schema.skuJourneys.workspaceId, id));
  await db
    .delete(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, id));
  await db.delete(schema.skuCards).where(eq(schema.skuCards.workspaceId, id));
  await db
    .delete(schema.productCandidates)
    .where(eq(schema.productCandidates.workspaceId, id));
  await db
    .delete(schema.discoverySessions)
    .where(eq(schema.discoverySessions.workspaceId, id));
  await db
    .delete(schema.topicAEntries)
    .where(eq(schema.topicAEntries.workspaceId, id));
  await db
    .delete(schema.financeVerdicts)
    .where(eq(schema.financeVerdicts.workspaceId, id));
  await db
    .delete(schema.orchestratorEvents)
    .where(eq(schema.orchestratorEvents.workspaceId, id));
  await db
    .delete(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, id));

  await db
    .update(schema.journeyStates)
    .set({
      primaryState: "discovery",
      pausedFromState: null,
      blockedFromState: null,
      blockedReason: null,
      updatedAt,
    })
    .where(eq(schema.journeyStates.workspaceId, id));

  // Preserve onboardingComplete — founder must not re-do onboarding.
  await db
    .update(schema.sideStatuses)
    .set({
      productAccepted: false,
      okayRiskAck: false,
      tier1Resolved: false,
      sampleStatus: "none",
      storeReadyPercent: 0,
      storeReady: false,
      marketingStage: "none",
      batchOrdered: false,
      batchArrivedReady: false,
      batchArrivalEta: null,
      topicAWeekCount: 0,
      cashLockAck: false,
      stuckOver10kAck: false,
      costQuotesSaved: false,
      discoveryExhaustedRounds: 0,
      experienceRaisedPendingAck: false,
      updatedAt,
    })
    .where(eq(schema.sideStatuses.workspaceId, id));

  await db
    .update(schema.workspaces)
    .set({
      activeSkuId: null,
      shopPaused: false,
    })
    .where(eq(schema.workspaces.id, id));
}
