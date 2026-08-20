-- WAVE-2 §14 PR2 — intro seen on the profile; ask/frame chips on the session.
-- discoveryIntroSeen survives Refresh. agent_frame_json is cleared by a new session.
ALTER TABLE "onboarding_profiles" ADD COLUMN "discovery_intro_seen" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD COLUMN "agent_frame_json" text;
