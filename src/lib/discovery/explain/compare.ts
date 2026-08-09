/**
 * WAVE-2 §6.2 compare brief — Gemini narrates a skills-picked winner only.
 * Advice only; never changes Accept gates or shortlist ranking.
 */

import {
  assertFounderFriendlyCopy,
  assertNoUngroundedMarketClaims,
  canCiteMarketFromPayload,
  containsFounderJargon,
  containsHardBlockedWording,
  containsStockPhrase,
  FORBIDDEN_UNGROUNDED_MARKET_PHRASES,
  packSuggestionSentences,
  splitSuggestionSentences,
  type WhyPickSkillPayload,
} from "@/lib/discovery/explain/why-pick";

export const COMPARE_BODY_MIN_CHARS = 500;
export const COMPARE_BODY_MAX_CHARS = 1600;
export const COMPARE_BODY_MIN_SENTENCES = 4;
export const COMPARE_BODY_MAX_SENTENCES = 8;
/** Slightly stricter than §6.1 — compare covers 2–3 cards per sentence. */
const COMPARE_MIN_WORDS_PER_SENTENCE = 5;
/**
 * A brief covers 2–3 cards, so the advised product may be named up to three
 * times. Shared with the Gemini instruction so the prompt and the validator
 * cannot drift into rejecting copy we asked for.
 */
export const COMPARE_ADVISED_NAME_MAX_MENTIONS = 3;

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
  if (!/[.!?。؟]["'")\]]*$/u.test(t)) return false;
  const sentences = splitSuggestionSentences(t);
  if (
    sentences.length < COMPARE_BODY_MIN_SENTENCES ||
    sentences.length > COMPARE_BODY_MAX_SENTENCES
  ) {
    return false;
  }
  for (const s of sentences) {
    if (s.split(/\s+/).filter(Boolean).length < COMPARE_MIN_WORDS_PER_SENTENCE) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic skills SoT footer — not a Gemini winner override. Appended only
 * when the packed narration never nominated the advised product and also never
 * nominated a rival (rival-promoting bodies stay rejected).
 */
export function buildCompareSkillsFooter(advisedName: string): string {
  const name = advisedName.trim();
  return `Skills advise starting a sample test on ${name} among these marks; Accept remains your free choice on any card.`;
}

function packOpts() {
  return {
    minChars: COMPARE_BODY_MIN_CHARS,
    maxChars: COMPARE_BODY_MAX_CHARS,
    maxSentences: COMPARE_BODY_MAX_SENTENCES,
  };
}

/**
 * Pack whole sentences, preferring to keep a sentence that already nominates
 * the skills-advised name when a blind prefix would drop it.
 */
function packCompareSentences(
  text: string,
  advisedName: string,
  otherNames: readonly string[],
): string | null {
  const sentences = splitSuggestionSentences(text);
  if (sentences.length === 0) return null;

  const allNames = [advisedName, ...otherNames].map((n) => n.trim()).filter(Boolean);
  const adviceIndexes = sentences
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        promotesProductAsAdvised(s, advisedName, allNames) &&
        !otherNames.some((n) => promotesProductAsAdvised(s, n, allNames)),
    )
    .map(({ i }) => i);
  const preferredAdviceIdx =
    adviceIndexes.length > 0 ? adviceIndexes[adviceIndexes.length - 1]! : -1;

  const prefixPacked = packSuggestionSentences(text, packOpts());
  if (!prefixPacked) return null;

  const kept = splitSuggestionSentences(prefixPacked).length;
  if (preferredAdviceIdx < 0 || preferredAdviceIdx < kept) {
    return prefixPacked;
  }

  // Blind prefix dropped the only advice nomination — rebuild with room for it.
  const adviceSent = sentences[preferredAdviceIdx]!;
  const rebuilt: string[] = [];
  for (let i = 0; i < preferredAdviceIdx; i++) {
    if (rebuilt.length >= COMPARE_BODY_MAX_SENTENCES - 1) break;
    const trial = [...rebuilt, sentences[i]!, adviceSent].join(" ");
    if (trial.length > COMPARE_BODY_MAX_CHARS) break;
    rebuilt.push(sentences[i]!);
  }
  const withAdvice = [...rebuilt, adviceSent].join(" ");
  if (
    withAdvice.length >= COMPARE_BODY_MIN_CHARS &&
    withAdvice.length <= COMPARE_BODY_MAX_CHARS &&
    splitSuggestionSentences(withAdvice).length <= COMPARE_BODY_MAX_SENTENCES
  ) {
    return withAdvice;
  }
  return prefixPacked;
}

/**
 * When narration never nominates the advised product (and never nominates a
 * rival), append the skills footer. Rival-promoting bodies are left untouched
 * so alignment still rejects them.
 */
function ensureSkillsAdviceNomination(
  body: string,
  advisedName: string,
  otherNames: readonly string[],
): string {
  const name = advisedName.trim();
  if (!name) return body;
  const allNames = [name, ...otherNames].map((n) => n.trim()).filter(Boolean);
  if (otherNames.some((n) => promotesProductAsAdvised(body, n, allNames))) {
    return body;
  }
  if (promotesProductAsAdvised(body, name, allNames)) {
    return body;
  }

  const mentions = countMentions(body, name);
  if (mentions >= COMPARE_ADVISED_NAME_MAX_MENTIONS) {
    return body;
  }

  const footer = buildCompareSkillsFooter(name);
  const sentences = splitSuggestionSentences(body);
  // Need one free sentence slot for the footer.
  let kept = sentences;
  while (kept.length >= COMPARE_BODY_MAX_SENTENCES) {
    kept = kept.slice(0, -1);
  }
  while (kept.length > 0) {
    const candidate = `${kept.join(" ")} ${footer}`.replace(/\s+/g, " ").trim();
    if (
      candidate.length <= COMPARE_BODY_MAX_CHARS &&
      splitSuggestionSentences(candidate).length <= COMPARE_BODY_MAX_SENTENCES &&
      countMentions(candidate, name) <= COMPARE_ADVISED_NAME_MAX_MENTIONS
    ) {
      return candidate;
    }
    kept = kept.slice(0, -1);
  }
  return body;
}

/**
 * Normalize Gemini compare text into a complete founder brief, or null when no
 * whole-sentence prefix fits the locked window.
 *
 * Packing prefers an advice-nominating sentence; when the packed body still
 * never nominates the skills winner (and never nominates a rival), a short
 * deterministic skills footer is appended. Mention-cap and rival-promotion
 * checks stay in `assertCompareAdviceAligned`.
 */
export function finalizeCompareBody(
  raw: string,
  advisedName: string = "",
  otherNames: readonly string[] = [],
): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Drop trailing incomplete fragment after the last sentence end.
  if (!/[.!?。؟]["'")\]]*$/u.test(text)) {
    const m = text.match(/^[\s\S]*[.!?。؟]/);
    if (!m) return null;
    text = m[0].trim();
  }

  const packed = packCompareSentences(text, advisedName, otherNames);
  if (!packed) return null;
  text = ensureSkillsAdviceNomination(packed, advisedName, otherNames);

  if (!isCompleteCompareBody(text)) return null;
  if (!assertFounderFriendlyCopy(text)) return null;
  return text;
}

/**
 * Cheap pre-check on the raw draft — same spirit as §6.1
 * `containsHardBlockedWording`. Length / domain / count rules wait until after
 * finalize so a stray trailing sentence cannot fail a valid brief.
 */
export function containsHardBlockedCompareWording(
  raw: string,
  payload: CompareExplainPayload,
): boolean {
  if (containsFounderJargon(raw) || containsStockPhrase(raw)) return true;

  if (!payload.anyLiveEvidence) {
    const lower = raw.toLowerCase();
    return FORBIDDEN_UNGROUNDED_MARKET_PHRASES.some((p) => lower.includes(p));
  }

  const live = payload.products.filter((p) => canCiteMarketFromPayload(p));
  const seed = live[0] ?? payload.products[0];
  if (!seed) return containsHardBlockedWording(raw, {
    productName: payload.advisedName,
    fitScore: 0,
    strength: "Okay",
    canCiteMarketSignals: false,
    evidenceSource: "heuristic_seed",
    marketEvidence: null,
  });

  const tier1Found = [
    ...new Set(live.flatMap((p) => p.marketEvidence?.tier1Found ?? [])),
  ];
  return containsHardBlockedWording(raw, {
    ...seed,
    canCiteMarketSignals: true,
    evidenceSource: "live_search",
    marketEvidence: {
      abroad: seed.marketEvidence?.abroad ?? null,
      lebanon: seed.marketEvidence?.lebanon ?? null,
      localCompetition: seed.marketEvidence?.localCompetition ?? null,
      tier1Found: tier1Found.length > 0 ? tier1Found : null,
    },
  });
}

function countMentions(body: string, name: string): number {
  return body.toLowerCase().split(name.toLowerCase()).length - 1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Gap that stays inside one sentence and cannot step over another selected
 * product's name. That distinction is the whole check: in “skills advise
 * Widget over Gadget” the advice belongs to Widget, and Gadget is a contrast
 * the founder should still see named.
 */
function gapNotCrossing(otherNames: readonly string[], max: number): string {
  const alt = otherNames
    .map((n) => n.trim())
    .filter(Boolean)
    .map(escapeRe)
    .join("|");
  const step = alt ? `(?:(?!${alt})[^.!?。])` : "[^.!?。]";
  return `${step}{0,${max}}?`;
}

/**
 * Wording that nominates a product as the test to run first. Deliberately
 * narrow and anchored to the name, so a neutral mention of a rival (“a weaker
 * Fit reading than Gadget”) is never read as a recommendation.
 */
function promotionPatterns(name: string, otherNames: readonly string[]): RegExp[] {
  const n = escapeRe(name.trim());
  // Long enough for “advise starting a sample test on <name>”.
  const gap = gapNotCrossing(otherNames, 40);
  const near = gapNotCrossing(otherNames, 20);
  return [
    // “skills advise <name>”, “we recommend starting a sample test on <name>”
    new RegExp(
      `(?:advise|advises|advised|recommend|recommends|recommended|suggest|suggests|نوصي|ننصح|يُنصح|ينصح)${gap}${n}`,
      "iu",
    ),
    // “start with <name>”, “begin with <name>”, “go with <name>”, “lead with <name>”
    new RegExp(
      `(?:start|starting|begin|beginning|go|going|lead|leading)\\s+with\\s+(?:the\\s+)?${n}`,
      "iu",
    ),
    // “test <name> first”, “sample <name> first”
    new RegExp(
      `(?:test|testing|try|trying|sample|sampling)\\s+(?:the\\s+)?${n}${near}\\bfirst\\b`,
      "iu",
    ),
    // “<name> is the stronger choice” — require the/a + choice-like noun so
    // contrast (“Gadget is better for storage than …”) is never a promotion.
    new RegExp(
      `${n}\\s+(?:is|remains|would\\s+be)\\s+(?:the\\s+|a\\s+)(?:clear(?:ly)?\\s+|obvious\\s+)?(?:advised|stronger|strongest|better|best|safer|smarter|wiser)\\s+(?:choice|option|pick|test|one)\\b`,
      "iu",
    ),
    new RegExp(
      `${n}\\s+(?:is|remains|would\\s+be)\\s+(?:the\\s+|a\\s+)?(?:one\\s+to\\s+(?:start|test|sample)|first\\s+to\\s+(?:test|sample))`,
      "iu",
    ),
    // AR: “ابدأ بـ<name>” / “ابدأ مع <name>”
    new RegExp(`(?:ابدأ|ابدئي|البدء)\\s*(?:بـ|ب|مع)?\\s*${n}`, "iu"),
    // AR: “اختبر <name> أولاً”
    new RegExp(
      `(?:اختبر|اختبري|جرّب|جرب)\\s*(?:الـ)?\\s*${n}${near}(?:أولاً|أولا)`,
      "iu",
    ),
    // AR: “<name> هو الأقوى / الخيار الأفضل”
    new RegExp(
      `${n}\\s*(?:هو|هي)?\\s*(?:الخيار\\s*)?(?:الأقوى|الأفضل|الأنسب|الأجدر)`,
      "iu",
    ),
  ];
}

/**
 * True when the brief nominates `name` as the product to test first. Used both
 * ways: the advised name must be nominated, and no rival may be.
 */
export function promotesProductAsAdvised(
  body: string,
  name: string,
  otherNames: readonly string[] = [],
): boolean {
  const target = name.trim();
  if (!target) return false;
  const others = otherNames
    .map((n) => n.trim())
    .filter((n) => n && n.toLowerCase() !== target.toLowerCase());
  return promotionPatterns(target, others).some((re) => re.test(body));
}

/**
 * Gemini must narrate the skills winner. Prose that nominates a rival is a
 * REJECTED body, not a displayed one — and advice language has to attach to
 * the advised name rather than merely co-occur with it in the paragraph.
 */
export function assertCompareAdviceAligned(
  body: string,
  payload: CompareExplainPayload,
): boolean {
  const name = payload.advisedName.trim();
  if (!name) return false;
  const mentions = countMentions(body, name);
  if (mentions < 1 || mentions > COMPARE_ADVISED_NAME_MAX_MENTIONS) return false;
  if (/\byou must accept\b|must accept\b|اقبل حتماً|يجب أن تقبل/iu.test(body)) {
    return false;
  }

  const allNames = payload.products.map((p) => p.productName);
  for (const other of payload.products) {
    if (other.candidateId === payload.advisedCandidateId) continue;
    if (promotesProductAsAdvised(body, other.productName, allNames)) {
      return false;
    }
  }
  return promotesProductAsAdvised(body, name, allNames);
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
