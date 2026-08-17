-- Wave 4 Phase 6a — visual gen foundation (packs, owned files, card results, monthly ledger).
-- No Higgsfield client in this slice. Packs are per-SKU only (sku_id NOT NULL).
CREATE TABLE "marketing_sku_photo_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"motion_clip_storage_path" text,
	"motion_clip_original_name" text,
	"motion_clip_mime_type" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "marketing_sku_photo_packs_workspace_sku_name_unique" UNIQUE("workspace_id","sku_id","name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_sku_photo_packs_default_unique" ON "marketing_sku_photo_packs" ("workspace_id","sku_id") WHERE "is_default" = true;
--> statement-breakpoint
CREATE TABLE "marketing_sku_photo_pack_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_creative_visuals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"kit_id" text NOT NULL,
	"creative_id" text NOT NULL,
	"pack_id" text,
	"storage_path" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"regenerate_count" integer DEFAULT 0 NOT NULL,
	"generated_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "marketing_creative_visuals_kit_creative_unique" UNIQUE("workspace_id","kit_id","creative_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_visual_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"month_key" text NOT NULL,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"last_run_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "marketing_visual_usage_workspace_month_unique" UNIQUE("workspace_id","month_key")
);
--> statement-breakpoint
ALTER TABLE "marketing_sku_photo_packs" ADD CONSTRAINT "marketing_sku_photo_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sku_photo_packs" ADD CONSTRAINT "marketing_sku_photo_packs_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sku_photo_pack_assets" ADD CONSTRAINT "marketing_sku_photo_pack_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sku_photo_pack_assets" ADD CONSTRAINT "marketing_sku_photo_pack_assets_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sku_photo_pack_assets" ADD CONSTRAINT "marketing_sku_photo_pack_assets_pack_id_marketing_sku_photo_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."marketing_sku_photo_packs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_creative_visuals" ADD CONSTRAINT "marketing_creative_visuals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_creative_visuals" ADD CONSTRAINT "marketing_creative_visuals_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_creative_visuals" ADD CONSTRAINT "marketing_creative_visuals_kit_id_marketing_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."marketing_kits"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_creative_visuals" ADD CONSTRAINT "marketing_creative_visuals_pack_id_marketing_sku_photo_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."marketing_sku_photo_packs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_visual_usage" ADD CONSTRAINT "marketing_visual_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
