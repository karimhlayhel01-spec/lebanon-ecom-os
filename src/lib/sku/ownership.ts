import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { DbExecutor } from "@/db/executor";

export type SkuOwnershipEvalError = "not_found" | "wiped" | "foreign";

/**
 * Pure ownership rules: card + journey must belong to the workspace; wiped rejected.
 * Callers map all failures to a uniform `not_found` at the API boundary.
 */
export function evaluateSkuOwnership(args: {
  workspaceId: string;
  card: { workspaceId: string; lifecycleStatus: string } | null | undefined;
  journey: { workspaceId: string } | null | undefined;
}): { ok: true } | { ok: false; error: SkuOwnershipEvalError } {
  const { workspaceId, card, journey } = args;
  if (!card || !journey) return { ok: false, error: "not_found" };
  if (card.lifecycleStatus === "wiped") return { ok: false, error: "wiped" };
  if (card.workspaceId !== workspaceId || journey.workspaceId !== workspaceId) {
    return { ok: false, error: "foreign" };
  }
  return { ok: true };
}

export type AssertSkuOwnedResult =
  | {
      ok: true;
      card: typeof schema.skuCards.$inferSelect;
      journey: typeof schema.skuJourneys.$inferSelect;
    }
  | { ok: false; error: "not_found" };

/**
 * SKU card + journey belong to `workspaceId` and the card is not wiped.
 * Use before any mutation that takes a client-supplied skuId.
 */
export async function assertSkuOwned(
  workspaceId: string,
  skuId: string,
  exec: DbExecutor = db,
): Promise<AssertSkuOwnedResult> {
  await ensureMigrated();
  const [card, journey] = await Promise.all([
    exec
      .select()
      .from(schema.skuCards)
      .where(eq(schema.skuCards.id, skuId))
      .then((rows) => rows[0]),
    exec
      .select()
      .from(schema.skuJourneys)
      .where(eq(schema.skuJourneys.skuId, skuId))
      .then((rows) => rows[0]),
  ]);

  const evalResult = evaluateSkuOwnership({ workspaceId, card, journey });
  if (!evalResult.ok || !card || !journey) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, card, journey };
}

/**
 * Approval skuId resolution: only the DB column is trusted.
 * payload.data.skuId is ignored unless callers already verified it into row.skuId
 * at createApprovalRequest time.
 */
export function resolveApprovalSkuId(args: {
  rowSkuId: string | null | undefined;
  /** Ignored — kept so call sites document the payload field they must not trust. */
  payloadSkuId?: string | null | undefined;
}): string | null {
  return args.rowSkuId ?? null;
}
