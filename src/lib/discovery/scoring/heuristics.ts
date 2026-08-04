/**
 * Seed / heuristic score derivation when DISCOVERY_LIVE_SEARCH is off.
 * Deterministic from pool row fields — no network. WAVE-2 Approach A.
 */

import type { ScoreSnapshot } from "@/lib/discovery/scores";
import { HEURISTIC_SEED_CONFIDENCE } from "@/lib/discovery/scoring/constants";
import { scoreCompetition } from "@/lib/discovery/scoring/competition";
import { scoreDemand } from "@/lib/discovery/scoring/demand";

export type HeuristicPoolFields = {
  catalogKey: string;
  category: string;
  difficulty: number;
  risk: number;
  tier1Marketplaces: string;
  nameEn: string;
};

function parseTier1Count(raw: string): number {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* ignore */
  }
  return 0;
}

/** Tiny stable 0..1 from catalog key (diversity across seed rows). */
function keyJitter(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

/**
 * Derive abroad / Lebanon / competition evidence from curated seed attributes.
 * Not live search — confidence stays low so polish can cap Strong → Okay.
 */
export function heuristicScoresFromPoolProduct(
  product: HeuristicPoolFields,
): ScoreSnapshot {
  const tier1 = parseTier1Count(product.tier1Marketplaces);
  const jitter = keyJitter(product.catalogKey);

  // Abroad: easier / lower-risk seed products lean slightly stronger.
  const abroadDemandScore = Math.max(
    0.35,
    Math.min(
      0.85,
      0.52 + (2 - product.difficulty) * 0.08 - product.risk * 0.04 + jitter * 0.06,
    ),
  );

  // Lebanon: Tier-1 presence ⇒ more local footprint (local-proven lean).
  const lebanonDemandScore = Math.max(
    0.15,
    Math.min(0.85, (tier1 > 0 ? 0.48 + tier1 * 0.12 : 0.22) + jitter * 0.05),
  );

  // Competition intensity: Tier-1 collisions raise Lebanon competition.
  const competitionScore = Math.max(
    0.1,
    Math.min(0.95, (tier1 === 0 ? 0.18 : 0.4 + tier1 * 0.22) + jitter * 0.04),
  );

  const demand = scoreDemand({ abroadDemandScore, lebanonDemandScore });
  const competition = scoreCompetition(competitionScore);
  // Product-only stub composite (no founder Fit/budget) for cache inspectability.
  const compositeStub = demand.score * competition.multiplier;

  const explainLine = `Heuristic seed scores for ${product.nameEn} (${demand.path ?? "neutral"}; competition ${competition.level}).`;

  return {
    abroadDemandScore,
    lebanonDemandScore,
    competitionScore,
    budgetFightPenalty: null,
    compositeScore: compositeStub,
    demandPath: demand.path,
    confidence: HEURISTIC_SEED_CONFIDENCE,
    explainLine,
    shadowWouldExclude: false,
    shadowExcludeReason: null,
    rawEvidenceJson: JSON.stringify({
      source: "heuristic_seed",
      tier1Count: tier1,
      category: product.category,
      difficulty: product.difficulty,
      risk: product.risk,
    }),
  };
}
