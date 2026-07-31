import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "lebanon-ecom.sqlite");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

let migrated = false;

export function ensureMigrated() {
  if (migrated) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      founder_user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL DEFAULT 'My Store',
      language TEXT NOT NULL DEFAULT 'en',
      active_sku_id TEXT,
      shop_paused INTEGER NOT NULL DEFAULT 0,
      shopify_status TEXT NOT NULL DEFAULT 'not_started',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboarding_profiles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
      budget_usd REAL NOT NULL,
      monthly_follow_on_budget REAL NOT NULL,
      hours_per_week INTEGER NOT NULL,
      experience TEXT NOT NULL,
      ui_language TEXT NOT NULL,
      storage_description TEXT NOT NULL,
      storage_limits TEXT NOT NULL DEFAULT '',
      risk_tolerance TEXT NOT NULL,
      category_likes TEXT NOT NULL,
      lebanon_sellability_ack INTEGER NOT NULL DEFAULT 0,
      cod_comfort TEXT NOT NULL,
      shopify_status TEXT NOT NULL,
      max_landed_cost REAL NOT NULL,
      delivery_band_days TEXT NOT NULL DEFAULT '7-10',
      sample_clearance_ready INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journey_states (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
      primary_state TEXT NOT NULL DEFAULT 'discovery',
      paused_from_state TEXT,
      blocked_from_state TEXT,
      blocked_reason TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS side_statuses (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
      onboarding_complete INTEGER NOT NULL DEFAULT 0,
      product_accepted INTEGER NOT NULL DEFAULT 0,
      okay_risk_ack INTEGER NOT NULL DEFAULT 0,
      tier1_resolved INTEGER NOT NULL DEFAULT 0,
      sample_status TEXT NOT NULL DEFAULT 'none',
      store_ready_percent INTEGER NOT NULL DEFAULT 0,
      store_ready INTEGER NOT NULL DEFAULT 0,
      marketing_stage TEXT NOT NULL DEFAULT 'none',
      batch_ordered INTEGER NOT NULL DEFAULT 0,
      batch_arrived_ready INTEGER NOT NULL DEFAULT 0,
      topic_a_week_count INTEGER NOT NULL DEFAULT 0,
      cash_lock_ack INTEGER NOT NULL DEFAULT 0,
      stuck_over_10k_ack INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discovery_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      show_more_used INTEGER NOT NULL DEFAULT 0,
      products_shown INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_candidates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      session_id TEXT NOT NULL REFERENCES discovery_sessions(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      sell_price REAL NOT NULL,
      product_cost REAL NOT NULL,
      intl_ship REAL NOT NULL,
      clearance_taxes REAL NOT NULL,
      local_courier REAL NOT NULL,
      margin_before REAL NOT NULL,
      margin_after REAL NOT NULL,
      margins_pass INTEGER NOT NULL,
      margin_block_reason TEXT,
      fit_score REAL NOT NULL,
      fit_breakdown TEXT NOT NULL,
      strength TEXT NOT NULL,
      risk_read TEXT,
      differentiation TEXT NOT NULL,
      tier1_conflict INTEGER NOT NULL DEFAULT 0,
      tier1_marketplaces TEXT,
      oversized_hard_block INTEGER NOT NULL DEFAULT 0,
      not_recommended INTEGER NOT NULL DEFAULT 0,
      demand_confirmed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'shown',
      rank INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS demand_signals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      product_candidate_id TEXT NOT NULL REFERENCES product_candidates(id),
      url TEXT,
      note TEXT,
      screenshot_note TEXT,
      ai_summary TEXT NOT NULL,
      founder_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sku_cards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      product_candidate_id TEXT REFERENCES product_candidates(id),
      name TEXT NOT NULL,
      basics TEXT NOT NULL,
      ship_fitness TEXT NOT NULL,
      storage_ambiance TEXT NOT NULL,
      handling TEXT NOT NULL,
      import_batch TEXT NOT NULL,
      money_snapshot TEXT NOT NULL,
      marketing_hooks TEXT NOT NULL,
      founder_notes TEXT NOT NULL DEFAULT '',
      lifecycle_status TEXT NOT NULL DEFAULT 'live',
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sku_journeys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT NOT NULL UNIQUE REFERENCES sku_cards(id),
      primary_state TEXT NOT NULL DEFAULT 'discovery',
      paused_from_state TEXT,
      blocked_from_state TEXT,
      blocked_reason TEXT,
      sample_status TEXT NOT NULL DEFAULT 'none',
      batch_ordered INTEGER NOT NULL DEFAULT 0,
      batch_arrived_ready INTEGER NOT NULL DEFAULT 0,
      batch_arrival_eta TEXT,
      marketing_stage TEXT NOT NULL DEFAULT 'none',
      cost_quotes_saved INTEGER NOT NULL DEFAULT 0,
      cash_lock_ack INTEGER NOT NULL DEFAULT 0,
      stuck_over_10k_ack INTEGER NOT NULL DEFAULT 0,
      okay_risk_ack INTEGER NOT NULL DEFAULT 0,
      tier1_resolved INTEGER NOT NULL DEFAULT 0,
      reorder_status TEXT NOT NULL DEFAULT 'idle',
      reorder_arrival_eta TEXT,
      reorder_supplier_id TEXT,
      reorder_qty INTEGER,
      reorder_est_cost REAL,
      reorder_path_supplier_id TEXT,
      reorder_unavailable_json TEXT,
      reorder_crisis_skip_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplier_options (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT NOT NULL REFERENCES sku_cards(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      rank INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'import',
      years INTEGER NOT NULL,
      rating REAL NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      moq INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      sample_replies INTEGER NOT NULL DEFAULT 1,
      negotiation_draft TEXT NOT NULL,
      payment_map_estimate TEXT NOT NULL,
      red_flags TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sample_records (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT NOT NULL REFERENCES sku_cards(id),
      supplier_id TEXT NOT NULL REFERENCES supplier_options(id),
      status TEXT NOT NULL DEFAULT 'requested',
      quality_checklist TEXT NOT NULL,
      photo_notes TEXT NOT NULL DEFAULT '',
      packing_brief TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_readiness (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
      checklist TEXT NOT NULL,
      store_url TEXT,
      whatsapp_number TEXT,
      courier_choice TEXT,
      policies_draft TEXT NOT NULL DEFAULT '',
      content_draft_en TEXT NOT NULL DEFAULT '',
      content_draft_ar TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketing_kits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT REFERENCES sku_cards(id),
      stage TEXT NOT NULL,
      capacity_tier TEXT NOT NULL,
      items TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topic_a_entries (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      week_start TEXT NOT NULL,
      store_totals_usd REAL NOT NULL,
      per_sku_sold_left TEXT NOT NULL,
      meta_spend REAL NOT NULL DEFAULT 0,
      tiktok_spend REAL NOT NULL DEFAULT 0,
      cod_collected REAL NOT NULL DEFAULT 0,
      cod_outstanding REAL NOT NULL DEFAULT 0,
      courier_fees REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_verdicts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT REFERENCES sku_cards(id),
      gate_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL,
      acknowledgements TEXT NOT NULL DEFAULT '[]',
      decision_note TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestrator_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Additive column migrations for DBs created before a column existed.
  ensureColumn("journey_states", "blocked_from_state", "TEXT");
  ensureColumn("product_candidates", "rank", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("sku_cards", "quoted_costs", "TEXT");
  ensureColumn("sku_cards", "reported_margin", "TEXT");
  ensureColumn(
    "sku_cards",
    "lifecycle_status",
    "TEXT NOT NULL DEFAULT 'live'",
  );
  ensureColumn("sku_cards", "archived_at", "TEXT");
  ensureColumn(
    "workspaces",
    "shop_paused",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn("approval_requests", "sku_id", "TEXT");
  ensureColumn(
    "side_statuses",
    "cost_quotes_saved",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "side_statuses",
    "discovery_exhausted_rounds",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "discovery_sessions",
    "exhaustion_counted",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn("side_statuses", "batch_arrival_eta", "TEXT");
  ensureColumn(
    "side_statuses",
    "experience_raised_pending_ack",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn("users", "first_name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("users", "last_name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    "supplier_options",
    "source",
    "TEXT NOT NULL DEFAULT 'import'",
  );
  ensureColumn(
    "sku_journeys",
    "reorder_status",
    "TEXT NOT NULL DEFAULT 'idle'",
  );
  ensureColumn("sku_journeys", "reorder_arrival_eta", "TEXT");
  ensureColumn("sku_journeys", "reorder_supplier_id", "TEXT");
  ensureColumn("sku_journeys", "reorder_qty", "INTEGER");
  ensureColumn("sku_journeys", "reorder_est_cost", "REAL");
  ensureColumn("sku_journeys", "reorder_path_supplier_id", "TEXT");
  ensureColumn("sku_journeys", "reorder_unavailable_json", "TEXT");
  ensureColumn("sku_journeys", "reorder_crisis_skip_json", "TEXT");
  backfillUserNameParts();
  backfillLegacyWorkspaceNames();
  migrateSkuJourneysFromWorkspace();

  migrated = true;
}

/**
 * Split legacy `users.name` into first_name / last_name for rows that never
 * received the new columns (empty first_name).
 */
function backfillUserNameParts() {
  const rows = sqlite
    .prepare(`SELECT id, name, first_name FROM users`)
    .all() as { id: string; name: string; first_name: string }[];
  const update = sqlite.prepare(
    `UPDATE users SET first_name = ?, last_name = ? WHERE id = ?`,
  );
  for (const row of rows) {
    if (row.first_name) continue;
    const trimmed = (row.name ?? "").trim();
    const space = trimmed.indexOf(" ");
    const firstName = space === -1 ? trimmed : trimmed.slice(0, space);
    const lastName = space === -1 ? "" : trimmed.slice(space + 1).trim();
    update.run(firstName, lastName, row.id);
  }
}

/**
 * Replace hard-coded legacy store titles with the first-name default pattern.
 * Skips any workspace that was already customized.
 */
function backfillLegacyWorkspaceNames() {
  const rows = sqlite
    .prepare(
      `SELECT w.id AS id, w.name AS name, w.language AS language,
              u.first_name AS first_name
       FROM workspaces w
       JOIN users u ON u.id = w.founder_user_id
       WHERE w.name IN ('My Store', 'Preview Store')`,
    )
    .all() as {
    id: string;
    name: string;
    language: string;
    first_name: string;
  }[];
  const update = sqlite.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`);
  for (const row of rows) {
    const first = (row.first_name ?? "").trim();
    if (!first) continue;
    const locale = row.language === "ar" ? "ar" : "en";
    const next =
      locale === "ar" ? `متجر ${first}` : `${first}'s Store`;
    update.run(next, row.id);
  }
}

/**
 * Wave 1: copy workspace journey + SKU-scoped side flags onto the active SKU
 * (or every existing SKU card missing a journey row). Idempotent.
 */
function migrateSkuJourneysFromWorkspace() {
  // Ensure table exists even for DBs that ran an older ensureMigrated body
  // before sku_journeys was added (CREATE IF NOT EXISTS is in the main exec,
  // but re-run here for safety if the main exec was skipped mid-migration).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sku_journeys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT NOT NULL UNIQUE REFERENCES sku_cards(id),
      primary_state TEXT NOT NULL DEFAULT 'discovery',
      paused_from_state TEXT,
      blocked_from_state TEXT,
      blocked_reason TEXT,
      sample_status TEXT NOT NULL DEFAULT 'none',
      batch_ordered INTEGER NOT NULL DEFAULT 0,
      batch_arrived_ready INTEGER NOT NULL DEFAULT 0,
      batch_arrival_eta TEXT,
      marketing_stage TEXT NOT NULL DEFAULT 'none',
      cost_quotes_saved INTEGER NOT NULL DEFAULT 0,
      cash_lock_ack INTEGER NOT NULL DEFAULT 0,
      stuck_over_10k_ack INTEGER NOT NULL DEFAULT 0,
      okay_risk_ack INTEGER NOT NULL DEFAULT 0,
      tier1_resolved INTEGER NOT NULL DEFAULT 0,
      reorder_status TEXT NOT NULL DEFAULT 'idle',
      reorder_arrival_eta TEXT,
      reorder_supplier_id TEXT,
      reorder_qty INTEGER,
      reorder_est_cost REAL,
      reorder_path_supplier_id TEXT,
      reorder_unavailable_json TEXT,
      reorder_crisis_skip_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const skus = sqlite
    .prepare(
      `SELECT s.id AS id, s.workspace_id AS workspace_id,
              w.active_sku_id AS active_sku_id
       FROM sku_cards s
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE s.id NOT IN (SELECT sku_id FROM sku_journeys)`,
    )
    .all() as {
    id: string;
    workspace_id: string;
    active_sku_id: string | null;
  }[];

  if (skus.length === 0) return;

  const insert = sqlite.prepare(`
    INSERT INTO sku_journeys (
      id, workspace_id, sku_id, primary_state, paused_from_state,
      blocked_from_state, blocked_reason, sample_status, batch_ordered,
      batch_arrived_ready, batch_arrival_eta, marketing_stage,
      cost_quotes_saved, cash_lock_ack, stuck_over_10k_ack, okay_risk_ack,
      tier1_resolved, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const getJourney = sqlite.prepare(
    `SELECT * FROM journey_states WHERE workspace_id = ?`,
  );
  const getSide = sqlite.prepare(
    `SELECT * FROM side_statuses WHERE workspace_id = ?`,
  );

  const now = new Date().toISOString();

  for (const sku of skus) {
    const isActive = sku.active_sku_id === sku.id;
    const journey = getJourney.get(sku.workspace_id) as
      | {
          primary_state: string;
          paused_from_state: string | null;
          blocked_from_state: string | null;
          blocked_reason: string | null;
        }
      | undefined;
    const side = getSide.get(sku.workspace_id) as
      | {
          sample_status: string;
          batch_ordered: number;
          batch_arrived_ready: number;
          batch_arrival_eta: string | null;
          marketing_stage: string;
          cost_quotes_saved: number;
          cash_lock_ack: number;
          stuck_over_10k_ack: number;
          okay_risk_ack: number;
          tier1_resolved: number;
        }
      | undefined;

    // Active SKU inherits workspace journey; other legacy SKUs start at selling
    // only if they somehow existed without journeys (shouldn't happen in v1).
    const primaryState = isActive
      ? (journey?.primary_state ?? "supplier_sample")
      : "supplier_sample";

    insert.run(
      `sj_${sku.id}`,
      sku.workspace_id,
      sku.id,
      primaryState,
      isActive ? (journey?.paused_from_state ?? null) : null,
      isActive ? (journey?.blocked_from_state ?? null) : null,
      isActive ? (journey?.blocked_reason ?? null) : null,
      isActive ? (side?.sample_status ?? "none") : "none",
      isActive ? (side?.batch_ordered ?? 0) : 0,
      isActive ? (side?.batch_arrived_ready ?? 0) : 0,
      isActive ? (side?.batch_arrival_eta ?? null) : null,
      isActive ? (side?.marketing_stage ?? "none") : "none",
      isActive ? (side?.cost_quotes_saved ?? 0) : 0,
      isActive ? (side?.cash_lock_ack ?? 0) : 0,
      isActive ? (side?.stuck_over_10k_ack ?? 0) : 0,
      isActive ? (side?.okay_risk_ack ?? 0) : 0,
      isActive ? (side?.tier1_resolved ?? 0) : 0,
      now,
    );
  }

  // Mirror shop pause from workspace journey paused overlay.
  const pausedShops = sqlite
    .prepare(
      `SELECT workspace_id FROM journey_states WHERE primary_state = 'paused'`,
    )
    .all() as { workspace_id: string }[];
  const pauseShop = sqlite.prepare(
    `UPDATE workspaces SET shop_paused = 1 WHERE id = ?`,
  );
  for (const row of pausedShops) {
    pauseShop.run(row.workspace_id);
  }
}

/** Idempotently add a column to an existing table if it is missing. */
function ensureColumn(table: string, column: string, type: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export { schema };
