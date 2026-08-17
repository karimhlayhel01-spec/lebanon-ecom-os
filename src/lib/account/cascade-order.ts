/**
 * FK-safe wipe order for workspace-scoped tables (children → parents).
 * Single source of truth — account delete, demo reset, and SKU wipe import subsets.
 * When adding a workspace-scoped table, insert it here in FK-safe position.
 *
 * Global Wave 2 Discovery tables (`discovery_product_pool`, `discovery_product_scores`)
 * are intentionally excluded — they are shared catalog/score cache, not per-workspace.
 */
export const WORKSPACE_CASCADE_TABLES = [
  "sample_records",
  "supplier_options",
  "marketing_sku_photo_pack_assets",
  "marketing_creative_visuals",
  "marketing_sku_photo_packs",
  "marketing_kits",
  "store_page_packs",
  "demand_signals",
  "sku_journeys",
  "approval_requests",
  "sku_cards",
  "product_candidates",
  "discovery_sessions",
  "topic_a_entries",
  "finance_verdicts",
  "discovery_metric_events",
  "marketing_gemini_usage",
  "marketing_visual_usage",
  "orchestrator_events",
  "store_readiness",
  "onboarding_profiles",
  "journey_states",
  "side_statuses",
  "workspaces",
] as const;

export type WorkspaceCascadeTable = (typeof WORKSPACE_CASCADE_TABLES)[number];

/** Full account / workspace delete — entire cascade list. */
export const WORKSPACE_CASCADE_DELETE_ORDER = WORKSPACE_CASCADE_TABLES;

/**
 * First identity table kept on demo reset.
 * Reset deletes the prefix before this; onboarding + workspace identity stay.
 */
export const WORKSPACE_IDENTITY_CUTOFF = "onboarding_profiles" satisfies WorkspaceCascadeTable;

const identityCutoffIndex = WORKSPACE_CASCADE_TABLES.indexOf(
  WORKSPACE_IDENTITY_CUTOFF,
);

/** Demo journey wipe — same order as full cascade, stops before identity. */
export const DEMO_JOURNEY_RESET_DELETE_ORDER = WORKSPACE_CASCADE_TABLES.slice(
  0,
  identityCutoffIndex,
);

/** Identity tables kept on demo reset (and trailing parents on full delete). */
export const WORKSPACE_IDENTITY_TABLES = WORKSPACE_CASCADE_TABLES.slice(
  identityCutoffIndex,
);

/**
 * SKU hard-wipe dependents (sku-scoped). Derived from the master list so
 * relative FK order cannot drift. Card is marked wiped afterward — not deleted.
 */
export type SkuWipeTable =
  | "sample_records"
  | "supplier_options"
  | "marketing_sku_photo_pack_assets"
  | "marketing_creative_visuals"
  | "marketing_sku_photo_packs"
  | "marketing_kits"
  | "store_page_packs"
  | "sku_journeys"
  | "approval_requests";

export const SKU_WIPE_DELETE_ORDER: readonly SkuWipeTable[] =
  WORKSPACE_CASCADE_TABLES.filter((t): t is SkuWipeTable =>
    t === "sample_records" ||
    t === "supplier_options" ||
    t === "marketing_sku_photo_pack_assets" ||
    t === "marketing_creative_visuals" ||
    t === "marketing_sku_photo_packs" ||
    t === "marketing_kits" ||
    t === "store_page_packs" ||
    t === "sku_journeys" ||
    t === "approval_requests",
  );
