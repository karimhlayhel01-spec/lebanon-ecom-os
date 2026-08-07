/**
 * §6.1 “Why we suggested this” — Gemini narrates skill payloads (not a scoring brain).
 */

import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import {
  checkWhyPickRateLimit,
  deleteCachedWhyPick,
  getCachedWhyPick,
  recordWhyPickRateHit,
  setCachedWhyPick,
  whyPickCacheKey,
} from "@/lib/discovery/explain/cache";
import {
  isGeminiConfigured,
  isSuggestionExplainEnabled,
  narrateSuggestionWithGemini,
  resolveGeminiApiKey,
} from "@/lib/discovery/explain/llm";
import {
  isCompleteSuggestionBody,
  skillPayloadFromCandidateMeta,
  type WhyPickLocale,
  type WhyPickResult,
} from "@/lib/discovery/explain/why-pick";
import { getScoreForPoolProduct } from "@/lib/discovery/scores";

export type WhyPickServiceResult =
  | { ok: true; result: WhyPickResult; cached: boolean }
  | {
      ok: false;
      error:
        | "feature_off"
        | "missing_key"
        | "not_found"
        | "rate_limited"
        | "no_session"
        | "api_error"
        | "ungrounded"
        | "okay_mismatch"
        | "incomplete"
        | "empty"
        | "error";
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

/**
 * Build (or return cached) suggestion paragraph for a candidate.
 * Requires Gemini key — fail closed (no template product UX).
 * Does not write productCandidates / scores / approvals.
 */
export async function explainWhyThisPick(input: {
  workspaceId: string;
  candidateId: string;
  locale: WhyPickLocale;
}): Promise<WhyPickServiceResult> {
  if (!isSuggestionExplainEnabled()) {
    return { ok: false, error: "feature_off" };
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_key" };
  }

  await ensureMigrated();

  const candidate = await db
    .select()
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.id, input.candidateId))
    .then((rows) => rows[0]);

  if (!candidate || candidate.workspaceId !== input.workspaceId) {
    return { ok: false, error: "not_found" };
  }
  if (!candidate.sessionId) {
    return { ok: false, error: "no_session" };
  }

  const cacheKey = whyPickCacheKey(
    candidate.sessionId,
    candidate.id,
    input.locale,
  );
  const cached = getCachedWhyPick(cacheKey);
  if (cached && cached.body) {
    if (isCompleteSuggestionBody(cached.body)) {
      return { ok: true, result: cached, cached: true };
    }
    deleteCachedWhyPick(cacheKey);
  }

  const rate = checkWhyPickRateLimit(input.workspaceId);
  if (!rate.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  let catalogKey = "";
  try {
    catalogKey = JSON.parse(candidate.fitBreakdown).catalogKey ?? "";
  } catch {
    catalogKey = "";
  }

  let scoreEvidenceSource: string | null = null;
  let scoreEvidence: Record<string, unknown> | null = null;
  let curatedDifferentiation = candidate.differentiation?.trim() || null;
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
        differentiationEn: schema.discoveryProductPool.differentiationEn,
        differentiationAr: schema.discoveryProductPool.differentiationAr,
      })
      .from(schema.discoveryProductPool)
      .where(eq(schema.discoveryProductPool.catalogKey, catalogKey))
      .then((rows) => rows[0]);
    if (poolRow) {
      const score = await getScoreForPoolProduct(poolRow.id);
      const parsedEvidence = parseScoreEvidence(score?.rawEvidenceJson);
      scoreEvidenceSource = parsedEvidence.source;
      scoreEvidence = parsedEvidence.evidence;
      curatedDifferentiation =
        (input.locale === "ar"
          ? poolRow.differentiationAr
          : poolRow.differentiationEn
        )?.trim() ||
        curatedDifferentiation;
      if (score) {
        scoreCache = {
          demandPath: score.demandPath,
          competitionScore: score.competitionScore,
          budgetFightPenalty: score.budgetFightPenalty,
          // Same confidence the view reads, so both resolve one Okay reason.
          confidence: score.confidence,
        };
      }
    }
  }

  const payload = skillPayloadFromCandidateMeta({
    productName: candidate.name,
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

  const narrated = await narrateSuggestionWithGemini(payload, input.locale, {
    apiKey,
  });
  if (!narrated.ok) {
    return { ok: false, error: narrated.error };
  }

  recordWhyPickRateHit(input.workspaceId);
  setCachedWhyPick(cacheKey, narrated.result);
  return { ok: true, result: narrated.result, cached: false };
}

export { isGeminiConfigured, isSuggestionExplainEnabled };

/** Snapshot helper for tests — proves explain path does not expose mutators. */
export const WHY_PICK_READ_ONLY_SEAM = true as const;
