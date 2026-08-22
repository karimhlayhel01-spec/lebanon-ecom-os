/**
 * Path 1 intake — normalize public search/shopping hits into pool fields.
 * Winning-product oriented (not brand directory). No Alibaba official API.
 */

import type { IndustryOptionId } from "@/lib/constants";
import { INDUSTRY_OPTIONS } from "@/lib/constants";
import type { SearchResultItem } from "@/lib/discovery/search-provider";

export type NormalizedPath1Candidate = {
  catalogKey: string;
  nameEn: string;
  nameAr: string;
  category: IndustryOptionId;
  summaryEn: string;
  summaryAr: string;
  differentiationEn: string;
  differentiationAr: string;
  sellPrice: number;
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  difficulty: number;
  risk: number;
  timeNeed: number;
  workload: number;
  storageFootprint: "small" | "medium" | "large";
  oversized: boolean;
  tier1Marketplaces: string;
  sourceUrl: string;
  moqHint: number | null;
  sampleCostHint: number | null;
  source: "path1_search";
  active: boolean;
  /** Sanitized http(s) shopping thumbnail, or null. Never fetched. */
  imageUrl: string | null;
};

/** Domains we never ingest (WAVE-2 §9.4 / no Alibaba official path). */
const BLOCKED_HOST_FRAGMENTS = [
  "alibaba.com",
  "1688.com",
  "aliexpress.com",
  "accio.com",
];

const BRAND_DIRECTORY_TITLE =
  /\b(official\s+store|brand\s+store|flagship\s+store|wikipedia|about\s+us)\b/i;

const INDUSTRY_QUERY_LABELS: Record<IndustryOptionId, string> = {
  beauty_personal_care: "beauty personal care",
  home_kitchen: "home kitchen",
  phone_tech_accessories: "phone tech accessories",
  kids_baby_accessories: "kids baby accessories",
  fitness_lifestyle: "fitness lifestyle",
  fashion_accessories: "fashion accessories",
  car_accessories: "car accessories",
  pet_accessories: "pet accessories",
  office_desk_gadgets: "office desk gadgets",
  health_wellness_gadgets: "health wellness gadgets",
};

function clampMoney(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

/** Stable short key from URL — Path 1 rows coexist with catalog_seed keys. */
export function catalogKeyFromSourceUrl(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `path1_${hex}`;
}

export function isBlockedIntakeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOST_FRAGMENTS.some((f) => host.includes(f));
  } catch {
    return true;
  }
}

export function looksLikeBrandDirectory(title: string): boolean {
  return BRAND_DIRECTORY_TITLE.test(title.trim());
}

/**
 * Persist an http(s) URL string only. Reject data:/javascript:/vbscript:/
 * empty/non-http. Do not fetch the file. Shared allow-list for pool photos
 * and §14.13 listing hrefs.
 */
export function sanitizeHttpUrl(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 2000);
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:")
  ) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/** Shopping thumbnail — same allow-list as `sanitizeHttpUrl`. */
export function sanitizeHttpImageUrl(
  raw: string | null | undefined,
): string | null {
  return sanitizeHttpUrl(raw);
}

/** Keep a new valid URL; do not wipe an existing good URL with null. */
export function nextPath1ImageUrl(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  return sanitizeHttpImageUrl(incoming) ?? sanitizeHttpImageUrl(existing);
}

/**
 * Extract a sell-price seed from structured price, snippet, or title.
 */
export function extractPriceSeed(
  item: Pick<SearchResultItem, "title" | "snippet" | "price">,
): number | null {
  if (item.price != null && Number.isFinite(item.price) && item.price > 0) {
    return item.price;
  }
  const blob = `${item.title} ${item.snippet ?? ""}`;
  const m = blob.replace(/,/g, "").match(/(?:USD|US\$|\$|€|£)\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * US/EU-oriented Path 1 query templates (WAVE-2 §1b / §9.1).
 * Cap applied by caller via maxQueries.
 */
export function buildPath1IntakeQueries(maxQueries: number): {
  query: string;
  category: IndustryOptionId;
}[] {
  const cap = Math.max(0, Math.floor(maxQueries));
  const out: { query: string; category: IndustryOptionId }[] = [];
  const templates = [
    (label: string) =>
      `best selling ${label} products United States`,
    (label: string) => `top trending ${label} products Europe`,
  ];

  for (const id of INDUSTRY_OPTIONS) {
    const label = INDUSTRY_QUERY_LABELS[id];
    for (const tmpl of templates) {
      if (out.length >= cap) return out;
      out.push({ query: tmpl(label), category: id });
    }
  }
  return out;
}

/**
 * Map one search hit + intake category into pool fields.
 * Returns null when the hit is blocked / brand-directory / unusable.
 */
export function normalizeSearchItemToPoolCandidate(
  item: SearchResultItem,
  category: IndustryOptionId,
): NormalizedPath1Candidate | null {
  const title = item.title.trim();
  const url = item.url.trim();
  if (!title || !url) return null;
  if (isBlockedIntakeUrl(url)) return null;
  if (looksLikeBrandDirectory(title)) return null;

  const sellPrice = clampMoney(extractPriceSeed(item) ?? 29.99, 29.99);
  // Seed landed components — scoring will refine; cost ~25% of retail seed.
  const productCost = clampMoney(sellPrice * 0.25, 5);
  const intlShip = clampMoney(Math.min(8, sellPrice * 0.08), 2);
  const clearanceTaxes = clampMoney(Math.min(4, sellPrice * 0.04), 1);
  const localCourier = 2;

  const summaryEn =
    (item.snippet ?? "").trim().slice(0, 240) ||
    `Path 1 candidate: ${title}`;

  return {
    catalogKey: catalogKeyFromSourceUrl(url),
    nameEn: title.slice(0, 160),
    nameAr: "",
    category,
    summaryEn,
    summaryAr: "",
    differentiationEn: "",
    differentiationAr: "",
    sellPrice,
    productCost,
    intlShip,
    clearanceTaxes,
    localCourier,
    difficulty: 1,
    risk: 1,
    timeNeed: 5,
    workload: 1,
    storageFootprint: "small",
    oversized: false,
    tier1Marketplaces: "[]",
    sourceUrl: url.slice(0, 2000),
    moqHint: null,
    sampleCostHint: null,
    source: "path1_search",
    active: true,
    imageUrl: sanitizeHttpImageUrl(item.imageUrl),
  };
}

/**
 * Dedupe by catalogKey (URL-derived) preserving first occurrence.
 */
export function dedupeNormalizedCandidates(
  rows: readonly NormalizedPath1Candidate[],
): NormalizedPath1Candidate[] {
  const seen = new Set<string>();
  const out: NormalizedPath1Candidate[] = [];
  for (const row of rows) {
    if (seen.has(row.catalogKey)) continue;
    seen.add(row.catalogKey);
    out.push(row);
  }
  return out;
}
