-- WAVE-2 §14.5 — one shopping thumbnail URL on the Discovery pool.
-- Persist the URL string only. No image-byte scrape. Catalog seed stays NULL.
-- when MUST be >= 1787600000000 (0016 is 1787500000000).
ALTER TABLE "discovery_product_pool" ADD COLUMN IF NOT EXISTS "image_url" text;
