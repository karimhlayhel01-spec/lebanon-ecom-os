/**
 * Wave 4 Phase 7 — monthly Marketing Gemini spend ledger (per workspace).
 * Counts successful Intro fill + creatives kit improve (+ visual polish when
 * Gemini actually runs). Store pack Gemini is out of scope.
 *
 * Env: MARKETING_GEMINI_MONTHLY_CAP (default MARKETING_GEMINI_MONTHLY_CAP_DEFAULT).
 */

import { and, eq, sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { MARKETING_GEMINI_MONTHLY_CAP_DEFAULT } from "@/lib/constants";
import { currentMonthKey } from "@/lib/discovery/search-usage";
import { newId, nowIso } from "@/lib/ids";

export { currentMonthKey };

/**
 * Configured monthly allowance. Malformed / negative → safe default.
 * Explicit 0 = spend nothing.
 */
export function resolveMarketingGeminiMonthlyCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.MARKETING_GEMINI_MONTHLY_CAP?.trim();
  if (!raw) return MARKETING_GEMINI_MONTHLY_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return MARKETING_GEMINI_MONTHLY_CAP_DEFAULT;
  }
  return Math.floor(n);
}

export function remainingMarketingGeminiAllowance(
  cap: number,
  used: number,
): number {
  return Math.max(0, cap - Math.max(0, used));
}

/** True when the workspace may spend one more successful Marketing Gemini call. */
export function canSpendMarketingGeminiCall(
  cap: number,
  used: number,
): boolean {
  return remainingMarketingGeminiAllowance(cap, used) > 0;
}

export type MonthlyMarketingGeminiUsage = {
  workspaceId: string;
  monthKey: string;
  callsUsed: number;
};

/** Read the running total for a workspace month (absent = zero). */
export async function loadMarketingGeminiUsage(
  workspaceId: string,
  monthKey: string = currentMonthKey(),
): Promise<MonthlyMarketingGeminiUsage> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.marketingGeminiUsage)
    .where(
      and(
        eq(schema.marketingGeminiUsage.workspaceId, workspaceId),
        eq(schema.marketingGeminiUsage.monthKey, monthKey),
      ),
    )
    .then((rows) => rows[0]);
  return { workspaceId, monthKey, callsUsed: row?.callsUsed ?? 0 };
}

/**
 * Whether this workspace can call Marketing Gemini now (under monthly cap).
 */
export async function checkMarketingGeminiAllowance(
  workspaceId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true } | { ok: false; error: "monthly_cap" }> {
  const cap = resolveMarketingGeminiMonthlyCap(env);
  const usage = await loadMarketingGeminiUsage(workspaceId);
  if (!canSpendMarketingGeminiCall(cap, usage.callsUsed)) {
    return { ok: false, error: "monthly_cap" };
  }
  return { ok: true };
}

/**
 * True when used >= cap (for calm UI honesty). Does not block reads.
 */
export async function isMarketingGeminiCapReached(
  workspaceId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const cap = resolveMarketingGeminiMonthlyCap(env);
  const usage = await loadMarketingGeminiUsage(workspaceId);
  return !canSpendMarketingGeminiCall(cap, usage.callsUsed);
}

/**
 * Add successful calls to the workspace month bucket (SQL increment).
 */
export async function recordMarketingGeminiCalls(input: {
  workspaceId: string;
  monthKey?: string;
  calls?: number;
}): Promise<MonthlyMarketingGeminiUsage> {
  const monthKey = input.monthKey ?? currentMonthKey();
  const calls = Math.max(0, Math.floor(input.calls ?? 1));
  if (calls === 0) {
    return loadMarketingGeminiUsage(input.workspaceId, monthKey);
  }

  await ensureMigrated();
  const at = nowIso();
  await db
    .insert(schema.marketingGeminiUsage)
    .values({
      id: newId(),
      workspaceId: input.workspaceId,
      monthKey,
      callsUsed: calls,
      lastRunAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [
        schema.marketingGeminiUsage.workspaceId,
        schema.marketingGeminiUsage.monthKey,
      ],
      set: {
        callsUsed: sql`${schema.marketingGeminiUsage.callsUsed} + ${calls}`,
        lastRunAt: at,
        updatedAt: at,
      },
    });

  return loadMarketingGeminiUsage(input.workspaceId, monthKey);
}
