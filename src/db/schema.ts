import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  founderUserId: text("founder_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull().default("My Store"),
  language: text("language").notNull().default("en"), // en | ar | both
  activeSkuId: text("active_sku_id"),
  /** Shop-wide pause — overlays all SKU journeys until resumed. */
  shopPaused: boolean("shop_paused").notNull().default(false),
  shopifyStatus: text("shopify_status").notNull().default("not_started"),
  createdAt: text("created_at").notNull(),
});

export const onboardingProfiles = pgTable("onboarding_profiles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  budgetUsd: doublePrecision("budget_usd").notNull(),
  monthlyFollowOnBudget: doublePrecision("monthly_follow_on_budget").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull(),
  experience: text("experience").notNull(), // beginner | some | experienced
  uiLanguage: text("ui_language").notNull(), // en | ar | both
  storageDescription: text("storage_description").notNull(),
  /** Optional free-text notes; empty string when blank. Not used in v1 Fit/Discovery. */
  storageLimits: text("storage_limits").notNull().default(""),
  riskTolerance: text("risk_tolerance").notNull(), // low | medium | high
  categoryLikes: text("category_likes").notNull(), // JSON array
  lebanonSellabilityAck: boolean("lebanon_sellability_ack")
    .notNull()
    .default(false),
  codComfort: text("cod_comfort").notNull(),
  shopifyStatus: text("shopify_status").notNull(),
  maxLandedCost: doublePrecision("max_landed_cost").notNull(),
  deliveryBandDays: text("delivery_band_days").notNull().default("7-10"),
  sampleClearanceReady: boolean("sample_clearance_ready")
    .notNull()
    .default(false),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const journeyStates = pgTable("journey_states", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  primaryState: text("primary_state").notNull().default("discovery"),
  pausedFromState: text("paused_from_state"),
  blockedFromState: text("blocked_from_state"),
  blockedReason: text("blocked_reason"),
  updatedAt: text("updated_at").notNull(),
});

export const sideStatuses = pgTable("side_statuses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  productAccepted: boolean("product_accepted").notNull().default(false),
  okayRiskAck: boolean("okay_risk_ack").notNull().default(false),
  tier1Resolved: boolean("tier1_resolved").notNull().default(false),
  sampleStatus: text("sample_status").notNull().default("none"), // none | in_flight | approved | rejected
  storeReadyPercent: integer("store_ready_percent").notNull().default(0),
  storeReady: boolean("store_ready").notNull().default(false),
  marketingStage: text("marketing_stage").notNull().default("none"),
  batchOrdered: boolean("batch_ordered").notNull().default(false),
  batchArrivedReady: boolean("batch_arrived_ready").notNull().default(false),
  /**
   * Expected batch arrival ETA (JSON: { preset, weeks, date?, label? }).
   * Null = founder has not set; Marketing uses default 1 month (4 weeks).
   */
  batchArrivalEta: text("batch_arrival_eta"),
  topicAWeekCount: integer("topic_a_week_count").notNull().default(0),
  cashLockAck: boolean("cash_lock_ack").notNull().default(false),
  stuckOver10kAck: boolean("stuck_over_10k_ack").notNull().default(false),
  costQuotesSaved: boolean("cost_quotes_saved").notNull().default(false),
  /** Fully exhausted Discovery session pools (reject-all ladder). Reset on accept / onboarding edit. */
  discoveryExhaustedRounds: integer("discovery_exhausted_rounds")
    .notNull()
    .default(0),
  /**
   * Set when founder edits onboarding experience TO `experienced` from a lower
   * level. Cleared after they acknowledge seriousness on Add SKU.
   */
  experienceRaisedPendingAck: boolean("experience_raised_pending_ack")
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull(),
});

export const discoverySessions = pgTable("discovery_sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  showMoreUsed: integer("show_more_used").notNull().default(0),
  productsShown: integer("products_shown").notNull().default(0),
  status: text("status").notNull().default("active"), // active | closed
  /** True once this session's pool was counted toward discoveryExhaustedRounds. */
  exhaustionCounted: boolean("exhaustion_counted").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const productCandidates = pgTable("product_candidates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  sessionId: text("session_id")
    .notNull()
    .references(() => discoverySessions.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  summary: text("summary").notNull(),
  sellPrice: doublePrecision("sell_price").notNull(),
  productCost: doublePrecision("product_cost").notNull(),
  intlShip: doublePrecision("intl_ship").notNull(),
  clearanceTaxes: doublePrecision("clearance_taxes").notNull(),
  localCourier: doublePrecision("local_courier").notNull(),
  marginBefore: doublePrecision("margin_before").notNull(),
  marginAfter: doublePrecision("margin_after").notNull(),
  marginsPass: boolean("margins_pass").notNull(),
  marginBlockReason: text("margin_block_reason"),
  fitScore: doublePrecision("fit_score").notNull(),
  fitBreakdown: text("fit_breakdown").notNull(), // JSON
  strength: text("strength").notNull(), // Strong | Okay
  riskRead: text("risk_read"),
  differentiation: text("differentiation").notNull(),
  tier1Conflict: boolean("tier1_conflict").notNull().default(false),
  tier1Marketplaces: text("tier1_marketplaces"), // JSON
  oversizedHardBlock: boolean("oversized_hard_block").notNull().default(false),
  notRecommended: boolean("not_recommended").notNull().default(false),
  demandConfirmed: boolean("demand_confirmed").notNull().default(false),
  status: text("status").notNull().default("shown"), // shown | accepted | rejected
  rank: integer("rank").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const demandSignals = pgTable("demand_signals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  productCandidateId: text("product_candidate_id")
    .notNull()
    .references(() => productCandidates.id),
  url: text("url"),
  note: text("note"),
  screenshotNote: text("screenshot_note"),
  aiSummary: text("ai_summary").notNull(),
  founderConfirmed: boolean("founder_confirmed").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const skuCards = pgTable("sku_cards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  productCandidateId: text("product_candidate_id").references(
    () => productCandidates.id,
  ),
  name: text("name").notNull(),
  basics: text("basics").notNull(), // JSON
  shipFitness: text("ship_fitness").notNull(),
  storageAmbiance: text("storage_ambiance").notNull(),
  handling: text("handling").notNull(),
  importBatch: text("import_batch").notNull(),
  moneySnapshot: text("money_snapshot").notNull(),
  quotedCosts: text("quoted_costs"), // JSON — founder-quoted unit costs + expected margin
  reportedMargin: text("reported_margin"), // DEPRECATED — old manual "reported margin after ads". No longer written/read by product UI; after-ads margins are now computed automatically from Topic A. Left in place for a clean later cleanup.
  marketingHooks: text("marketing_hooks").notNull(),
  founderNotes: text("founder_notes").notNull().default(""),
  /** live | archived | wiped — add-SKU sequencing counts live only. */
  lifecycleStatus: text("lifecycle_status").notNull().default("live"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-SKU journey spine + SKU-scoped side flags (Wave 1 multi-SKU).
 * Shop-level store readiness stays on side_statuses / store_readiness.
 */
export const skuJourneys = pgTable("sku_journeys", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  skuId: text("sku_id")
    .notNull()
    .unique()
    .references(() => skuCards.id),
  primaryState: text("primary_state").notNull().default("discovery"),
  pausedFromState: text("paused_from_state"),
  blockedFromState: text("blocked_from_state"),
  blockedReason: text("blocked_reason"),
  sampleStatus: text("sample_status").notNull().default("none"),
  batchOrdered: boolean("batch_ordered").notNull().default(false),
  batchArrivedReady: boolean("batch_arrived_ready").notNull().default(false),
  batchArrivalEta: text("batch_arrival_eta"),
  marketingStage: text("marketing_stage").notNull().default("none"),
  costQuotesSaved: boolean("cost_quotes_saved").notNull().default(false),
  cashLockAck: boolean("cash_lock_ack").notNull().default(false),
  stuckOver10kAck: boolean("stuck_over_10k_ack").notNull().default(false),
  okayRiskAck: boolean("okay_risk_ack").notNull().default(false),
  tier1Resolved: boolean("tier1_resolved").notNull().default(false),
  /**
   * Next-batch side-flow while primary stays selling.
   * idle | ordered (in transit). Arrived resets to idle.
   */
  reorderStatus: text("reorder_status").notNull().default("idle"),
  reorderArrivalEta: text("reorder_arrival_eta"),
  reorderSupplierId: text("reorder_supplier_id"),
  reorderQty: integer("reorder_qty"),
  reorderEstCost: doublePrecision("reorder_est_cost"),
  /**
   * Working supplier for next-batch path (may diverge after can’t-fulfill switch).
   * Null → derive from first-batch / approved sample.
   */
  reorderPathSupplierId: text("reorder_path_supplier_id"),
  /** JSON map supplierId → { reason, at } — unavailable for reorder. */
  reorderUnavailableJson: text("reorder_unavailable_json"),
  /** JSON string[] of supplier ids allowed via crisis sample skip. */
  reorderCrisisSkipJson: text("reorder_crisis_skip_json"),
  updatedAt: text("updated_at").notNull(),
});

export const supplierOptions = pgTable("supplier_options", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  skuId: text("sku_id")
    .notNull()
    .references(() => skuCards.id),
  name: text("name").notNull(),
  role: text("role").notNull(), // primary | backup
  rank: integer("rank").notNull(),
  /** Wave 2: import (China) | local (Lebanon). Legacy rows default import. */
  source: text("source").notNull().default("import"),
  years: integer("years").notNull(),
  rating: doublePrecision("rating").notNull(),
  verified: boolean("verified").notNull().default(true),
  moq: integer("moq").notNull(),
  unitPrice: doublePrecision("unit_price").notNull(),
  sampleReplies: boolean("sample_replies").notNull().default(true),
  negotiationDraft: text("negotiation_draft").notNull(),
  paymentMapEstimate: text("payment_map_estimate").notNull(),
  redFlags: text("red_flags"), // JSON
  status: text("status").notNull().default("available"),
  createdAt: text("created_at").notNull(),
});

export const sampleRecords = pgTable("sample_records", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  skuId: text("sku_id")
    .notNull()
    .references(() => skuCards.id),
  supplierId: text("supplier_id")
    .notNull()
    .references(() => supplierOptions.id),
  status: text("status").notNull().default("requested"), // requested | received | approved | replace | rejected
  qualityChecklist: text("quality_checklist").notNull(), // JSON
  photoNotes: text("photo_notes").notNull().default(""),
  packingBrief: text("packing_brief").notNull().default(""),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
});

export const storeReadiness = pgTable("store_readiness", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  checklist: text("checklist").notNull(), // JSON Record<key, boolean>
  storeUrl: text("store_url"),
  whatsappNumber: text("whatsapp_number"),
  courierChoice: text("courier_choice"),
  policiesDraft: text("policies_draft").notNull().default(""),
  contentDraftEn: text("content_draft_en").notNull().default(""),
  contentDraftAr: text("content_draft_ar").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const marketingKits = pgTable("marketing_kits", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  skuId: text("sku_id").references(() => skuCards.id),
  stage: text("stage").notNull(),
  capacityTier: text("capacity_tier").notNull(), // 6 | 10 | 14
  items: text("items").notNull(), // JSON array of creatives
  language: text("language").notNull().default("en"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const topicAEntries = pgTable(
  "topic_a_entries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    weekStart: text("week_start").notNull(),
    storeTotalsUsd: doublePrecision("store_totals_usd").notNull(),
    perSkuSoldLeft: text("per_sku_sold_left").notNull(), // JSON
    metaSpend: doublePrecision("meta_spend").notNull().default(0),
    tiktokSpend: doublePrecision("tiktok_spend").notNull().default(0),
    codCollected: doublePrecision("cod_collected").notNull().default(0),
    codOutstanding: doublePrecision("cod_outstanding").notNull().default(0),
    courierFees: doublePrecision("courier_fees").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    unique("topic_a_entries_workspace_week_unique").on(
      t.workspaceId,
      t.weekStart,
    ),
  ],
);

export const financeVerdicts = pgTable("finance_verdicts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  kind: text("kind").notNull(), // estimate | weekly_health | invest_next
  payload: text("payload").notNull(), // JSON
  confidence: doublePrecision("confidence").notNull().default(0.5),
  createdAt: text("created_at").notNull(),
});

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  /** SKU-scoped gates (sample/batch/selling); null for shop-level gates. */
  skuId: text("sku_id").references(() => skuCards.id),
  gateId: text("gate_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  payload: text("payload").notNull(), // JSON
  acknowledgements: text("acknowledgements").notNull().default("[]"),
  decisionNote: text("decision_note"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
});

export const orchestratorEvents = pgTable("orchestrator_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  meta: text("meta").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
