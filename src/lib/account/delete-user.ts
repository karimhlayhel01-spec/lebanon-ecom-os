import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { DbExecutor } from "@/db/executor";
import { WORKSPACE_CASCADE_DELETE_ORDER } from "@/lib/account/cascade-order";

/** Re-export — canonical list lives in cascade-order.ts. */
export { WORKSPACE_CASCADE_DELETE_ORDER };

async function deleteWorkspaceRows(
  exec: DbExecutor,
  workspaceId: string,
): Promise<void> {
  const id = workspaceId;
  await exec
    .delete(schema.sampleRecords)
    .where(eq(schema.sampleRecords.workspaceId, id));
  await exec
    .delete(schema.supplierOptions)
    .where(eq(schema.supplierOptions.workspaceId, id));
  await exec
    .delete(schema.marketingSkuPhotoPackAssets)
    .where(eq(schema.marketingSkuPhotoPackAssets.workspaceId, id));
  await exec
    .delete(schema.marketingCreativeVisuals)
    .where(eq(schema.marketingCreativeVisuals.workspaceId, id));
  await exec
    .delete(schema.marketingSkuPhotoPacks)
    .where(eq(schema.marketingSkuPhotoPacks.workspaceId, id));
  await exec
    .delete(schema.marketingKits)
    .where(eq(schema.marketingKits.workspaceId, id));
  await exec
    .delete(schema.storePagePacks)
    .where(eq(schema.storePagePacks.workspaceId, id));
  await exec
    .delete(schema.demandSignals)
    .where(eq(schema.demandSignals.workspaceId, id));
  // Wave 1: sku_journeys + approvals reference sku_cards — delete before cards.
  await exec
    .delete(schema.skuJourneys)
    .where(eq(schema.skuJourneys.workspaceId, id));
  await exec
    .delete(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, id));
  await exec.delete(schema.skuCards).where(eq(schema.skuCards.workspaceId, id));
  await exec
    .delete(schema.productCandidates)
    .where(eq(schema.productCandidates.workspaceId, id));
  await exec
    .delete(schema.discoverySessions)
    .where(eq(schema.discoverySessions.workspaceId, id));
  await exec
    .delete(schema.topicAEntries)
    .where(eq(schema.topicAEntries.workspaceId, id));
  await exec
    .delete(schema.financeVerdicts)
    .where(eq(schema.financeVerdicts.workspaceId, id));
  await exec
    .delete(schema.discoveryMetricEvents)
    .where(eq(schema.discoveryMetricEvents.workspaceId, id));
  await exec
    .delete(schema.marketingGeminiUsage)
    .where(eq(schema.marketingGeminiUsage.workspaceId, id));
  await exec
    .delete(schema.marketingVisualUsage)
    .where(eq(schema.marketingVisualUsage.workspaceId, id));
  await exec
    .delete(schema.orchestratorEvents)
    .where(eq(schema.orchestratorEvents.workspaceId, id));
  await exec
    .delete(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, id));
  await exec
    .delete(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, id));
  await exec
    .delete(schema.journeyStates)
    .where(eq(schema.journeyStates.workspaceId, id));
  await exec
    .delete(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, id));
  await exec.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
}

/** Delete one workspace and every workspace-scoped child row (atomic). */
export async function deleteWorkspaceById(workspaceId: string): Promise<void> {
  await ensureMigrated();
  await db.transaction(async (tx) => {
    await deleteWorkspaceRows(tx, workspaceId);
  });
}

/**
 * Cascade-delete every workspace owned by the user, then sessions, then the user.
 * Leaves no orphan rows for that founder. Single transaction.
 */
export async function deleteUserAndWorkspace(userId: string): Promise<void> {
  await ensureMigrated();

  await db.transaction(async (tx) => {
    const workspaces = await tx
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.founderUserId, userId));

    for (const ws of workspaces) {
      await deleteWorkspaceRows(tx, ws.id);
    }

    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
