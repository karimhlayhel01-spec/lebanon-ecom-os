/**
 * Skills pick for Assess listing — deterministic from extracted facts.
 * Gemini narrates only; never overrides this tier.
 * Does NOT require page-sourced company identity for worth_sampling.
 */

import type {
  DiligenceFacts,
  DiligenceRecommendation,
} from "@/lib/supplier/diligence/types";

/** Below this, page is too thin to green-light a sample. */
export const DILIGENCE_THIN_PAGE_CHARS = 400;

export function hasCredibilitySignal(facts: DiligenceFacts): boolean {
  if (facts.verifiedSignals.length > 0) return true;
  if (facts.yearsOnPlatform != null && facts.yearsOnPlatform > 0) return true;
  if (facts.rating != null && facts.rating >= 4.0) return true;
  return false;
}

/**
 * pickSupplierDiligenceRecommendation — WAVE-3 locked tiers.
 *
 * worth_sampling: SKU-relevant + ≥1 credibility signal + not a hard mismatch
 * (no company-name gate — founder opens listing for full supplier profile)
 * skip: thin scrape, irrelevant SKU, or nothing that justifies even a sample ask
 * caution: relevant but weak/missing signals, or mixed
 */
export function pickSupplierDiligenceRecommendation(
  facts: DiligenceFacts,
  _skuName?: string,
): DiligenceRecommendation {
  const thin = facts.pageTextLength < DILIGENCE_THIN_PAGE_CHARS;
  const relevant =
    facts.skuRelevance === "strong" || facts.skuRelevance === "weak";
  const strongRelevant = facts.skuRelevance === "strong";
  const credibility = hasCredibilitySignal(facts);

  if (thin && !credibility) return "skip";
  if (facts.skuRelevance === "none") return "skip";
  if (!relevant && !credibility) return "skip";

  if (
    relevant &&
    credibility &&
    (strongRelevant || facts.verifiedSignals.length > 0 || credibility) &&
    (!thin || facts.verifiedSignals.length > 0 || credibility)
  ) {
    return "worth_sampling";
  }

  if (relevant) {
    return "caution";
  }

  return "skip";
}

/** Founder-facing EN copy for the skills tier (Gemini must not invent a different tier). */
export function diligenceRecommendationCopyEn(
  tier: DiligenceRecommendation,
): string {
  switch (tier) {
    case "worth_sampling":
      return "Worth requesting a sample";
    case "caution":
      return "Proceed with caution";
    case "skip":
      return "Skip for now";
  }
}

export function diligenceRecommendationCopyAr(
  tier: DiligenceRecommendation,
): string {
  switch (tier) {
    case "worth_sampling":
      return "يجدر طلب عيّنة";
    case "caution":
      return "تابع بحذر";
    case "skip":
      return "تخطَّ الآن";
  }
}

/** Platform label for “Open on …” CTA in narration. */
export function openListingPlatformLabel(
  platform: DiligenceFacts["platform"],
): "Alibaba" | "AliExpress" | "Web" {
  if (platform === "aliexpress") return "AliExpress";
  if (platform === "alibaba") return "Alibaba";
  return "Web";
}
