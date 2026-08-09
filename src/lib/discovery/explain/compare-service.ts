/**
 * §6.2 Worth-considering compare — skills pick + Gemini explain.
 * Read-only vs scores / accept / shortlist.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import {
  DISCOVERY_COMPARE_MAX,
  DISCOVERY_COMPARE_MIN,
} from "@/lib/constants";
import {
  pickCompareWinner,
  signalsFromFitBreakdown,
} from "@/lib/discovery/compare/pick";
import {
  compareCacheKey,
  checkWhyPickRateLimit,
  deleteCachedCompare,
  getCachedCompare,
  recordWhyPickRateHit,
  setCachedCompare,
} from "@/lib/discovery/explain/cache";
import {
  buildCompareExplainPayload,
  isCompleteCompareBody,
  type CompareExplainResult,
  type CompareProductPayload,
} from "@/lib/discovery/explain/compare";
import { narrateCompareWithGemini } from "@/lib/discovery/explain/compare-llm";
import {
  isGeminiConfigured,
  isSuggestionExplainEnabled,
  resolveGeminiApiKey,
} from "@/lib/discovery/explain/llm";
import {
  skillPayloadFromCandidateMeta,
  type WhyPickLocale,
} from "@/lib/discovery/explain/why-pick";
import { resolveDisplayProductName } from "@/lib/discovery/localize";
import { getScoreForPoolProduct } from "@/lib/discovery/scores";

export type CompareServiceResult =
  | {
      ok: true;
      result: CompareExplainResult;
      cached: boolean;
    }
  | {
      ok: false;
      error:
        | "feature_off"
        | "missing_key"
        | "not_found"
        | "rate_limited"
        | "no_session"
        | "invalid_selection"
        | "stale_selection"
        | "api_error"
        | "ungrounded"
        | "misaligned"
        | "incomplete"
        | "empty"
        | "error";
      /** Skills pick — present once the winner was computed, even on narrate failure. */
      advisedCandidateId?: string;
      advisedCatalogKey?: string;
      advisedName?: string;
    };

function parseScoreEvidence(
  raw: string | null | undefined,
): { source: string | null; evidence: Record<string, unknown> | null } {
  if (!raw) return { source: null, evidence: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      source: typeof parsed.source === "string" ? parsed.source : null,
      evidence: parsed,
    };
  } catch {
    return { source: null, evidence: null };
  }
}

async function loadCompareProductPayload(input: {
  candidate: typeof schema.productCandidates.$inferSelect;
  locale: WhyPickLocale;
}): Promise<CompareProductPayload> {
  const { candidate, locale } = input;
  let catalogKey = "";
  try {
    catalogKey = JSON.parse(candidate.fitBreakdown).catalogKey ?? "";
  } catch {
    catalogKey = "";
  }

  let scoreEvidenceSource: string | null = null;
  let scoreEvidence: Record<string, unknown> | null = null;
  let curatedDifferentiation = candidate.differentiation?.trim() || null;
  let displayProductName = resolveDisplayProductName({
    locale,
    nameEn: candidate.name,
    nameAr: "",
    fallbackName: candidate.name,
  });
  let scoreCache: {
    demandPath?: string | null;
    competitionScore?: number | null;
    budgetFightPenalty?: number | null;
    confidence?: number | null;
  } | null = null;

  if (catalogKey) {
    const poolRow = await db
      .select({
        id: schema.discoveryProductPool.id,
        nameEn: schema.discoveryProductPool.nameEn,
        nameAr: schema.discoveryProductPool.nameAr,
        differentiationEn: schema.discoveryProductPool.differentiationEn,
        differentiationAr: schema.discoveryProductPool.differentiationAr,
      })
      .from(schema.discoveryProductPool)
      .where(eq(schema.discoveryProductPool.catalogKey, catalogKey))
      .then((rows) => rows[0]);
    if (poolRow) {
      displayProductName = resolveDisplayProductName({
        locale,
        nameEn: poolRow.nameEn,
        nameAr: poolRow.nameAr,
        fallbackName: candidate.name,
      });
      const score = await getScoreForPoolProduct(poolRow.id);
      const parsedEvidence = parseScoreEvidence(score?.rawEvidenceJson);
      scoreEvidenceSource = parsedEvidence.source;
      scoreEvidence = parsedEvidence.evidence;
      curatedDifferentiation =
        (locale === "ar"
          ? poolRow.differentiationAr
          : poolRow.differentiationEn
        )?.trim() || curatedDifferentiation;
      if (score) {
        scoreCache = {
          demandPath: score.demandPath,
          competitionScore: score.competitionScore,
          budgetFightPenalty: score.budgetFightPenalty,
          confidence: score.confidence,
        };
      }
    }
  }

  const base = skillPayloadFromCandidateMeta({
    productName: displayProductName,
    category: candidate.category,
    fitScore: candidate.fitScore,
    strength: candidate.strength === "Strong" ? "Strong" : "Okay",
    fitBreakdownJson: candidate.fitBreakdown,
    riskRead: candidate.riskRead,
    marginBefore: candidate.marginBefore,
    marginAfter: candidate.marginAfter,
    curatedDifferentiation,
    scoreEvidenceSource,
    scoreEvidence,
    scoreCache,
  });

  return {
    ...base,
    candidateId: candidate.id,
    catalogKey,
  };
}

/**
 * Skills-rank selected shown candidates, then Gemini explains the advised pick.
 * Does not write productCandidates / scores / approvals.
 */
export async function explainWorthConsideringCompare(input: {
  workspaceId: string;
  candidateIds: string[];
  locale: WhyPickLocale;
}): Promise<CompareServiceResult> {
  if (!isSuggestionExplainEnabled()) {
    return { ok: false, error: "feature_off" };
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_key" };
  }

  const uniqueIds = [...new Set(input.candidateIds.filter(Boolean))];
  if (
    uniqueIds.length < DISCOVERY_COMPARE_MIN ||
    uniqueIds.length > DISCOVERY_COMPARE_MAX
  ) {
    return { ok: false, error: "invalid_selection" };
  }

  await ensureMigrated();

  const session = await db
    .select()
    .from(schema.discoverySessions)
    .where(
      and(
        eq(schema.discoverySessions.workspaceId, input.workspaceId),
        eq(schema.discoverySessions.status, "active"),
      ),
    )
    .then((rows) => rows[0]);
  if (!session) {
    return { ok: false, error: "no_session" };
  }

  const rows = await db
    .select()
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.workspaceId, input.workspaceId),
        eq(schema.productCandidates.sessionId, session.id),
        eq(schema.productCandidates.status, "shown"),
        inArray(schema.productCandidates.id, uniqueIds),
      ),
    );

  if (rows.length !== uniqueIds.length) {
    return { ok: false, error: "stale_selection" };
  }

  // Visible = still within productsShown window.
  const visible = rows.filter((r) => r.rank < session.productsShown);
  if (visible.length !== uniqueIds.length) {
    return { ok: false, error: "stale_selection" };
  }

  const cacheKey = compareCacheKey(session.id, uniqueIds, input.locale);
  const cached = getCachedCompare(cacheKey);
  if (cached && isCompleteCompareBody(cached.body)) {
    return { ok: true, result: cached, cached: true };
  }
  if (cached) deleteCachedCompare(cacheKey);

  const rate = checkWhyPickRateLimit(input.workspaceId);
  if (!rate.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const signals = visible.map((r) =>
    signalsFromFitBreakdown(r.fitBreakdown, {
      candidateId: r.id,
      name: r.name,
      fitScore: r.fitScore,
      rank: r.rank,
      strength: r.strength === "Strong" ? "Strong" : "Okay",
      marginsPass: r.marginsPass,
    }),
  );
  const pick = pickCompareWinner(signals);

  const products: CompareProductPayload[] = [];
  for (const row of visible) {
    products.push(
      await loadCompareProductPayload({
        candidate: row,
        locale: input.locale,
      }),
    );
  }

  // Keep product order aligned with skills ranking for the prompt.
  const byId = new Map(products.map((p) => [p.candidateId, p]));
  const orderedProducts = pick.ordered
    .map((s) => byId.get(s.candidateId))
    .filter((p): p is CompareProductPayload => Boolean(p));

  const payload = buildCompareExplainPayload({
    advisedCandidateId: pick.advised.candidateId,
    products: orderedProducts,
  });

  const advisedMeta = {
    advisedCandidateId: payload.advisedCandidateId,
    advisedCatalogKey: payload.advisedCatalogKey,
    advisedName: payload.advisedName,
  };

  const narrated = await narrateCompareWithGemini(payload, input.locale, {
    apiKey,
  });
  if (!narrated.ok) {
    return { ok: false, error: narrated.error, ...advisedMeta };
  }

  recordWhyPickRateHit(input.workspaceId);
  setCachedCompare(cacheKey, narrated.result);
  return { ok: true, result: narrated.result, cached: false };
}

export { isGeminiConfigured, isSuggestionExplainEnabled };

/** Snapshot helper for tests — compare path is explain-only. */
export const COMPARE_READ_ONLY_SEAM = true as const;
