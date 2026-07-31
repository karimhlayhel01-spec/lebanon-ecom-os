import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
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
  curatedDemandProvider,
  getCatalogProduct,
  localizedProduct,
  type CatalogProduct,
  type DemandProvider,
} from "@/lib/discovery/catalog";
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
  ensureMigrated();
  return db
    .select()
    .from(schema.discoverySessions)
    .where(
      and(
        eq(schema.discoverySessions.workspaceId, workspaceId),
        eq(schema.discoverySessions.status, "active"),
      ),
    )
    .get();
}

/** Number of candidates generated for a session (the reveal pool size). */
async function poolSize(sessionId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.productCandidates.id })
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.sessionId, sessionId))
    .all();
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
  ensureMigrated();
  const rows = await db
    .select({ fitBreakdown: schema.productCandidates.fitBreakdown })
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.workspaceId, workspaceId))
    .all();
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
};

/**
 * Score + rank catalog products for a profile. Excludes seen keys. Same Fit /
 * Margin / maxLanded rules as the first session (never-all-blocked ranking).
 */
export function scoreRankCatalog(
  onboarding: OnboardingRow,
  excludeKeys: ReadonlySet<string> = new Set(),
): ScoredProduct[] {
  const profile = toFitProfile(onboarding);
  const sourceCatalog = selectLandedCostPool(
    CATALOG,
    onboarding.maxLandedCost,
  ).filter((p) => !excludeKeys.has(p.key));

  const scored = sourceCatalog.map((p) => {
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
  });

  scored.sort((a, b) => {
    const aAcc = a.margin.pass && !a.p.oversized ? 0 : 1;
    const bAcc = b.margin.pass && !b.p.oversized ? 0 : 1;
    if (aAcc !== bAcc) return aAcc - bAcc;
    if (a.fit.notRecommended !== b.fit.notRecommended) {
      return a.fit.notRecommended ? 1 : -1;
    }
    return b.fit.score - a.fit.score;
  });

  return scored;
}

export async function countRemainingEligible(
  workspaceId: string,
  onboarding: OnboardingRow,
): Promise<number> {
  const seen = await getSeenCatalogKeys(workspaceId);
  return scoreRankCatalog(onboarding, seen).length;
}

async function getExhaustedRounds(workspaceId: string): Promise<number> {
  const side = await db
    .select({
      discoveryExhaustedRounds: schema.sideStatuses.discoveryExhaustedRounds,
    })
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId))
    .get();
  return side?.discoveryExhaustedRounds ?? 0;
}

export async function resetDiscoveryExhaustedRounds(
  workspaceId: string,
): Promise<void> {
  ensureMigrated();
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
    .all();
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
  if (pool.length === 0) return undefined;

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

  await db.insert(schema.productCandidates).values(
    pool.map(({ p, fit, margin }, i) => ({
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
      fitBreakdown: JSON.stringify({ dims: fit.breakdown, catalogKey: p.key }),
      strength: fit.strength,
      riskRead: fit.riskRead,
      differentiation: p.en.differentiation,
      tier1Conflict: p.tier1Marketplaces.length > 0,
      tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
      oversizedHardBlock: p.oversized,
      notRecommended: fit.notRecommended,
      demandConfirmed: false,
      status: "shown" as const,
      rank: i,
      createdAt,
    })),
  );

  return getActiveSession(workspaceId);
}

/**
 * Start a discovery session: score the curated catalog against the founder's
 * ability profile + Shared Margin skill, rank so acceptable products come
 * first (never an all-blocked page), and reveal the first 5.
 */
export async function startDiscoverySession(
  workspaceId: string,
  onboarding: OnboardingRow,
) {
  ensureMigrated();

  const existing = await getActiveSession(workspaceId);
  if (existing) return existing;

  const scored = scoreRankCatalog(onboarding);
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
  ensureMigrated();

  const existing = await getActiveSession(workspaceId);
  if (!existing) return { ok: false, error: "no_session" };

  await maybeCountExhaustion(workspaceId);

  // Score next pool before closing — keep the exhausted session if nothing left (D).
  const seen = await getSeenCatalogKeys(workspaceId);
  const scored = scoreRankCatalog(onboarding, seen);
  if (scored.length === 0) return { ok: false, error: "catalog_exhausted" };

  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.id, existing.id));

  const session = await insertSessionPool(workspaceId, scored);
  if (!session) return { ok: false, error: "catalog_exhausted" };
  return { ok: true };
}

export async function submitDiscoveryPassFeedback(
  workspaceId: string,
  input: { reasons: DiscoveryPassReason[]; otherNote?: string },
): Promise<{ ok: true } | { ok: false; error: "empty" }> {
  ensureMigrated();
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
  ensureMigrated();
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
  ensureMigrated();
  const row = await db
    .select()
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.id, candidateId))
    .get();
  if (!row || row.workspaceId !== workspaceId) return undefined;
  return row;
}

export async function confirmDemand(
  workspaceId: string,
  candidateId: string,
  input: { url?: string; note?: string; screenshotNote?: string },
  locale: AppLocale,
  provider: DemandProvider = curatedDemandProvider,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  ensureMigrated();
  const candidate = await getCandidateOwned(workspaceId, candidateId);
  if (!candidate) return { ok: false, error: "not_found" };

  if (!input.url && !input.note && !input.screenshotNote) {
    return { ok: false, error: "empty_signal" };
  }

  const { summary } = provider.summarize({
    productName: candidate.name,
    category: candidate.category,
    url: input.url,
    note: input.note,
    screenshotNote: input.screenshotNote,
    locale,
  });

  await db.insert(schema.demandSignals).values({
    id: newId(),
    workspaceId,
    productCandidateId: candidateId,
    url: input.url ?? null,
    note: input.note ?? null,
    screenshotNote: input.screenshotNote ?? null,
    aiSummary: summary,
    founderConfirmed: true,
    createdAt: nowIso(),
  });

  await db
    .update(schema.productCandidates)
    .set({ demandConfirmed: true })
    .where(eq(schema.productCandidates.id, candidateId));

  return { ok: true, summary };
}

export async function resolveTier1(
  workspaceId: string,
  candidateId: string,
  choice: "customize" | "drop",
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
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
  ensureMigrated();
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
        | "needs_demand"
        | "needs_risk_ack"
        | "error";
    };

/**
 * Accept a product through the Human Approvals `accept_product` gate. On
 * approval the SKU journey advances to supplier_sample and Topic B basics +
 * active SKU + side status are written. Works for first SKU (workspace in
 * discovery) and for add-SKU (additional live SKUs while others continue).
 */
export async function acceptProduct(
  workspaceId: string,
  candidateId: string,
  riskReadAck: boolean,
): Promise<AcceptResult> {
  ensureMigrated();

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
  if (!candidate.demandConfirmed) {
    return { ok: false, error: "needs_demand" };
  }

  const requiredAcks = candidate.strength === "Okay" ? ["okay_risk_read"] : [];
  // Pre-check the acknowledgement so we never open a lingering pending gate.
  if (requiredAcks.length > 0 && !riskReadAck) {
    return { ok: false, error: "needs_risk_ack" };
  }

  const approval = await createApprovalRequest(workspaceId, "accept_product", {
    data: { candidateId, productName: candidate.name },
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

  let catalogKey = "";
  try {
    catalogKey = JSON.parse(candidate.fitBreakdown).catalogKey ?? "";
  } catch {
    catalogKey = "";
  }

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
  /** `@fit.*` note key (or legacy English); UI translates. */
  riskRead: string | null;
  notRecommended: boolean;
  demandConfirmed: boolean;
  /** Saved DemandProvider aiSummary (founder-confirmed signal). Null until confirmed. */
  demandSummary: string | null;
  tier1Conflict: boolean;
  tier1Marketplaces: string[];
  /**
   * H1: Import vs Local planning hint only. Accept / Strong / Okay stay on
   * import `marginsPass` / moneySnapshot — never unlock via local-only margins.
   */
  sourceCostHint: SourceCostHint | null;
};

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
};

export async function getDiscoveryView(
  workspaceId: string,
  locale: AppLocale,
): Promise<DiscoveryView | null> {
  ensureMigrated();
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
    .all();

  const visible = rows.filter((r) => r.rank < freshSession.productsShown);
  const cap = Math.min(DISCOVERY_SESSION_CAP, await poolSize(freshSession.id));
  const canShowMore =
    freshSession.productsShown < cap &&
    freshSession.showMoreUsed < DISCOVERY_SHOW_MORE_MAX;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .get();
  const remainingEligible = onboarding
    ? await countRemainingEligible(workspaceId, onboarding)
    : 0;
  const exhaustedRounds = await getExhaustedRounds(workspaceId);
  const ladder = classifyDiscoveryLadder({
    visibleCount: visible.length,
    canShowMore,
    remainingEligible,
    exhaustedRounds,
  });

  // Latest demand aiSummary per confirmed candidate (written by confirmDemand).
  const confirmedIds = visible
    .filter((r) => r.demandConfirmed)
    .map((r) => r.id);
  const demandSummaryByCandidate = new Map<string, string>();
  if (confirmedIds.length > 0) {
    const signals = await db
      .select({
        productCandidateId: schema.demandSignals.productCandidateId,
        aiSummary: schema.demandSignals.aiSummary,
      })
      .from(schema.demandSignals)
      .where(inArray(schema.demandSignals.productCandidateId, confirmedIds))
      .orderBy(desc(schema.demandSignals.createdAt))
      .all();
    for (const s of signals) {
      if (!demandSummaryByCandidate.has(s.productCandidateId)) {
        demandSummaryByCandidate.set(s.productCandidateId, s.aiSummary);
      }
    }
  }

  const candidates: DiscoveryCandidateView[] = visible.map((r) => {
    let catalogKey = "";
    try {
      catalogKey = JSON.parse(r.fitBreakdown).catalogKey ?? "";
    } catch {
      catalogKey = "";
    }
    const product = getCatalogProduct(catalogKey);
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

    return {
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
      riskRead: r.riskRead,
      notRecommended: r.notRecommended,
      demandConfirmed: r.demandConfirmed,
      demandSummary: demandSummaryByCandidate.get(r.id) ?? null,
      tier1Conflict: r.tier1Conflict,
      tier1Marketplaces,
      sourceCostHint: product
        ? computeSourceCostHint(
            product,
            onboarding?.monthlyFollowOnBudget ?? 0,
          )
        : null,
    };
  });

  return {
    sessionId: freshSession.id,
    productsShown: freshSession.productsShown,
    showMoreRemaining: computeShowMoreRemaining(
      freshSession.productsShown,
      cap,
    ),
    canShowMore,
    sessionCap: cap,
    candidates,
    ladder,
    exhaustedRounds,
    remainingEligible,
  };
}
