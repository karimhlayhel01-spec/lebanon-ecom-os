import { describe, expect, it, afterEach, vi } from "vitest";
import { WORKSPACE_CASCADE_DELETE_ORDER } from "@/lib/account/delete-user";
import { isDemoResetEnabled } from "@/lib/demo/config";
import { DEMO_JOURNEY_RESET_DELETE_ORDER } from "@/lib/demo/reset-journey";

describe("DEMO_JOURNEY_RESET_DELETE_ORDER", () => {
  it("matches workspace cascade prefix and stops before identity tables", () => {
    expect(DEMO_JOURNEY_RESET_DELETE_ORDER).toEqual([
      "sample_records",
      "supplier_options",
      "marketing_kits",
      "demand_signals",
      "sku_journeys",
      "approval_requests",
      "sku_cards",
      "product_candidates",
      "discovery_sessions",
      "topic_a_entries",
      "finance_verdicts",
      "orchestrator_events",
      "store_readiness",
    ]);

    const kept = [
      "onboarding_profiles",
      "journey_states",
      "side_statuses",
      "workspaces",
    ];
    for (const table of DEMO_JOURNEY_RESET_DELETE_ORDER) {
      expect(WORKSPACE_CASCADE_DELETE_ORDER).toContain(table);
      expect(kept).not.toContain(table);
    }
    expect(WORKSPACE_CASCADE_DELETE_ORDER.slice(0, DEMO_JOURNEY_RESET_DELETE_ORDER.length)).toEqual(
      [...DEMO_JOURNEY_RESET_DELETE_ORDER],
    );
  });
});

describe("isDemoResetEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default", () => {
    vi.stubEnv("DEMO_RESET", undefined);
    expect(isDemoResetEnabled()).toBe(false);
  });

  it("accepts 1 or true", () => {
    vi.stubEnv("DEMO_RESET", "1");
    expect(isDemoResetEnabled()).toBe(true);
    vi.stubEnv("DEMO_RESET", "true");
    expect(isDemoResetEnabled()).toBe(true);
  });

  it("rejects other values", () => {
    vi.stubEnv("DEMO_RESET", "0");
    expect(isDemoResetEnabled()).toBe(false);
    vi.stubEnv("DEMO_RESET", "yes");
    expect(isDemoResetEnabled()).toBe(false);
  });
});
