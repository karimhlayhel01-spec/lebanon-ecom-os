import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { DEMO_JOURNEY_RESET_DELETE_ORDER } from "@/lib/account/cascade-order";
import { nowIso } from "@/lib/ids";

/** Re-export — canonical subset lives in cascade-order.ts. */
export { DEMO_JOURNEY_RESET_DELETE_ORDER };

/**
 * Wipe workspace journey data → empty shop discovery (atomic).
 * Keeps: user, session, workspace row (id / Shopify slot / name),
 * onboarding_profiles, and side_statuses.onboardingComplete.
 * Prefer `restoreDemoDiscovery` for recruiter demos (wipe then seed).
 */
export async function resetWorkspaceJourney(
  workspaceId: string,
): Promise<void> {
  await ensureMigrated();
  const id = workspaceId;
  const updatedAt = nowIso();

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.sampleRecords)
      .where(eq(schema.sampleRecords.workspaceId, id));
    await tx
      .delete(schema.supplierOptions)
      .where(eq(schema.supplierOptions.workspaceId, id));
    await tx
      .delete(schema.marketingKits)
      .where(eq(schema.marketingKits.workspaceId, id));
    await tx
      .delete(schema.demandSignals)
      .where(eq(schema.demandSignals.workspaceId, id));
    await tx
      .delete(schema.skuJourneys)
      .where(eq(schema.skuJourneys.workspaceId, id));
    await tx
      .delete(schema.approvalRequests)
      .where(eq(schema.approvalRequests.workspaceId, id));
    await tx.delete(schema.skuCards).where(eq(schema.skuCards.workspaceId, id));
    await tx
      .delete(schema.productCandidates)
      .where(eq(schema.productCandidates.workspaceId, id));
    await tx
      .delete(schema.discoverySessions)
      .where(eq(schema.discoverySessions.workspaceId, id));
    await tx
      .delete(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, id));
    await tx
      .delete(schema.financeVerdicts)
      .where(eq(schema.financeVerdicts.workspaceId, id));
    await tx
      .delete(schema.discoveryMetricEvents)
      .where(eq(schema.discoveryMetricEvents.workspaceId, id));
    await tx
      .delete(schema.orchestratorEvents)
      .where(eq(schema.orchestratorEvents.workspaceId, id));
    await tx
      .delete(schema.storeReadiness)
      .where(eq(schema.storeReadiness.workspaceId, id));

    await tx
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
    await tx
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

    await tx
      .update(schema.workspaces)
      .set({
        activeSkuId: null,
        shopPaused: false,
      })
      .where(eq(schema.workspaces.id, id));
  });
}
