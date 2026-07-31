import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";

/**
 * FK-safe wipe order for workspace-scoped tables (children → parents).
 * Keep in sync with preview seed reset. Pure list for unit tests.
 */
export const WORKSPACE_CASCADE_DELETE_ORDER = [
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
  "onboarding_profiles",
  "journey_states",
  "side_statuses",
  "workspaces",
] as const;

/** Delete one workspace and every workspace-scoped child row. */
export async function deleteWorkspaceById(workspaceId: string): Promise<void> {
  await ensureMigrated();
  const id = workspaceId;
  await db.delete(schema.sampleRecords).where(eq(schema.sampleRecords.workspaceId, id));
  await db.delete(schema.supplierOptions).where(eq(schema.supplierOptions.workspaceId, id));
  await db.delete(schema.marketingKits).where(eq(schema.marketingKits.workspaceId, id));
  await db.delete(schema.demandSignals).where(eq(schema.demandSignals.workspaceId, id));
  // Wave 1: sku_journeys + approvals reference sku_cards — delete before cards.
  await db.delete(schema.skuJourneys).where(eq(schema.skuJourneys.workspaceId, id));
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
  await db.delete(schema.topicAEntries).where(eq(schema.topicAEntries.workspaceId, id));
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
    .delete(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, id));
  await db.delete(schema.journeyStates).where(eq(schema.journeyStates.workspaceId, id));
  await db.delete(schema.sideStatuses).where(eq(schema.sideStatuses.workspaceId, id));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
}

/**
 * Cascade-delete every workspace owned by the user, then sessions, then the user.
 * Leaves no orphan rows for that founder.
 */
export async function deleteUserAndWorkspace(userId: string): Promise<void> {
  await ensureMigrated();

  const workspaces = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, userId))
    ;

  for (const ws of workspaces) {
    await deleteWorkspaceById(ws.id);
  }

  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
