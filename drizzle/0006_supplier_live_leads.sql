-- Wave 3: additive live-lead metadata on supplier_options (nullable / defaults).
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "lead_source" text DEFAULT 'heuristic' NOT NULL;
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "platform" text;
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "external_title" text;
