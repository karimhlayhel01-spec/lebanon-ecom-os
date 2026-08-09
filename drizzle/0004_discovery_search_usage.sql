-- Wave 2 §7 monthly search-spend ledger: one row per UTC month, checked before
-- each query batch so a job stops cleanly at the cap instead of burning quota.
-- Global like the pool / score cache — no workspace_id FK.
CREATE TABLE "discovery_search_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"queries_used" integer DEFAULT 0 NOT NULL,
	"last_run_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "discovery_search_usage_month_key_unique" UNIQUE("month_key")
);
