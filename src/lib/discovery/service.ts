import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  DISCOVERY_COMPARE_MAX,
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
  isDiscoveryAgentUiEnabled,
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
  isSoftCompetitionBudgetEnabled,
} from "@/lib/discovery/flags";
import { applyHideDumpToRanked } from "@/lib/discovery/agent/hide-dump";
import { applyAgentFrameRank, isCheapStorageDrop } from "@/lib/discovery/agent/frame-rank";
import {
  pickOnboardingUnlock,
  type OnboardingUnlockAdvice,
} from "@/lib/discovery/agent/onboarding-unlock";
import {
  applyAudienceAnswer,
  applyDifferAnswer,
  applySellAnswer,
  applySkipRefuseAnswer,
  applyWhyExploreAnswer,
  beginNarrowing,
  beginWhyExplore,
  filterCatalogByIndustries,
  finishNarrowing,
  isAgentAskComplete,
  isNarrowingFieldsWritten,
  parseAgentFrame,
  parseOnboardingIndustryLikes,
  resolveAgentBoardPhase,
  resolveAgentRetrievePlan,
  serializeAgentFrame,
  type AgentAudienceChip,
  type AgentDifferChip,
  type AgentFrame,
  type AgentSkipRefuseChip,
  type AgentWhyChip,
} from "@/lib/discovery/agent/frame";
import {
  AGENT_HELD_RANK_BASE,
  agentWindowRange,
  excludeShownFromRanked,
  isInAgentVisibleGrid,
  keepLookingRequiresNarrowing,
  parseShownCatalogKeys,
  serializeShownCatalogKeys,
  sessionHasAgentTail,
  takeExploreBatch,
  unionCatalogKeys,
  wasCandidatePresented,
} from "@/lib/discovery/agent/explore";
import { loadScoresByCatalogKey, type ScoreRow } from "@/lib/discovery/scores";
import {
  resolveScoreFreshness,
  resolveScoreStaleAfterDays,
  type ScoreFreshness,
} from "@/lib/discovery/freshness";
import {
  evaluateUndoReject,
  selectUndoableRejects,
  type UndoRejectRefusal,
} from "@/lib/discovery/undo-reject";
import {
  candidateMetricDedupeKey,
  sessionMetricDedupeKey,
  shortlistOutcomeDedupeKey,
} from "@/lib/discovery/metrics/events";
import { recordDiscoveryMetric } from "@/lib/discovery/metrics/store";

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
  rankWave2ShortlistWithBlockers,
  type Wave2RankedProduct,
} from "@/lib/discovery/scoring/rank";
import {
  classifyShortlistBlocker,
  emptyBlockerTally,
  mergeBlockerTallies,
  resolveShortlistEmptyDecision,
  tallyShortlistBlockers,
  type EditOnboardingBanner,
  type ShortlistBlocker,
  type ShortlistBlockerTally,
  type ShortlistEmptyState,
} from "@/lib/discovery/empty-state";
import type { OkayReason } from "@/lib/discovery/scoring/composite";
import { resolveOkayReasonForDisplay } from "@/lib/discovery/okay-reason";
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

/** Score-cache fields the demand gate reads (shared by view, accept, undo). */
function demandCacheFromScoreRow(row: ScoreRow | undefined | null) {
  if (!row) return null;
  return {
    abroadDemandScore: row.abroadDemandScore,
    lebanonDemandScore: row.lebanonDemandScore,
    demandPath: row.demandPath,
    compositeScore: row.compositeScore,
    lastScoreStatus: row.lastScoreStatus,
    confidence: row.confidence,
  };
}

/**
 * Resolve the system demand gate + shortlist accept-readiness for one stored
 * candidate. The Discovery view and undo-reject share this so an undo can never
 * restore a card the page itself would have filtered out.
 */
function resolveCandidateGate(input: {
  scoreRow: ScoreRow | undefined;
  product: CatalogProduct | undefined;
  systemGateEnabled: boolean;
  liveSearchEnabled: boolean;
  marginsPass: boolean;
  oversized: boolean;
  fitNotRecommended: boolean;
}): {
  resolvedSystem: ReturnType<typeof resolveSystemDemandInput> | null;
  systemDemand: SystemDemandGateResult | null;
  acceptReady: boolean;
} {
  const resolvedSystem = input.systemGateEnabled
    ? resolveSystemDemandInput({
        cache: demandCacheFromScoreRow(input.scoreRow),
        heuristicProduct: input.product
          ? heuristicFieldsFromProduct(input.product)
          : null,
        liveSearchEnabled: input.liveSearchEnabled,
      })
    : null;

  return {
    resolvedSystem,
    systemDemand: input.systemGateEnabled
      ? evaluateSystemDemandGate(resolvedSystem)
      : null,
    acceptReady: isAcceptReadyForShortlist({
      marginsPass: input.marginsPass,
      oversized: input.oversized,
      fitNotRecommended: input.fitNotRecommended,
      system: resolvedSystem,
      systemGateEnabled: input.systemGateEnabled,
    }),
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

/**
 * Catalog keys the founder actually saw or decided on.
 * Unrevealed freeze-tail rows (rank >= productsShown) are not seen — Keep
 * looking must still be able to show the rest of an 11-product session.
 */
export async function getSeenCatalogKeys(
  workspaceId: string,
): Promise<Set<string>> {
  await ensureMigrated();
  const rows = await db
    .select({
      fitBreakdown: schema.productCandidates.fitBreakdown,
      status: schema.productCandidates.status,
      rank: schema.productCandidates.rank,
      productsShown: schema.discoverySessions.productsShown,
    })
    .from(schema.productCandidates)
    .innerJoin(
      schema.discoverySessions,
      eq(schema.productCandidates.sessionId, schema.discoverySessions.id),
    )
    .where(eq(schema.productCandidates.workspaceId, workspaceId));
  const keys = new Set<string>();
  for (const row of rows) {
    if (!wasCandidatePresented(row.status, row.rank, row.productsShown)) {
      continue;
    }
    const key = catalogKeyFromCandidate(row);
    if (key) keys.add(key);
  }
  return keys;
}

export type ScoredProduct = {
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
  restrictCategories?: readonly string[],
): ScoredProduct[] {
  const profile = toFitProfile(onboarding);
  let sourceCatalog = selectLandedCostPool(
    catalog,
    onboarding.maxLandedCost,
  ).filter((p) => !excludeKeys.has(p.key));
  if (restrictCategories && restrictCategories.length > 0) {
    sourceCatalog = filterCatalogByIndustries(
      sourceCatalog,
      restrictCategories as AgentFrame["industryIds"],
    );
  }

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
  opts: { restrictCategories?: readonly string[] } = {},
): Promise<ScoredProduct[]> {
  return (await scoreRankWithBlockers(onboarding, excludeKeys, opts)).scored;
}

/**
 * Same shortlist, plus why the rest of the pool was excluded (WAVE-2 §8) so an
 * empty board can name its real cause instead of defaulting to "your profile".
 */
async function scoreRankWithBlockers(
  onboarding: OnboardingRow,
  excludeKeys: ReadonlySet<string> = new Set(),
  opts: { restrictCategories?: readonly string[] } = {},
): Promise<{
  scored: ScoredProduct[];
  blockers: ShortlistBlockerTally;
  hideDumpDropped: number;
}> {
  const catalog = await resolveDiscoveryCatalogSource();

  let sourceCatalog = selectLandedCostPool(
    catalog,
    onboarding.maxLandedCost,
  ).filter((p) => !excludeKeys.has(p.key));
  if (opts.restrictCategories && opts.restrictCategories.length > 0) {
    sourceCatalog = filterCatalogByIndustries(
      sourceCatalog,
      opts.restrictCategories as AgentFrame["industryIds"],
    );
  }

  if (!isDiscoveryPoolV2Enabled()) {
    const scored = scoreRankCatalog(
      onboarding,
      excludeKeys,
      catalog,
      opts.restrictCategories,
    );
    // Wave 1 runs no score cache, so nothing here can be blocked by one.
    return {
      scored,
      blockers: {
        ...emptyBlockerTally(),
        profile: Math.max(0, sourceCatalog.length - scored.length),
      },
      hideDumpDropped: 0,
    };
  }

  const [scoresByKey, hintsByKey] = await Promise.all([
    loadScoresByCatalogKey(),
    loadPoolHintsByCatalogKey(),
  ]);

  const { ranked, blockers } = rankWave2ShortlistWithBlockers(
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

  // §14 hide-dump: drop high+Tier-1 from retrieve when agent UI + pool + scores.
  // Remaining stay in existing composite order (whitespace is already in demand).
  const listed = applyHideDumpToRanked(ranked, scoresByKey, {
    poolV2: true,
    agentUi: isDiscoveryAgentUiEnabled(),
  });
  const dumped = ranked.length - listed.length;
  // Hide-dump is not a Fit/budget profile blocker (§14.7 nothing-fits).
  const scored = listed.map((r) => ({
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

  return { scored, blockers, hideDumpDropped: dumped };
}

export type RemainingEligible = {
  count: number;
  /** Why the unlisted remainder is unlisted (WAVE-2 §8) — display/metrics only. */
  blockers: ShortlistBlockerTally;
  /** §14 hide-dump drops — not a Fit/budget Edit-onboarding cause. */
  hideDumpDropped: number;
};

/**
 * Accept-ready products left in the pool for this profile, with the reasons the
 * rest were dropped. A caller that only needs the number should use
 * `countRemainingEligible`; the empty board needs the reasons so a scoring
 * outage does not read as "your profile filtered everything out".
 */
export async function resolveRemainingEligible(
  workspaceId: string,
  onboarding: OnboardingRow,
  opts: {
    restrictCategories?: readonly string[];
    extraExcludeKeys?: readonly string[];
  } = {},
): Promise<RemainingEligible> {
  const seen = await getSeenCatalogKeys(workspaceId);
  for (const key of opts.extraExcludeKeys ?? []) seen.add(key);
  const { scored, blockers, hideDumpDropped } = await scoreRankWithBlockers(
    onboarding,
    seen,
    opts,
  );
  return { count: scored.length, blockers, hideDumpDropped };
}

export async function countRemainingEligible(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<number> {
  return (await resolveRemainingEligible(workspaceId, onboarding)).count;
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

/**
 * Open an active discovery session from a pre-scored pool (demo restore, tests).
 * Caller must ensure no active session remains (e.g. after journey wipe).
 */
export async function createActiveDiscoverySessionFromScored(
  workspaceId: string,
  scored: ScoredProduct[],
): Promise<typeof schema.discoverySessions.$inferSelect | undefined> {
  await ensureMigrated();
  const existing = await getActiveSession(workspaceId);
  if (existing) {
    return existing;
  }
  return insertSessionPool(workspaceId, scored);
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
    agentFrameJson: null,
    exploreMoreCount: 0,
    shownCatalogKeysJson: null,
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

function candidateRowsFromScored(
  workspaceId: string,
  sessionId: string,
  scored: ScoredProduct[],
  createdAt: string,
  limit: number = DISCOVERY_SESSION_CAP,
  rankOffset: number = 0,
) {
  const pool = scored.slice(0, limit);
  return pool.map(
    (
      { p, fit, margin, strength, riskRead, okayReason, notRecommended, wave2 },
      i,
    ) => ({
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
      rank: rankOffset + i,
      createdAt,
    }),
  );
}

/**
 * Replace the visible grid on THIS session. Basket rows (keepCandidateIds)
 * stay; rejected/accepted rows stay. Not a new session.
 */
async function replaceSessionCandidates(
  workspaceId: string,
  sessionId: string,
  scored: ScoredProduct[],
  opts: {
    keepCandidateIds?: readonly string[];
    limit?: number;
    /** Persist a longer ranked tail but only reveal the first window. */
    revealOnly?: boolean;
  } = {},
): Promise<{ insertedKeys: string[] }> {
  const createdAt = nowIso();
  const limit = opts.limit ?? DISCOVERY_SESSION_CAP;
  const keepIds = [
    ...new Set((opts.keepCandidateIds ?? []).filter(Boolean)),
  ].slice(0, DISCOVERY_COMPARE_MAX);

  const keepRows =
    keepIds.length > 0
      ? await db
          .select()
          .from(schema.productCandidates)
          .where(
            and(
              eq(schema.productCandidates.sessionId, sessionId),
              eq(schema.productCandidates.status, "shown"),
              inArray(schema.productCandidates.id, keepIds),
            ),
          )
      : [];
  const keepIdSet = new Set(keepRows.map((r) => r.id));
  const keepKeys = new Set(
    keepRows
      .map((r) => catalogKeyFromCandidate(r))
      .filter((k): k is string => Boolean(k)),
  );

  if (keepIdSet.size > 0) {
    await db
      .delete(schema.productCandidates)
      .where(
        and(
          eq(schema.productCandidates.sessionId, sessionId),
          eq(schema.productCandidates.status, "shown"),
          notInArray(schema.productCandidates.id, [...keepIdSet]),
        ),
      );
  } else {
    await db
      .delete(schema.productCandidates)
      .where(
        and(
          eq(schema.productCandidates.sessionId, sessionId),
          eq(schema.productCandidates.status, "shown"),
        ),
      );
  }

  for (let i = 0; i < keepRows.length; i += 1) {
    const row = keepRows[i];
    if (!row) continue;
    await db
      .update(schema.productCandidates)
      .set({ rank: AGENT_HELD_RANK_BASE + i })
      .where(eq(schema.productCandidates.id, row.id));
  }

  const fresh = scored.filter((s) => !keepKeys.has(s.p.key));
  const rows = candidateRowsFromScored(
    workspaceId,
    sessionId,
    fresh,
    createdAt,
    limit,
  );
  if (rows.length > 0) {
    await db.insert(schema.productCandidates).values(rows);
  }
  await db
    .update(schema.discoverySessions)
    .set({
      productsShown: opts.revealOnly
        ? Math.min(DISCOVERY_INITIAL_COUNT, rows.length)
        : rows.length,
      showMoreUsed: 0,
      exhaustionCounted: false,
    })
    .where(eq(schema.discoverySessions.id, sessionId));

  return {
    insertedKeys: rows
      .map((r) => catalogKeyFromCandidate(r))
      .filter((k): k is string => Boolean(k)),
  };
}

async function mergeShownCatalogKeys(
  sessionId: string,
  existingJson: string | null | undefined,
  added: readonly string[],
): Promise<string[]> {
  const next = unionCatalogKeys(parseShownCatalogKeys(existingJson), added);
  await db
    .update(schema.discoverySessions)
    .set({ shownCatalogKeysJson: serializeShownCatalogKeys(next) })
    .where(eq(schema.discoverySessions.id, sessionId));
  return next;
}

async function loadSessionGridRows(sessionId: string): Promise<
  { fitBreakdown: string; rank: number }[]
> {
  return db
    .select({
      fitBreakdown: schema.productCandidates.fitBreakdown,
      rank: schema.productCandidates.rank,
    })
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.sessionId, sessionId),
        eq(schema.productCandidates.status, "shown"),
      ),
    );
}

async function scoreUnseenAgentBatch(input: {
  workspaceId: string;
  onboarding: OnboardingRow;
  session: typeof schema.discoverySessions.$inferSelect;
  frame: AgentFrame;
}): Promise<ScoredProduct[]> {
  const plan = resolveAgentRetrievePlan(input.frame);
  if (plan.dontDeal) return [];
  const shown = parseShownCatalogKeys(input.session.shownCatalogKeysJson);
  const seen = await getSeenCatalogKeys(input.workspaceId);
  for (const key of shown) seen.add(key);
  const scored = applyAgentFrameRank(
    await scoreRankForDiscovery(input.onboarding, seen, {
      restrictCategories: plan.industryIds,
    }),
    input.frame,
  );
  const unseen = excludeShownFromRanked(
    scored.map((s) => ({ ...s, key: s.p.key })),
    seen,
  );
  return takeExploreBatch(unseen, DISCOVERY_INITIAL_COUNT);
}

async function retrieveAgentGrid(input: {
  workspaceId: string;
  onboarding: OnboardingRow;
  session: typeof schema.discoverySessions.$inferSelect;
  frame: AgentFrame;
  keepCandidateIds?: readonly string[];
}): Promise<{ insertedKeys: string[] }> {
  const plan = resolveAgentRetrievePlan(input.frame);
  const shown = parseShownCatalogKeys(input.session.shownCatalogKeysJson);
  const seen = await getSeenCatalogKeys(input.workspaceId);
  for (const key of shown) seen.add(key);

  if (plan.dontDeal) {
    return replaceSessionCandidates(
      input.workspaceId,
      input.session.id,
      [],
      {
        keepCandidateIds: input.keepCandidateIds,
        limit: DISCOVERY_INITIAL_COUNT,
      },
    );
  }

  const scored = applyAgentFrameRank(
    await scoreRankForDiscovery(input.onboarding, seen, {
      restrictCategories: plan.industryIds,
    }),
    input.frame,
  );
  const unseen = excludeShownFromRanked(
    scored.map((s) => ({ ...s, key: s.p.key })),
    seen,
  );
  // Persist the full ranked aisle (up to session cap). The agent grid reveals
  // a growing prefix of DISCOVERY_INITIAL_COUNT; Keep looking pages the tail
  // instead of re-scoring and wiping. not_convinced still replaces after
  // narrowing.
  const batch = takeExploreBatch(unseen, DISCOVERY_SESSION_CAP);
  return replaceSessionCandidates(
    input.workspaceId,
    input.session.id,
    batch,
    {
      keepCandidateIds: input.keepCandidateIds,
      limit: DISCOVERY_SESSION_CAP,
      revealOnly: true,
    },
  );
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

  // Agent UI: delay retrieve until ask completes (PR2). Empty session is OK.
  if (isDiscoveryAgentUiEnabled()) {
    return insertSessionPool(workspaceId, []);
  }

  const scored = await scoreRankForDiscovery(onboarding, new Set());
  return insertSessionPool(workspaceId, scored);
}

/**
 * WAVE-2 §14.12 — after an onboarding *edit* from Discovery, re-retrieve on
 * the same session. Keep `agentFrameJson` (same chips). Do not close the
 * session. Wipe this session's shown rows first so they can reappear if the
 * new profile now lists them.
 */
export async function retrieveAfterOnboardingEdit(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<void> {
  await ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return;

  const frame = parseAgentFrame(session.agentFrameJson);

  await replaceSessionCandidates(workspaceId, session.id, [], {
    limit: DISCOVERY_INITIAL_COUNT,
  });
  await db
    .update(schema.discoverySessions)
    .set({
      shownCatalogKeysJson: serializeShownCatalogKeys([]),
      exploreMoreCount: 0,
    })
    .where(eq(schema.discoverySessions.id, session.id));

  const refreshed = (await getActiveSession(workspaceId)) ?? session;

  if (isDiscoveryAgentUiEnabled()) {
    if (
      isAgentAskComplete(frame) &&
      !resolveAgentRetrievePlan(frame).dontDeal
    ) {
      await retrieveAgentGrid({
        workspaceId,
        onboarding,
        session: refreshed,
        frame,
      });
    }
    return;
  }

  const seen = await getSeenCatalogKeys(workspaceId);
  const scored = await scoreRankForDiscovery(onboarding, seen);
  await replaceSessionCandidates(workspaceId, session.id, scored, {
    limit: DISCOVERY_SESSION_CAP,
  });
}

export async function markDiscoveryIntroSeen(workspaceId: string): Promise<void> {
  await ensureMigrated();
  await db
    .update(schema.onboardingProfiles)
    .set({ discoveryIntroSeen: true, updatedAt: nowIso() })
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId));
}

/**
 * Persist ask answers on the active session. When the ask is complete, retrieve
 * (or leave empty for don’t-deal). Same session id — Refresh is what clears chips.
 */
export async function saveDiscoveryAgentAsk(
  workspaceId: string,
  onboarding: OnboardingRow,
  frame: AgentFrame,
  keepCandidateIds: readonly string[] = [],
): Promise<{ ok: true } | { ok: false; error: "no_session" }> {
  await ensureMigrated();
  if (!isDiscoveryAgentUiEnabled()) {
    return { ok: false, error: "no_session" };
  }
  const session = await getActiveSession(workspaceId);
  if (!session) return { ok: false, error: "no_session" };

  let stored = frame;
  if (stored.narrowing && isAgentAskComplete(stored)) {
    if (!isNarrowingFieldsWritten(stored) && !resolveAgentRetrievePlan(stored).dontDeal) {
      stored = { ...stored, askStep: Math.min(stored.askStep, 3) };
      await db
        .update(schema.discoverySessions)
        .set({ agentFrameJson: serializeAgentFrame(stored) })
        .where(eq(schema.discoverySessions.id, session.id));
      return { ok: true };
    }
    stored = finishNarrowing(stored);
  }

  await db
    .update(schema.discoverySessions)
    .set({ agentFrameJson: serializeAgentFrame(stored) })
    .where(eq(schema.discoverySessions.id, session.id));

  if (!isAgentAskComplete(stored)) {
    return { ok: true };
  }

  const { insertedKeys } = await retrieveAgentGrid({
    workspaceId,
    onboarding,
    session,
    frame: stored,
    keepCandidateIds,
  });
  await mergeShownCatalogKeys(
    session.id,
    session.shownCatalogKeysJson,
    insertedKeys.slice(0, DISCOVERY_INITIAL_COUNT),
  );
  if (frame.narrowing) {
    await db
      .update(schema.discoverySessions)
      .set({ exploreMoreCount: 0 })
      .where(eq(schema.discoverySessions.id, session.id));
  }
  return { ok: true };
}

export type AgentAskStepInput =
  | { step: "sell"; industryIds: readonly string[]; otherText: string }
  | { step: "skipRefuse"; value: AgentSkipRefuseChip | "skipped" }
  | { step: "audience"; value: AgentAudienceChip | "skipped" }
  | { step: "differ"; value: AgentDifferChip | "skipped" };

export async function applyDiscoveryAgentAskStep(
  workspaceId: string,
  onboarding: OnboardingRow,
  input: AgentAskStepInput,
  keepCandidateIds: readonly string[] = [],
): Promise<
  | { ok: true }
  | { ok: false; error: "no_session" | "empty_sell" | "skip_not_allowed" }
> {
  await ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return { ok: false, error: "no_session" };
  const current = parseAgentFrame(session.agentFrameJson);

  let next: AgentFrame;
  if (input.step === "sell") {
    const applied = applySellAnswer(
      current,
      input.industryIds as AgentFrame["industryIds"],
      input.otherText,
    );
    if ("error" in applied) return { ok: false, error: applied.error };
    next = applied;
  } else if (input.step === "skipRefuse") {
    const applied = applySkipRefuseAnswer(current, input.value);
    if ("error" in applied) return { ok: false, error: applied.error };
    next = applied;
  } else if (input.step === "audience") {
    const applied = applyAudienceAnswer(current, input.value);
    if ("error" in applied) return { ok: false, error: applied.error };
    next = applied;
  } else {
    const applied = applyDifferAnswer(current, input.value);
    if ("error" in applied) return { ok: false, error: applied.error };
    next = applied;
  }

  return saveDiscoveryAgentAsk(
    workspaceId,
    onboarding,
    next,
    keepCandidateIds,
  );
}

export async function beginAgentExploreMore(
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; error: "no_session" | "not_ready" }> {
  await ensureMigrated();
  if (!isDiscoveryAgentUiEnabled()) {
    return { ok: false, error: "no_session" };
  }
  const session = await getActiveSession(workspaceId);
  if (!session) return { ok: false, error: "no_session" };
  const frame = parseAgentFrame(session.agentFrameJson);
  if (!isAgentAskComplete(frame) || frame.whyPending) {
    return { ok: false, error: "not_ready" };
  }
  if (resolveAgentRetrievePlan(frame).dontDeal) {
    return { ok: false, error: "not_ready" };
  }
  const next = beginWhyExplore(frame);
  await db
    .update(schema.discoverySessions)
    .set({ agentFrameJson: serializeAgentFrame(next) })
    .where(eq(schema.discoverySessions.id, session.id));
  return { ok: true };
}

export async function submitAgentExploreWhy(
  workspaceId: string,
  onboarding: OnboardingRow,
  input: {
    why: AgentWhyChip;
    note?: string;
    keepCandidateIds?: readonly string[];
  },
): Promise<
  | { ok: true; next: "narrowing" | "grid" }
  | { ok: false; error: "no_session" | "not_ready" }
> {
  await ensureMigrated();
  if (!isDiscoveryAgentUiEnabled()) {
    return { ok: false, error: "no_session" };
  }
  const session = await getActiveSession(workspaceId);
  if (!session) return { ok: false, error: "no_session" };
  const frame = parseAgentFrame(session.agentFrameJson);
  if (!frame.whyPending || !isAgentAskComplete(frame)) {
    return { ok: false, error: "not_ready" };
  }

  const answered = applyWhyExploreAnswer(frame, input.why, input.note ?? "");
  const requireNarrowing =
    input.why === "not_convinced" ||
    keepLookingRequiresNarrowing(session.exploreMoreCount);

  if (requireNarrowing) {
    const narrowed = beginNarrowing(answered);
    await db
      .update(schema.discoverySessions)
      .set({ agentFrameJson: serializeAgentFrame(narrowed) })
      .where(eq(schema.discoverySessions.id, session.id));
    return { ok: true, next: "narrowing" };
  }

  // keep_looking and count < 5 — page the persisted aisle first (5 of 11).
  // APPEND: bump the visible prefix; do not replace/wipe when the tail exists.
  const gridRows = await loadSessionGridRows(session.id);
  const gridCount = gridRows.filter((r) => r.rank < AGENT_HELD_RANK_BASE).length;

  if (sessionHasAgentTail(gridCount, session.exploreMoreCount)) {
    const nextCount = session.exploreMoreCount + 1;
    const { start, end } = agentWindowRange(nextCount);
    const revealed = gridRows
      .filter(
        (r) =>
          r.rank >= start &&
          r.rank < end &&
          r.rank < AGENT_HELD_RANK_BASE,
      )
      .map((r) => catalogKeyFromCandidate(r))
      .filter((k): k is string => Boolean(k));
    await mergeShownCatalogKeys(
      session.id,
      session.shownCatalogKeysJson,
      revealed,
    );
    await db
      .update(schema.discoverySessions)
      .set({
        agentFrameJson: serializeAgentFrame(answered),
        exploreMoreCount: nextCount,
        productsShown: Math.max(
          session.productsShown,
          Math.min(end, gridCount),
        ),
      })
      .where(eq(schema.discoverySessions.id, session.id));
    return { ok: true, next: "grid" };
  }

  const batch = await scoreUnseenAgentBatch({
    workspaceId,
    onboarding,
    session,
    frame: answered,
  });
  if (batch.length === 0) {
    const narrowed = beginNarrowing(answered);
    await db
      .update(schema.discoverySessions)
      .set({ agentFrameJson: serializeAgentFrame(narrowed) })
      .where(eq(schema.discoverySessions.id, session.id));
    return { ok: true, next: "narrowing" };
  }

  const createdAt = nowIso();
  const rows = candidateRowsFromScored(
    workspaceId,
    session.id,
    batch,
    createdAt,
    DISCOVERY_INITIAL_COUNT,
    gridCount,
  );
  await db.insert(schema.productCandidates).values(rows);
  const insertedKeys = rows
    .map((r) => catalogKeyFromCandidate(r))
    .filter((k): k is string => Boolean(k));
  await mergeShownCatalogKeys(
    session.id,
    session.shownCatalogKeysJson,
    insertedKeys,
  );
  const nextCount =
    gridCount === 0
      ? session.exploreMoreCount
      : session.exploreMoreCount + 1;
  const { end } = agentWindowRange(
    gridCount === 0 ? session.exploreMoreCount : nextCount,
  );
  await db
    .update(schema.discoverySessions)
    .set({
      agentFrameJson: serializeAgentFrame(answered),
      exploreMoreCount: nextCount,
      productsShown: Math.max(session.productsShown, end),
    })
    .where(eq(schema.discoverySessions.id, session.id));
  return { ok: true, next: "grid" };
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

  // Agent UI Refresh = start over: new session, no frame copy, no retrieve yet.
  if (isDiscoveryAgentUiEnabled()) {
    await db
      .update(schema.discoverySessions)
      .set({ status: "closed" })
      .where(eq(schema.discoverySessions.id, existingSessionId));
    const session = await insertSessionPool(workspaceId, []);
    if (!session) return { ok: false, error: "catalog_exhausted" };
    return { ok: true, sessionId: session.id };
  }

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
    // Stamped so the WAVE-2 §7 undo window can be bounded from the reject.
    .set({ status: "rejected", rejectedAt: nowIso() })
    .where(eq(schema.productCandidates.id, candidateId));
  await recordDiscoveryMetric({
    workspaceId,
    kind: "reject",
    sessionId: candidate.sessionId,
    dedupeKey: candidateMetricDedupeKey(candidateId, "reject"),
  });
  await maybeCountExhaustion(workspaceId);
  return { ok: true };
}

export type UndoRejectResult =
  | { ok: true }
  | { ok: false; error: UndoRejectRefusal };

/**
 * WAVE-2 §7 — restore the last mis-tapped reject to the active shortlist.
 *
 * Deliberately narrow:
 * - Only a `rejected` row of the ACTIVE session, inside the undo window, among
 *   the last `DISCOVERY_UNDO_REJECT_MAX` rejects.
 * - An accepted product is refused with its own reason — undo must never walk
 *   back a Human Approval or a created SKU.
 * - Accept-readiness is re-checked against CURRENT scores, so a card the gates
 *   moved against is explained rather than silently put back.
 * - The exhausted-round ladder is untouched: undo never bumps it, and the
 *   session's `exhaustionCounted` flag stays set so a re-reject cannot count a
 *   second round for the same pool.
 */
export async function undoRejectCandidate(
  workspaceId: string,
  candidateId: string,
): Promise<UndoRejectResult> {
  await ensureMigrated();

  const candidate = await getCandidateOwned(workspaceId, candidateId);
  if (!candidate) return { ok: false, error: "not_found" };

  const session = await getActiveSession(workspaceId);
  const undoable = session
    ? selectUndoableRejects(await loadSessionRejects(session.id), {
        activeSessionId: session.id,
      })
    : [];

  const systemGateEnabled = isSystemDemandGateEnabled();
  const catalogKey = catalogKeyFromCandidate(candidate) ?? "";
  const scoresByKey = systemGateEnabled
    ? await loadScoresByCatalogKey()
    : new Map<string, ScoreRow>();
  const product =
    getCatalogProduct(catalogKey) ??
    (catalogKey && isDiscoveryPoolV2Enabled()
      ? (await loadPoolProductsByCatalogKeys([catalogKey])).get(catalogKey)
      : undefined);

  const { acceptReady } = resolveCandidateGate({
    scoreRow: catalogKey ? scoresByKey.get(catalogKey) : undefined,
    product,
    systemGateEnabled,
    liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
    marginsPass: candidate.marginsPass,
    oversized: candidate.oversizedHardBlock,
    fitNotRecommended: candidate.notRecommended,
  });

  const decision = evaluateUndoReject({
    candidate,
    activeSessionId: session?.id ?? null,
    acceptReady,
    undoableIds: undoable.map((r) => r.id),
  });
  if (!decision.ok) return { ok: false, error: decision.reason };

  await db
    .update(schema.productCandidates)
    .set({ status: "shown", rejectedAt: null })
    .where(eq(schema.productCandidates.id, candidateId));

  return { ok: true };
}

/** Rejected rows of one session — undo candidates before window/cap filtering. */
async function loadSessionRejects(sessionId: string) {
  return db
    .select({
      id: schema.productCandidates.id,
      name: schema.productCandidates.name,
      sessionId: schema.productCandidates.sessionId,
      status: schema.productCandidates.status,
      rejectedAt: schema.productCandidates.rejectedAt,
    })
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.sessionId, sessionId),
        eq(schema.productCandidates.status, "rejected"),
      ),
    );
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

  await recordDiscoveryMetric({
    workspaceId,
    kind: "accept",
    sessionId: candidate.sessionId,
    dedupeKey: candidateMetricDedupeKey(candidate.id, "accept"),
  });

  // Wave 3: start live Import/Local fill before the founder opens Supplier
  // (Approach A one-shot). Failures stay soft — panel may show empty + retry.
  try {
    const { ensureSuppliers } = await import("@/lib/supplier/service");
    await ensureSuppliers(workspaceId, skuId);
  } catch {
    // Soft: accept still succeeds; getSupplierPanel will retry ensure.
  }

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
  /** Pool photo URL when stored; agent grid uses a placeholder if missing. */
  imageUrl: string | null;
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
   * WAVE-2 §7 — how old the market read behind this card is. Display only:
   * never feeds rank, strength, or an accept gate.
   */
  scoreFreshness: ScoreFreshness;
  /**
   * @deprecated Soft-list browsing removed — always false (accept-ready only).
   */
  softListedHardAcceptBlocked: boolean;
};

/** WAVE-2 §7 — a recently rejected card the founder can still restore. */
export type UndoableReject = {
  candidateId: string;
  name: string;
};

export type {
  EditOnboardingBanner,
  ShortlistEmptyState,
} from "@/lib/discovery/empty-state";

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
  /**
   * WAVE-2 §14.12 — named knob + preview names when a dry-run proves ≥1 extra
   * accept-ready id in this frame. Null means the banner must not render.
   */
  editOnboardingUnlock: OnboardingUnlockAdvice | null;
  /**
   * WAVE-2 §8 — why the board is empty. `no_scores` means missing / failed
   * score rows, which the founder cannot fix by editing onboarding, so that
   * state replaces the nag instead of joining it.
   */
  shortlistEmptyState: ShortlistEmptyState | null;
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
  /**
   * WAVE-2 §7 — recent rejects still inside the undo window, newest first.
   * Session-scoped, so a refresh / new session empties it.
   */
  undoableRejects: UndoableReject[];
  /**
   * WAVE-2 §14 — when true, REPLACE the 5-card board with the agent grid.
   * Default off. Never render both on one page.
   */
  agentUiEnabled: boolean;
  /** intro | ask | why | grid — intro/ask/why hide the result list. */
  agentPhase: "intro" | "ask" | "why" | "grid";
  agentIntroSeen: boolean;
  agentFrame: AgentFrame;
  agentDontDeal: boolean;
  /** §14.7 empty retrieve / hide-dump aisle — not Continue discovery. */
  agentNothingFits: boolean;
  agentHeldCandidates: DiscoveryCandidateView[];
  agentExploreMoreCount: number;
  onboardingIndustryLikes: string[];
};

export async function getDiscoveryView(
  workspaceId: string,
  locale: AppLocale,
): Promise<DiscoveryView | null> {
  await ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return null;

  const agentUiEnabled = isDiscoveryAgentUiEnabled();
  // Agent intro/ask (and don’t-deal) are not exhausted shortlists.
  if (!agentUiEnabled) {
    await maybeCountExhaustion(workspaceId);
  }
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

  const visible = agentUiEnabled
    ? rows.filter((r) =>
        isInAgentVisibleGrid(r.rank, freshSession.exploreMoreCount),
      )
    : rows.filter((r) => r.rank < freshSession.productsShown);
  const heldRows = agentUiEnabled
    ? rows.filter((r) => r.rank >= AGENT_HELD_RANK_BASE)
    : [];
  const rowsForView = [...visible, ...heldRows];
  const gridRowCount = visible.length;
  const cap = Math.min(DISCOVERY_SESSION_CAP, await poolSize(freshSession.id));
  const canShowMore =
    freshSession.productsShown < cap &&
    freshSession.showMoreUsed < DISCOVERY_SHOW_MORE_MAX;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  const agentIntroSeen = onboarding?.discoveryIntroSeen === true;
  const agentFrame = parseAgentFrame(freshSession.agentFrameJson);
  const agentPhase = resolveAgentBoardPhase({
    agentUi: agentUiEnabled,
    introSeen: agentIntroSeen,
    frame: agentFrame,
  });
  const retrievePlan = resolveAgentRetrievePlan(agentFrame);
  const agentDontDeal =
    agentUiEnabled && isAgentAskComplete(agentFrame) && retrievePlan.dontDeal;
  const restrictCategories =
    agentUiEnabled && isAgentAskComplete(agentFrame) && !retrievePlan.dontDeal
      ? retrievePlan.industryIds
      : undefined;
  const remaining: RemainingEligible = onboarding
    ? await resolveRemainingEligible(workspaceId, onboarding, {
        restrictCategories,
        extraExcludeKeys: parseShownCatalogKeys(
          freshSession.shownCatalogKeysJson,
        ),
      })
    : { count: 0, blockers: emptyBlockerTally(), hideDumpDropped: 0 };
  const remainingEligible = remaining.count;
  const exhaustedRounds = await getExhaustedRounds(workspaceId);

  const systemGateEnabled = isSystemDemandGateEnabled();
  const suggestionEnabled = isSuggestionExplainEnabled();
  const geminiConfigured = isGeminiConfigured();
  const canRefreshSuggestions = isDiscoveryPoolV2Enabled();
  const scoresByKey = systemGateEnabled
    ? await loadScoresByCatalogKey()
    : new Map();
  // One clock for the whole render so cards cannot disagree about "today".
  const now = new Date();
  const staleAfterDays = resolveScoreStaleAfterDays();

  // Path 1 keys missing from catalog.ts: resolve text for visible cards only
  // (keyed batch — O(visible), not a full active-pool scan on the view path).
  const visibleCatalogKeys: string[] = [];
  for (const r of rowsForView) {
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

  const mapped = rowsForView.map((r) => {
    let catalogKey = "";
    let storedOkayReason: string | null = null;
    let snapshotCompetitionLevel: string | null = null;
    let snapshotConfidence: number | null = null;
    try {
      const breakdown = JSON.parse(r.fitBreakdown) as {
        catalogKey?: string;
        okayReason?: string;
        wave2?: {
          okayReason?: string;
          explain?: {
            competitionLevel?: string | null;
            confidence?: number | null;
          };
        };
      };
      catalogKey = breakdown.catalogKey ?? "";
      storedOkayReason =
        breakdown.wave2?.okayReason ?? breakdown.okayReason ?? null;
      snapshotCompetitionLevel =
        breakdown.wave2?.explain?.competitionLevel ?? null;
      snapshotConfidence = breakdown.wave2?.explain?.confidence ?? null;
    } catch {
      catalogKey = "";
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
    const { systemDemand, acceptReady } = resolveCandidateGate({
      scoreRow,
      product,
      systemGateEnabled,
      liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
      marginsPass: r.marginsPass,
      oversized: r.oversizedHardBlock,
      fitNotRecommended: r.notRecommended,
    });

    // Display only — a stale or never-measured read is said plainly, never
    // scored (WAVE-2 §7). No score row at all reads as "never measured".
    const scoreFreshness = resolveScoreFreshness({
      lastScoredAt: scoreRow?.lastScoredAt ?? null,
      now,
      staleAfterDays,
    });

    // One resolver for the card note and the explain payload (§6.1) — the
    // yellow note can never state a different reason than Gemini is given.
    const { okayReason, riskRead } = resolveOkayReasonForDisplay({
      strength: r.strength === "Strong" ? "Strong" : "Okay",
      fitScore: r.fitScore,
      storedOkayReason,
      storedRiskRead: r.riskRead,
      snapshotCompetitionLevel,
      snapshotConfidence,
      scoreConfidence: scoreRow?.confidence ?? null,
      scoreCompetitionScore: scoreRow?.competitionScore ?? null,
    });

    const view: DiscoveryCandidateView = {
      id: r.id,
      name: text.name,
      summary: text.summary,
      differentiation: text.differentiation,
      imageUrl: product?.imageUrl ?? null,
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
      scoreFreshness,
      softListedHardAcceptBlocked: false,
    };
    const blocker: ShortlistBlocker | null = classifyShortlistBlocker({
      included: acceptReady,
      marginsPass: r.marginsPass,
      oversized: r.oversizedHardBlock,
      fitNotRecommended: r.notRecommended,
      systemDemand,
    });
    return { view, acceptReady, blocker };
  });

  // Accept-ready only on the page — hide legacy soft-listed / blocked leftovers.
  const mappedGrid = mapped.slice(0, gridRowCount);
  const mappedHeld = mapped.slice(gridRowCount);
  const candidates = mappedGrid.filter((m) => m.acceptReady).map((m) => m.view);
  const agentHeldCandidates = mappedHeld
    .filter((m) => m.acceptReady)
    .map((m) => m.view);

  const acceptReadyVisible = candidates.length;
  const showMoreOnThisSurface = !agentUiEnabled && acceptReadyVisible > 0 && canShowMore;
  const suppressAgentEmpty = agentPhase !== "grid" || agentDontDeal;
  const ladder =
    agentUiEnabled || suppressAgentEmpty
      ? null
      : classifyDiscoveryLadder({
        visibleCount: acceptReadyVisible,
        canShowMore: showMoreOnThisSurface,
        remainingEligible,
        exhaustedRounds,
      });

  // §8 — an empty board is only an onboarding problem when the profile is what
  // filtered it. Cards this session already dropped and the rest of the pool
  // are judged together, since either set can be the one holding the evidence.
  // Don’t-deal / intro / ask must not use Edit onboarding (WAVE-2 §14.7).
  const decided = suppressAgentEmpty
    ? { emptyState: null, editOnboardingBanner: null }
    : resolveShortlistEmptyDecision({
        acceptReadyVisible,
        remainingEligible,
        blockers: mergeBlockerTallies(
          tallyShortlistBlockers(mappedGrid.map((m) => m.blocker)),
          remaining.blockers,
        ),
      });
  let emptyState = decided.emptyState;
  let editOnboardingBanner = decided.editOnboardingBanner;
  // §14.7: hide-dump / seen-key empty aisle is nothing-fits, not Continue /
  // Edit onboarding, unless Fit/budget is the traced profile blocker.
  let agentNothingFits = false;
  if (
    agentUiEnabled &&
    agentPhase === "grid" &&
    !agentDontDeal &&
    acceptReadyVisible === 0
  ) {
    if (emptyState?.cause === "no_scores") {
      editOnboardingBanner = null;
    } else if (
      emptyState?.cause === "profile_filtered" &&
      remaining.blockers.profile > 0 &&
      remaining.hideDumpDropped === 0
    ) {
      agentNothingFits = false;
    } else {
      agentNothingFits = true;
      emptyState = null;
      editOnboardingBanner = null;
    }
  }

  let editOnboardingUnlock: OnboardingUnlockAdvice | null = null;
  if (editOnboardingBanner && onboarding) {
    let unlockCatalog = await resolveDiscoveryCatalogSource();
    if (restrictCategories && restrictCategories.length > 0) {
      unlockCatalog = filterCatalogByIndustries(
        unlockCatalog,
        restrictCategories as AgentFrame["industryIds"],
      );
    }
    if (agentUiEnabled && agentFrame.skipRefuse === "cheap_storage") {
      unlockCatalog = unlockCatalog.filter((p) => !isCheapStorageDrop(p));
    }
    const advice = pickOnboardingUnlock({
      profile: {
        ...toFitProfile(onboarding),
        monthlyFollowOnBudget: onboarding.monthlyFollowOnBudget,
      },
      catalog: unlockCatalog,
      systemGateEnabled,
      liveSearchEnabled: isDiscoveryLiveSearchEnabled(),
      scoresByKey,
      hideDump: {
        poolV2: isDiscoveryPoolV2Enabled(),
        agentUi: agentUiEnabled,
      },
    });
    if (advice) {
      editOnboardingUnlock = advice;
    } else {
      editOnboardingBanner = null;
      if (
        agentUiEnabled &&
        agentPhase === "grid" &&
        !agentDontDeal &&
        acceptReadyVisible === 0 &&
        emptyState?.cause !== "no_scores"
      ) {
        agentNothingFits = true;
        emptyState = null;
      }
    }
  }

  const undoableRejects = selectUndoableRejects(
    await loadSessionRejects(freshSession.id),
    { activeSessionId: freshSession.id, now },
  ).map((r) => ({ candidateId: r.id, name: r.name }));

  // §7 measurement loop. Deduped per session, so the counters survive the
  // re-renders and revalidates a single visit produces.
  if (agentPhase === "grid" && !agentDontDeal) {
    await recordDiscoveryMetric({
      workspaceId,
      kind: acceptReadyVisible > 0 ? "shortlist_shown" : "shortlist_empty",
      sessionId: freshSession.id,
      dedupeKey: shortlistOutcomeDedupeKey(freshSession.id),
    });
    // A data outage is counted as its own empty kind so the edit-onboarding rate
    // keeps measuring profile-driven nags only (§7.1).
    if (emptyState?.cause === "no_scores") {
      await recordDiscoveryMetric({
        workspaceId,
        kind: "shortlist_empty_no_scores",
        sessionId: freshSession.id,
        dedupeKey: sessionMetricDedupeKey(
          freshSession.id,
          "shortlist_empty_no_scores",
        ),
      });
    }
    if (editOnboardingBanner) {
      await recordDiscoveryMetric({
        workspaceId,
        kind: "edit_onboarding_shown",
        sessionId: freshSession.id,
        dedupeKey: sessionMetricDedupeKey(
          freshSession.id,
          "edit_onboarding_shown",
        ),
      });
    }
  }

  return {
    sessionId: freshSession.id,
    productsShown: freshSession.productsShown,
    showMoreRemaining: computeShowMoreRemaining(
      freshSession.productsShown,
      cap,
    ),
    canShowMore: showMoreOnThisSurface,
    sessionCap: cap,
    candidates,
    ladder,
    exhaustedRounds,
    remainingEligible,
    editOnboardingBanner,
    editOnboardingUnlock,
    shortlistEmptyState: emptyState,
    suggestionExplainEnabled: suggestionEnabled,
    geminiConfigured,
    whyPickEnabled: suggestionEnabled,
    canRefreshSuggestions,
    undoableRejects,
    agentUiEnabled,
    agentPhase,
    agentIntroSeen,
    agentFrame,
    agentDontDeal,
    agentNothingFits,
    agentHeldCandidates,
    agentExploreMoreCount: freshSession.exploreMoreCount,
    onboardingIndustryLikes: onboarding
      ? parseOnboardingIndustryLikes(onboarding.categoryLikes)
      : [],
  };
}
