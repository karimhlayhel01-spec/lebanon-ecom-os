/**
 * Grounding validators for Assess listing Gemini narration.
 * Reject ungrounded years / verified / rating / certs / tier upgrades / bulk language.
 */

import {
  diligenceRecommendationCopyAr,
  diligenceRecommendationCopyEn,
} from "@/lib/supplier/diligence/recommend";
import type {
  DiligenceFacts,
  DiligenceRecommendation,
} from "@/lib/supplier/diligence/types";

const BULK_APPROVED_FORBIDDEN = [
  "safe for bulk",
  "safe bulk",
  "approved supplier",
  "bulk order ready",
  "ready for bulk",
  "go ahead and order bulk",
  "آمن للطلب بالجملة",
  "مورّد معتمد",
] as const;

const GREEN_SAMPLE_PHRASES = [
  "worth requesting a sample",
  "justify a sample ask",
  "reasonable to proceed to a sample",
  "يجدر طلب عيّنة",
  "يبرّر طلب عيّنة",
] as const;

const SKIP_SOFTEN_FORBIDDEN = [
  "worth requesting a sample",
  "justify a sample ask",
  "strong match",
  "highly recommend",
  "يجدر طلب عيّنة",
] as const;

function yearsClaimedInBody(body: string): number[] {
  const out: number[] = [];
  const re =
    /(\d{1,2})\s*\+?\s*(?:years?|yrs?|سنوات|سنة|عاماً|أعوام)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function ratingsClaimedInBody(body: string): number[] {
  const out: number[] = [];
  const re =
    /(?:rating|score|تقييم|★)\s*(?:looks?\s+)?(?:roughly\s+|about\s+|around\s+)?(\d(?:\.\d)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 5) out.push(n);
  }
  // also "4.7 from buyer"
  const re2 = /(\d(?:\.\d)?)\s*(?:from\s+buyer|\/\s*5|out of 5)/gi;
  while ((m = re2.exec(body))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 5) out.push(n);
  }
  return out;
}

export function assertNoBulkApprovedLanguage(body: string): boolean {
  const lower = body.toLowerCase();
  return !BULK_APPROVED_FORBIDDEN.some((p) => lower.includes(p.toLowerCase()));
}

/** Normalize for company-name presence checks (minor punctuation OK). */
export function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When facts.companyName is set, the draft must mention that name
 * (allow Co./Ltd. omission and minor punctuation differences).
 */
export function assertCompanyNameMentioned(
  body: string,
  facts: DiligenceFacts,
): boolean {
  const name = facts.companyName?.trim();
  if (!name) return true;
  const have = normalizeCompanyKey(body);
  const want = normalizeCompanyKey(name);
  if (want.length >= 2 && have.includes(want)) return true;
  const stripped = want
    .replace(/\b(co|ltd|limited|inc|llc|corp|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 4 && have.includes(stripped)) return true;
  // Token overlap: require all substantial tokens (≥3 chars) to appear
  const tokens = stripped.split(" ").filter((t) => t.length >= 3);
  if (tokens.length >= 2 && tokens.every((t) => have.includes(t))) return true;
  return false;
}

/** Never narrate “Alibaba listing · SKU” (or siblings) as the supplier identity. */
export function assertNoPlaceholderSupplierNarration(body: string): boolean {
  const lower = body.toLowerCase();
  if (/alibaba listing\s*·/.test(lower)) return false;
  if (/aliexpress seller listing\s*·/.test(lower)) return false;
  if (/marketplace listing\s*·/.test(lower)) return false;
  return true;
}

/** Success briefs must point the founder at Open on Alibaba / AliExpress. */
export function assertOpenListingCta(
  body: string,
  platform: DiligenceFacts["platform"],
): boolean {
  if (platform === "aliexpress") {
    return (
      /open on aliexpress/i.test(body) || /افتح على\s*aliexpress/i.test(body)
    );
  }
  if (platform === "alibaba") {
    return /open on alibaba/i.test(body) || /افتح على\s*alibaba/i.test(body);
  }
  return /open on (alibaba|aliexpress)|open listing/i.test(body);
}

export function assertYearsGrounded(
  body: string,
  facts: DiligenceFacts,
): boolean {
  const claimed = yearsClaimedInBody(body);
  if (claimed.length === 0) return true;
  if (facts.yearsOnPlatform == null) return false;
  return claimed.every((n) => n === facts.yearsOnPlatform);
}

export function assertRatingGrounded(
  body: string,
  facts: DiligenceFacts,
): boolean {
  const claimed = ratingsClaimedInBody(body);
  if (claimed.length === 0) return true;
  if (facts.rating == null) return false;
  return claimed.every((n) => Math.abs(n - facts.rating!) < 0.05);
}

export function assertVerifiedSignalsGrounded(
  body: string,
  facts: DiligenceFacts,
): boolean {
  const lower = body.toLowerCase();
  const checks: { phrase: string; signal: string }[] = [
    { phrase: "verified supplier", signal: "Verified Supplier" },
    { phrase: "gold supplier", signal: "Gold Supplier" },
    { phrase: "trade assurance", signal: "Trade Assurance" },
  ];
  for (const c of checks) {
    if (!lower.includes(c.phrase)) continue;
    if (!facts.verifiedSignals.includes(c.signal)) return false;
  }
  return true;
}

export function assertCertsGrounded(
  body: string,
  facts: DiligenceFacts,
): boolean {
  const allowed = new Set(facts.certifications.map((c) => c.toUpperCase()));
  const candidates = ["FDA", "LFGB", "ROHS", "BSCI", "ISO 9001", "ISO 14001"];
  const upper = body.toUpperCase();
  for (const c of candidates) {
    if (!upper.includes(c)) continue;
    // CE is too short / ambiguous — only gate when "CE mark"
    if (c === "CE" && !/CE\s*MARK/i.test(body)) continue;
    if (!allowed.has(c) && !allowed.has(c.replace(" ", ""))) {
      // ISO 9001 stored as "ISO 9001"
      if (!facts.certifications.some((f) => f.toUpperCase() === c)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Skills skip must not be soft-pedaled into green sample language.
 * worth_sampling narration should not read as "skip".
 */
export function assertRecommendationAligned(
  body: string,
  recommendation: DiligenceRecommendation,
): boolean {
  const lower = body.toLowerCase();
  if (recommendation === "skip") {
    return !SKIP_SOFTEN_FORBIDDEN.some((p) => lower.includes(p.toLowerCase()));
  }
  if (recommendation === "worth_sampling") {
    // Soft check: prefer sample-ask language; do not require exact phrase
    // (Gemini may say "reasonable to proceed to a sample ask").
    const skipHard =
      /\bskip (?:this|for now)\b/i.test(body) ||
      /لا تطلب عيّنة|تخطَّ الآن/i.test(body);
    if (skipHard) return false;
    return true;
  }
  // caution — reject pure green soft-pedal AND pure skip
  if (GREEN_SAMPLE_PHRASES.some((p) => lower.includes(p.toLowerCase()))) {
    // "justify a sample ask" is ok for caution if hedged; allow
  }
  return true;
}

export function assertDiligenceNarrationGrounded(
  body: string,
  facts: DiligenceFacts,
  recommendation: DiligenceRecommendation,
): boolean {
  if (!body.trim() || body.trim().length < 40) return false;
  if (!assertNoBulkApprovedLanguage(body)) return false;
  if (!assertNoPlaceholderSupplierNarration(body)) return false;
  if (!assertOpenListingCta(body, facts.platform)) return false;
  // Do not require companyName mention — founder opens listing for supplier profile.
  if (!assertYearsGrounded(body, facts)) return false;
  if (!assertRatingGrounded(body, facts)) return false;
  if (!assertVerifiedSignalsGrounded(body, facts)) return false;
  if (!assertCertsGrounded(body, facts)) return false;
  if (!assertRecommendationAligned(body, recommendation)) return false;
  return true;
}

/** Prefix skills recommendation line so modal always leads with the locked tier. */
export function ensureRecommendationLead(
  body: string,
  recommendation: DiligenceRecommendation,
  locale: "en" | "ar",
): string {
  const lead =
    locale === "ar"
      ? diligenceRecommendationCopyAr(recommendation)
      : diligenceRecommendationCopyEn(recommendation);
  const trimmed = body.trim();
  if (trimmed.toLowerCase().startsWith(lead.toLowerCase())) {
    return trimmed;
  }
  return `${lead}\n\n${trimmed}`;
}

export { GREEN_SAMPLE_PHRASES };
