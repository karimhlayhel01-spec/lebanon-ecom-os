-- Wave 4 Phase 7 — monthly Marketing Gemini spend ledger (per workspace + UTC month).
-- Intro fill + creatives improve (+ visual polish when Gemini runs). Store pack excluded.
CREATE TABLE "marketing_gemini_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"month_key" text NOT NULL,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"last_run_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "marketing_gemini_usage_workspace_month_unique" UNIQUE("workspace_id","month_key")
);
--> statement-breakpoint
ALTER TABLE "marketing_gemini_usage" ADD CONSTRAINT "marketing_gemini_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
