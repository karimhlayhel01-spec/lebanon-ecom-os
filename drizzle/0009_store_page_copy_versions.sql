-- Wave 4 Phase 2 addendum: baseline + up to 3 AI Store page-copy snapshots.
ALTER TABLE "store_readiness" ADD COLUMN IF NOT EXISTS "page_copy_versions" text DEFAULT '' NOT NULL;
