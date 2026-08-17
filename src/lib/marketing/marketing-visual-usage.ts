/**
 * Wave 4 Phase 6a — monthly Marketing visual (Higgsfield) spend ledger (per workspace).
 * Separate from marketing_gemini_usage. Count successful Higgsfield runs later.
 *
 * Env: MARKETING_VISUAL_MONTHLY_CAP (default MARKETING_VISUAL_MONTHLY_CAP_DEFAULT).
 */

import { and, eq, sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { MARKETING_VISUAL_MONTHLY_CAP_DEFAULT } from "@/lib/constants";
import { currentMonthKey } from "@/lib/discovery/search-usage";
import { newId, nowIso } from "@/lib/ids";

export { currentMonthKey };

/**
 * Configured monthly visual allowance. Malformed / negative → 80.
 * Explicit 0 = no Generate later (Copy prompt only).
 */
export function resolveMarketingVisualMonthlyCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.MARKETING_VISUAL_MONTHLY_CAP?.trim();
  if (!raw) return MARKETING_VISUAL_MONTHLY_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return MARKETING_VISUAL_MONTHLY_CAP_DEFAULT;
  }
  return Math.floor(n);
}

export function remainingMarketingVisualAllowance(
  cap: number,
  used: number,
): number {
  return Math.max(0, cap - Math.max(0, used));
}

/** True when the workspace may spend one more successful Higgsfield run. */
export function canSpendMarketingVisualCall(
  cap: number,
  used: number,
): boolean {
  return remainingMarketingVisualAllowance(cap, used) > 0;
}

export type MonthlyMarketingVisualUsage = {
  workspaceId: string;
  monthKey: string;
  callsUsed: number;
};

/** Read the running total for a workspace month (absent = zero). */
export async function loadMarketingVisualUsage(
  workspaceId: string,
  monthKey: string = currentMonthKey(),
): Promise<MonthlyMarketingVisualUsage> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.marketingVisualUsage)
    .where(
      and(
        eq(schema.marketingVisualUsage.workspaceId, workspaceId),
        eq(schema.marketingVisualUsage.monthKey, monthKey),
      ),
    )
    .then((rows) => rows[0]);
  return { workspaceId, monthKey, callsUsed: row?.callsUsed ?? 0 };
}

/**
 * Whether this workspace can call Higgsfield now (under monthly visual cap).
 */
export async function checkMarketingVisualAllowance(
  workspaceId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true } | { ok: false; error: "monthly_cap" }> {
  const cap = resolveMarketingVisualMonthlyCap(env);
  const usage = await loadMarketingVisualUsage(workspaceId);
  if (!canSpendMarketingVisualCall(cap, usage.callsUsed)) {
    return { ok: false, error: "monthly_cap" };
  }
  return { ok: true };
}

/**
 * Add successful visual runs to the workspace month bucket (SQL increment).
 * Does not touch marketing_gemini_usage.
 */
export async function recordMarketingVisualCalls(input: {
  workspaceId: string;
  monthKey?: string;
  calls?: number;
}): Promise<MonthlyMarketingVisualUsage> {
  const monthKey = input.monthKey ?? currentMonthKey();
  const calls = Math.max(0, Math.floor(input.calls ?? 1));
  if (calls === 0) {
    return loadMarketingVisualUsage(input.workspaceId, monthKey);
  }

  await ensureMigrated();
  const at = nowIso();
  await db
    .insert(schema.marketingVisualUsage)
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
        schema.marketingVisualUsage.workspaceId,
        schema.marketingVisualUsage.monthKey,
      ],
      set: {
        callsUsed: sql`${schema.marketingVisualUsage.callsUsed} + ${calls}`,
        lastRunAt: at,
        updatedAt: at,
      },
    });

  return loadMarketingVisualUsage(input.workspaceId, monthKey);
}
