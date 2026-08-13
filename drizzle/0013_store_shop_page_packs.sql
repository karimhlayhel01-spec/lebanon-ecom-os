-- Wave 4 Store whole-shop pack: nullable sku_id + one shop pack per workspace.
ALTER TABLE "store_page_packs" ALTER COLUMN "sku_id" DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "store_page_packs_workspace_shop_unique" ON "store_page_packs" ("workspace_id") WHERE "sku_id" IS NULL;
