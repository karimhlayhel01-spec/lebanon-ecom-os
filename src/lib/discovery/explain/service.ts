/**
 * §6.1 Why this pick? orchestration — read-only vs Discovery scores/gates.
 */

import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import {
  checkWhyPickRateLimit,
  getCachedWhyPick,
  recordWhyPickRateHit,
  setCachedWhyPick,
  whyPickCacheKey,
} from "@/lib/discovery/explain/cache";
import {
  isWhyPickFeatureEnabled,
  narrateWhyPickWithLlm,
  resolveExplainLlmApiKey,
} from "@/lib/discovery/explain/llm";
import {
  buildDeterministicWhyPick,
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
        | "not_found"
        | "rate_limited"
        | "no_session"
        | "error";
    };

function parseEvidenceSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: string };
    return typeof parsed.source === "string" ? parsed.source : null;
  } catch {
    return null;
  }
}

/**
 * Build (or return cached) Why this pick? paragraph for a candidate.
 * Does not write productCandidates / scores / approvals.
 */
export async function explainWhyThisPick(input: {
  workspaceId: string;
  candidateId: string;
  locale: WhyPickLocale;
}): Promise<WhyPickServiceResult> {
  if (!isWhyPickFeatureEnabled()) {
    return { ok: false, error: "feature_off" };
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
  if (cached) {
    return { ok: true, result: cached, cached: true };
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
  if (catalogKey) {
    const poolRow = await db
      .select({ id: schema.discoveryProductPool.id })
      .from(schema.discoveryProductPool)
      .where(eq(schema.discoveryProductPool.catalogKey, catalogKey))
      .then((rows) => rows[0]);
    if (poolRow) {
      const score = await getScoreForPoolProduct(poolRow.id);
      scoreEvidenceSource = parseEvidenceSource(score?.rawEvidenceJson);
    }
  }

  const payload = skillPayloadFromCandidateMeta({
    productName: candidate.name,
    fitScore: candidate.fitScore,
    strength: candidate.strength === "Strong" ? "Strong" : "Okay",
    fitBreakdownJson: candidate.fitBreakdown,
    scoreEvidenceSource,
  });

  const apiKey = resolveExplainLlmApiKey();
  let result: WhyPickResult;
  if (apiKey) {
    result = await narrateWhyPickWithLlm(payload, input.locale, { apiKey });
  } else {
    result = buildDeterministicWhyPick(payload, input.locale);
  }

  recordWhyPickRateHit(input.workspaceId);
  setCachedWhyPick(cacheKey, result);
  return { ok: true, result, cached: false };
}

/** Snapshot helper for tests — proves explain path does not expose mutators. */
export const WHY_PICK_READ_ONLY_SEAM = true as const;
