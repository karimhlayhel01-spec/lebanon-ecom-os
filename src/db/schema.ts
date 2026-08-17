import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
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
  /**
   * When the founder rejected this card — bounds the WAVE-2 §7 undo window.
   * Null on legacy rejects (never undoable) and cleared again on undo.
   */
  rejectedAt: text("rejected_at"),
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
  /** Wave 3: heuristic | live_search */
  leadSource: text("lead_source").notNull().default("heuristic"),
  /** Wave 3: alibaba | aliexpress | other | null */
  platform: text("platform"),
  /** Wave 3: public listing URL when from live search */
  sourceUrl: text("source_url"),
  /** Wave 3: raw SERP title when live */
  externalTitle: text("external_title"),
  /** Wave 3: founder-entered supplier email (never auto-scraped). */
  contactEmail: text("contact_email"),
  /** Wave 3: founder-entered supplier WhatsApp (never store WhatsApp). */
  contactWhatsapp: text("contact_whatsapp"),
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
  /** Legacy shop-level pack columns — AI reads `store_page_packs` (per SKU). Left in place. */
  discoverabilityPack: text("discoverability_pack").notNull().default(""),
  /** Legacy shop-level versions — AI reads `store_page_packs`. Left in place. */
  pageCopyVersions: text("page_copy_versions").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Wave 4 Store — per live SKU product-page pack, plus one shop pack per
 * workspace (`sku_id` NULL) when ≥3 live SKUs. Shop checklist stays on
 * store_readiness.
 */
export const storePagePacks = pgTable(
  "store_page_packs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    skuId: text("sku_id")
      .unique()
      .references(() => skuCards.id),
    policiesDraft: text("policies_draft").notNull().default(""),
    contentDraftEn: text("content_draft_en").notNull().default(""),
    contentDraftAr: text("content_draft_ar").notNull().default(""),
    discoverabilityPack: text("discoverability_pack").notNull().default(""),
    pageCopyVersions: text("page_copy_versions").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("store_page_packs_workspace_shop_unique")
      .on(t.workspaceId)
      .where(sql`${t.skuId} is null`),
  ],
);

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
// Partial unique index (workspace_id, gate_id, coalesce(sku_id,'')) WHERE status='pending'
// — see drizzle/0002_approval_pending_unique.sql.

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

/**
 * Wave 2 Discovery — global product pool (Approach A / Path 1 SoT).
 * Not workspace-scoped: intake/scoring jobs must never write journey / Topic A / SKU finance.
 * `catalog.ts` seeds rows until Path 1 ingest is live.
 */
export const discoveryProductPool = pgTable("discovery_product_pool", {
  id: text("id").primaryKey(),
  /** Stable key for curated seed rows; Path 1 rows may use a generated key. */
  catalogKey: text("catalog_key").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull().default(""),
  category: text("category").notNull(),
  summaryEn: text("summary_en").notNull().default(""),
  summaryAr: text("summary_ar").notNull().default(""),
  differentiationEn: text("differentiation_en").notNull().default(""),
  differentiationAr: text("differentiation_ar").notNull().default(""),
  sellPrice: doublePrecision("sell_price").notNull(),
  productCost: doublePrecision("product_cost").notNull(),
  intlShip: doublePrecision("intl_ship").notNull(),
  clearanceTaxes: doublePrecision("clearance_taxes").notNull(),
  localCourier: doublePrecision("local_courier").notNull(),
  difficulty: integer("difficulty").notNull().default(0),
  risk: integer("risk").notNull().default(0),
  timeNeed: integer("time_need").notNull().default(4),
  workload: integer("workload").notNull().default(0),
  storageFootprint: text("storage_footprint").notNull().default("small"),
  oversized: boolean("oversized").notNull().default(false),
  tier1Marketplaces: text("tier1_marketplaces").notNull().default("[]"), // JSON
  sourceUrl: text("source_url"),
  /** Missing MOQ/sample → neutral in scoring (WAVE-2 §7). */
  moqHint: integer("moq_hint"),
  sampleCostHint: doublePrecision("sample_cost_hint"),
  /** catalog_seed | path1_search | dropship_backup */
  source: text("source").notNull().default("catalog_seed"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Wave 2 Discovery — Approach A score cache (one row per pool product).
 * Failed refreshes update status/error only — never wipe last-known scores.
 */
export const discoveryProductScores = pgTable("discovery_product_scores", {
  id: text("id").primaryKey(),
  poolProductId: text("pool_product_id")
    .notNull()
    .unique()
    .references(() => discoveryProductPool.id),
  abroadDemandScore: doublePrecision("abroad_demand_score"),
  lebanonDemandScore: doublePrecision("lebanon_demand_score"),
  competitionScore: doublePrecision("competition_score"),
  budgetFightPenalty: doublePrecision("budget_fight_penalty"),
  compositeScore: doublePrecision("composite_score"),
  /** whitespace | local_proven | null */
  demandPath: text("demand_path"),
  confidence: doublePrecision("confidence"),
  explainLine: text("explain_line"),
  lastScoredAt: text("last_scored_at"),
  /** ok | failed | pending | never */
  lastScoreStatus: text("last_score_status").notNull().default("never"),
  lastError: text("last_error"),
  /** Shadow mode: would exclude under hard filters (log before enforce). */
  shadowWouldExclude: boolean("shadow_would_exclude").notNull().default(false),
  shadowExcludeReason: text("shadow_exclude_reason"),
  rawEvidenceJson: text("raw_evidence_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Wave 2 §7 — monthly search-spend ledger (one row per UTC month).
 * Checked before each query batch so a run stops cleanly at the configured cap
 * instead of burning a paid quota. Global, like the pool: no workspace_id.
 */
export const discoverySearchUsage = pgTable("discovery_search_usage", {
  id: text("id").primaryKey(),
  /** UTC month bucket, `YYYY-MM`. */
  monthKey: text("month_key").notNull().unique(),
  queriesUsed: integer("queries_used").notNull().default(0),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Wave 4 Phase 7 — monthly Marketing Gemini spend ledger (per workspace + UTC month).
 * Counts successful Intro fill + creatives improve (+ visual polish when Gemini runs).
 * Store pack Gemini is out of scope.
 */
export const marketingGeminiUsage = pgTable(
  "marketing_gemini_usage",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** UTC month bucket, `YYYY-MM`. */
    monthKey: text("month_key").notNull(),
    callsUsed: integer("calls_used").notNull().default(0),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    unique("marketing_gemini_usage_workspace_month_unique").on(
      t.workspaceId,
      t.monthKey,
    ),
  ],
);

/**
 * Wave 4 Phase 6a — per-SKU named product photo packs (not whole-shop).
 * One default pack per SKU. Optional product-motion clip metadata on the pack.
 */
export const marketingSkuPhotoPacks = pgTable(
  "marketing_sku_photo_packs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    skuId: text("sku_id")
      .notNull()
      .references(() => skuCards.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    motionClipStoragePath: text("motion_clip_storage_path"),
    motionClipOriginalName: text("motion_clip_original_name"),
    motionClipMimeType: text("motion_clip_mime_type"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    unique("marketing_sku_photo_packs_workspace_sku_name_unique").on(
      t.workspaceId,
      t.skuId,
      t.name,
    ),
    uniqueIndex("marketing_sku_photo_packs_default_unique")
      .on(t.workspaceId, t.skuId)
      .where(sql`${t.isDefault} = true`),
  ],
);

/** Photos we own for a pack (local durable paths — not Higgsfield URLs). */
export const marketingSkuPhotoPackAssets = pgTable(
  "marketing_sku_photo_pack_assets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    skuId: text("sku_id")
      .notNull()
      .references(() => skuCards.id),
    packId: text("pack_id")
      .notNull()
      .references(() => marketingSkuPhotoPacks.id),
    kind: text("kind").notNull(),
    storagePath: text("storage_path").notNull(),
    originalName: text("original_name").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
);

/**
 * Wave 4 Phase 6a — generated still/clip on a kit card.
 * Side table so kit JSON items stay Phase 3 copy.
 */
export const marketingCreativeVisuals = pgTable(
  "marketing_creative_visuals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    skuId: text("sku_id")
      .notNull()
      .references(() => skuCards.id),
    kitId: text("kit_id")
      .notNull()
      .references(() => marketingKits.id),
    creativeId: text("creative_id").notNull(),
    packId: text("pack_id").references(() => marketingSkuPhotoPacks.id),
    storagePath: text("storage_path").notNull().default(""),
    kind: text("kind").notNull(),
    regenerateCount: integer("regenerate_count").notNull().default(0),
    generatedAt: text("generated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    unique("marketing_creative_visuals_kit_creative_unique").on(
      t.workspaceId,
      t.kitId,
      t.creativeId,
    ),
  ],
);

/**
 * Wave 4 Phase 6a — monthly Higgsfield visual spend ledger (per workspace + UTC month).
 * Separate from marketing_gemini_usage. Count successful Higgsfield runs later.
 */
export const marketingVisualUsage = pgTable(
  "marketing_visual_usage",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** UTC month bucket, `YYYY-MM`. */
    monthKey: text("month_key").notNull(),
    callsUsed: integer("calls_used").notNull().default(0),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    unique("marketing_visual_usage_workspace_month_unique").on(
      t.workspaceId,
      t.monthKey,
    ),
  ],
);

/**
 * Wave 2 §7 "Measure" — append-only Discovery funnel counters.
 * Rows are never updated: `dedupe_key` is unique so a re-render, revalidate, or
 * retried request records one event. Read only by the metrics CLI — nothing
 * here may feed scoring, rank, or accept gates.
 */
export const discoveryMetricEvents = pgTable("discovery_metric_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  /** Session context when the event has one; null for card-scoped events. */
  sessionId: text("session_id"),
  kind: text("kind").notNull(),
  /** Typed action error code for failure kinds — never founder-facing text. */
  errorCode: text("error_code"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
