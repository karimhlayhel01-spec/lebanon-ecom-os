-- Drop any accidental duplicate weeks (keep earliest created_at, then id).
DELETE FROM "topic_a_entries" a
USING "topic_a_entries" b
WHERE a."workspace_id" = b."workspace_id"
  AND a."week_start" = b."week_start"
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );
--> statement-breakpoint
ALTER TABLE "topic_a_entries" ADD CONSTRAINT "topic_a_entries_workspace_week_unique" UNIQUE("workspace_id","week_start");
