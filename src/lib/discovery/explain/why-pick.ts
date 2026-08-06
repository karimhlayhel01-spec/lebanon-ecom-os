/**
 * WAVE-2 §6.1 “Why we suggested this” — explain only, not a scoring brain.
 * Narrates skill payloads; must not invent market facts or change gates/rank.
 * Template helpers remain for tests/grounding; product UX requires Gemini.
 */

import type { OkayReason } from "@/lib/discovery/scoring/composite";

export type WhyPickLocale = "en" | "ar";

export type WhyPickEvidenceResult = {
  domain: string;
  title: string;
  seller: string | null;
};

export type WhyPickEvidenceGroup = {
  count: number;
  results: WhyPickEvidenceResult[];
};

export type WhyPickMarketEvidence = {
  abroad: WhyPickEvidenceGroup | null;
  lebanon: WhyPickEvidenceGroup | null;
  localCompetition: WhyPickEvidenceGroup | null;
  tier1Found: string[] | null;
};

export type WhyPickSkillPayload = {
  productName: string;
  /** Category key/label for context (e.g. home, beauty). */
  category?: string | null;
  fitScore: number;
  strength: "Strong" | "Okay";
  /** Why the overall recommendation is Okay; null when Strong. */
  okayReason?: OkayReason | null;
  softMarginBand?: "pass" | "soft_ok" | "far_below" | null;
  softMarginNote?: string | null;
  /** Planning margin before ads (0..1) when available. */
  marginBefore?: number | null;
  /** Planning margin after ads (0..1) when available. */
  marginAfter?: number | null;
  /** True when demand/competition fields may be narrated (heuristic or live). */
  canCiteMarketSignals: boolean;
  demandPath?: "whitespace" | "local_proven" | null;
  competitionLevel?: "low" | "medium" | "high" | null;
  budgetFightMultiplier?: number | null;
  fallbackUsed?: boolean;
  /** Curated catalog angle — never treated as a market claim. */
  curatedDifferentiation?: string | null;
  /** Bounded score-job evidence; all fields null when unavailable. */
  marketEvidence?: WhyPickMarketEvidence | null;
  evidenceSource?:
    | "heuristic_seed"
    | "score_cache"
    | "neutral"
    | "live_search"
    | null;
};

export type WhyPickResult = {
  titleKey: "whyPickTitle" | "whySuggestedTitle";
  body: string;
  honestyKey:
    | "whyPickHonesty"
    | "whySuggestedHonesty"
    | "whySuggestedHonestyLive"
    | "whySuggestedHonestyEstimate";
  source: "template" | "llm";
  /** True when market demand/competition sentences were omitted for grounding. */
  marketSignalsOmitted: boolean;
};

/** Validation window around the founder-locked ~900–1100 character target. */
export const SUGGESTION_BODY_MIN_CHARS = 800;
export const SUGGESTION_BODY_MAX_CHARS = 1100;

/** Phrases that must not appear without relevant live-search evidence. */
export const FORBIDDEN_UNGROUNDED_MARKET_PHRASES = [
  "us traction",
  "united states traction",
  "lebanon gap",
  "abroad traction",
  "whitespace",
  "local-proven",
  "local proven",
  "tier-1",
  "ishtari",
  "eglow",
  "platza",
  "not saturated",
  "unsaturated",
  "less crowded",
  "local shelf may still have room",
] as const;

/**
 * Vague filler banned when real skill fields exist (tests + post-check).
 * “good/strong fit” is filler only as a bare verdict — a numeric Fit reading
 * (“strong fit score of 78/100”) is the reporting the prompt asks for.
 */
export const VAGUE_FLUFF_PATTERNS: RegExp[] = [
  /\bstrong suggestion\b/i,
  /\bworth considering\b/i,
  /\bhighly recommended\b/i,
  /\bgreat opportunity\b/i,
  /\blooks promising\b/i,
  /\b(?:good|strong|great|solid) fit\b(?!\s*(?:score)?\s*(?:of|at|is|:)?\s*\d)/i,
  /\bsolid choice\b/i,
  /\bworth a look\b/i,
];

/** Stock lines that must never appear verbatim (product-agnostic templates). */
export const FORBIDDEN_STOCK_PHRASES: RegExp[] = [
  /people in lebanon already seem to look for this kind of product/i,
  /it does well abroad while lebanon still looks less crowded/i,
  /lebanon still looks less crowded for this kind of product/i,
];

/** Engineer/debug jargon never shown to founders in the paragraph. */
export const FORBIDDEN_FOUNDER_JARGON: RegExp[] = [
  /\bdemand path\b/i,
  /\bwhitespace\b/i,
  /\blocal[_-]?proven\b/i,
  /\bskill payload/i,
  /\bheuristic\b/i,
  /\bcomposite\b/i,
  /\bwave\s*2\b/i,
  /\bscore cache\b/i,
  /\bbudget-?fight multiplier\b/i,
  /\blisting strength\b/i,
];

/**
 * Whether demand/competition may be narrated from this payload.
 * Only bounded live-search facts are citable. Heuristic / score-cache-only
 * payloads stay Fit, margins, and curated differentiation only.
 */
export function canCiteMarketFromPayload(
  payload: Pick<
    WhyPickSkillPayload,
    | "canCiteMarketSignals"
    | "evidenceSource"
    | "demandPath"
    | "competitionLevel"
    | "marketEvidence"
  >,
): boolean {
  if (payload.evidenceSource !== "live_search") return false;
  const evidence = payload.marketEvidence;
  if (!evidence) return false;
  return Boolean(
    (evidence.abroad?.count ?? 0) > 0 ||
      (evidence.lebanon?.count ?? 0) > 0 ||
      (evidence.localCompetition?.count ?? 0) > 0 ||
      (evidence.tier1Found?.length ?? 0) > 0,
  );
}

export function assertNoUngroundedMarketClaims(
  body: string,
  grounding: boolean | WhyPickSkillPayload,
): boolean {
  const lower = body.toLowerCase();
  if (typeof grounding === "boolean") {
    if (grounding) return true;
    return !FORBIDDEN_UNGROUNDED_MARKET_PHRASES.some((p) => lower.includes(p));
  }

  const evidence = grounding.marketEvidence;
  const canCiteMarket = canCiteMarketFromPayload(grounding);
  if (!canCiteMarket) {
    return (
      !FORBIDDEN_UNGROUNDED_MARKET_PHRASES.some((p) => lower.includes(p)) &&
      !/\b(?:https?:\/\/|www\.)?\w[\w.-]+\.(?:com|net|org|lb|de|fr|uk)\b/i.test(
        body,
      )
    );
  }

  const abroadCount = evidence?.abroad?.count ?? 0;
  const lebanonCount = evidence?.lebanon?.count ?? 0;
  const localCount = evidence?.localCompetition?.count ?? 0;
  if (
    abroadCount <= 0 &&
    /\b(abroad|us traction|united states|europe|amazon)\b/i.test(body)
  ) {
    return false;
  }
  if (
    lebanonCount <= 0 &&
    /\b(lebanon (?:interest|demand|footprint|results?)|beirut)\b/i.test(body)
  ) {
    return false;
  }
  if (
    localCount <= 0 &&
    (evidence?.tier1Found?.length ?? 0) <= 0 &&
    /\b(local sellers?|tier-1|ishtari|eglow|platza|crowded|saturated)\b/i.test(
      body,
    )
  ) {
    return false;
  }

  const allowedDomains = new Set(
    [
      ...(evidence?.abroad?.results ?? []),
      ...(evidence?.lebanon?.results ?? []),
      ...(evidence?.localCompetition?.results ?? []),
    ].map((r) => r.domain.toLowerCase()),
  );
  const citedDomains =
    body.toLowerCase().match(/\b\w[\w.-]+\.(?:com|net|org|lb|de|fr|uk)\b/g) ??
    [];
  if (citedDomains.some((domain) => !allowedDomains.has(domain))) return false;

  for (const marketplace of ["Ishtari", "EGLOW", "Platza"]) {
    if (
      lower.includes(marketplace.toLowerCase()) &&
      !evidence?.tier1Found?.some(
        (found) => found.toLowerCase() === marketplace.toLowerCase(),
      )
    ) {
      return false;
    }
  }

  const allowedCounts = new Set([abroadCount, lebanonCount, localCount]);
  for (const match of body.matchAll(/\b(\d+)\s+(?:results?|hits?|listings?|sellers?)\b/gi)) {
    if (!allowedCounts.has(Number(match[1]))) return false;
  }
  return true;
}

export function containsVagueFluff(body: string): boolean {
  return VAGUE_FLUFF_PATTERNS.some((re) => re.test(body));
}

export function containsFounderJargon(body: string): boolean {
  return FORBIDDEN_FOUNDER_JARGON.some((re) => re.test(body));
}

export function containsStockPhrase(body: string): boolean {
  return FORBIDDEN_STOCK_PHRASES.some((re) => re.test(body));
}

/** Product must be named at least once; allow one repeat before it reads spammy. */
export const PRODUCT_NAME_MAX_MENTIONS = 2;

export function assertNamesProduct(body: string, productName: string): boolean {
  const name = productName.trim();
  if (!name) return true;
  const mentions = body.toLowerCase().split(name.toLowerCase()).length - 1;
  return mentions >= 1 && mentions <= PRODUCT_NAME_MAX_MENTIONS;
}

export function assertFounderFriendlyCopy(body: string): boolean {
  return (
    !containsFounderJargon(body) &&
    !containsVagueFluff(body) &&
    !containsStockPhrase(body)
  );
}

/**
 * The paragraph must explain and mitigate the same reason shown in the yellow
 * Okay note. Keep matching broad enough for natural EN/AR Gemini phrasing.
 */
export function assertOkayReasonAligned(
  body: string,
  okayReason: OkayReason | null,
): boolean {
  if (!okayReason) return true;
  const hasNextStep =
    /\b(?:accept|sample|skip|test|hold|scale|order|ads?|differentiat\w*)\b|(?:اقبل|عيّنة|عينة|تخط|اختبر|توسّع|توسع|إعلانات|تميّز|تميز)/iu.test(
      body,
    );
  if (!hasNextStep) return false;

  switch (okayReason) {
    case "low_evidence_confidence":
      return (
        /estimate|estimated|low[- ]confidence|unproven|تقدير|منخفض(?:ة)? الثقة/iu.test(
          body,
        ) &&
        /sample|test|small|modest|scale|عيّنة|عينة|اختبر|توسّع|توسع/iu.test(
          body,
        )
      );
    case "high_competition":
      return (
        /competition|competitor|seller|ads?|منافس|بائع|إعلانات/iu.test(body) &&
        /differentiat|curated|angle|ads?|modest|تميّز|تميز|زاوية|إعلانات/iu.test(
          body,
        )
      );
    case "fit_risk":
      return (
        /\bfit\b|operational|constraint|budget|time|ملاءم|تشغيل|ميزانية|وقت/iu.test(
          body,
        ) &&
        /sample|skip|constraint|budget|time|عيّنة|عينة|تخط|ميزانية|وقت/iu.test(
          body,
        )
      );
  }
}

/**
 * Clamp to demand-summary length; prefer cutting on a sentence boundary.
 * Prefer not to return mid-sentence stubs — callers should use finalizeSuggestionBody.
 */
export function clampSuggestionBody(
  body: string,
  maxChars: number = SUGGESTION_BODY_MAX_CHARS,
): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;

  const slice = trimmed.slice(0, maxChars);
  const lastStop = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("。"),
  );
  if (lastStop >= Math.floor(maxChars * 0.45)) {
    return slice.slice(0, lastStop + 1).trim();
  }
  // Fall back to last terminator anywhere in slice
  const anyStop = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("。"),
  );
  if (anyStop >= Math.floor(maxChars * 0.4)) {
    return slice.slice(0, anyStop + 1).trim();
  }
  return `${slice.trimEnd()}…`;
}

/**
 * True when body looks like a finished 4–6 sentence founder paragraph
 * (not a mid-generation stub).
 */
export function isCompleteSuggestionBody(body: string): boolean {
  const t = body.replace(/\s+/g, " ").trim();
  if (
    t.length < SUGGESTION_BODY_MIN_CHARS ||
    t.length > SUGGESTION_BODY_MAX_CHARS
  ) {
    return false;
  }
  if (t.endsWith("…")) return false;
  if (!/[.!?。]["'")\]]*$/u.test(t)) return false;

  const sentences = t
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 4 || sentences.length > 6) return false;

  // Known truncated openers from earlier Gemini failures
  if (/^people in lebanon already seem to look\.?$/i.test(t)) return false;
  if (/^people in lebanon already seem to look for\b/i.test(t) && t.length < 100) {
    return false;
  }

  for (const s of sentences) {
    if (s.split(/\s+/).filter(Boolean).length < 5) return false;
  }
  return true;
}

/**
 * Normalize LLM text into complete founder copy, or null if incomplete/stub.
 * When productName is set, the paragraph must name the product 1–2 times.
 */
export function finalizeSuggestionBody(
  raw: string,
  productName?: string,
): string | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Drop trailing incomplete fragment after the last sentence end.
  if (!/[.!?。]["'")\]]*$/u.test(text)) {
    const m = text.match(/^[\s\S]*[.!?。]/);
    if (!m) return null;
    text = m[0].trim();
  }

  text = clampSuggestionBody(text);
  if (text.endsWith("…")) {
    const without = text.slice(0, -1).trim();
    const m = without.match(/^[\s\S]*[.!?。]/);
    if (!m) return null;
    text = m[0].trim();
  }

  // Keep the founder-locked footprint: at most 6 complete sentences.
  {
    const sentences = text
      .split(/(?<=[.!?。])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length > 6) {
      text = sentences.slice(0, 6).join(" ");
    }
  }

  if (!isCompleteSuggestionBody(text)) return null;
  if (!assertFounderFriendlyCopy(text)) return null;
  if (productName && !assertNamesProduct(text, productName)) return null;
  return text;
}

/**
 * Deterministic 4–6 sentence paragraph from skill payloads only.
 * Founder-facing plain language — never debug labels.
 */
export function buildDeterministicWhyPick(
  payload: WhyPickSkillPayload,
  locale: WhyPickLocale = "en",
): WhyPickResult {
  const citeMarket = canCiteMarketFromPayload(payload);
  const body =
    locale === "ar"
      ? buildAr(payload, citeMarket)
      : buildEn(payload, citeMarket);

  return {
    titleKey: "whySuggestedTitle",
    body: clampSuggestionBody(body),
    honestyKey: citeMarket
      ? "whySuggestedHonestyLive"
      : "whySuggestedHonestyEstimate",
    source: "template",
    marketSignalsOmitted: !citeMarket,
  };
}

function pctMargin(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

function buildEn(payload: WhyPickSkillPayload, citeMarket: boolean): string {
  const name = payload.productName;
  const parts: string[] = [];
  const evidence = payload.marketEvidence;
  if (citeMarket) {
    const abroad = evidence?.abroad;
    const lebanon = evidence?.lebanon;
    const abroadDomain = abroad?.results[0]?.domain;
    const lebanonDomain = lebanon?.results[0]?.domain;
    const marketBits = [
      abroad
        ? `${abroad.count} abroad result${abroad.count === 1 ? "" : "s"}${abroadDomain ? ` including ${abroadDomain}` : ""}`
        : null,
      lebanon
        ? `${lebanon.count} Lebanon result${lebanon.count === 1 ? "" : "s"}${lebanonDomain ? ` including ${lebanonDomain}` : ""}`
        : null,
    ].filter(Boolean);
    if (marketBits.length > 0) {
      parts.push(`${name} appeared in ${marketBits.join(" and ")}.`);
    } else {
      const localCount = evidence?.localCompetition?.count ?? 0;
      parts.push(
        `${name} appeared in ${localCount} local seller result${localCount === 1 ? "" : "s"} in saved live evidence.`,
      );
    }

    const competitors = evidence?.tier1Found ?? [];
    const localCount = evidence?.localCompetition?.count ?? 0;
    if (competitors.length > 0 || localCount > 0) {
      const who =
        competitors.length > 0
          ? competitors.join(", ")
          : `${localCount} local seller result${localCount === 1 ? "" : "s"}`;
      parts.push(
        `You would compete with ${who}; use the curated angle${
          payload.curatedDifferentiation
            ? `: ${payload.curatedDifferentiation}`
            : " to make the offer distinct"
        }.`,
      );
    }
  } else {
    parts.push(
      `${name}'s market read is an estimate because no citable live evidence is saved yet.`,
    );
    if (payload.curatedDifferentiation) {
      parts.push(`Curated differentiation angle: ${payload.curatedDifferentiation}.`);
    }
  }

  const before = pctMargin(payload.marginBefore);
  const after = pctMargin(payload.marginAfter);
  const marginNums =
    before && after ? ` (~${before} before ads / ~${after} after)` : "";
  const marginBit =
    payload.softMarginBand === "pass"
      ? `planning margins clear the 70%/35% targets${marginNums}`
      : payload.softMarginBand === "soft_ok"
        ? `margins sit a bit under 70%/35%${marginNums} (below hard accept targets)`
        : payload.softMarginBand === "far_below"
          ? `margins look weak versus 70%/35%${marginNums}`
          : `margins follow the notes on the card${marginNums}`;

  parts.push(
    `Your operational Fit is ${payload.fitScore}/100, and ${marginBit}.${
      payload.fallbackUsed
        ? " Few products cleared accept-ready gates for this profile."
        : ""
    }`,
  );

  if (payload.okayReason === "low_evidence_confidence") {
    parts.push(
      "The recommendation is Okay because that market read is estimate-only, not because your Fit is moderate.",
      "Handle that uncertainty with one small sample and modest ads, and do not scale until real sales validate demand.",
    );
  } else if (payload.okayReason === "high_competition") {
    parts.push(
      `The recommendation is Okay because competition appears high${citeMarket ? "" : " in the estimate"}, not because your Fit is moderate.`,
      `Handle that pressure with modest ads and a distinct offer${payload.curatedDifferentiation ? ` built around ${payload.curatedDifferentiation}` : ""}.`,
    );
  } else if (payload.okayReason === "fit_risk") {
    parts.push(
      "The recommendation is Okay because the operational Fit carries a real budget, time, or workload constraint.",
      "Keep the first sample small and skip this product if you cannot absorb that constraint without stretching your budget or time.",
    );
  } else {
    parts.push(
      "Use the first sample to verify quality, pricing, and the curated offer before putting meaningful money behind it.",
    );
  }

  parts.push(
    payload.okayReason
      ? "Accept to order a sample only if you can follow that mitigation; otherwise skip it."
      : "Accept to order a sample next, then validate the offer before committing to a wider order.",
  );

  return parts.slice(0, 6).join(" ");
}

function buildAr(payload: WhyPickSkillPayload, citeMarket: boolean): string {
  const name = payload.productName;
  const parts: string[] = [];
  const evidence = payload.marketEvidence;
  if (citeMarket) {
    const abroad = evidence?.abroad;
    const lebanon = evidence?.lebanon;
    const marketBits = [
      abroad
        ? `${abroad.count} نتائج خارجية${abroad.results[0]?.domain ? ` منها ${abroad.results[0].domain}` : ""}`
        : null,
      lebanon
        ? `${lebanon.count} نتائج لبنانية${lebanon.results[0]?.domain ? ` منها ${lebanon.results[0].domain}` : ""}`
        : null,
    ].filter(Boolean);
    if (marketBits.length > 0) {
      parts.push(`ظهر «${name}» في ${marketBits.join(" و")}.`);
    } else {
      parts.push(
        `ظهر «${name}» في ${evidence?.localCompetition?.count ?? 0} نتائج لبائعين محليين ضمن أدلة البحث الحية المحفوظة.`,
      );
    }
    const competitors = evidence?.tier1Found ?? [];
    const localCount = evidence?.localCompetition?.count ?? 0;
    if (competitors.length > 0 || localCount > 0) {
      const who =
        competitors.length > 0
          ? competitors.join("، ")
          : `${localCount} نتائج لبائعين محليين`;
      parts.push(
        `ستنافس ${who}؛ استخدم زاوية التميّز المنسّقة${
          payload.curatedDifferentiation
            ? `: ${payload.curatedDifferentiation}`
            : " لجعل العرض مختلفاً"
        }.`,
      );
    }
  } else {
    parts.push(
      `قراءة السوق لـ«${name}» تقديرية لعدم وجود أدلة بحث حية قابلة للاستشهاد بعد.`,
    );
    if (payload.curatedDifferentiation) {
      parts.push(`زاوية التميّز المنسّقة: ${payload.curatedDifferentiation}.`);
    }
  }

  const before = pctMargin(payload.marginBefore);
  const after = pctMargin(payload.marginAfter);
  const marginNums =
    before && after ? ` (~${before} قبل الإعلانات / ~${after} بعدها)` : "";
  const marginBit =
    payload.softMarginBand === "pass"
      ? `وهوامش التخطيط تتجاوز أهداف ٧٠٪/٣٥٪${marginNums}`
      : payload.softMarginBand === "soft_ok"
        ? `والهوامش أقل قليلاً من ٧٠٪/٣٥٪${marginNums} (دون أهداف القبول الصارمة)`
        : payload.softMarginBand === "far_below"
          ? `والهوامش ضعيفة مقابل ٧٠٪/٣٥٪${marginNums}`
          : `والهوامش وفق الملاحظات على البطاقة${marginNums}`;

  parts.push(
    `ملاءمتك التشغيلية هي ${payload.fitScore}/100، ${marginBit}.${
      payload.fallbackUsed
        ? " قليل من المنتجات اجتازت بوابات الجاهزية للقبول لهذا الملف."
        : ""
    }`,
  );

  if (payload.okayReason === "low_evidence_confidence") {
    parts.push(
      "التوصية مقبولة لأن قراءة السوق تقديرية ومنخفضة الثقة، وليس لأن ملاءمتك متوسطة.",
      "عالِج عدم اليقين بعيّنة صغيرة وإعلانات محدودة، ولا تتوسّع قبل أن تثبت المبيعات الفعلية الطلب.",
    );
  } else if (payload.okayReason === "high_competition") {
    parts.push(
      `التوصية مقبولة لأن المنافسة تبدو مرتفعة${citeMarket ? "" : " في التقدير"}، وليس لأن ملاءمتك متوسطة.`,
      `واجِه ذلك بإعلانات محدودة وعرض مميّز${payload.curatedDifferentiation ? ` مبني على ${payload.curatedDifferentiation}` : ""}.`,
    );
  } else if (payload.okayReason === "fit_risk") {
    parts.push(
      "التوصية مقبولة لأن الملاءمة التشغيلية تحمل قيداً حقيقياً في الميزانية أو الوقت أو عبء العمل.",
      "أبقِ العيّنة الأولى صغيرة وتخطَّ المنتج إن لم تستطع تحمّل هذا القيد من دون ضغط ميزانيتك أو وقتك.",
    );
  } else {
    parts.push(
      "استخدم العيّنة الأولى للتحقق من الجودة والسعر والعرض المنسّق قبل استثمار مبلغ كبير فيه.",
    );
  }

  parts.push(
    payload.okayReason
      ? "اقبل لطلب عيّنة فقط إن استطعت تطبيق هذا التخفيف، وإلا فتخطَّ المنتج."
      : "اقبل لطلب عيّنة تالياً، ثم اختبر العرض قبل الالتزام بطلب أكبر.",
  );

  return parts.slice(0, 6).join(" ");
}

function parseDemandPath(
  raw: string | null | undefined,
): WhyPickSkillPayload["demandPath"] {
  if (raw === "whitespace" || raw === "local_proven") return raw;
  return null;
}

function parseCompetitionLevel(
  raw: string | null | undefined,
): WhyPickSkillPayload["competitionLevel"] {
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return null;
}

function parseEvidenceSource(
  raw: string | null | undefined,
): WhyPickSkillPayload["evidenceSource"] {
  if (
    raw === "heuristic_seed" ||
    raw === "score_cache" ||
    raw === "neutral" ||
    raw === "live_search"
  ) {
    return raw;
  }
  return null;
}

const EXPLAIN_EVIDENCE_CAP = 5;
const EXPLAIN_EVIDENCE_TEXT_MAX = 120;

function nullableEvidenceGroup(raw: unknown): WhyPickEvidenceGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const group = raw as { count?: unknown; results?: unknown };
  const count =
    typeof group.count === "number" && Number.isFinite(group.count)
      ? Math.max(0, Math.floor(group.count))
      : 0;
  const results = Array.isArray(group.results)
    ? group.results
        .slice(0, EXPLAIN_EVIDENCE_CAP)
        .flatMap((item): WhyPickEvidenceResult[] => {
          if (!item || typeof item !== "object") return [];
          const value = item as Record<string, unknown>;
          const domain =
            typeof value.domain === "string"
              ? value.domain.trim().slice(0, 100)
              : "";
          const title =
            typeof value.title === "string"
              ? value.title
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, EXPLAIN_EVIDENCE_TEXT_MAX)
              : "";
          const seller =
            typeof value.seller === "string" && value.seller.trim()
              ? value.seller
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, EXPLAIN_EVIDENCE_TEXT_MAX)
              : null;
          return domain && title ? [{ domain, title, seller }] : [];
        })
    : [];
  return count > 0 ? { count, results } : null;
}

/** Parse only the bounded evidence schema; malformed/missing fields stay null. */
export function parseWhyPickMarketEvidence(
  raw: unknown,
): WhyPickMarketEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const abroad = nullableEvidenceGroup(value.abroad);
  const lebanon = nullableEvidenceGroup(value.lebanon);
  const localCompetition = nullableEvidenceGroup(value.localCompetition);
  const tier1Found = Array.isArray(value.tier1Found)
    ? value.tier1Found
        .flatMap((item) =>
          typeof item === "string" && item.trim()
            ? [
                item
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, EXPLAIN_EVIDENCE_TEXT_MAX),
              ]
            : [],
        )
        .slice(0, EXPLAIN_EVIDENCE_CAP)
    : [];
  if (
    !abroad &&
    !lebanon &&
    !localCompetition &&
    tier1Found.length === 0
  ) {
    return null;
  }
  return {
    abroad,
    lebanon,
    localCompetition,
    tier1Found: tier1Found.length > 0 ? tier1Found : null,
  };
}

/**
 * Parse fitBreakdown + optional score-cache fields into a grounded payload.
 * Invents nothing — missing fields stay null; market cite needs scored evidence.
 */
export function skillPayloadFromCandidateMeta(input: {
  productName: string;
  category?: string | null;
  fitScore: number;
  strength: "Strong" | "Okay";
  fitBreakdownJson: string;
  marginBefore?: number | null;
  marginAfter?: number | null;
  curatedDifferentiation?: string | null;
  /** From score cache rawEvidenceJson.source when present. */
  scoreEvidenceSource?: string | null;
  /** Parsed rawEvidenceJson object; malformed/missing facts stay null. */
  scoreEvidence?: unknown;
  /** Prefer live score-cache skill fields when available (heuristic or live). */
  scoreCache?: {
    demandPath?: string | null;
    competitionLevel?: string | null;
    competitionScore?: number | null;
    budgetFightPenalty?: number | null;
  } | null;
}): WhyPickSkillPayload {
  let softMarginBand: WhyPickSkillPayload["softMarginBand"] = null;
  let softMarginNote: string | null = null;
  let demandPath: WhyPickSkillPayload["demandPath"] = null;
  let competitionLevel: WhyPickSkillPayload["competitionLevel"] = null;
  let budgetFightMultiplier: number | null = null;
  let fallbackUsed = false;
  let evidenceSource: WhyPickSkillPayload["evidenceSource"] = "neutral";
  let marketEvidence: WhyPickMarketEvidence | null = null;
  let okayReason: OkayReason | null = null;

  try {
    const breakdown = JSON.parse(input.fitBreakdownJson) as {
      wave2?: {
        fallbackUsed?: boolean;
        softMarginBand?: string;
        okayReason?: string | null;
        explain?: {
          softMarginBand?: string;
          softMarginNote?: string | null;
          demandPath?: string | null;
          competitionLevel?: string | null;
          budgetFightMultiplier?: number | null;
          evidenceSource?: string | null;
          confidence?: number | null;
          fallbackUsed?: boolean;
        };
      };
    };
    const explain = breakdown.wave2?.explain;
    const rawOkayReason = breakdown.wave2?.okayReason;
    if (
      rawOkayReason === "fit_risk" ||
      rawOkayReason === "low_evidence_confidence" ||
      rawOkayReason === "high_competition"
    ) {
      okayReason = rawOkayReason;
    }
    const band =
      explain?.softMarginBand ?? breakdown.wave2?.softMarginBand ?? null;
    if (band === "pass" || band === "soft_ok" || band === "far_below") {
      softMarginBand = band;
    }
    softMarginNote = explain?.softMarginNote ?? null;
    demandPath = parseDemandPath(explain?.demandPath);
    competitionLevel = parseCompetitionLevel(explain?.competitionLevel);
    if (
      explain?.budgetFightMultiplier != null &&
      Number.isFinite(explain.budgetFightMultiplier)
    ) {
      budgetFightMultiplier = explain.budgetFightMultiplier;
    }
    fallbackUsed = Boolean(
      breakdown.wave2?.fallbackUsed || explain?.fallbackUsed,
    );
    const fromExplain = parseEvidenceSource(explain?.evidenceSource);
    if (fromExplain) evidenceSource = fromExplain;

    // Heal older session snapshots that predate typed Okay reasons.
    if (input.strength === "Okay" && !okayReason) {
      if (input.fitScore < 70) {
        okayReason = "fit_risk";
      } else if (explain?.competitionLevel === "high") {
        okayReason = "high_competition";
      } else if (
        explain?.confidence != null &&
        Number.isFinite(explain.confidence) &&
        explain.confidence < 0.5
      ) {
        okayReason = "low_evidence_confidence";
      }
    }
  } catch {
    /* keep defaults */
  }

  // Score cache overlays — more current than session fitBreakdown snapshot.
  const cache = input.scoreCache;
  if (cache) {
    const fromCache = parseDemandPath(cache.demandPath);
    if (fromCache) demandPath = fromCache;
    const levelFromCache = parseCompetitionLevel(cache.competitionLevel);
    if (levelFromCache) {
      competitionLevel = levelFromCache;
    } else if (
      cache.competitionScore != null &&
      Number.isFinite(cache.competitionScore)
    ) {
      const intensity = Math.max(0, Math.min(1, cache.competitionScore));
      competitionLevel =
        intensity <= 0.33 ? "low" : intensity >= 0.66 ? "high" : "medium";
    }
    if (
      cache.budgetFightPenalty != null &&
      Number.isFinite(cache.budgetFightPenalty) &&
      budgetFightMultiplier == null
    ) {
      budgetFightMultiplier = Math.max(
        0,
        Math.min(1, 1 - cache.budgetFightPenalty),
      );
    }
  }

  const fromScore = parseEvidenceSource(input.scoreEvidenceSource);
  if (fromScore === "live_search") {
    evidenceSource = "live_search";
  } else if (fromScore === "heuristic_seed") {
    evidenceSource = "heuristic_seed";
  } else if (
    fromScore === "score_cache" &&
    evidenceSource !== "live_search" &&
    evidenceSource !== "heuristic_seed"
  ) {
    evidenceSource = "score_cache";
  } else if (
    cache &&
    (cache.demandPath ||
      cache.competitionLevel != null ||
      cache.competitionScore != null) &&
    evidenceSource === "neutral"
  ) {
    evidenceSource = "score_cache";
  }

  if (evidenceSource === "live_search") {
    marketEvidence = parseWhyPickMarketEvidence(input.scoreEvidence);
  }

  if (input.strength === "Okay" && !okayReason) {
    okayReason =
      input.fitScore < 70
        ? "fit_risk"
        : competitionLevel === "high"
          ? "high_competition"
          : "low_evidence_confidence";
  }

  const canCiteMarketSignals = canCiteMarketFromPayload({
    canCiteMarketSignals: false,
    evidenceSource,
    demandPath,
    competitionLevel,
    marketEvidence,
  });

  return {
    productName: input.productName,
    category: input.category?.trim() || null,
    fitScore: input.fitScore,
    strength: input.strength,
    okayReason: input.strength === "Okay" ? okayReason : null,
    softMarginBand,
    softMarginNote,
    marginBefore:
      input.marginBefore != null && Number.isFinite(input.marginBefore)
        ? input.marginBefore
        : null,
    marginAfter:
      input.marginAfter != null && Number.isFinite(input.marginAfter)
        ? input.marginAfter
        : null,
    canCiteMarketSignals,
    demandPath,
    competitionLevel,
    budgetFightMultiplier,
    fallbackUsed,
    curatedDifferentiation:
      input.curatedDifferentiation
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 240) || null,
    marketEvidence,
    evidenceSource,
  };
}
