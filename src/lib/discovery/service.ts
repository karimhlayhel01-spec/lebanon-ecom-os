import { and, asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  DISCOVERY_INITIAL_COUNT,
  DISCOVERY_SESSION_CAP,
  DISCOVERY_SHOW_MORE_MAX,
} from "@/lib/constants";
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
  createApprovalRequest,
  decideApproval,
} from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import type { AppLocale } from "@/i18n/routing";

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

function landedCostOf(p: CatalogProduct): number {
  return p.productCost + p.intlShip + p.clearanceTaxes + p.localCourier;
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

  const profile = toFitProfile(onboarding);

  const scored = CATALOG.map((p) => {
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

  // Rank: acceptable (margins pass and not oversized) first, then recommended,
  // then by fit score. Guarantees the first page is never all-blocked.
  scored.sort((a, b) => {
    const aAcc = a.margin.pass && !a.p.oversized ? 0 : 1;
    const bAcc = b.margin.pass && !b.p.oversized ? 0 : 1;
    if (aAcc !== bAcc) return aAcc - bAcc;
    if (a.fit.notRecommended !== b.fit.notRecommended) {
      return a.fit.notRecommended ? 1 : -1;
    }
    return b.fit.score - a.fit.score;
  });

  const sessionId = newId();
  const createdAt = nowIso();
  await db.insert(schema.discoverySessions).values({
    id: sessionId,
    workspaceId,
    showMoreUsed: 0,
    productsShown: DISCOVERY_INITIAL_COUNT,
    status: "active",
    createdAt,
  });

  const pool = scored.slice(0, DISCOVERY_SESSION_CAP);
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

/** Reveal the next batch (5) up to 5 clicks / 25 per session. */
export async function showMore(workspaceId: string) {
  ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return;

  const total = await poolSize(session.id);
  const cap = Math.min(DISCOVERY_SESSION_CAP, total);
  if (
    session.showMoreUsed >= DISCOVERY_SHOW_MORE_MAX ||
    session.productsShown >= cap
  ) {
    return;
  }

  await db
    .update(schema.discoverySessions)
    .set({
      productsShown: Math.min(cap, session.productsShown + DISCOVERY_INITIAL_COUNT),
      showMoreUsed: session.showMoreUsed + 1,
    })
    .where(eq(schema.discoverySessions.id, session.id));
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
): Promise<{ ok: boolean; error?: string }> {
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

  return { ok: true };
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
  return { ok: true };
}

export type AcceptResult =
  | { ok: true }
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
 * approval the journey advances (discovery → supplier_sample) and Topic B
 * basics + active SKU + side status are written.
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

  const journey = await getJourney(workspaceId);
  if (!journey || journey.primaryState !== "discovery") {
    return { ok: false, error: "wrong_state" };
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
  });
  if (!approval) return { ok: false, error: "error" };

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

  const landedCost =
    candidate.productCost +
    candidate.intlShip +
    candidate.clearanceTaxes +
    candidate.localCourier;
  const now = nowIso();
  const skuId = newId();

  await db.insert(schema.skuCards).values({
    id: skuId,
    workspaceId,
    productCandidateId: candidate.id,
    name: candidate.name,
    basics: JSON.stringify({
      category: candidate.category,
      sellPrice: candidate.sellPrice,
      landedCost,
      differentiation: candidate.differentiation,
    }),
    shipFitness: candidate.oversizedHardBlock ? "oversized" : "standard-parcel",
    storageAmbiance: "ambient",
    handling: "standard",
    importBatch: JSON.stringify({ moq: null, status: "not_ordered" }),
    moneySnapshot: JSON.stringify({
      sellPrice: candidate.sellPrice,
      landedCost,
      marginBefore: candidate.marginBefore,
      marginAfter: candidate.marginAfter,
    }),
    marketingHooks: candidate.differentiation,
    founderNotes: "",
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(schema.workspaces)
    .set({ activeSkuId: skuId })
    .where(eq(schema.workspaces.id, workspaceId));

  await db
    .update(schema.sideStatuses)
    .set({
      productAccepted: true,
      ...(candidate.strength === "Okay" ? { okayRiskAck: true } : {}),
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  await db
    .update(schema.productCandidates)
    .set({ status: "accepted" })
    .where(eq(schema.productCandidates.id, candidate.id));

  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.workspaceId, workspaceId));

  return { ok: true };
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
  oversized: boolean;
  fitScore: number;
  strength: "Strong" | "Okay";
  riskRead: string | null;
  notRecommended: boolean;
  demandConfirmed: boolean;
  tier1Conflict: boolean;
  tier1Marketplaces: string[];
};

export type DiscoveryView = {
  sessionId: string;
  productsShown: number;
  showMoreRemaining: number;
  canShowMore: boolean;
  sessionCap: number;
  candidates: DiscoveryCandidateView[];
};

export async function getDiscoveryView(
  workspaceId: string,
  locale: AppLocale,
): Promise<DiscoveryView | null> {
  ensureMigrated();
  const session = await getActiveSession(workspaceId);
  if (!session) return null;

  const rows = await db
    .select()
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.sessionId, session.id),
        eq(schema.productCandidates.status, "shown"),
      ),
    )
    .orderBy(asc(schema.productCandidates.rank))
    .all();

  const visible = rows.filter((r) => r.rank < session.productsShown);
  const cap = Math.min(DISCOVERY_SESSION_CAP, await poolSize(session.id));

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
      oversized: r.oversizedHardBlock,
      fitScore: r.fitScore,
      strength: r.strength as "Strong" | "Okay",
      riskRead: r.riskRead,
      notRecommended: r.notRecommended,
      demandConfirmed: r.demandConfirmed,
      tier1Conflict: r.tier1Conflict,
      tier1Marketplaces,
    };
  });

  return {
    sessionId: session.id,
    productsShown: session.productsShown,
    showMoreRemaining: Math.max(0, DISCOVERY_SHOW_MORE_MAX - session.showMoreUsed),
    canShowMore:
      session.showMoreUsed < DISCOVERY_SHOW_MORE_MAX &&
      session.productsShown < cap,
    sessionCap: cap,
    candidates,
  };
}
