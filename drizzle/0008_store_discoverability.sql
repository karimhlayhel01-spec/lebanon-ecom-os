-- Wave 4 Phase 2: Store discoverability / SEO pack (JSON text; founder pastes into Shopify).
ALTER TABLE "store_readiness" ADD COLUMN IF NOT EXISTS "discoverability_pack" text DEFAULT '' NOT NULL;
