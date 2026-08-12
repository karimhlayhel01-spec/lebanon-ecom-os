export const MIN_BUDGET_USD = 2000;
export const MARGIN_BEFORE_ADS_MIN = 0.7;
export const MARGIN_AFTER_ADS_MIN = 0.35;
/** Marketing estimate per order is capped at this share of the sell price. */
export const MARKETING_COST_PCT_OF_PRICE = 0.2;
/** Monthly follow-on budget is spread across this many days for the estimate. */
export const MARKETING_BUDGET_DAYS = 30;
/** Products revealed on session start (and per Show more click). */
export const DISCOVERY_INITIAL_COUNT = 5;
/**
 * Secondary guard on Show more clicks. Full pool: 5 initial + 4 clicks = 25.
 * The real limiter is `productsShown < sessionCap`; this caps click count.
 */
export const DISCOVERY_SHOW_MORE_MAX = 4;
/** Max products revealed per discovery session when the pool is large enough. */
export const DISCOVERY_SESSION_CAP = 25;
/** After this many fully exhausted session pools, show the "why did you pass?" form. */
export const DISCOVERY_EXHAUSTED_ROUNDS_BEFORE_WHY = 3;
/**
 * Per-unit landed-cost tolerance for Discovery. A product whose landed cost is
 * at or below `maxLandedCost × MAX_LANDED_SOFT_OVERAGE` may still appear (the
 * soft budget Fit penalty handles "slightly over"). Anything above this ceiling
 * is way over the founder's stated per-unit max and is hard-excluded from the
 * discovery pool. This is about per-unit landed cost, NOT total budgetUsd.
 */
export const MAX_LANDED_SOFT_OVERAGE = 1.2;
/**
 * Wave 2 Approach A — max search queries per pool product per score refresh
 * (abroad + Lebanon + Tier-1 family). Jobs must respect this cap.
 */
export const DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX = 6;
/** Soft ceiling for Path 1 intake queries per scheduled run. */
export const DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX = 40;
/**
 * Wave 2 §7 — default monthly search-query allowance across all Discovery jobs.
 * Deliberately at free-tier scale: a runaway cron must never quietly burn a paid
 * quota. Raise per deployment with DISCOVERY_SEARCH_MONTHLY_QUERY_CAP.
 */
export const DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT = 100;
/**
 * Wave 4 Phase 7 — default monthly successful Marketing Gemini calls per workspace
 * (Intro fill + creatives improve; visual polish only when it actually calls Gemini).
 * Raise per deployment with MARKETING_GEMINI_MONTHLY_CAP. Explicit 0 = spend nothing.
 */
export const MARKETING_GEMINI_MONTHLY_CAP_DEFAULT = 40;
/** Per-request timeout for an outbound search call (no unbounded hangs). */
export const DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS = 30_000;
/** Total attempts (1 initial + bounded retries) for a transient search failure. */
export const DISCOVERY_SEARCH_MAX_ATTEMPTS = 3;
/** Soft threshold for “thin shortlist” Edit-onboarding banner (WAVE-2 §8). */
export const DISCOVERY_FALLBACK_SHORTLIST_MIN = 5;
/**
 * Wave 2 §7 — a market read older than this reads as out of date on the card.
 * Matches the daily score cadence with slack for a few missed cron runs.
 * Override per deployment with DISCOVERY_SCORE_STALE_AFTER_DAYS.
 */
export const DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT = 7;
/**
 * Wave 2 §7 — how long a reject stays recoverable. Long enough to catch a
 * mis-tap, short enough that undo never becomes a second shortlist.
 */
export const DISCOVERY_UNDO_REJECT_WINDOW_MS = 10 * 60 * 1000;
/** Wave 2 §7 — most recent rejects offered for undo at one time. */
export const DISCOVERY_UNDO_REJECT_MAX = 3;
/** Worth-considering compare: minimum selected cards to run Compare. */
export const DISCOVERY_COMPARE_MIN = 2;
/** Worth-considering compare: hard max marks per session. */
export const DISCOVERY_COMPARE_MAX = 3;
export const INVEST_NEXT_MIN_WEEKS = 4;
/**
 * Shop Topic A weeks shown on the main Finance panel (newest).
 * Older weeks live on `/finance/history` — UI split only; DB keeps all rows.
 */
export const TOPIC_A_RECENT_WEEKS = 20;
/** Soft next-batch nudge when SKU runway weeks ≤ this (Topic A left ÷ sell-through). */
export const REORDER_RUNWAY_WEEKS = 4;
export const PRE_LAUNCH_MAX_DAILY_AD_SPEND = 5;
/** Soft warning when an estimated batch order crosses this USD threshold. */
export const BATCH_SOFT_WARNING_USD = 10000;
/** Marketing capacity tiers = creatives per plan, by hours-per-week band. */
export const MARKETING_CAPACITY_TIERS = [6, 10, 14] as const;
export type MarketingCapacityTier = (typeof MARKETING_CAPACITY_TIERS)[number];

export const JOURNEY_STATES = [
  "discovery",
  "supplier_sample",
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
  "paused",
  "blocked",
] as const;

export type JourneyState = (typeof JOURNEY_STATES)[number];

export const PRIMARY_STATES = [
  "discovery",
  "supplier_sample",
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
] as const;

export type PrimaryJourneyState = (typeof PRIMARY_STATES)[number];

export const APPROVAL_GATES = [
  "accept_product",
  "tier1_customize_or_drop",
  "sample_decision",
  "stuck_over_10k_path_c",
  "batch_ordered",
  "batch_arrived_ready",
  "store_ready",
  "start_launch_marketing",
  "mark_selling",
  /** Side-only: next-batch marked ordered while primary stays selling. */
  "reorder_ordered",
  /** Side-only: next-batch arrived; primary stays selling. */
  "reorder_arrived",
  /** Side-only: crisis sample skip on cold backup (some/experienced). */
  "reorder_crisis_skip",
] as const;

export type ApprovalGateId = (typeof APPROVAL_GATES)[number];

export const MARKETING_STAGES = [
  "none",
  "intro_pdf",
  "pre_launch",
  "launch",
  "weekly_refresh",
] as const;

export type MarketingStage = (typeof MARKETING_STAGES)[number];

/** Legacy DB / JSON stage id — accept on read only; never write. */
export const LEGACY_MONTHLY_REFRESH_STAGE = "monthly_refresh";

/**
 * Normalize a stored marketing stage string.
 * Maps legacy `monthly_refresh` → `weekly_refresh`.
 */
export function normalizeMarketingStage(raw: unknown): MarketingStage {
  if (raw === LEGACY_MONTHLY_REFRESH_STAGE) return "weekly_refresh";
  if (
    typeof raw === "string" &&
    (MARKETING_STAGES as readonly string[]).includes(raw)
  ) {
    return raw as MarketingStage;
  }
  return "none";
}

export const TIER1_MARKETPLACES = ["Ishtari", "EGLOW", "Platza"] as const;

/** Last-mile delivery company option ids (labels: Store.deliveryCompanies.*). */
export const COURIERS_TBD = [
  "confirm_later",
  "partner_a",
  "partner_b",
  "partner_c",
  "partner_d",
] as const;

/**
 * Stable clearance-partner id until a real partner is confirmed.
 * Founder-facing copy lives in i18n (Supplier / Onboarding) — never show this id raw.
 */
export const CLEARANCE_PARTNER_TBD = "placeholder";

/** Stable industry IDs for onboarding category likes (JSON array). Labels live in i18n. */
export const INDUSTRY_OPTIONS = [
  "beauty_personal_care",
  "home_kitchen",
  "phone_tech_accessories",
  "kids_baby_accessories",
  "fitness_lifestyle",
  "fashion_accessories",
  "car_accessories",
  "pet_accessories",
  "office_desk_gadgets",
  "health_wellness_gadgets",
] as const;

export type IndustryOptionId = (typeof INDUSTRY_OPTIONS)[number];

/** Build-section keys (stable ids). Titles live in i18n Store.checklist.*. */
export const STORE_CHECKLIST_BUILD_KEYS = [
  "shopifyCreated",
  "currencyUsd",
  "contentEnAr",
  "productPublished",
  "codPrimary",
  "optionalPayments",
  "courierSelected",
  "shortPolicies",
  "whatsappConnected",
] as const;

/** Go-live section keys (stable ids). */
export const STORE_CHECKLIST_GO_LIVE_KEYS = [
  "sellToLebanon",
  "shippingRates",
  "storePublic",
  "testCheckout",
] as const;

/** Section id → keys (stable order). Section titles: Store.buildSection / goLiveSection. */
export const STORE_CHECKLIST_SECTIONS = [
  { id: "buildSection", keys: STORE_CHECKLIST_BUILD_KEYS },
  { id: "goLiveSection", keys: STORE_CHECKLIST_GO_LIVE_KEYS },
] as const;

export type StoreChecklistSectionId =
  (typeof STORE_CHECKLIST_SECTIONS)[number]["id"];

export const STORE_CHECKLIST_KEYS = [
  ...STORE_CHECKLIST_BUILD_KEYS,
  ...STORE_CHECKLIST_GO_LIVE_KEYS,
] as const;

export type StoreChecklistKey = (typeof STORE_CHECKLIST_KEYS)[number];
