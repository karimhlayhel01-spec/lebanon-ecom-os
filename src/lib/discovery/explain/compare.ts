/**
 * WAVE-2 §6.2 compare brief — Gemini narrates a skills-picked winner only.
 * Advice only; never changes Accept gates or shortlist ranking.
 */

import {
  assertFounderFriendlyCopy,
  assertNoUngroundedMarketClaims,
  canCiteMarketFromPayload,
  clampSuggestionBody,
  type WhyPickSkillPayload,
} from "@/lib/discovery/explain/why-pick";

export const COMPARE_BODY_MIN_CHARS = 500;
export const COMPARE_BODY_MAX_CHARS = 1600;

export type CompareProductPayload = WhyPickSkillPayload & {
  candidateId: string;
  catalogKey: string;
};

export type CompareExplainPayload = {
  advisedCandidateId: string;
  advisedCatalogKey: string;
  advisedName: string;
  products: CompareProductPayload[];
  /** True when any selected product has live-citable evidence. */
  anyLiveEvidence: boolean;
};

export type CompareExplainResult = {
  titleKey: "compareResultTitle";
  body: string;
  honestyKey: "whySuggestedHonestyLive" | "whySuggestedHonestyEstimate";
  source: "llm";
  advisedCandidateId: string;
  advisedCatalogKey: string;
  advisedName: string;
  marketSignalsOmitted: boolean;
};

export function isCompleteCompareBody(body: string): boolean {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length < COMPARE_BODY_MIN_CHARS || t.length > COMPARE_BODY_MAX_CHARS) {
    return false;
  }
  if (t.endsWith("…")) return false;
  if (!/[.!?。]["'")\]]*$/u.test(t)) return false;
  const sentences = t
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 4 || sentences.length > 8) return false;
  for (const s of sentences) {
    if (s.split(/\s+/).filter(Boolean).length < 5) return false;
  }
  return true;
}

export function finalizeCompareBody(
  raw: string,
  advisedName: string,
): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (!/[.!?。]["'")\]]*$/u.test(text)) {
    const m = text.match(/^[\s\S]*[.!?。]/);
    if (!m) return null;
    text = m[0].trim();
  }

  text = clampSuggestionBody(text, COMPARE_BODY_MAX_CHARS);
  if (text.endsWith("…")) {
    const without = text.slice(0, -1).trim();
    const m = without.match(/^[\s\S]*[.!?。]/);
    if (!m) return null;
    text = m[0].trim();
  }

  {
    const sentences = text
      .split(/(?<=[.!?。])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length > 8) {
      text = sentences.slice(0, 8).join(" ");
    }
  }

  if (!isCompleteCompareBody(text)) return null;
  if (!assertFounderFriendlyCopy(text)) return null;
  // Compare briefs may name the advised product up to 3 times across 2–3 cards.
  const name = advisedName.trim();
  if (name) {
    const mentions = text.toLowerCase().split(name.toLowerCase()).length - 1;
    if (mentions < 1 || mentions > 3) return null;
  }
  return text;
}

/**
 * Gemini must narrate the skills winner — never promote another product as
 * the advised pick. Soft check: advised name present; no “must accept”.
 */
export function assertCompareAdviceAligned(
  body: string,
  payload: CompareExplainPayload,
): boolean {
  const name = payload.advisedName.trim();
  if (!name) return false;
  const mentions = body.toLowerCase().split(name.toLowerCase()).length - 1;
  if (mentions < 1 || mentions > 3) return false;
  if (/\byou must accept\b|must accept\b|اقبل حتماً|يجب أن تقبل/iu.test(body)) {
    return false;
  }

  // Reject if another selected product is framed as the advised winner.
  for (const other of payload.products) {
    if (other.candidateId === payload.advisedCandidateId) continue;
    const otherName = other.productName.trim();
    if (!otherName) continue;
    const escaped = otherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const otherAdvised = new RegExp(
      `(?:advised?|recommend(?:s|ed)?|skills advise|يُنصح|ننصح)\\b[^.]{0,48}${escaped}`,
      "iu",
    );
    if (otherAdvised.test(body)) return false;
  }

  const lower = body.toLowerCase();
  const advisedLower = name.toLowerCase();
  const adviceNearWinner =
    lower.includes(advisedLower) &&
    /(?:advised|recommend|strongest among|skills|best (?:among|of)|يُنصح|ننصح|الأقوى)/iu.test(
      body,
    );
  if (adviceNearWinner) return true;
  return (
    lower.indexOf(advisedLower) >= 0 &&
    /(?:among|between|compared|من بين|مقارنة)/iu.test(body)
  );
}

export function assertCompareGrounded(
  body: string,
  products: readonly CompareProductPayload[],
): boolean {
  const live = products.filter((p) => canCiteMarketFromPayload(p));
  if (live.length === 0) {
    return assertNoUngroundedMarketClaims(body, false);
  }

  const abroadResults = live.flatMap((p) => p.marketEvidence?.abroad?.results ?? []);
  const lebanonResults = live.flatMap(
    (p) => p.marketEvidence?.lebanon?.results ?? [],
  );
  const localResults = live.flatMap(
    (p) => p.marketEvidence?.localCompetition?.results ?? [],
  );
  const tier1Found = [
    ...new Set(
      live.flatMap((p) => p.marketEvidence?.tier1Found ?? []).filter(Boolean),
    ),
  ];
  const abroadCount = Math.max(
    0,
    ...live.map((p) => p.marketEvidence?.abroad?.count ?? 0),
  );
  const lebanonCount = Math.max(
    0,
    ...live.map((p) => p.marketEvidence?.lebanon?.count ?? 0),
  );
  const localCount = Math.max(
    0,
    ...live.map((p) => p.marketEvidence?.localCompetition?.count ?? 0),
  );

  const merged: WhyPickSkillPayload = {
    productName: live[0]!.productName,
    fitScore: live[0]!.fitScore,
    strength: live[0]!.strength,
    canCiteMarketSignals: true,
    evidenceSource: "live_search",
    marketEvidence: {
      abroad:
        abroadCount > 0
          ? { count: abroadCount, results: abroadResults.slice(0, 5) }
          : null,
      lebanon:
        lebanonCount > 0
          ? { count: lebanonCount, results: lebanonResults.slice(0, 5) }
          : null,
      localCompetition:
        localCount > 0
          ? { count: localCount, results: localResults.slice(0, 5) }
          : null,
      tier1Found: tier1Found.length > 0 ? tier1Found.slice(0, 5) : null,
    },
  };
  return assertNoUngroundedMarketClaims(body, merged);
}

export function buildCompareExplainPayload(input: {
  advisedCandidateId: string;
  products: CompareProductPayload[];
}): CompareExplainPayload {
  const advised = input.products.find(
    (p) => p.candidateId === input.advisedCandidateId,
  );
  if (!advised) {
    throw new Error("advised candidate missing from compare products");
  }
  const anyLiveEvidence = input.products.some((p) =>
    canCiteMarketFromPayload(p),
  );
  return {
    advisedCandidateId: advised.candidateId,
    advisedCatalogKey: advised.catalogKey,
    advisedName: advised.productName,
    products: input.products,
    anyLiveEvidence,
  };
}
