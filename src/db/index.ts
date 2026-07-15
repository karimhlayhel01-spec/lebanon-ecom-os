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
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      founder_user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL DEFAULT 'My Store',
      language TEXT NOT NULL DEFAULT 'en',
      active_sku_id TEXT,
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
      storage_limits TEXT NOT NULL,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supplier_options (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sku_id TEXT NOT NULL REFERENCES sku_cards(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      rank INTEGER NOT NULL,
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

  migrated = true;
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
