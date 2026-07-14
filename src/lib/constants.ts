export const MIN_BUDGET_USD = 2000;
export const MARGIN_BEFORE_ADS_MIN = 0.7;
export const MARGIN_AFTER_ADS_MIN = 0.35;
export const DISCOVERY_INITIAL_COUNT = 5;
export const DISCOVERY_SHOW_MORE_MAX = 5;
export const DISCOVERY_SESSION_CAP = 25;
export const INVEST_NEXT_MIN_WEEKS = 4;
export const PRE_LAUNCH_MAX_DAILY_AD_SPEND = 5;

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
] as const;

export type ApprovalGateId = (typeof APPROVAL_GATES)[number];

export const MARKETING_STAGES = [
  "none",
  "intro_pdf",
  "pre_launch",
  "launch",
  "monthly_refresh",
] as const;

export type MarketingStage = (typeof MARKETING_STAGES)[number];

export const TIER1_MARKETPLACES = ["Ishtari", "EGLOW", "Platza"] as const;

export const COURIERS_TBD = [
  "Courier TBD 1",
  "Courier TBD 2",
  "Courier TBD 3",
  "Courier TBD 4",
  "Courier TBD 5",
] as const;

export const CLEARANCE_PARTNER_TBD = "Clearance partner TBD";

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

export const STORE_CHECKLIST_KEYS = [
  "shopifyCreated",
  "currencyUsd",
  "contentEnAr",
  "codPrimary",
  "optionalPayments",
  "courierSelected",
  "shortPolicies",
  "whatsappConnected",
] as const;

export type StoreChecklistKey = (typeof STORE_CHECKLIST_KEYS)[number];
