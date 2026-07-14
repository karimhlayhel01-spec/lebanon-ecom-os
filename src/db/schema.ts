import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  founderUserId: text("founder_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull().default("My Store"),
  language: text("language").notNull().default("en"), // en | ar | both
  activeSkuId: text("active_sku_id"),
  shopifyStatus: text("shopify_status").notNull().default("not_started"),
  createdAt: text("created_at").notNull(),
});

export const onboardingProfiles = sqliteTable("onboarding_profiles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  budgetUsd: real("budget_usd").notNull(),
  monthlyFollowOnBudget: real("monthly_follow_on_budget").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull(),
  experience: text("experience").notNull(), // beginner | some | experienced
  uiLanguage: text("ui_language").notNull(), // en | ar | both
  storageDescription: text("storage_description").notNull(),
  storageLimits: text("storage_limits").notNull(),
  riskTolerance: text("risk_tolerance").notNull(), // low | medium | high
  categoryLikes: text("category_likes").notNull(), // JSON array
  lebanonSellabilityAck: integer("lebanon_sellability_ack", { mode: "boolean" })
    .notNull()
    .default(false),
  codComfort: text("cod_comfort").notNull(),
  shopifyStatus: text("shopify_status").notNull(),
  maxLandedCost: real("max_landed_cost").notNull(),
  deliveryBandDays: text("delivery_band_days").notNull().default("7-10"),
  sampleClearanceReady: integer("sample_clearance_ready", { mode: "boolean" })
    .notNull()
    .default(false),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const journeyStates = sqliteTable("journey_states", {
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

export const sideStatuses = sqliteTable("side_statuses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id),
  onboardingComplete: integer("onboarding_complete", { mode: "boolean" })
    .notNull()
    .default(false),
  productAccepted: integer("product_accepted", { mode: "boolean" })
    .notNull()
    .default(false),
  okayRiskAck: integer("okay_risk_ack", { mode: "boolean" }).notNull().default(false),
  tier1Resolved: integer("tier1_resolved", { mode: "boolean" }).notNull().default(false),
  sampleStatus: text("sample_status").notNull().default("none"), // none | in_flight | approved | rejected
  storeReadyPercent: integer("store_ready_percent").notNull().default(0),
  storeReady: integer("store_ready", { mode: "boolean" }).notNull().default(false),
  marketingStage: text("marketing_stage").notNull().default("none"),
  batchOrdered: integer("batch_ordered", { mode: "boolean" }).notNull().default(false),
  batchArrivedReady: integer("batch_arrived_ready", { mode: "boolean" })
    .notNull()
    .default(false),
  topicAWeekCount: integer("topic_a_week_count").notNull().default(0),
  cashLockAck: integer("cash_lock_ack", { mode: "boolean" }).notNull().default(false),
  stuckOver10kAck: integer("stuck_over_10k_ack", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull(),
});

export const discoverySessions = sqliteTable("discovery_sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  showMoreUsed: integer("show_more_used").notNull().default(0),
  productsShown: integer("products_shown").notNull().default(0),
  status: text("status").notNull().default("active"), // active | closed
  createdAt: text("created_at").notNull(),
});

export const productCandidates = sqliteTable("product_candidates", {
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
  sellPrice: real("sell_price").notNull(),
  productCost: real("product_cost").notNull(),
  intlShip: real("intl_ship").notNull(),
  clearanceTaxes: real("clearance_taxes").notNull(),
  localCourier: real("local_courier").notNull(),
  marginBefore: real("margin_before").notNull(),
  marginAfter: real("margin_after").notNull(),
  marginsPass: integer("margins_pass", { mode: "boolean" }).notNull(),
  marginBlockReason: text("margin_block_reason"),
  fitScore: real("fit_score").notNull(),
  fitBreakdown: text("fit_breakdown").notNull(), // JSON
  strength: text("strength").notNull(), // Strong | Okay
  riskRead: text("risk_read"),
  differentiation: text("differentiation").notNull(),
  tier1Conflict: integer("tier1_conflict", { mode: "boolean" }).notNull().default(false),
  tier1Marketplaces: text("tier1_marketplaces"), // JSON
  oversizedHardBlock: integer("oversized_hard_block", { mode: "boolean" })
    .notNull()
    .default(false),
  notRecommended: integer("not_recommended", { mode: "boolean" }).notNull().default(false),
  demandConfirmed: integer("demand_confirmed", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("shown"), // shown | accepted | rejected
  createdAt: text("created_at").notNull(),
});

export const demandSignals = sqliteTable("demand_signals", {
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
  founderConfirmed: integer("founder_confirmed", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
});

export const skuCards = sqliteTable("sku_cards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  productCandidateId: text("product_candidate_id").references(() => productCandidates.id),
  name: text("name").notNull(),
  basics: text("basics").notNull(), // JSON
  shipFitness: text("ship_fitness").notNull(),
  storageAmbiance: text("storage_ambiance").notNull(),
  handling: text("handling").notNull(),
  importBatch: text("import_batch").notNull(),
  moneySnapshot: text("money_snapshot").notNull(),
  marketingHooks: text("marketing_hooks").notNull(),
  founderNotes: text("founder_notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const supplierOptions = sqliteTable("supplier_options", {
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
  years: integer("years").notNull(),
  rating: real("rating").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(true),
  moq: integer("moq").notNull(),
  unitPrice: real("unit_price").notNull(),
  sampleReplies: integer("sample_replies", { mode: "boolean" }).notNull().default(true),
  negotiationDraft: text("negotiation_draft").notNull(),
  paymentMapEstimate: text("payment_map_estimate").notNull(),
  redFlags: text("red_flags"), // JSON
  status: text("status").notNull().default("available"),
  createdAt: text("created_at").notNull(),
});

export const sampleRecords = sqliteTable("sample_records", {
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

export const storeReadiness = sqliteTable("store_readiness", {
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

export const marketingKits = sqliteTable("marketing_kits", {
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

export const topicAEntries = sqliteTable("topic_a_entries", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  weekStart: text("week_start").notNull(),
  storeTotalsUsd: real("store_totals_usd").notNull(),
  perSkuSoldLeft: text("per_sku_sold_left").notNull(), // JSON
  metaSpend: real("meta_spend").notNull().default(0),
  tiktokSpend: real("tiktok_spend").notNull().default(0),
  codCollected: real("cod_collected").notNull().default(0),
  codOutstanding: real("cod_outstanding").notNull().default(0),
  courierFees: real("courier_fees").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const financeVerdicts = sqliteTable("finance_verdicts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  kind: text("kind").notNull(), // estimate | weekly_health | invest_next
  payload: text("payload").notNull(), // JSON
  confidence: real("confidence").notNull().default(0.5),
  createdAt: text("created_at").notNull(),
});

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  gateId: text("gate_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  payload: text("payload").notNull(), // JSON
  acknowledgements: text("acknowledgements").notNull().default("[]"),
  decisionNote: text("decision_note"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
});

export const orchestratorEvents = sqliteTable("orchestrator_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  meta: text("meta").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
