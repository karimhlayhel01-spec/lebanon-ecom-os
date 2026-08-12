-- Rename marketing stage monthly_refresh → weekly_refresh (Wave 4).
-- Dual-read in app remains for any env that has not run this yet.

UPDATE "marketing_kits"
SET "stage" = 'weekly_refresh'
WHERE "stage" = 'monthly_refresh';
--> statement-breakpoint
UPDATE "sku_journeys"
SET "marketing_stage" = 'weekly_refresh'
WHERE "marketing_stage" = 'monthly_refresh';
--> statement-breakpoint
UPDATE "side_statuses"
SET "marketing_stage" = 'weekly_refresh'
WHERE "marketing_stage" = 'monthly_refresh';
