-- Wave 4 Store follow-up: per-SKU page packs (drafts / discoverability / versions).
-- Shop checklist / URL / WhatsApp / courier stay on store_readiness.
CREATE TABLE "store_page_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"policies_draft" text DEFAULT '' NOT NULL,
	"content_draft_en" text DEFAULT '' NOT NULL,
	"content_draft_ar" text DEFAULT '' NOT NULL,
	"discoverability_pack" text DEFAULT '' NOT NULL,
	"page_copy_versions" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "store_page_packs_sku_id_unique" UNIQUE("sku_id")
);
--> statement-breakpoint
ALTER TABLE "store_page_packs" ADD CONSTRAINT "store_page_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_page_packs" ADD CONSTRAINT "store_page_packs_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Attach existing shop-level copy to one live SKU: prefer activeSkuId if live, else first live.
INSERT INTO "store_page_packs" (
	"id",
	"workspace_id",
	"sku_id",
	"policies_draft",
	"content_draft_en",
	"content_draft_ar",
	"discoverability_pack",
	"page_copy_versions",
	"created_at",
	"updated_at"
)
SELECT
	'migpack_' || sr."workspace_id",
	sr."workspace_id",
	chosen."sku_id",
	sr."policies_draft",
	sr."content_draft_en",
	sr."content_draft_ar",
	sr."discoverability_pack",
	sr."page_copy_versions",
	sr."updated_at",
	sr."updated_at"
FROM "store_readiness" sr
INNER JOIN (
	SELECT
		w."id" AS "workspace_id",
		COALESCE(
			(
				SELECT sc."id"
				FROM "sku_cards" sc
				WHERE sc."workspace_id" = w."id"
					AND sc."id" = w."active_sku_id"
					AND sc."lifecycle_status" = 'live'
				LIMIT 1
			),
			(
				SELECT sc."id"
				FROM "sku_cards" sc
				WHERE sc."workspace_id" = w."id"
					AND sc."lifecycle_status" = 'live'
				ORDER BY sc."created_at", sc."id"
				LIMIT 1
			)
		) AS "sku_id"
	FROM "workspaces" w
) chosen ON chosen."workspace_id" = sr."workspace_id"
WHERE chosen."sku_id" IS NOT NULL
ON CONFLICT ("sku_id") DO NOTHING;
--> statement-breakpoint
-- Stop reading leftover shop-level AI columns (left in place; cheaper than DROP).
UPDATE "store_readiness"
SET
	"policies_draft" = '',
	"content_draft_en" = '',
	"content_draft_ar" = '',
	"discoverability_pack" = '',
	"page_copy_versions" = '';
