-- WAVE-2 §14 PR3 — Explore more counter + shown keys on the session.
-- when MUST be >= 1787500000000 so drizzle-orm migrate applies on Neon
-- (this DB already has a __drizzle_migrations row at 1787400000000).
ALTER TABLE "discovery_sessions" ADD COLUMN IF NOT EXISTS "explore_more_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD COLUMN IF NOT EXISTS "shown_catalog_keys_json" text;
