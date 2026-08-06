import { and, asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  DISCOVERY_FALLBACK_SHORTLIST_MIN,
  DISCOVERY_INITIAL_COUNT,
  DISCOVERY_SESSION_CAP,
  DISCOVERY_SHOW_MORE_MAX,
  MAX_LANDED_SOFT_OVERAGE,
} from "@/lib/constants";
import { computeShowMoreRemaining } from "@/lib/discovery/show-more";
import { computeFit, type FitProfile } from "@/lib/skills/fit";
import { computeMargin } from "@/lib/skills/margin";
import {
  CATALOG,
  getCatalogProduct,
  localizedProduct,
  type CatalogProduct,
} from "@/lib/discovery/catalog";
import {
  resolveDiscoveryCatalogSource,
  loadPoolHintsByCatalogKey,
  loadPoolProductsByCatalogKeys,
} from "@/lib/discovery/pool";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
  isSoftCompetitionBudgetEnabled,
} from "@/lib/discovery/flags";
import { loadScoresByCatalogKey } from "@/lib/discovery/scores";

import {
  evaluateAcceptDemandGate,
  evaluateSystemDemandGate,
  isAcceptReadyForShortlist,
  isSystemDemandGateEnabled,
  resolveSystemDemandInput,
  type SystemDemandGateResult,
} from "@/lib/discovery/dual-gate";
import {
  isGeminiConfigured,
  isSuggestionExplainEnabled,
} from "@/lib/discovery/explain/llm";
import {
  rankWave2Shortlist,
  type Wave2RankedProduct,
} from "@/lib/discovery/scoring/rank";
import type { OkayReason } from "@/lib/discovery/scoring/composite";
import {
  classifyDiscoveryLadder,
  suggestionsForPassReasons,
  type DiscoveryLadder,
  type DiscoveryPassReason,
} from "@/lib/discovery/ladder";
import {
  createApprovalRequest,
  decideApproval,
} from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import { buildSkuSections, footprintForCatalogKey } from "@/lib/sku/service";
import {
  countLiveSkus,
  createSkuJourney,
} from "@/lib/sku/journey";
import type { AppLocale } from "@/i18n/routing";
import {
  computeSourceCostHint,
  type SourceCostHint,
} from "@/lib/discovery/local-hint";

export type { SourceCostHint } from "@/lib/discovery/local-hint";

export type { DiscoveryLadder, DiscoveryPassReason } from "@/lib/discovery/ladder";
export {
  classifyDiscoveryLadder,
  DISCOVERY_PASS_REASONS,
  suggestionsForPassReasons,
} from "@/lib/discovery/ladder";

type OnboardingRow = typeof schema.onboardingProfiles.$inferSelect;
type CandidateRow = typeof schema.productCandidates.$inferSelect;

function toFitProfile(onboarding: OnboardingRow): FitProfile {
  let likes: string[] = [];
  try {
    const parsed = JSON.parse(onboarding.categoryLikes);
    if (Array.isArray(parsed)) likes = parsed.map(String);
  } catch {
    likes = [];
  }
  return {
    maxLandedCost: onboarding.maxLandedCost,
    experience: onboarding.experience as FitProfile["experience"],
    riskTolerance: onboarding.riskTolerance as FitProfile["riskTolerance"],
    hoursPerWeek: onboarding.hoursPerWeek,
    categoryLikes: likes,
  };
}

export function landedCostOf(p: CatalogProduct): number {
  return p.productCost + p.intlShip + p.clearanceTaxes + p.localCourier;
}

/** Pool/catalog fields needed for LIVE_SEARCH-off heuristic demand gate. */
function heuristicFieldsFromProduct(p: CatalogProduct) {
  return {
    catalogKey: p.key,
    category: p.category,
    difficulty: p.difficulty,
    risk: p.risk,
    tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
    nameEn: p.en.name,
  };
}

/**
 * Fix #2 — select the discovery source pool by per-unit landed cost.
 *
 * Products at or under `maxLandedCost × MAX_LANDED_SOFT_OVERAGE` stay in (the
 * soft budget Fit penalty handles "slightly over"); products way over are
 * hard-excluded. Never all-blocked: if the band is empty (maxLandedCost set so
 * low that every product is way over), fall back to the least-over products
 * (cheapest landed cost first) so Discovery is never a blank dead-end.
 */
export function selectLandedCostPool(
  catalog: readonly CatalogProduct[],
  maxLandedCost: number,
): CatalogProduct[] {
  const overageCeiling = maxLandedCost * MAX_LANDED_SOFT_OVERAGE;
  const withinBand = catalog.filter((p) => landedCostOf(p) <= overageCeiling);
  if (withinBand.length > 0) return withinBand;
  return [...catalog].sort((a, b) => landedCostOf(a) - landedCostOf(b));
}

export async function getActiveSession(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.discoverySessions)
    .where(
      and(
        eq(schema.discoverySessions.workspaceId, workspaceId),
        eq(schema.discoverySessions.status, "active"),
      ),
    )
    .then((rows) => rows[0]);
}

/** Number of candidates generated for a session (the reveal pool size). */
async function poolSize(sessionId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.productCandidates.id })
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.sessionId, sessionId))
    ;
  return rows.length;
}

function catalogKeyFromCandidate(row: {
  fitBreakdown: string;
}): string | null {
  try {
    const key = JSON.parse(row.fitBreakdown).catalogKey;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}

/** Catalog keys already shown/rejected/accepted in this workspace. */
export async function getSeenCatalogKeys(
  workspaceId: string,
): Promise<Set<string>> {
  await ensureMigrated();
  const rows = await db
    .select({ fitBreakdown: schema.productCandidates.fitBreakdown })
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.workspaceId, workspaceId))
    ;
  const keys = new Set<string>();
  for (const row of rows) {
    const key = catalogKeyFromCandidate(row);
    if (key) keys.add(key);
  }
  return keys;
}

type ScoredProduct = {
  p: CatalogProduct;
  landedCost: number;
  fit: ReturnType<typeof computeFit>;
  margin: ReturnType<typeof computeMargin>;
  /** Wave 2 listing strength when pool v2 ranking applied. */
  strength?: "Strong" | "Okay";
  riskRead?: string | null;
  /** Wave 2: why Okay (confidence / competition / Fit / multiple). */
  okayReason?: OkayReason | null;
  notRecommended?: boolean;
  wave2?: {
    compositeScore: number;
    explain: Wave2RankedProduct["explain"];
    fallbackUsed: boolean;
    okayReason: OkayReason | null;
  };
};

/**
 * Score + rank catalog products for a profile. Excludes seen keys.
 * Shortlist = accept-ready only (hard margins + !oversized) — Wave 1 path
 * when DISCOVERY_POOL_V2 is off. No blocked cards for browsing.
 * `catalog` defaults to in-memory CATALOG; pool-v2 callers pass the DB source.
 */
export function scoreRankCatalog(
  onboarding: OnboardingRow,
  excludeKeys: ReadonlySet<string> = new Set(),
  catalog: readonly CatalogProduct[] = CATALOG,
): ScoredProduct[] {
  const profile = toFitProfile(onboarding);
  const sourceCatalog = selectLandedCostPool(
    catalog,
    onboarding.maxLandedCost,
  ).filter((p) => !excludeKeys.has(p.key));

  const scored = sourceCatalog
    .map((p) => {
      const landedCost = landedCostOf(p);
      const fit = computeFit(profile, {
        category: p.category,
        landedCost,
        difficulty: p.difficulty,
        risk: p.risk,
        timeNeed: p.timeNeed,
        workload: p.workload,
        storageFootprint: p.storageFootprint,
      });
      const margin = computeMargin({
        sellPrice: p.sellPrice,
        productCost: p.productCost,
        intlShip: p.intlShip,
        clearanceTaxes: p.clearanceTaxes,
        localCourier: p.localCourier,
        monthlyFollowOnBudget: onboarding.monthlyFollowOnBudget,
      });
      return { p, landedCost, fit, margin };
    })
    .filter(
      (s) =>
        isAcceptReadyForShortlist({
          marginsPass: s.margin.pass,
          oversized: s.p.oversized,
          fitNotRecommended: s.fit.notRecommended,
          system: null,
          systemGateEnabled: false,
        }),
    );

  scored.sort((a, b) => b.fit.score - a.fit.score);

  return scored;
}

/**
 * Wave 2 Approach A: read score cache + composite skills when pool v2 is on.
 * Flags off → identical to Wave 1 `scoreRankCatalog`.
 */
export async function scoreRankForDiscovery(
  onboarding: OnboardingRow,
  excludeKeys: ReadonlySet<string> = new Set(),
): Promise<ScoredProduct[]> {
  const catalog = await resolveDiscoveryCatalogSource();

  if (!isDiscoveryPoolV2Enabled()) {
    return scoreRankCatalog(onboarding, excludeKeys, catalog);
  }

  const sourceCatalog = selectLandedCostPool(
    catalog,
    onboarding.maxLandedCost,
  ).filter((p) => !excludeKeys.has(p.key));

  const [scoresByKey, hintsByKey] = await Promise.all([
    loadScoresByCatalogKey(),
    loadPoolHintsByCatalogKey(),
  ]);

  const ranked = rankWave2Shortlist(
    {
      ...toFitProfile(onboarding),
      budgetUsd: onboarding.budgetUsd,
      monthlyFollowOnBudget: onboarding.monthlyFollowOnBudget,
    },
    sourceCatalog,
    scoresByKey,
    hintsByKey,
    isSoftCompetitionBudgetEnabled(),
    {
      systemGateEnabled: true,
      liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
    },
  );

  return ranked.map((r) => ({
    p: r.p,
    landedCost: r.landedCost,
    fit: {
      ...r.fit,
      strength: r.strength,
      riskRead: r.riskRead,
      notRecommended: r.notRecommended,
    },
    margin: r.margin,
    strength: r.strength,
    riskRead: r.riskRead,
    okayReason: r.okayReason,
    notRecommended: r.notRecommended,
    wave2: {
      compositeScore: r.compositeScore,
      explain: r.explain,
      fallbackUsed: r.fallbackUsed,
      okayReason: r.okayReason,
    },
  }));
}

export async function countRemainingEligible(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<number> {
  const seen = await getSeenCatalogKeys(workspaceId);
  return (await scoreRankForDiscovery(onboarding, seen)).length;
}

async function getExhaustedRounds(workspaceId: string): Promise<number> {
  const side = await db
    .select({
      discoveryExhaustedRounds: schema.sideStatuses.discoveryExhaustedRounds,
    })
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  return side?.discoveryExhaustedRounds ?? 0;
}

export async function resetDiscoveryExhaustedRounds(
  workspaceId: string,
): Promise<void> {
  await ensureMigrated();
  await db
    .update(schema.sideStatuses)
    .set({ discoveryExhaustedRounds: 0, updatedAt: nowIso() })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
}

/**
 * When the visible list is empty and show-more is done, count this session
 * once toward the exhausted-round ladder.
 */
async function maybeCountExhaustion(workspaceId: string): Promise<void> {
  const session = await getActiveSession(workspaceId);
  if (!session || session.exhaustionCounted) return;

  const total = await poolSize(session.id);
  const cap = Math.min(DISCOVERY_SESSION_CAP, total);
  const canShowMore =
    session.productsShown < cap &&
    session.showMoreUsed < DISCOVERY_SHOW_MORE_MAX;

  const shownRows = await db
    .select({
      id: schema.productCandidates.id,
      rank: schema.productCandidates.rank,
    })
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.sessionId, session.id),
        eq(schema.productCandidates.status, "shown"),
      ),
    )
    ;
  const visibleCount = shownRows.filter(
    (r) => r.rank < session.productsShown,
  ).length;

  if (visibleCount > 0 || canShowMore) return;

  const rounds = await getExhaustedRounds(workspaceId);
  await db
    .update(schema.discoverySessions)
    .set({ exhaustionCounted: true })
    .where(eq(schema.discoverySessions.id, session.id));
  await db
    .update(schema.sideStatuses)
    .set({
      discoveryExhaustedRounds: rounds + 1,
      updatedAt: nowIso(),
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
}

async function insertSessionPool(
  workspaceId: string,
  scored: ScoredProduct[],
): Promise<typeof schema.discoverySessions.$inferSelect | undefined> {
  const pool = scored.slice(0, DISCOVERY_SESSION_CAP);
  // Empty accept-ready pool is allowed — UI shows Edit onboarding (WAVE-2 §8).

  const sessionId = newId();
  const createdAt = nowIso();
  await db.insert(schema.discoverySessions).values({
    id: sessionId,
    workspaceId,
    showMoreUsed: 0,
    productsShown: Math.min(DISCOVERY_INITIAL_COUNT, pool.length),
    status: "active",
    exhaustionCounted: false,
    createdAt,
  });

  if (pool.length > 0) {
    await db.insert(schema.productCandidates).values(
      pool.map(({ p, fit, margin, strength, riskRead, okayReason, notRecommended, wave2 }, i) => ({
        id: newId(),
        workspaceId,
        sessionId,
        name: p.en.name,
        category: p.category,
        summary: p.en.summary,
        sellPrice: p.sellPrice,
        productCost: p.productCost,
        intlShip: p.intlShip,
        clearanceTaxes: p.clearanceTaxes,
        localCourier: p.localCourier,
        marginBefore: margin.marginBefore,
        marginAfter: margin.marginAfter,
        // Wave 1 accept gate — hard Shared Margin skill (unchanged this pass).
        marginsPass: margin.pass,
        marginBlockReason: margin.blockReason,
        fitScore: fit.score,
        fitBreakdown: JSON.stringify({
          dims: fit.breakdown,
          catalogKey: p.key,
          ...(wave2
            ? {
                wave2: {
                  compositeScore: wave2.compositeScore,
                  fallbackUsed: wave2.fallbackUsed,
                  explain: wave2.explain,
                  okayReason: wave2.okayReason ?? okayReason ?? null,
                },
              }
            : okayReason
              ? { okayReason }
              : {}),
        }),
        strength: strength ?? fit.strength,
        riskRead: riskRead !== undefined ? riskRead : fit.riskRead,
        differentiation: p.en.differentiation,
        tier1Conflict: p.tier1Marketplaces.length > 0,
        tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
        oversizedHardBlock: p.oversized,
        notRecommended:
          notRecommended !== undefined ? notRecommended : fit.notRecommended,
        demandConfirmed: false,
        status: "shown" as const,
        rank: i,
        createdAt,
      })),
    );
  }

  return getActiveSession(workspaceId);
}

/**
 * Start a discovery session: score against the founder's profile + hard
 * margin / demand gates, shortlist accept-ready products only, reveal first 5.
 * Zero accept-ready → empty session + Edit onboarding in the UI.
 */
export async function startDiscoverySession(
  workspaceId: string,
  onboarding: OnboardingRow,
) {
  await ensureMigrated();

  const existing = await getActiveSession(workspaceId);
  if (existing) {
    return existing;
  }

  const scored = await scoreRankForDiscovery(onboarding, new Set());
  return insertSessionPool(workspaceId, scored);
}

/**
 * Fix #13 B — close the exhausted session and open a new one with the same
 * onboarding filters, excluding catalog keys already seen in this workspace.
 */
export async function continueDiscoverySession(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<{ ok: true } | { ok: false; error: "no_session" | "catalog_exhausted" }> {
  await ensureMigrated();

  const existing = await getActiveSession(workspaceId);
  if (!existing) return { ok: false, error: "no_session" };

  await maybeCountExhaustion(workspaceId);


  const result = await closeAndOpenScoredSession(
    workspaceId,
    onboarding,
    existing.id,
  );
  return result.ok ? { ok: true } : result;
}

/**
 * POOL_V2 only — founder-triggered resync from live pool + Approach A scores.
 *
 * Rules (see docs/WAVE-2.md §10.3 / README):
 * - Closes the active session and inserts a new shortlist from `scoreRankForDiscovery`.
 * - Excludes workspace-seen catalog keys (shown / rejected / accepted) — same as Continue.
 * - Does **not** increment exhausted-round ladder.
 * - Reject / show-more / accept on the new session behave as usual.
 * - Flag off → `{ error: "pool_v2_off" }` (UI hidden).
 */
export async function refreshDiscoverySuggestions(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<
  | { ok: true; sessionId: string }
  | {
      ok: false;
      error: "no_session" | "catalog_exhausted" | "pool_v2_off";
    }
> {
  if (!isDiscoveryPoolV2Enabled()) {
    return { ok: false, error: "pool_v2_off" };
  }

  await ensureMigrated();

  const existing = await getActiveSession(workspaceId);
  if (!existing) return { ok: false, error: "no_session" };

  const result = await closeAndOpenScoredSession(
    workspaceId,
    onboarding,
    existing.id,
    "post-fix",
  );
  return result;
}

async function closeAndOpenScoredSession(
  workspaceId: string,
  onboarding: OnboardingRow,
  existingSessionId: string,
  runId = "pre-fix",
): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; error: "catalog_exhausted" }
> {
  // Score next pool before closing. Empty accept-ready → still open empty
  // session so the UI can show Edit onboarding (not keep soft-listed leftovers).
  void runId;
  const seen = await getSeenCatalogKeys(workspaceId);
  const scored = await scoreRankForDiscovery(onboarding, seen);

  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.id, existingSessionId));

  const session = await insertSessionPool(workspaceId, scored);
  if (!session) return { ok: false, error: "catalog_exhausted" };
  return { ok: true, sessionId: session.id };
}

export async function submitDiscoveryPassFeedback(
  workspaceId: string,
  input: { reasons: DiscoveryPassReason[]; otherNote?: string },
): Promise<{ ok: true } | { ok: false; error: "empty" }> {
  await ensureMigrated();
  if (input.reasons.length === 0 && !input.otherNote?.trim()) {
    return { ok: false, error: "empty" };
  }
  const suggestions = suggestionsForPassReasons(input.reasons);
  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "discovery_pass_feedback",
    message: "Founder shared why they passed on Discovery matches",
    meta: JSON.stringify({
      reasons: input.reasons,
      otherNote: input.otherNote?.trim() || null,
      suggestions,
    }),
    createdAt: nowIso(),
  });
  return { ok: true };
}

/** Reveal the next batch (5). Cap is productsShown; click max is a secondary guard. */
export async function showMore(workspaceId: string) {
  await ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return;

  const total = await poolSize(session.id);
  const cap = Math.min(DISCOVERY_SESSION_CAP, total);
  if (
    session.productsShown >= cap ||
    session.showMoreUsed >= DISCOVERY_SHOW_MORE_MAX
  ) {
    await maybeCountExhaustion(workspaceId);
    return;
  }

  await db
    .update(schema.discoverySessions)
    .set({
      productsShown: Math.min(cap, session.productsShown + DISCOVERY_INITIAL_COUNT),
      showMoreUsed: session.showMoreUsed + 1,
    })
    .where(eq(schema.discoverySessions.id, session.id));
  await maybeCountExhaustion(workspaceId);
}

export async function getCandidateOwned(
  workspaceId: string,
  candidateId: string,
): Promise<CandidateRow | undefined> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.id, candidateId))
    .then((rows) => rows[0]);
  if (!row || row.workspaceId !== workspaceId) return undefined;
  return row;
}

export async function resolveTier1(
  workspaceId: string,
  candidateId: string,
  choice: "customize" | "drop",
): Promise<{ ok: boolean; error?: string }> {
  await ensureMigrated();
  const candidate = await getCandidateOwned(workspaceId, candidateId);
  if (!candidate) return { ok: false, error: "not_found" };
  if (!candidate.tier1Conflict) return { ok: true };

  // Side-only Human Approval gate — records the customize/drop decision.
  const approval = await createApprovalRequest(
    workspaceId,
    "tier1_customize_or_drop",
    {
      data: { candidateId, choice, productName: candidate.name },
      requiredAcks: ["tier1_choice"],
    },
  );
  if (!approval) return { ok: false, error: "error" };

  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: ["tier1_choice"],
    note: choice,
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  if (choice === "drop") {
    await db
      .update(schema.productCandidates)
      .set({ status: "rejected" })
      .where(eq(schema.productCandidates.id, candidateId));
  } else {
    // Customize with supplier: clear the conflict so the product can proceed.
    await db
      .update(schema.productCandidates)
      .set({ tier1Conflict: false })
      .where(eq(schema.productCandidates.id, candidateId));
  }

  await db
    .update(schema.sideStatuses)
    .set({ tier1Resolved: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "tier1_resolution",
    message: `Tier-1 ${choice} for ${candidate.name}`,
    meta: JSON.stringify({ candidateId, choice }),
    createdAt: now,
  });

  return { ok: true };
}

export async function rejectCandidate(
  workspaceId: string,
  candidateId: string,
): Promise<{ ok: boolean; error?: string }> {
  await ensureMigrated();
  const candidate = await getCandidateOwned(workspaceId, candidateId);
  if (!candidate) return { ok: false, error: "not_found" };
  await db
    .update(schema.productCandidates)
    .set({ status: "rejected" })
    .where(eq(schema.productCandidates.id, candidateId));
  await maybeCountExhaustion(workspaceId);
  return { ok: true };
}

export type AcceptResult =
  | { ok: true; skuId: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "wrong_state"
        | "blocked"
        | "tier1_unresolved"
        | "needs_system_demand_missing"
        | "needs_system_demand_weak"
        /** @deprecated Prefer needs_system_demand_missing / _weak */
        | "needs_system_demand"
        | "needs_risk_ack"
        | "error";
    };

/**
 * Accept a product through the Human Approvals `accept_product` gate. On
 * approval the SKU journey advances to supplier_sample and Topic B basics +
 * active SKU + side status are written. Works for first SKU (workspace in
 * discovery) and for add-SKU (additional live SKUs while others continue).
 *
 * Paste demand confirm is REMOVED. Wave 2 (POOL_V2): system demand/score gate.
 * Wave 1 (flag off): margins / Tier-1 / oversized only (no paste).
 */
export async function acceptProduct(
  workspaceId: string,
  candidateId: string,
  riskReadAck: boolean,
): Promise<AcceptResult> {
  await ensureMigrated();

  const candidate = await getCandidateOwned(workspaceId, candidateId);
  if (!candidate || candidate.status !== "shown") {
    return { ok: false, error: "not_found" };
  }

  const liveCount = await countLiveSkus(workspaceId);
  const journey = await getJourney(workspaceId);

  // First SKU: workspace must still be in discovery (or no SKU journey yet).
  // Add-SKU: discovery session is open while other SKUs keep their states.
  if (liveCount === 0) {
    const state = journey?.primaryState;
    if (state && state !== "discovery" && state !== "paused") {
      return { ok: false, error: "wrong_state" };
    }
  }

  if (candidate.oversizedHardBlock || !candidate.marginsPass) {
    return { ok: false, error: "blocked" };
  }
  if (candidate.tier1Conflict) {
    return { ok: false, error: "tier1_unresolved" };
  }

  let catalogKey = "";
  try {
    catalogKey = JSON.parse(candidate.fitBreakdown).catalogKey ?? "";
  } catch {
    catalogKey = "";
  }

  let systemScore: Parameters<typeof evaluateAcceptDemandGate>[0]["system"] =
    null;
  if (isSystemDemandGateEnabled() && catalogKey) {
    const scoresByKey = await loadScoresByCatalogKey();
    const row = scoresByKey.get(catalogKey);
    const cache = row
      ? {
          abroadDemandScore: row.abroadDemandScore,
          lebanonDemandScore: row.lebanonDemandScore,
          demandPath: row.demandPath,
          compositeScore: row.compositeScore,
          lastScoreStatus: row.lastScoreStatus,
          confidence: row.confidence,
        }
      : null;
    const product =
      getCatalogProduct(catalogKey) ??
      (await loadPoolProductsByCatalogKeys([catalogKey])).get(catalogKey);
    systemScore = resolveSystemDemandInput({
      cache,
      heuristicProduct: product ? heuristicFieldsFromProduct(product) : null,
      liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
    });
  }

  const demandGate = evaluateAcceptDemandGate({ system: systemScore });
  if (!demandGate.ok && demandGate.error) {
    return { ok: false, error: demandGate.error };
  }

  const requiredAcks = candidate.strength === "Okay" ? ["okay_risk_read"] : [];
  // Pre-check the acknowledgement so we never open a lingering pending gate.
  if (requiredAcks.length > 0 && !riskReadAck) {
    return { ok: false, error: "needs_risk_ack" };
  }

  const approval = await createApprovalRequest(workspaceId, "accept_product", {
    data: {
      candidateId,
      productName: candidate.name,
      systemDemandGate: demandGate.systemGateEnabled,
      systemDemandPath: demandGate.system.demandPath,
    },
    requiredAcks,
    // skuId filled after insert — advance via workspace until SKU exists, then
    // we create the sku journey at supplier_sample directly (gate still records).
  });
  if (!approval) return { ok: false, error: "error" };

  // For add-SKU, skip FSM advance on workspace (other SKUs aren't in discovery).
  // Decide approval without relying on workspace FSM when liveCount > 0.
  if (liveCount === 0) {
    const decided = await decideApproval(approval.id, {
      type: "approve",
      acknowledgements: requiredAcks,
    });
    if (!decided.ok) {
      return {
        ok: false,
        error:
          decided.error === "missing_acknowledgements"
            ? "needs_risk_ack"
            : "error",
      };
    }
  } else {
    // Mark approval approved without workspace advance (SKU journey created below).
    const decided = await decideApproval(approval.id, {
      type: "approve",
      acknowledgements: requiredAcks,
    });
    // transition_failed is expected when workspace isn't in discovery — continue.
    if (
      !decided.ok &&
      decided.error !== "transition_failed" &&
      decided.error !== "missing_acknowledgements"
    ) {
      return { ok: false, error: "error" };
    }
    if (!decided.ok && decided.error === "missing_acknowledgements") {
      return { ok: false, error: "needs_risk_ack" };
    }
    if (!decided.ok && decided.error === "transition_failed") {
      // Manually commit the approval row — decideApproval aborted before commit.
      await db
        .update(schema.approvalRequests)
        .set({
          status: "approved",
          acknowledgements: JSON.stringify(requiredAcks),
          decidedAt: nowIso(),
        })
        .where(eq(schema.approvalRequests.id, approval.id));
    }
  }

  const landedCost =
    candidate.productCost +
    candidate.intlShip +
    candidate.clearanceTaxes +
    candidate.localCourier;
  const now = nowIso();
  const skuId = newId();

  const sections = buildSkuSections({
    name: candidate.name,
    category: candidate.category,
    sellPrice: candidate.sellPrice,
    landedCost,
    marginBefore: candidate.marginBefore,
    marginAfter: candidate.marginAfter,
    differentiation: candidate.differentiation,
    oversized: candidate.oversizedHardBlock,
    footprint: footprintForCatalogKey(catalogKey),
    productCost: candidate.productCost,
    intlShip: candidate.intlShip,
    clearanceTaxes: candidate.clearanceTaxes,
    localCourier: candidate.localCourier,
  });

  await db.insert(schema.skuCards).values({
    id: skuId,
    workspaceId,
    productCandidateId: candidate.id,
    name: candidate.name,
    basics: sections.basics,
    shipFitness: sections.shipFitness,
    storageAmbiance: sections.storageAmbiance,
    handling: sections.handling,
    importBatch: sections.importBatch,
    moneySnapshot: sections.moneySnapshot,
    marketingHooks: sections.marketingHooks,
    founderNotes: "",
    lifecycleStatus: "live",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await createSkuJourney({
    workspaceId,
    skuId,
    primaryState: "supplier_sample",
    okayRiskAck: candidate.strength === "Okay",
  });

  // Link approval to the new SKU for history.
  await db
    .update(schema.approvalRequests)
    .set({ skuId })
    .where(eq(schema.approvalRequests.id, approval.id));

  await db
    .update(schema.workspaces)
    .set({ activeSkuId: skuId })
    .where(eq(schema.workspaces.id, workspaceId));

  await db
    .update(schema.sideStatuses)
    .set({
      productAccepted: true,
      discoveryExhaustedRounds: 0,
      ...(candidate.strength === "Okay" ? { okayRiskAck: true } : {}),
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  // Mirror first-SKU accept onto legacy workspace journey when needed.
  if (liveCount === 0) {
    await db
      .update(schema.journeyStates)
      .set({
        primaryState: "supplier_sample",
        pausedFromState: null,
        blockedFromState: null,
        blockedReason: null,
        updatedAt: now,
      })
      .where(eq(schema.journeyStates.workspaceId, workspaceId));
  }

  await db
    .update(schema.productCandidates)
    .set({ status: "accepted" })
    .where(eq(schema.productCandidates.id, candidate.id));

  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.workspaceId, workspaceId));

  return { ok: true, skuId };
}

// ---------------------------------------------------------------------------
// Read model for the UI
// ---------------------------------------------------------------------------

export type DiscoveryCandidateView = {
  id: string;
  name: string;
  summary: string;
  differentiation: string;
  category: string;
  sellPrice: number;
  landedCost: number;
  marginBefore: number;
  marginAfter: number;
  marginsPass: boolean;
  /** Space-separated `@margin.*` note keys (or legacy English); UI translates. */
  marginBlockReason: string | null;
  oversized: boolean;
  fitScore: number;
  strength: "Strong" | "Okay";
  /**
   * Why overall recommendation is Okay (Wave 2). Null when Strong or Wave 1 Fit-only.
   */
  okayReason: OkayReason | null;
  /** `@fit.*` / `@listing.*` note key (or legacy English); UI translates. */
  riskRead: string | null;
  notRecommended: boolean;
  /** @deprecated Paste demand confirm removed — kept for schema/read compat. */
  demandConfirmed: boolean;
  /** @deprecated Paste summaries no longer shown on cards. */
  demandSummary: string | null;
  tier1Conflict: boolean;
  tier1Marketplaces: string[];
  /**
   * H1: Import vs Local planning hint only. Accept / Strong / Okay stay on
   * import `marginsPass` / moneySnapshot — never unlock via local-only margins.
   */
  sourceCostHint: SourceCostHint | null;
  /** Wave 2 system demand/score gate active (POOL_V2). */
  systemDemandGate: boolean;
  /** @deprecated Alias of systemDemandGate (paste dual-gate removed). */
  dualDemandGate: boolean;
  /** System demand/score gate status when POOL_V2 on. */
  systemDemand: SystemDemandGateResult | null;
  /**
   * @deprecated Soft-list browsing removed — always false (accept-ready only).
   */
  softListedHardAcceptBlocked: boolean;
};

/** Soft Edit-onboarding banner when accept-ready shortlist is empty or thin. */
export type EditOnboardingBanner = "zero_accept_ready" | "thin_accept_ready";

export type DiscoveryView = {
  sessionId: string;
  productsShown: number;
  showMoreRemaining: number;
  canShowMore: boolean;
  sessionCap: number;
  candidates: DiscoveryCandidateView[];
  /** A–D empty-state ladder when the visible list is empty. */
  ladder: DiscoveryLadder | null;
  exhaustedRounds: number;
  remainingEligible: number;
  /**
   * WAVE-2 §8 — Edit onboarding when profile/budget/Fit leaves 0 or too few
   * accept-ready products (never strand on blocked cards).
   */
  editOnboardingBanner: EditOnboardingBanner | null;
  /** WAVE-2 §6.1 “Why we suggested this” (POOL_V2) — Gemini required. */
  suggestionExplainEnabled: boolean;
  /** True when GEMINI_API_KEY / DISCOVERY_EXPLAIN_GEMINI_API_KEY is set. */
  geminiConfigured: boolean;
  /** @deprecated Use suggestionExplainEnabled. */
  whyPickEnabled: boolean;
  /**
   * POOL_V2: founder can close this session and resync shortlist from live
   * pool + Approach A scores (excludes seen keys).
   */
  canRefreshSuggestions: boolean;
};

export async function getDiscoveryView(
  workspaceId: string,
  locale: AppLocale,
): Promise<DiscoveryView | null> {
  await ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return null;

  await maybeCountExhaustion(workspaceId);
  // Re-read session after possible exhaustion_counted write (rounds may bump).
  const freshSession = (await getActiveSession(workspaceId)) ?? session;

  const rows = await db
    .select()
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.sessionId, freshSession.id),
        eq(schema.productCandidates.status, "shown"),
      ),
    )
    .orderBy(asc(schema.productCandidates.rank))
    ;

  const visible = rows.filter((r) => r.rank < freshSession.productsShown);
  const cap = Math.min(DISCOVERY_SESSION_CAP, await poolSize(freshSession.id));
  const canShowMore =
    freshSession.productsShown < cap &&
    freshSession.showMoreUsed < DISCOVERY_SHOW_MORE_MAX;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  const remainingEligible = onboarding
    ? await countRemainingEligible(workspaceId, onboarding)
    : 0;
  const exhaustedRounds = await getExhaustedRounds(workspaceId);

  const systemGateEnabled = isSystemDemandGateEnabled();
  const suggestionEnabled = isSuggestionExplainEnabled();
  const geminiConfigured = isGeminiConfigured();
  const canRefreshSuggestions = isDiscoveryPoolV2Enabled();
  const scoresByKey = systemGateEnabled
    ? await loadScoresByCatalogKey()
    : new Map();

  // Path 1 keys missing from catalog.ts: resolve text for visible cards only
  // (keyed batch — O(visible), not a full active-pool scan on the view path).
  const visibleCatalogKeys: string[] = [];
  for (const r of visible) {
    try {
      const breakdown = JSON.parse(r.fitBreakdown);
      const key = breakdown.catalogKey;
      if (typeof key === "string" && key.length > 0) visibleCatalogKeys.push(key);
    } catch {
      /* ignore malformed breakdown */
    }
  }
  const poolByKey = isDiscoveryPoolV2Enabled()
    ? await loadPoolProductsByCatalogKeys(visibleCatalogKeys)
    : new Map<string, CatalogProduct>();

  const mapped = visible.map((r) => {
    let catalogKey = "";
    let okayReason: OkayReason | null = null;
    try {
      const breakdown = JSON.parse(r.fitBreakdown) as {
        catalogKey?: string;
        okayReason?: string;
        wave2?: { okayReason?: string };
      };
      catalogKey = breakdown.catalogKey ?? "";
      const raw =
        breakdown.wave2?.okayReason ?? breakdown.okayReason ?? null;
      if (
        raw === "fit_risk" ||
        raw === "low_evidence_confidence" ||
        raw === "high_competition"
      ) {
        okayReason = raw;
      }
    } catch {
      catalogKey = "";
    }
    // Legacy sessions: infer Okay reason from riskRead note when missing.
    if (!okayReason && r.strength === "Okay") {
      if (r.riskRead === "@listing.lowEvidenceConfidence") {
        okayReason = "low_evidence_confidence";
      } else if (r.riskRead === "@listing.highCompetition") {
        okayReason = "high_competition";
      } else if (r.riskRead === "@listing.multipleOkay") {
        // Old rows could store a combined reason. Prefer the concrete
        // competition mitigation; the live score below can refine this.
        okayReason = "high_competition";
      } else if (
        r.riskRead === "@fit.moderateOkay" ||
        r.riskRead === "@fit.riskOverTolerance"
      ) {
        okayReason = "fit_risk";
      }
    }
    const product =
      getCatalogProduct(catalogKey) ??
      (catalogKey ? poolByKey.get(catalogKey) : undefined);
    const text = product
      ? localizedProduct(product, locale)
      : { name: r.name, summary: r.summary, differentiation: r.differentiation };

    let tier1Marketplaces: string[] = [];
    try {
      const parsed = JSON.parse(r.tier1Marketplaces ?? "[]");
      if (Array.isArray(parsed)) tier1Marketplaces = parsed.map(String);
    } catch {
      tier1Marketplaces = [];
    }

    const scoreRow = catalogKey ? scoresByKey.get(catalogKey) : undefined;
    const cache = scoreRow
      ? {
          abroadDemandScore: scoreRow.abroadDemandScore,
          lebanonDemandScore: scoreRow.lebanonDemandScore,
          demandPath: scoreRow.demandPath,
          compositeScore: scoreRow.compositeScore,
          lastScoreStatus: scoreRow.lastScoreStatus,
          confidence: scoreRow.confidence,
        }
      : null;
    const resolvedSystem = systemGateEnabled
      ? resolveSystemDemandInput({
          cache,
          heuristicProduct: product
            ? heuristicFieldsFromProduct(product)
            : null,
          liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
        })
      : null;
    const systemDemand = systemGateEnabled
      ? evaluateSystemDemandGate(resolvedSystem)
      : null;

    const acceptReady = isAcceptReadyForShortlist({
      marginsPass: r.marginsPass,
      oversized: r.oversizedHardBlock,
      fitNotRecommended: r.notRecommended,
      system: resolvedSystem,
      systemGateEnabled,
    });

    // Heal legacy Wave 2 rows: Fit Strong + Okay listing used @fit.moderateOkay
    // when confidence/competition capped strength (misleading copy).
    let riskRead = r.riskRead;
    if (
      r.strength === "Okay" &&
      r.fitScore >= 70 &&
      (riskRead === "@fit.moderateOkay" || !okayReason)
    ) {
      const conf =
        scoreRow?.confidence != null && Number.isFinite(scoreRow.confidence)
          ? scoreRow.confidence
          : null;
      const competitionHigh =
        scoreRow?.competitionScore != null &&
        Number.isFinite(scoreRow.competitionScore) &&
        scoreRow.competitionScore >= 0.66;
      const lowConf = conf != null && conf < 0.5;
      if (lowConf && competitionHigh) {
        okayReason = "high_competition";
        riskRead = "@listing.highCompetition";
      } else if (lowConf) {
        okayReason = "low_evidence_confidence";
        riskRead = "@listing.lowEvidenceConfidence";
      } else if (competitionHigh) {
        okayReason = "high_competition";
        riskRead = "@listing.highCompetition";
      }
    }

    const view: DiscoveryCandidateView = {
      id: r.id,
      name: text.name,
      summary: text.summary,
      differentiation: text.differentiation,
      category: r.category,
      sellPrice: r.sellPrice,
      landedCost:
        r.productCost + r.intlShip + r.clearanceTaxes + r.localCourier,
      marginBefore: r.marginBefore,
      marginAfter: r.marginAfter,
      marginsPass: r.marginsPass,
      marginBlockReason: r.marginBlockReason,
      oversized: r.oversizedHardBlock,
      fitScore: r.fitScore,
      strength: r.strength as "Strong" | "Okay",
      okayReason,
      riskRead,
      notRecommended: r.notRecommended,
      demandConfirmed: r.demandConfirmed,
      demandSummary: null,
      tier1Conflict: r.tier1Conflict,
      tier1Marketplaces,
      sourceCostHint: product
        ? computeSourceCostHint(
            product,
            onboarding?.monthlyFollowOnBudget ?? 0,
          )
        : null,
      systemDemandGate: systemGateEnabled,
      dualDemandGate: systemGateEnabled,
      systemDemand,
      softListedHardAcceptBlocked: false,
    };
    return { view, acceptReady };
  });

  // Accept-ready only on the page — hide legacy soft-listed / blocked leftovers.
  const candidates = mapped.filter((m) => m.acceptReady).map((m) => m.view);

  const acceptReadyVisible = candidates.length;
  const ladder = classifyDiscoveryLadder({
    visibleCount: acceptReadyVisible,
    canShowMore: acceptReadyVisible > 0 ? canShowMore : false,
    remainingEligible,
    exhaustedRounds,
  });

  let editOnboardingBanner: EditOnboardingBanner | null = null;
  if (acceptReadyVisible === 0 && remainingEligible <= 0) {
    editOnboardingBanner = "zero_accept_ready";
  } else if (
    acceptReadyVisible > 0 &&
    acceptReadyVisible + remainingEligible < DISCOVERY_FALLBACK_SHORTLIST_MIN
  ) {
    editOnboardingBanner = "thin_accept_ready";
  }

  return {
    sessionId: freshSession.id,
    productsShown: freshSession.productsShown,
    showMoreRemaining: computeShowMoreRemaining(
      freshSession.productsShown,
      cap,
    ),
    canShowMore: acceptReadyVisible > 0 ? canShowMore : false,
    sessionCap: cap,
    candidates,
    ladder,
    exhaustedRounds,
    remainingEligible,
    editOnboardingBanner,
    suggestionExplainEnabled: suggestionEnabled,
    geminiConfigured,
    whyPickEnabled: suggestionEnabled,
    canRefreshSuggestions,
  };
}
