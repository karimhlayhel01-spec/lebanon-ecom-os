-- Wave 3: founder-entered path-supplier contacts (nullable; never auto-filled).
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "contact_email" text;
ALTER TABLE "supplier_options" ADD COLUMN IF NOT EXISTS "contact_whatsapp" text;
