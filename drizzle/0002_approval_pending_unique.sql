-- Drop duplicate pending approvals (keep earliest created_at, then id).
DELETE FROM "approval_requests" a
USING "approval_requests" b
WHERE a."status" = 'pending'
  AND b."status" = 'pending'
  AND a."workspace_id" = b."workspace_id"
  AND a."gate_id" = b."gate_id"
  AND coalesce(a."sku_id", '') = coalesce(b."sku_id", '')
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );
--> statement-breakpoint
-- At most one pending request per workspace + gate + sku (null sku → '').
CREATE UNIQUE INDEX "approval_requests_pending_unique"
ON "approval_requests" ("workspace_id", "gate_id", (coalesce("sku_id", '')))
WHERE "status" = 'pending';
