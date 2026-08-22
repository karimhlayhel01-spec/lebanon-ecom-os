/**
 * Wave 3 — Assess listing diligence types.
 * Facts are null when absent on the fetched page; never invent marketplace stats.
 */

export type DiligenceRecommendation =
  | "worth_sampling"
  | "caution"
  | "skip";

export type DiligenceSkuRelevance = "strong" | "weak" | "none";

export type DiligencePlatform = "alibaba" | "aliexpress" | "other";

export type DiligenceFacts = {
  companyName: string | null;
  /**
   * Where companyName came from — page extract vs card contact name.
   * null when companyName is null.
   */
  companyNameSource: "page" | "card" | null;
  yearsOnPlatform: number | null;
  verifiedSignals: string[];
  certifications: string[];
  rating: number | null;
  reviewSnippets: string[];
  skuRelevance: DiligenceSkuRelevance;
  moqHint: number | null;
  unitPriceHint: number | null;
  platform: DiligencePlatform;
  /** Bounded excerpts used for grounding checks / optional chips. */
  rawExcerpts: string[];
  /** Characters of page text used for extract (thin-scrape gate). */
  pageTextLength: number;
};

export type DiligenceHonestyKey = "assessListingHonesty";

export type AssessListingSuccess = {
  ok: true;
  recommendation: DiligenceRecommendation;
  /** Gemini body when narration succeeded; null when skills-only fallback. */
  summary: string | null;
  facts: DiligenceFacts;
  honestyKey: DiligenceHonestyKey;
  narrationSource: "llm" | "skills_only";
  /** Import live seat removed because Assess extracted a unit over max landed. */
  seatHiddenOverCap?: boolean;
};

export type AssessListingErrorCode =
  | "not_found"
  | "no_url"
  | "missing_scrape_key"
  | "scrape_failed"
  | "missing_key"
  | "quota"
  | "failed";

export type AssessListingResult =
  | AssessListingSuccess
  | { ok: false; error: AssessListingErrorCode };

export type ScrapeListingResult =
  | { ok: true; text: string; markdown: string | null }
  | { ok: false; error: "missing_key" | "empty" | "blocked" | "api_error" };
