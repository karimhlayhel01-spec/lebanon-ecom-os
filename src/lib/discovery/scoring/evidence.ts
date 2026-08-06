/**
 * Approach A score-refresh evidence — capped search → demand/competition scores.
 * Dual demand paths (whitespace OR local-proven). WAVE-2 §§3–4, §7, §9.
 * Pure mapping is unit-testable; live I/O stays in the score-refresh job.
 */

import { TIER1_MARKETPLACES } from "@/lib/constants";
import type {
  SearchQuery,
  SearchResultItem,
} from "@/lib/discovery/search-provider";
import type { ScoreSnapshot } from "@/lib/discovery/scores";
import {
  COMPETITION_HIGH_MIN,
  DEMAND_NEUTRAL,
} from "@/lib/discovery/scoring/constants";
import { scoreCompetition } from "@/lib/discovery/scoring/competition";
import { scoreDemand } from "@/lib/discovery/scoring/demand";

const ABROAD_HOST_HINTS = [
  "amazon.",
  "walmart.",
  "target.com",
  "bestbuy.",
  "ebay.",
  "johnlewis.",
  "otto.de",
  "fnac.",
  "bol.com",
  "etsy.",
  "wayfair.",
  "shopify.com",
];

const ABROAD_TEXT_HINTS = [
  "best seller",
  "bestseller",
  "top rated",
  "amazon",
  "united states",
  " u.s.",
  "europe",
  " eu ",
];

const LEBANON_HINTS = [
  "lebanon",
  "beirut",
  ".lb",
  "lebanese",
  "بيروت",
  "لبنان",
];

const GULF_HOST_HINTS = [
  "amazon.ae",
  "amazon.sa",
  "noon.com",
  "jarir.com",
  "extra.com",
];

export const MARKET_EVIDENCE_RESULT_CAP = 5;
export const MARKET_EVIDENCE_TEXT_MAX = 120;

export type BoundedMarketResult = {
  domain: string;
  title: string;
  seller: string | null;
};

export type ScoreRefreshProductFields = {
  nameEn: string;
  category: string;
  tier1Marketplaces: string;
};

export type GatheredEvidence = {
  abroadItems: SearchResultItem[];
  lebanonItems: SearchResultItem[];
  tier1Items: SearchResultItem[];
  localItems: SearchResultItem[];
  queriesUsed: number;
  /** True when every leg returned zero items. */
  emptyEvidence: boolean;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEMAND_NEUTRAL;
  return Math.max(0, Math.min(1, n));
}

function itemBlob(item: SearchResultItem): string {
  return `${item.title} ${item.url} ${item.snippet ?? ""} ${item.merchant ?? ""}`.toLowerCase();
}

function trimEvidenceText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MARKET_EVIDENCE_TEXT_MAX);
}

function domainFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "").slice(0, 100);
  } catch {
    return "";
  }
}

/** Bounded, deduplicated facts only — no snippets or full result payloads. */
export function boundedMarketResults(
  items: readonly SearchResultItem[],
): BoundedMarketResult[] {
  const out: BoundedMarketResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const domain = domainFromUrl(item.url);
    const title = trimEvidenceText(item.title);
    const seller = trimEvidenceText(item.merchant) || null;
    if (!domain || !title) continue;
    const key = `${domain}\u0000${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain, title, seller });
    if (out.length >= MARKET_EVIDENCE_RESULT_CAP) break;
  }
  return out;
}

export function tier1NamesFromItems(
  items: readonly SearchResultItem[],
): string[] {
  const known = [
    { name: "Ishtari", needles: ["ishtari"] },
    { name: "EGLOW", needles: ["eglow"] },
    { name: "Platza", needles: ["platza"] },
  ];
  const found: string[] = [];
  for (const item of items) {
    const blob = itemBlob(item);
    const knownHit = known.find((entry) =>
      entry.needles.some((needle) => blob.includes(needle)),
    );
    const name =
      (knownHit?.name ?? trimEvidenceText(item.merchant)) ||
      domainFromUrl(item.url);
    if (name && !found.includes(name)) found.push(name);
    if (found.length >= MARKET_EVIDENCE_RESULT_CAP) break;
  }
  return found;
}

function isGulfPrimaryHit(item: SearchResultItem): boolean {
  const blob = itemBlob(item);
  return GULF_HOST_HINTS.some((h) => blob.includes(h));
}

function parsePoolTier1(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Cap-aware query plan: abroad + Lebanon + Tier-1/local (WAVE-2 §9).
 * Default max = DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX (6).
 */
export function buildScoreRefreshQueryPlan(
  product: ScoreRefreshProductFields,
  maxQueries: number,
): SearchQuery[] {
  const name = product.nameEn.trim() || "product";
  const cap = Math.max(0, Math.floor(maxQueries));
  const plan: SearchQuery[] = [
    {
      kind: "abroad_demand",
      query: `${name} best selling United States`,
    },
    {
      kind: "abroad_demand",
      query: `${name} review Europe`,
    },
    {
      kind: "lebanon_demand",
      query: `${name} Lebanon buy`,
    },
    {
      kind: "lebanon_demand",
      query: `${name} Beirut`,
    },
    {
      kind: "tier1_competition",
      query: name,
      site: "ishtari.com",
    },
    {
      kind: "local_competition",
      query: `${name} Lebanon shop`,
    },
  ];
  return plan.slice(0, cap);
}

/** Soft 0..1 abroad traction from US/EU-oriented hits (Gulf not primary). */
export function scoreAbroadDemandFromItems(
  items: readonly SearchResultItem[],
): number {
  if (items.length === 0) return 0.2;
  let hits = 0;
  let secondary = 0;
  for (const item of items) {
    if (isGulfPrimaryHit(item)) {
      secondary += 0.25;
      continue;
    }
    const blob = itemBlob(item);
    const hostHit = ABROAD_HOST_HINTS.some((h) => blob.includes(h));
    const textHit = ABROAD_TEXT_HINTS.some((h) => blob.includes(h));
    if (hostHit || textHit) hits += 1;
    else secondary += 0.35;
  }
  return clamp01(0.32 + hits * 0.22 + Math.min(0.2, secondary * 0.1));
}

/** Soft 0..1 Lebanon demand from local-oriented hits. */
export function scoreLebanonDemandFromItems(
  items: readonly SearchResultItem[],
): number {
  if (items.length === 0) return 0.2;
  let hits = 0;
  for (const item of items) {
    const blob = itemBlob(item);
    if (LEBANON_HINTS.some((h) => blob.includes(h))) hits += 1;
    else hits += 0.35;
  }
  return clamp01(0.2 + hits * 0.2);
}

/** Lebanon competition intensity 0..1 from Tier-1 + local clutter. */
export function scoreCompetitionFromItems(input: {
  tier1Items: readonly SearchResultItem[];
  localItems: readonly SearchResultItem[];
  poolTier1: readonly string[];
}): number {
  const tier1Names = TIER1_MARKETPLACES.map((t) => t.toLowerCase());
  let tier1Hits = input.poolTier1.length * 0.22;
  for (const item of input.tier1Items) {
    const blob = itemBlob(item);
    if (
      tier1Names.some((t) => blob.includes(t)) ||
      blob.includes("ishtari") ||
      blob.includes("eglow") ||
      blob.includes("platza")
    ) {
      tier1Hits += 0.28;
    } else if (item.url) {
      tier1Hits += 0.12;
    }
  }
  const localHits = input.localItems.length * 0.1;
  return clamp01(0.12 + tier1Hits + Math.min(0.35, localHits));
}

/**
 * Map gathered search evidence → ScoreSnapshot (dual demand path via scoreDemand).
 * Soft competition×budget: rank penalty later at shortlist; here we only
 * shadow-log would-exclude (empty evidence or hard-mode high competition).
 */
export function scoresFromSearchEvidence(input: {
  productName: string;
  abroadItems: readonly SearchResultItem[];
  lebanonItems: readonly SearchResultItem[];
  tier1Items: readonly SearchResultItem[];
  localItems: readonly SearchResultItem[];
  poolTier1Json: string;
  softCompetitionBudget: boolean;
  queriesUsed: number;
}): ScoreSnapshot {
  const poolTier1 = parsePoolTier1(input.poolTier1Json);
  const abroadDemandScore = scoreAbroadDemandFromItems(input.abroadItems);
  const lebanonDemandScore = scoreLebanonDemandFromItems(input.lebanonItems);
  const competitionScore = scoreCompetitionFromItems({
    tier1Items: input.tier1Items,
    localItems: input.localItems,
    poolTier1,
  });

  const demand = scoreDemand({ abroadDemandScore, lebanonDemandScore });
  const competition = scoreCompetition(competitionScore);
  const compositeStub = demand.score * competition.multiplier;

  const totalHits =
    input.abroadItems.length +
    input.lebanonItems.length +
    input.tier1Items.length +
    input.localItems.length;
  const emptyEvidence = totalHits === 0;

  const confidence = emptyEvidence
    ? 0.2
    : clamp01(0.5 + Math.min(0.4, totalHits * 0.04) + input.queriesUsed * 0.02);

  // Shadow log before hard filters (WAVE-2 §7) — do not hard-hide here.
  let shadowWouldExclude = false;
  let shadowExcludeReason: string | null = null;
  if (emptyEvidence) {
    shadowWouldExclude = true;
    shadowExcludeReason = "empty_search_evidence";
  } else if (
    !input.softCompetitionBudget &&
    competition.intensity >= COMPETITION_HIGH_MIN
  ) {
    // Hard-mode flag: log that high competition would exclude thin fights.
    shadowWouldExclude = true;
    shadowExcludeReason = "high_competition_hard_mode_shadow";
  }

  const explainLine = emptyEvidence
    ? `Live search empty for ${input.productName} — low-confidence scores; last-known kept on future fail.`
    : `Live scores for ${input.productName} (${demand.path ?? "neutral"}; competition ${competition.level}).`;
  const abroadResults = boundedMarketResults(input.abroadItems);
  const lebanonResults = boundedMarketResults(input.lebanonItems);
  const localCompetitionResults = boundedMarketResults(input.localItems);
  const tier1Found = tier1NamesFromItems(input.tier1Items);

  return {
    abroadDemandScore,
    lebanonDemandScore,
    competitionScore,
    budgetFightPenalty: input.softCompetitionBudget
      ? 0
      : competition.level === "high"
        ? 0.55
        : null,
    compositeScore: compositeStub,
    demandPath: demand.path,
    confidence,
    explainLine,
    shadowWouldExclude,
    shadowExcludeReason,
    rawEvidenceJson: JSON.stringify({
      source: "live_search",
      provider: "SerpAPI",
      queriesUsed: input.queriesUsed,
      confidence,
      hitCounts: {
        abroad: input.abroadItems.length,
        lebanon: input.lebanonItems.length,
        tier1: input.tier1Items.length,
        local: input.localItems.length,
      },
      abroad: {
        count: input.abroadItems.length,
        results: abroadResults,
      },
      lebanon: {
        count: input.lebanonItems.length,
        results: lebanonResults,
      },
      localCompetition: {
        count: input.localItems.length,
        results: localCompetitionResults,
      },
      tier1Found,
      emptyEvidence,
      softCompetitionBudget: input.softCompetitionBudget,
      demandPath: demand.path,
      competitionLevel: competition.level,
      shadowWouldExclude,
      shadowExcludeReason,
    }),
  };
}

export function summarizeGatheredEvidence(
  bags: GatheredEvidence,
): GatheredEvidence {
  const emptyEvidence =
    bags.abroadItems.length === 0 &&
    bags.lebanonItems.length === 0 &&
    bags.tier1Items.length === 0 &&
    bags.localItems.length === 0;
  return { ...bags, emptyEvidence };
}
