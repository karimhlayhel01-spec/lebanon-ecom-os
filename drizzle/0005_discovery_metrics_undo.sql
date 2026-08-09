-- Wave 2 §7 measurement loop: append-only Discovery funnel counters.
-- dedupe_key is unique so a re-render / revalidate / retry records one event.
CREATE TABLE "discovery_metric_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text,
	"kind" text NOT NULL,
	"error_code" text,
	"dedupe_key" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "discovery_metric_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "discovery_metric_events" ADD CONSTRAINT "discovery_metric_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Aggregation always scans a time window.
CREATE INDEX "discovery_metric_events_created_at_idx" ON "discovery_metric_events" ("created_at");
--> statement-breakpoint
-- Wave 2 §7 undo reject: bounds the short recovery window after a mis-tap.
-- Null on rejects made before this migration — those stay non-undoable.
ALTER TABLE "product_candidates" ADD COLUMN "rejected_at" text;
