/**
 * Wave 2 §7 — monthly search-spend ledger.
 * Search spend is accounted per MONTH, not just per product: per-product caps
 * bound one row's cost but say nothing about a cron that runs all month.
 *
 * Checked before each query batch so a run stops cleanly at the cap (last-known
 * scores preserved, exit 0) instead of burning a paid quota.
 *
 * Env: DISCOVERY_SEARCH_MONTHLY_QUERY_CAP (default
 * DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT).
 */

import { eq, sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT } from "@/lib/constants";
import { newId, nowIso } from "@/lib/ids";

/** UTC month bucket, `YYYY-MM`. UTC so a cron never straddles two buckets. */
export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Configured monthly allowance. A malformed or negative value falls back to the
 * safe default rather than being read as "unlimited".
 */
export function resolveMonthlySearchQueryCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.DISCOVERY_SEARCH_MONTHLY_QUERY_CAP?.trim();
  if (!raw) return DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT;
  }
  return Math.floor(n);
}

export function remainingMonthlyAllowance(cap: number, used: number): number {
  return Math.max(0, cap - Math.max(0, used));
}

/**
 * How many queries the next batch may spend: never more than the batch wants,
 * never more than the month has left.
 */
export function allowanceForBatch(input: {
  cap: number;
  used: number;
  requested: number;
}): number {
  return Math.min(
    Math.max(0, input.requested),
    remainingMonthlyAllowance(input.cap, input.used),
  );
}

export type MonthlySearchUsage = {
  monthKey: string;
  queriesUsed: number;
};

/** Read the running total for a month (absent month = zero spent). */
export async function loadMonthlySearchUsage(
  monthKey: string = currentMonthKey(),
): Promise<MonthlySearchUsage> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.discoverySearchUsage)
    .where(eq(schema.discoverySearchUsage.monthKey, monthKey))
    .then((rows) => rows[0]);
  return { monthKey, queriesUsed: row?.queriesUsed ?? 0 };
}

/**
 * Add spend to the month bucket. Increments in SQL so two concurrent jobs
 * cannot both read 40 and both write 45, losing half the spend.
 */
export async function recordMonthlySearchQueries(input: {
  monthKey?: string;
  queries: number;
}): Promise<MonthlySearchUsage> {
  const monthKey = input.monthKey ?? currentMonthKey();
  const queries = Math.max(0, Math.floor(input.queries));
  if (queries === 0) return loadMonthlySearchUsage(monthKey);

  await ensureMigrated();
  const at = nowIso();
  await db
    .insert(schema.discoverySearchUsage)
    .values({
      id: newId(),
      monthKey,
      queriesUsed: queries,
      lastRunAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: schema.discoverySearchUsage.monthKey,
      set: {
        queriesUsed: sql`${schema.discoverySearchUsage.queriesUsed} + ${queries}`,
        lastRunAt: at,
        updatedAt: at,
      },
    });

  return loadMonthlySearchUsage(monthKey);
}
