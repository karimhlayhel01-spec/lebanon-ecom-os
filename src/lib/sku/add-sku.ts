import { asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { nowIso } from "@/lib/ids";
import {
  evaluateAddSkuGate,
  shopTopicABarMet,
  shouldRequireExperiencedSeriousnessAck,
  type AddSkuGateResult,
  type ExperienceLevel,
  type WeekVerdict,
} from "@/lib/sku/add-sku-gate";
import { countLiveSkus, listLiveSkus } from "@/lib/sku/journey";
import {
  computeHealth,
  parsePerSkuSoldLeft,
  costBasisForSku,
  type CostBasis,
  type WeeklyInput,
} from "@/lib/finance/service";
import { getSkuViewById } from "@/lib/sku/service";

export type AddSkuEvaluation = AddSkuGateResult & {
  liveSkuCount: number;
  experience: ExperienceLevel;
  barMet: boolean;
  seriousnessWarning: boolean;
};

export type FinanceVerdictRow = {
  kind: string;
  payload: string;
};

/**
 * Shop weekly_health verdicts in weekStart order (oldest → newest).
 * Rows missing weekStart sort last; createdAt is ignored for the streak.
 */
export function extractWeekVerdictsOrderedByWeekStart(
  rows: readonly FinanceVerdictRow[],
): WeekVerdict[] {
  type Parsed = { weekStart: string | null; verdict: WeekVerdict };
  const parsed: Parsed[] = [];

  for (const v of rows) {
    if (v.kind !== "weekly_health") continue;
    try {
      const payload = JSON.parse(v.payload) as {
        weekStart?: unknown;
        health?: { verdict?: string };
      };
      const verdict = payload.health?.verdict;
      if (
        verdict !== "healthy" &&
        verdict !== "watch" &&
        verdict !== "risk"
      ) {
        continue;
      }
      const weekStart =
        typeof payload.weekStart === "string" && payload.weekStart.length > 0
          ? payload.weekStart
          : null;
      parsed.push({ weekStart, verdict });
    } catch {
      /* ignore bad payload */
    }
  }

  parsed.sort((a, b) => {
    if (a.weekStart == null && b.weekStart == null) return 0;
    if (a.weekStart == null) return 1;
    if (b.weekStart == null) return -1;
    return a.weekStart.localeCompare(b.weekStart);
  });

  return parsed.map((p) => p.verdict);
}

export type TopicARowForPreviousSku = {
  weekStart: string;
  storeTotalsUsd: number;
  metaSpend: number;
  tiktokSpend: number;
  courierFees: number;
  codCollected: number;
  codOutstanding: number;
  perSkuSoldLeft: string;
};

/**
 * Attribute one Topic A week to the previous live SKU for soft weak-signal.
 * Mode C: that SKU’s sales/sold + ads/courier by sales share of shop week.
 * Legacy (no skus map): whole week attributed to previousId.
 * Returns null when Mode C week has no line / no activity for that SKU.
 */
export function weeklyInputForPreviousSku(
  previousId: string,
  row: TopicARowForPreviousSku,
): WeeklyInput | null {
  const parsed = parsePerSkuSoldLeft(row.perSkuSoldLeft);
  const modeC = Object.keys(parsed.skus).length > 0;

  if (modeC) {
    const line = parsed.skus[previousId];
    if (!line) return null;
    const sales = Math.max(0, line.sales);
    const sold = Math.max(0, line.sold);
    if (sales <= 0 && sold <= 0) return null;

    const shopSales = Object.values(parsed.skus).reduce(
      (s, l) => s + Math.max(0, l.sales),
      0,
    );
    const share = shopSales > 0 ? sales / shopSales : 0;

    return {
      weekStart: row.weekStart,
      sales,
      orders: parsed.orders,
      metaSpend: row.metaSpend * share,
      tiktokSpend: row.tiktokSpend * share,
      codCollected: row.codCollected,
      codOutstanding: row.codOutstanding,
      courierFees: row.courierFees * share,
      skuSold: sold,
      skuLeft: line.left,
    };
  }

  const sales = row.storeTotalsUsd;
  const sold = parsed.skuSold;
  if (sales <= 0 && sold <= 0) return null;

  return {
    weekStart: row.weekStart,
    sales,
    orders: parsed.orders,
    metaSpend: row.metaSpend,
    tiktokSpend: row.tiktokSpend,
    codCollected: row.codCollected,
    codOutstanding: row.codOutstanding,
    courierFees: row.courierFees,
    skuSold: sold,
    skuLeft: parsed.skuLeft,
  };
}

/**
 * Soft signal: previous live SKU looks weak if ≥ half of its recent attributed
 * weeks are watch/risk. Pure — caller supplies recent Topic A rows + basis.
 */
export function previousSkuLooksWeakFromRows(
  previousId: string,
  recentRows: readonly TopicARowForPreviousSku[],
  basis: CostBasis,
): boolean {
  let weak = 0;
  let counted = 0;

  for (const row of recentRows) {
    const input = weeklyInputForPreviousSku(previousId, row);
    if (!input) continue;
    counted += 1;
    const health = computeHealth(input, basis);
    if (health.verdict !== "healthy") weak += 1;
  }

  return counted > 0 && weak >= Math.ceil(counted / 2);
}

/**
 * Soft signal: previous live SKU (#2 when adding #3+) looks weak if its recent
 * Topic A weeks are mostly watch/risk.
 */
async function previousSkuLooksWeak(
  workspaceId: string,
  liveSkuIds: string[],
): Promise<boolean> {
  if (liveSkuIds.length < 2) return false;
  const previousId = liveSkuIds[liveSkuIds.length - 1]!;
  const rows = await db
    .select()
    .from(schema.topicAEntries)
    .where(eq(schema.topicAEntries.workspaceId, workspaceId))
    .orderBy(asc(schema.topicAEntries.weekStart))
    .all();
  if (rows.length === 0) return false;

  const recent = rows.slice(-5);
  const sku = await getSkuViewById(workspaceId, previousId);
  const basis = sku
    ? costBasisForSku(sku)
    : { importCogsPerUnit: 0, usesQuotes: false };

  return previousSkuLooksWeakFromRows(previousId, recent, basis);
}

async function weekVerdictsForShop(
  workspaceId: string,
): Promise<WeekVerdict[]> {
  const verdicts = await db
    .select()
    .from(schema.financeVerdicts)
    .where(eq(schema.financeVerdicts.workspaceId, workspaceId))
    .all();

  return extractWeekVerdictsOrderedByWeekStart(verdicts);
}

/**
 * Evaluate whether the founder may start Add-SKU discovery.
 * Seriousness warning only when onboarding was raised TO experienced and ack
 * is still pending — not on every experienced add.
 */
export async function evaluateAddSku(
  workspaceId: string,
): Promise<AddSkuEvaluation> {
  ensureMigrated();
  const [liveCount, onboarding, weekVerdicts, live, side] = await Promise.all([
    countLiveSkus(workspaceId),
    db
      .select({ experience: schema.onboardingProfiles.experience })
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
    weekVerdictsForShop(workspaceId),
    listLiveSkus(workspaceId),
    db
      .select({
        experienceRaisedPendingAck:
          schema.sideStatuses.experienceRaisedPendingAck,
      })
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
  ]);

  const experience = (onboarding?.experience ?? "beginner") as ExperienceLevel;
  const previousSkuWeak = await previousSkuLooksWeak(
    workspaceId,
    live.map((s) => s.id),
  );

  const gate = evaluateAddSkuGate({
    experience,
    liveSkuCount: liveCount,
    weekVerdicts,
    previousSkuWeak,
  });

  const barMet = shopTopicABarMet(weekVerdicts);

  return {
    ...gate,
    liveSkuCount: liveCount,
    experience,
    barMet,
    seriousnessWarning: shouldRequireExperiencedSeriousnessAck(
      !!side?.experienceRaisedPendingAck,
    ),
  };
}

/** Clear the raised-to-experienced ack after founder confirms. */
export async function clearExperienceRaisedAck(
  workspaceId: string,
): Promise<void> {
  ensureMigrated();
  await db
    .update(schema.sideStatuses)
    .set({
      experienceRaisedPendingAck: false,
      updatedAt: nowIso(),
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
}

/**
 * Open discovery for a new SKU when the gate allows.
 * Does not accept a product — that still goes through Discovery accept.
 */
export async function startAddSku(
  workspaceId: string,
): Promise<
  | { ok: true; warning?: "early_add" | "watch_previous_sku" | "both" }
  | { ok: false; error: string }
> {
  const evaluation = await evaluateAddSku(workspaceId);
  if (!evaluation.ok) {
    return { ok: false, error: evaluation.error };
  }

  // Ensure a discovery session can open: close any stale open session first
  // so startDiscoverySession creates a fresh one for the new SKU.
  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.workspaceId, workspaceId));

  if (evaluation.seriousnessWarning) {
    await clearExperienceRaisedAck(workspaceId);
  }

  return { ok: true, warning: evaluation.warning };
}
