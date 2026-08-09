/**
 * Deterministic fact extraction from listing page text.
 * Null / empty when the signal is not clearly present — never invent.
 * Never treat “Alibaba listing · SKU” card placeholders as companyName.
 */

import { isPlatformListingFallbackName } from "@/lib/supplier/live/company-name";
import type {
  DiligenceFacts,
  DiligencePlatform,
  DiligenceSkuRelevance,
} from "@/lib/supplier/diligence/types";

const CERT_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "FDA", re: /\bFDA\b/i },
  { label: "LFGB", re: /\bLFGB\b/i },
  { label: "CE", re: /\bCE\b(?:\s*mark(?:ing)?)?/i },
  { label: "RoHS", re: /\bRoHS\b/i },
  { label: "ISO 9001", re: /\bISO\s*9001\b/i },
  { label: "ISO 14001", re: /\bISO\s*14001\b/i },
  { label: "BSCI", re: /\bBSCI\b/i },
];

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "pack",
  "set",
  "pcs",
  "pc",
  "new",
  "hot",
  "sale",
  "of",
  "a",
  "an",
  "to",
  "in",
  "on",
]);

const LEGAL_SUFFIX =
  /(?:Co\.?,?\s*Ltd\.?|Company\s+Limited|Limited|Inc\.?|LLC|Corp\.?)/i;

export function platformFromUrl(url: string): DiligencePlatform {
  const u = url.toLowerCase();
  if (u.includes("alibaba.com")) return "alibaba";
  if (u.includes("aliexpress.com")) return "aliexpress";
  return "other";
}

function excerptAround(text: string, index: number, span = 80): string {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function cleanCompanyCandidate(raw: string): string | null {
  let name = raw
    .replace(/\s+/g, " ")
    .replace(/\s*(?:is\s+a\s+Verified|Verified\s+Supplier|Gold\s+Supplier).*$/i, "")
    .replace(/[|·•].*$/, "")
    .replace(/\s+(?:is|on|with|for)\s+.*$/i, "")
    .trim()
    .slice(0, 120);
  if (name.length < 4) return null;
  if (isPlatformListingFallbackName(name)) return null;
  if (/^Alibaba listing|^AliExpress seller listing/i.test(name)) return null;
  return name;
}

function scoreCompanyNearChrome(text: string, matchIndex: number, name: string): number {
  const after = text.slice(matchIndex, matchIndex + name.length + 220);
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  let score = name.length / 50;
  if (/\d{1,2}\s*yrs?\b/i.test(after)) score += 4;
  if (/Store\s+rating/i.test(after)) score += 4;
  if (/Verified/i.test(after) || /Verified/i.test(before)) score += 1;
  if (/\bCN\b|\bChina\b|🇨🇳/i.test(after) || /\bCN\b|\bChina\b/i.test(before)) {
    score += 0.5;
  }
  return score;
}

/**
 * Prefer the visible Alibaba supplier-card company line
 * (… Co., Ltd. above “9 yrs” / Store rating).
 */
export function extractCompanyNameFromPage(text: string): string | null {
  // Strongest: legal name immediately followed by “N yrs”
  const nearYrs = text.match(
    /\b((?:[A-Z][\w&.,'’\-]+[\s-]+){1,12}(?:Co\.?,?\s*Ltd\.?|Company\s+Limited|Limited))\s*[|\n\r\t ]*(\d{1,2})\s*yrs?\b/i,
  );
  if (nearYrs?.[1]) {
    const cleaned = cleanCompanyCandidate(nearYrs[1]);
    if (cleaned) return cleaned;
  }

  // Labeled supplier / company fields
  const labeledPatterns = [
    /(?:supplier|company|manufacturer|seller|store)\s*(?:name)?\s*[:：]\s*([^\n|]{4,120})/i,
    /(?:sold\s+by|by\s+seller|from\s+store)\s*[:：]?\s*([^\n.]{4,100})/i,
  ];
  for (const re of labeledPatterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const cleaned = cleanCompanyCandidate(m[1]);
    if (cleaned && LEGAL_SUFFIX.test(cleaned)) return cleaned;
    if (cleaned && cleaned.length >= 8) {
      // keep as candidate below if no better legal match
    }
  }

  // Score all Co., Ltd. / Limited hits; prefer those near yrs / Store rating
  const coRe =
    /\b((?:[A-Z][\w&.,'’\-]+[\s-]+){1,12}(?:Co\.?,?\s*Ltd\.?|Company\s+Limited|Limited))\b/g;
  let best: { name: string; score: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = coRe.exec(text))) {
    const cleaned = cleanCompanyCandidate(m[1]!);
    if (!cleaned) continue;
    const score = scoreCompanyNearChrome(text, m.index, cleaned);
    if (!best || score > best.score) best = { name: cleaned, score };
  }
  if (best && best.score >= 1) return best.name;

  // Labeled non-legal store names as last page resort
  for (const re of labeledPatterns) {
    const lm = text.match(re);
    if (!lm?.[1]) continue;
    const cleaned = cleanCompanyCandidate(lm[1]);
    if (cleaned && cleaned.length >= 6) return cleaned;
  }

  return null;
}

function usableCardFallback(fallbackName: string | null): string | null {
  const fallback = fallbackName?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
  if (fallback.length < 2) return null;
  if (isPlatformListingFallbackName(fallback)) return null;
  if (/^Alibaba listing|^AliExpress seller listing|^Marketplace listing/i.test(fallback)) {
    return null;
  }
  return fallback;
}

function extractCompanyName(
  text: string,
  fallbackName: string | null,
): { name: string | null; source: "page" | "card" | null } {
  const fromPage = extractCompanyNameFromPage(text);
  if (fromPage) return { name: fromPage, source: "page" };

  const fallback = usableCardFallback(fallbackName);
  if (fallback) return { name: fallback, source: "card" };
  return { name: null, source: null };
}

function scoreSkuRelevance(
  pageText: string,
  skuName: string,
): DiligenceSkuRelevance {
  const tokens = skuName
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
  if (tokens.length === 0) return "weak";
  const lower = pageText.toLowerCase();
  let hits = 0;
  for (const tok of tokens) {
    if (lower.includes(tok)) hits += 1;
  }
  const ratio = hits / tokens.length;
  if (hits >= 2 || ratio >= 0.5) return "strong";
  if (hits >= 1) return "weak";
  return "none";
}

function extractYears(text: string): { years: number | null; excerpt: string | null } {
  const patterns = [
    // Alibaba supplier chrome: "9 yrs" next to company / store rating
    /(\d{1,2})\s*yrs?\b(?=[\s\S]{0,120}Store\s+rating)/i,
    /(?:Co\.?,?\s*Ltd\.?|Limited)\s*[|\n\r\t ]*(\d{1,2})\s*yrs?\b/i,
    /(\d{1,2})\s*\+?\s*years?\s+(?:on\s+)?(?:alibaba|aliexpress|the\s+platform)/i,
    /years?\s+(?:on\s+)?(?:alibaba|aliexpress)[:\s]+(\d{1,2})/i,
    /(\d{1,2})\s*yrs?\s+(?:on\s+)?(?:alibaba|aliexpress)/i,
    /(\d{1,2})\s*yrs?\b/i,
    /established\s+(\d{1,2})\s+years?\s+ago/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 40) continue;
    return {
      years: n,
      excerpt: excerptAround(text, m.index ?? 0),
    };
  }
  return { years: null, excerpt: null };
}

function extractRating(text: string): { rating: number | null; excerpt: string | null } {
  const patterns = [
    /Store\s+rating[:\s]*(\d(?:\.\d)?)\s*\/\s*5(?:\.0)?/i,
    /(?:rating|score|reviews?)[:\s]*(\d(?:\.\d)?)\s*(?:\/\s*5(?:\.0)?)?/i,
    /(\d(?:\.\d)?)\s*\/\s*5(?:\.0)?(?:\s*(?:stars?|rating))?/i,
    /(\d(?:\.\d)?)\s*out\s+of\s+5/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 5) continue;
    return {
      rating: Math.round(n * 10) / 10,
      excerpt: excerptAround(text, m.index ?? 0),
    };
  }
  return { rating: null, excerpt: null };
}

function extractMoq(text: string): number | null {
  const patterns = [
    /MOQ[:\s]*(\d{1,6})/i,
    /minimum\s+order(?:\s+quantity)?[:\s]*(\d{1,6})/i,
    /min(?:imum)?\.?\s*order[:\s]*(\d{1,6})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  }
  return null;
}

function extractUnitPrice(text: string): number | null {
  const patterns = [
    /US\s*\$\s*([\d]+(?:\.\d{1,2})?)\s*(?:\/|per)\s*(?:piece|unit|pc|pcs)?/i,
    /\$\s*([\d]+(?:\.\d{1,2})?)\s*(?:\/|per)\s*(?:piece|unit|pc)/i,
    /unit\s*price[:\s]*US?\s*\$?\s*([\d]+(?:\.\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 100_000) return n;
  }
  return null;
}

function extractVerifiedSignals(text: string): { signals: string[]; excerpts: string[] } {
  const checks: { label: string; re: RegExp }[] = [
    { label: "Verified Supplier", re: /verified\s+supplier/i },
    { label: "Gold Supplier", re: /gold\s+supplier/i },
    { label: "Trade Assurance", re: /trade\s+assurance/i },
  ];
  const signals: string[] = [];
  const excerpts: string[] = [];
  for (const c of checks) {
    const m = text.match(c.re);
    if (!m) continue;
    signals.push(c.label);
    excerpts.push(excerptAround(text, m.index ?? 0));
  }
  return { signals, excerpts };
}

/** True when scrape text likely includes a supplier legal name. */
export function pageTextHasCompanySignal(text: string): boolean {
  return (
    /\bCo\.?,?\s*Ltd\.?\b/i.test(text) ||
    (/\bLimited\b/i.test(text) &&
      /\b(?:yrs?|Store\s+rating|Verified\s+Supplier)\b/i.test(text))
  );
}

/**
 * Extract diligence facts from scraped listing text.
 */
export function extractDiligenceFacts(input: {
  pageText: string;
  sourceUrl: string;
  skuName: string;
  /** Card contact name — used only when page has no company; never platform placeholders. */
  fallbackCompanyName?: string | null;
}): DiligenceFacts {
  const text = input.pageText;
  const excerpts: string[] = [];
  const years = extractYears(text);
  if (years.excerpt) excerpts.push(years.excerpt);
  const rating = extractRating(text);
  if (rating.excerpt) excerpts.push(rating.excerpt);
  const verified = extractVerifiedSignals(text);
  excerpts.push(...verified.excerpts);

  const certifications: string[] = [];
  for (const c of CERT_PATTERNS) {
    const m = text.match(c.re);
    if (!m) continue;
    certifications.push(c.label);
    excerpts.push(excerptAround(text, m.index ?? 0));
  }

  const company = extractCompanyName(text, input.fallbackCompanyName ?? null);
  const skuRelevance = scoreSkuRelevance(text, input.skuName);
  const moqHint = extractMoq(text);
  const unitPriceHint = extractUnitPrice(text);

  const reviewSnippets: string[] = [];
  const reviewRe =
    /(?:buyer|customer)\s+(?:said|feedback|review)[:\s]+(.{20,120})/gi;
  let rm: RegExpExecArray | null;
  while ((rm = reviewRe.exec(text)) && reviewSnippets.length < 3) {
    reviewSnippets.push(rm[1]!.replace(/\s+/g, " ").trim());
  }

  return {
    companyName: company.name,
    companyNameSource: company.source,
    yearsOnPlatform: years.years,
    verifiedSignals: verified.signals,
    certifications,
    rating: rating.rating,
    reviewSnippets,
    skuRelevance,
    moqHint,
    unitPriceHint,
    platform: platformFromUrl(input.sourceUrl),
    rawExcerpts: excerpts.slice(0, 8),
    pageTextLength: text.length,
  };
}
