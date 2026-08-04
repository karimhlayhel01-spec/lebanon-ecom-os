/**
 * Wave 2 Approach A score cache — last-known semantics.
 * Failed refreshes must not wipe previous numeric scores (WAVE-2 §7).
 */

import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";

export type ScoreRow = typeof schema.discoveryProductScores.$inferSelect;

export type ScoreSnapshot = {
  abroadDemandScore?: number | null;
  lebanonDemandScore?: number | null;
  competitionScore?: number | null;
  budgetFightPenalty?: number | null;
  compositeScore?: number | null;
  demandPath?: string | null;
  confidence?: number | null;
  explainLine?: string | null;
  shadowWouldExclude?: boolean;
  shadowExcludeReason?: string | null;
  rawEvidenceJson?: string | null;
};

/** Pure patch for failed refresh — never includes numeric score fields. */
export function buildFailedScoreRefreshPatch(
  errorMessage: string,
  at: string,
): {
  lastScoreStatus: "failed";
  lastError: string;
  updatedAt: string;
} {
  return {
    lastScoreStatus: "failed",
    lastError: errorMessage.slice(0, 500),
    updatedAt: at,
  };
}

/** Ensure a score row exists for a pool product (status never until first success). */
export async function ensureScoreRow(
  poolProductId: string,
): Promise<ScoreRow> {
  await ensureMigrated();
  const existing = await db
    .select()
    .from(schema.discoveryProductScores)
    .where(eq(schema.discoveryProductScores.poolProductId, poolProductId))
    .then((rows) => rows[0]);
  if (existing) return existing;

  const at = nowIso();
  const row = {
    id: newId(),
    poolProductId,
    abroadDemandScore: null,
    lebanonDemandScore: null,
    competitionScore: null,
    budgetFightPenalty: null,
    compositeScore: null,
    demandPath: null,
    confidence: null,
    explainLine: null,
    lastScoredAt: null,
    lastScoreStatus: "never",
    lastError: null,
    shadowWouldExclude: false,
    shadowExcludeReason: null,
    rawEvidenceJson: null,
    createdAt: at,
    updatedAt: at,
  };
  await db.insert(schema.discoveryProductScores).values(row);
  return row as ScoreRow;
}

/**
 * Persist a successful score refresh. Overwrites numeric fields with new values.
 */
export async function applySuccessfulScoreRefresh(
  poolProductId: string,
  snapshot: ScoreSnapshot,
): Promise<ScoreRow> {
  await ensureMigrated();
  const row = await ensureScoreRow(poolProductId);
  const at = nowIso();
  const patch = {
    abroadDemandScore:
      snapshot.abroadDemandScore !== undefined
        ? snapshot.abroadDemandScore
        : row.abroadDemandScore,
    lebanonDemandScore:
      snapshot.lebanonDemandScore !== undefined
        ? snapshot.lebanonDemandScore
        : row.lebanonDemandScore,
    competitionScore:
      snapshot.competitionScore !== undefined
        ? snapshot.competitionScore
        : row.competitionScore,
    budgetFightPenalty:
      snapshot.budgetFightPenalty !== undefined
        ? snapshot.budgetFightPenalty
        : row.budgetFightPenalty,
    compositeScore:
      snapshot.compositeScore !== undefined
        ? snapshot.compositeScore
        : row.compositeScore,
    demandPath:
      snapshot.demandPath !== undefined ? snapshot.demandPath : row.demandPath,
    confidence:
      snapshot.confidence !== undefined ? snapshot.confidence : row.confidence,
    explainLine:
      snapshot.explainLine !== undefined
        ? snapshot.explainLine
        : row.explainLine,
    shadowWouldExclude:
      snapshot.shadowWouldExclude !== undefined
        ? snapshot.shadowWouldExclude
        : row.shadowWouldExclude,
    shadowExcludeReason:
      snapshot.shadowExcludeReason !== undefined
        ? snapshot.shadowExcludeReason
        : row.shadowExcludeReason,
    rawEvidenceJson:
      snapshot.rawEvidenceJson !== undefined
        ? snapshot.rawEvidenceJson
        : row.rawEvidenceJson,
    lastScoredAt: at,
    lastScoreStatus: "ok",
    lastError: null,
    updatedAt: at,
  };

  await db
    .update(schema.discoveryProductScores)
    .set(patch)
    .where(eq(schema.discoveryProductScores.id, row.id));

  return { ...row, ...patch };
}

/**
 * Record a failed refresh without clearing last-known score numbers.
 */
export async function applyFailedScoreRefresh(
  poolProductId: string,
  errorMessage: string,
): Promise<ScoreRow> {
  await ensureMigrated();
  const row = await ensureScoreRow(poolProductId);
  const at = nowIso();
  const patch = buildFailedScoreRefreshPatch(errorMessage, at);
  // Intentionally do NOT touch score numerics / lastScoredAt success stamp.

  await db
    .update(schema.discoveryProductScores)
    .set(patch)
    .where(eq(schema.discoveryProductScores.id, row.id));

  return { ...row, ...patch };
}

export async function getScoreForPoolProduct(
  poolProductId: string,
): Promise<ScoreRow | undefined> {
  await ensureMigrated();
  return db
    .select()
    .from(schema.discoveryProductScores)
    .where(eq(schema.discoveryProductScores.poolProductId, poolProductId))
    .then((rows) => rows[0]);
}

/**
 * Active pool scores keyed by catalogKey — Approach A shortlist read path.
 */
export async function loadScoresByCatalogKey(): Promise<
  Map<string, ScoreRow>
> {
  await ensureMigrated();
  const rows = await db
    .select({
      catalogKey: schema.discoveryProductPool.catalogKey,
      score: schema.discoveryProductScores,
    })
    .from(schema.discoveryProductScores)
    .innerJoin(
      schema.discoveryProductPool,
      eq(
        schema.discoveryProductScores.poolProductId,
        schema.discoveryProductPool.id,
      ),
    )
    .where(eq(schema.discoveryProductPool.active, true));

  const map = new Map<string, ScoreRow>();
  for (const row of rows) {
    map.set(row.catalogKey, row.score);
  }
  return map;
}
