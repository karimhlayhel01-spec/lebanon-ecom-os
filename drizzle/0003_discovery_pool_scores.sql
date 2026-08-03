-- Wave 2 Discovery engineering foundation: global product pool + Approach A score cache.
-- Isolated from workspace journey / Topic A / SKU finance (no workspace_id FKs).
CREATE TABLE "discovery_product_pool" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_key" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"summary_en" text DEFAULT '' NOT NULL,
	"summary_ar" text DEFAULT '' NOT NULL,
	"differentiation_en" text DEFAULT '' NOT NULL,
	"differentiation_ar" text DEFAULT '' NOT NULL,
	"sell_price" double precision NOT NULL,
	"product_cost" double precision NOT NULL,
	"intl_ship" double precision NOT NULL,
	"clearance_taxes" double precision NOT NULL,
	"local_courier" double precision NOT NULL,
	"difficulty" integer DEFAULT 0 NOT NULL,
	"risk" integer DEFAULT 0 NOT NULL,
	"time_need" integer DEFAULT 4 NOT NULL,
	"workload" integer DEFAULT 0 NOT NULL,
	"storage_footprint" text DEFAULT 'small' NOT NULL,
	"oversized" boolean DEFAULT false NOT NULL,
	"tier1_marketplaces" text DEFAULT '[]' NOT NULL,
	"source_url" text,
	"moq_hint" integer,
	"sample_cost_hint" double precision,
	"source" text DEFAULT 'catalog_seed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "discovery_product_pool_catalog_key_unique" UNIQUE("catalog_key")
);
--> statement-breakpoint
CREATE TABLE "discovery_product_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_product_id" text NOT NULL,
	"abroad_demand_score" double precision,
	"lebanon_demand_score" double precision,
	"competition_score" double precision,
	"budget_fight_penalty" double precision,
	"composite_score" double precision,
	"demand_path" text,
	"confidence" double precision,
	"explain_line" text,
	"last_scored_at" text,
	"last_score_status" text DEFAULT 'never' NOT NULL,
	"last_error" text,
	"shadow_would_exclude" boolean DEFAULT false NOT NULL,
	"shadow_exclude_reason" text,
	"raw_evidence_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "discovery_product_scores_pool_product_id_unique" UNIQUE("pool_product_id")
);
--> statement-breakpoint
ALTER TABLE "discovery_product_scores" ADD CONSTRAINT "discovery_product_scores_pool_product_id_discovery_product_pool_id_fk" FOREIGN KEY ("pool_product_id") REFERENCES "public"."discovery_product_pool"("id") ON DELETE no action ON UPDATE no action;
