CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text,
	"gate_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" text NOT NULL,
	"acknowledgements" text DEFAULT '[]' NOT NULL,
	"decision_note" text,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_candidate_id" text NOT NULL,
	"url" text,
	"note" text,
	"screenshot_note" text,
	"ai_summary" text NOT NULL,
	"founder_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"show_more_used" integer DEFAULT 0 NOT NULL,
	"products_shown" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"exhaustion_counted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_states" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"primary_state" text DEFAULT 'discovery' NOT NULL,
	"paused_from_state" text,
	"blocked_from_state" text,
	"blocked_reason" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "journey_states_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_kits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text,
	"stage" text NOT NULL,
	"capacity_tier" text NOT NULL,
	"items" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"budget_usd" double precision NOT NULL,
	"monthly_follow_on_budget" double precision NOT NULL,
	"hours_per_week" integer NOT NULL,
	"experience" text NOT NULL,
	"ui_language" text NOT NULL,
	"storage_description" text NOT NULL,
	"storage_limits" text DEFAULT '' NOT NULL,
	"risk_tolerance" text NOT NULL,
	"category_likes" text NOT NULL,
	"lebanon_sellability_ack" boolean DEFAULT false NOT NULL,
	"cod_comfort" text NOT NULL,
	"shopify_status" text NOT NULL,
	"max_landed_cost" double precision NOT NULL,
	"delivery_band_days" text DEFAULT '7-10' NOT NULL,
	"sample_clearance_ready" boolean DEFAULT false NOT NULL,
	"completed_at" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "onboarding_profiles_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "orchestrator_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"meta" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"sell_price" double precision NOT NULL,
	"product_cost" double precision NOT NULL,
	"intl_ship" double precision NOT NULL,
	"clearance_taxes" double precision NOT NULL,
	"local_courier" double precision NOT NULL,
	"margin_before" double precision NOT NULL,
	"margin_after" double precision NOT NULL,
	"margins_pass" boolean NOT NULL,
	"margin_block_reason" text,
	"fit_score" double precision NOT NULL,
	"fit_breakdown" text NOT NULL,
	"strength" text NOT NULL,
	"risk_read" text,
	"differentiation" text NOT NULL,
	"tier1_conflict" boolean DEFAULT false NOT NULL,
	"tier1_marketplaces" text,
	"oversized_hard_block" boolean DEFAULT false NOT NULL,
	"not_recommended" boolean DEFAULT false NOT NULL,
	"demand_confirmed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'shown' NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"quality_checklist" text NOT NULL,
	"photo_notes" text DEFAULT '' NOT NULL,
	"packing_brief" text DEFAULT '' NOT NULL,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "side_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"product_accepted" boolean DEFAULT false NOT NULL,
	"okay_risk_ack" boolean DEFAULT false NOT NULL,
	"tier1_resolved" boolean DEFAULT false NOT NULL,
	"sample_status" text DEFAULT 'none' NOT NULL,
	"store_ready_percent" integer DEFAULT 0 NOT NULL,
	"store_ready" boolean DEFAULT false NOT NULL,
	"marketing_stage" text DEFAULT 'none' NOT NULL,
	"batch_ordered" boolean DEFAULT false NOT NULL,
	"batch_arrived_ready" boolean DEFAULT false NOT NULL,
	"batch_arrival_eta" text,
	"topic_a_week_count" integer DEFAULT 0 NOT NULL,
	"cash_lock_ack" boolean DEFAULT false NOT NULL,
	"stuck_over_10k_ack" boolean DEFAULT false NOT NULL,
	"cost_quotes_saved" boolean DEFAULT false NOT NULL,
	"discovery_exhausted_rounds" integer DEFAULT 0 NOT NULL,
	"experience_raised_pending_ack" boolean DEFAULT false NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "side_statuses_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "sku_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_candidate_id" text,
	"name" text NOT NULL,
	"basics" text NOT NULL,
	"ship_fitness" text NOT NULL,
	"storage_ambiance" text NOT NULL,
	"handling" text NOT NULL,
	"import_batch" text NOT NULL,
	"money_snapshot" text NOT NULL,
	"quoted_costs" text,
	"reported_margin" text,
	"marketing_hooks" text NOT NULL,
	"founder_notes" text DEFAULT '' NOT NULL,
	"lifecycle_status" text DEFAULT 'live' NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_journeys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"primary_state" text DEFAULT 'discovery' NOT NULL,
	"paused_from_state" text,
	"blocked_from_state" text,
	"blocked_reason" text,
	"sample_status" text DEFAULT 'none' NOT NULL,
	"batch_ordered" boolean DEFAULT false NOT NULL,
	"batch_arrived_ready" boolean DEFAULT false NOT NULL,
	"batch_arrival_eta" text,
	"marketing_stage" text DEFAULT 'none' NOT NULL,
	"cost_quotes_saved" boolean DEFAULT false NOT NULL,
	"cash_lock_ack" boolean DEFAULT false NOT NULL,
	"stuck_over_10k_ack" boolean DEFAULT false NOT NULL,
	"okay_risk_ack" boolean DEFAULT false NOT NULL,
	"tier1_resolved" boolean DEFAULT false NOT NULL,
	"reorder_status" text DEFAULT 'idle' NOT NULL,
	"reorder_arrival_eta" text,
	"reorder_supplier_id" text,
	"reorder_qty" integer,
	"reorder_est_cost" double precision,
	"reorder_path_supplier_id" text,
	"reorder_unavailable_json" text,
	"reorder_crisis_skip_json" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "sku_journeys_sku_id_unique" UNIQUE("sku_id")
);
--> statement-breakpoint
CREATE TABLE "store_readiness" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"checklist" text NOT NULL,
	"store_url" text,
	"whatsapp_number" text,
	"courier_choice" text,
	"policies_draft" text DEFAULT '' NOT NULL,
	"content_draft_en" text DEFAULT '' NOT NULL,
	"content_draft_ar" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "store_readiness_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_options" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"rank" integer NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"years" integer NOT NULL,
	"rating" double precision NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"moq" integer NOT NULL,
	"unit_price" double precision NOT NULL,
	"sample_replies" boolean DEFAULT true NOT NULL,
	"negotiation_draft" text NOT NULL,
	"payment_map_estimate" text NOT NULL,
	"red_flags" text,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_a_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"week_start" text NOT NULL,
	"store_totals_usd" double precision NOT NULL,
	"per_sku_sold_left" text NOT NULL,
	"meta_spend" double precision DEFAULT 0 NOT NULL,
	"tiktok_spend" double precision DEFAULT 0 NOT NULL,
	"cod_collected" double precision DEFAULT 0 NOT NULL,
	"cod_outstanding" double precision DEFAULT 0 NOT NULL,
	"courier_fees" double precision DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"founder_user_id" text NOT NULL,
	"name" text DEFAULT 'My Store' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"active_sku_id" text,
	"shop_paused" boolean DEFAULT false NOT NULL,
	"shopify_status" text DEFAULT 'not_started' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_product_candidate_id_product_candidates_id_fk" FOREIGN KEY ("product_candidate_id") REFERENCES "public"."product_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_verdicts" ADD CONSTRAINT "finance_verdicts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_states" ADD CONSTRAINT "journey_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_kits" ADD CONSTRAINT "marketing_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_kits" ADD CONSTRAINT "marketing_kits_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "onboarding_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_events" ADD CONSTRAINT "orchestrator_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_candidates" ADD CONSTRAINT "product_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_candidates" ADD CONSTRAINT "product_candidates_session_id_discovery_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."discovery_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_records" ADD CONSTRAINT "sample_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_records" ADD CONSTRAINT "sample_records_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_records" ADD CONSTRAINT "sample_records_supplier_id_supplier_options_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_statuses" ADD CONSTRAINT "side_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_cards" ADD CONSTRAINT "sku_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_cards" ADD CONSTRAINT "sku_cards_product_candidate_id_product_candidates_id_fk" FOREIGN KEY ("product_candidate_id") REFERENCES "public"."product_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_journeys" ADD CONSTRAINT "sku_journeys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_journeys" ADD CONSTRAINT "sku_journeys_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_readiness" ADD CONSTRAINT "store_readiness_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_options" ADD CONSTRAINT "supplier_options_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_options" ADD CONSTRAINT "supplier_options_sku_id_sku_cards_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_a_entries" ADD CONSTRAINT "topic_a_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_founder_user_id_users_id_fk" FOREIGN KEY ("founder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;