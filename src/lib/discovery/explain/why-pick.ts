/**
 * WAVE-2 §6.1 “Why this pick?” — explain only, not a scoring brain.
 * Narrates skill payloads; must not invent market facts or change gates/rank.
 */

export type WhyPickLocale = "en" | "ar";

export type WhyPickSkillPayload = {
  productName: string;
  fitScore: number;
  strength: "Strong" | "Okay";
  softMarginBand?: "pass" | "soft_ok" | "far_below" | null;
  softMarginNote?: string | null;
  /** Only cite when true — live/score evidence, not invented seed guesses. */
  canCiteMarketSignals: boolean;
  demandPath?: "whitespace" | "local_proven" | null;
  competitionLevel?: "low" | "medium" | "high" | null;
  budgetFightMultiplier?: number | null;
  fallbackUsed?: boolean;
  evidenceSource?: "heuristic_seed" | "score_cache" | "neutral" | "live_search" | null;
};

export type WhyPickResult = {
  titleKey: "whyPickTitle";
  body: string;
  honestyKey: "whyPickHonesty";
  source: "template" | "llm";
  /** True when market demand/competition sentences were omitted for grounding. */
  marketSignalsOmitted: boolean;
};

/** Phrases that must not appear unless canCiteMarketSignals. */
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
] as const;

/**
 * Whether market demand/competition may be narrated from this payload.
 * Heuristic seed / neutral → Fit/margin only (no fake US/Lebanon gap).
 */
export function canCiteMarketFromPayload(
  payload: Pick<
    WhyPickSkillPayload,
    "canCiteMarketSignals" | "evidenceSource" | "demandPath"
  >,
): boolean {
  if (!payload.canCiteMarketSignals) return false;
  // Only narrate market paths from live search evidence — never heuristic seed.
  return payload.evidenceSource === "live_search";
}

export function assertNoUngroundedMarketClaims(
  body: string,
  canCiteMarket: boolean,
): boolean {
  if (canCiteMarket) return true;
  const lower = body.toLowerCase();
  return !FORBIDDEN_UNGROUNDED_MARKET_PHRASES.some((p) => lower.includes(p));
}

/**
 * Deterministic 2–3 sentence paragraph from skill payloads only.
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
    titleKey: "whyPickTitle",
    body,
    honestyKey: "whyPickHonesty",
    source: "template",
    marketSignalsOmitted: !citeMarket,
  };
}

function buildEn(
  payload: WhyPickSkillPayload,
  citeMarket: boolean,
): string {
  const parts: string[] = [];
  parts.push(
    `${payload.productName} is listed with a Fit score of ${payload.fitScore}/100 (${payload.strength}) based on your budget, experience, time, and capacity.`,
  );

  if (payload.softMarginBand === "pass") {
    parts.push(
      "Planning margins meet the Wave 1 hard targets before and after ads.",
    );
  } else if (payload.softMarginBand === "soft_ok") {
    parts.push(
      "Margins sit slightly under the 70%/35% targets, so it stays listable as Okay — accept still needs hard margin pass.",
    );
  } else if (payload.softMarginBand === "far_below") {
    parts.push(
      "Margins look weak versus targets; treat this as a weak listing signal, not a green light.",
    );
  } else {
    parts.push(
      "Margin notes on the card come from the Shared Margin skill — this explanation does not rescore them.",
    );
  }

  if (citeMarket && payload.demandPath === "whitespace") {
    parts.push(
      "System scores point to abroad traction with a thinner Lebanon footprint (whitespace path).",
    );
  } else if (citeMarket && payload.demandPath === "local_proven") {
    parts.push(
      "System scores point to Lebanon demand for this product (local-proven path).",
    );
  }

  if (citeMarket && payload.competitionLevel) {
    parts.push(
      `Local competition reads as ${payload.competitionLevel} — high competition can still list as Okay.`,
    );
  }

  if (payload.fallbackUsed) {
    parts.push(
      "This shortlist used a Fit + soft-margin fallback because fewer than five Wave 2 passers were available.",
    );
  }

  // Cap to ~3 sentences for demand-summary footprint.
  return parts.slice(0, 3).join(" ");
}

function buildAr(
  payload: WhyPickSkillPayload,
  citeMarket: boolean,
): string {
  const parts: string[] = [];
  parts.push(
    `يُدرج «${payload.productName}» بدرجة ملاءمة ${payload.fitScore}/100 (${payload.strength === "Strong" ? "قوي" : "مقبول"}) وفق ميزانيتك وخبرتك ووقتك وقدرتك.`,
  );

  if (payload.softMarginBand === "pass") {
    parts.push(
      "هوامش التخطيط تستوفي أهداف الموجة ١ الصارمة قبل الإعلانات وبعدها.",
    );
  } else if (payload.softMarginBand === "soft_ok") {
    parts.push(
      "الهوامش أقل قليلاً من ٧٠٪/٣٥٪، لذا يبقى مقبولاً في القائمة — والقبول ما زال يحتاج اجتياز الهامش الصارم.",
    );
  } else if (payload.softMarginBand === "far_below") {
    parts.push(
      "الهوامش ضعيفة مقابل الأهداف؛ اعتبر هذه إشارة إدراج ضعيفة وليس ضوءاً أخضر.",
    );
  } else {
    parts.push(
      "ملاحظات الهامش على البطاقة من مهارة الهامش المشتركة — هذا الشرح لا يعيد حسابها.",
    );
  }

  if (citeMarket && payload.demandPath === "whitespace") {
    parts.push(
      "درجات النظام تشير إلى زخم في الخارج مع بصمة أضعف في لبنان (مسار الفجوة).",
    );
  } else if (citeMarket && payload.demandPath === "local_proven") {
    parts.push(
      "درجات النظام تشير إلى طلب لبناني لهذا المنتج (مسار محلي مثبت).",
    );
  }

  if (citeMarket && payload.competitionLevel) {
    parts.push(
      `المنافسة المحلية تُقرأ كـ${payload.competitionLevel === "high" ? "عالية" : payload.competitionLevel === "medium" ? "متوسطة" : "منخفضة"} — والمنافسة العالية قد تبقى مقبولة في القائمة.`,
    );
  }

  if (payload.fallbackUsed) {
    parts.push(
      "استخدمت هذه القائمة مسار احتياطي (ملاءمة + هامش مرن) لأن أقل من خمسة منتجات اجتازت موجة ٢.",
    );
  }

  return parts.slice(0, 3).join(" ");
}

/**
 * Parse fitBreakdown + optional score evidence into a grounded WhyPick payload.
 * Invents nothing — missing market evidence ⇒ canCiteMarketSignals false.
 */
export function skillPayloadFromCandidateMeta(input: {
  productName: string;
  fitScore: number;
  strength: "Strong" | "Okay";
  fitBreakdownJson: string;
  /** From score cache rawEvidenceJson.source when present. */
  scoreEvidenceSource?: string | null;
}): WhyPickSkillPayload {
  let softMarginBand: WhyPickSkillPayload["softMarginBand"] = null;
  let softMarginNote: string | null = null;
  let demandPath: WhyPickSkillPayload["demandPath"] = null;
  let competitionLevel: WhyPickSkillPayload["competitionLevel"] = null;
  let budgetFightMultiplier: number | null = null;
  let fallbackUsed = false;
  let evidenceSource: WhyPickSkillPayload["evidenceSource"] = "neutral";

  try {
    const breakdown = JSON.parse(input.fitBreakdownJson) as {
      wave2?: {
        fallbackUsed?: boolean;
        explain?: {
          softMarginBand?: string;
          softMarginNote?: string | null;
          demandPath?: string | null;
          competitionLevel?: string | null;
          budgetFightMultiplier?: number | null;
          evidenceSource?: string | null;
          fallbackUsed?: boolean;
        };
      };
    };
    const explain = breakdown.wave2?.explain;
    if (explain?.softMarginBand === "pass" ||
      explain?.softMarginBand === "soft_ok" ||
      explain?.softMarginBand === "far_below") {
      softMarginBand = explain.softMarginBand;
    }
    softMarginNote = explain?.softMarginNote ?? null;
    if (
      explain?.demandPath === "whitespace" ||
      explain?.demandPath === "local_proven"
    ) {
      demandPath = explain.demandPath;
    }
    if (
      explain?.competitionLevel === "low" ||
      explain?.competitionLevel === "medium" ||
      explain?.competitionLevel === "high"
    ) {
      competitionLevel = explain.competitionLevel;
    }
    budgetFightMultiplier = explain?.budgetFightMultiplier ?? null;
    fallbackUsed = Boolean(
      breakdown.wave2?.fallbackUsed || explain?.fallbackUsed,
    );
    if (
      explain?.evidenceSource === "heuristic_seed" ||
      explain?.evidenceSource === "score_cache" ||
      explain?.evidenceSource === "neutral"
    ) {
      evidenceSource = explain.evidenceSource;
    }
  } catch {
    /* keep defaults */
  }

  if (input.scoreEvidenceSource === "live_search") {
    evidenceSource = "live_search";
  } else if (input.scoreEvidenceSource === "heuristic_seed") {
    evidenceSource = "heuristic_seed";
  }

  // Rich live evidence only — heuristic/neutral stay Fit/margin-only (WAVE-2 §6.1).
  const canCiteMarketSignals = evidenceSource === "live_search";

  return {
    productName: input.productName,
    fitScore: input.fitScore,
    strength: input.strength,
    softMarginBand,
    softMarginNote,
    canCiteMarketSignals,
    demandPath,
    competitionLevel,
    budgetFightMultiplier,
    fallbackUsed,
    evidenceSource,
  };
}
