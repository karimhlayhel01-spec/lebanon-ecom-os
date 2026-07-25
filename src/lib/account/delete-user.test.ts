import { describe, expect, it } from "vitest";
import { WORKSPACE_CASCADE_DELETE_ORDER } from "@/lib/account/delete-user";

describe("WORKSPACE_CASCADE_DELETE_ORDER", () => {
  it("wipes children before workspaces (preview seed order)", () => {
    expect(WORKSPACE_CASCADE_DELETE_ORDER).toEqual([
      "sample_records",
      "supplier_options",
      "marketing_kits",
      "demand_signals",
      "sku_cards",
      "product_candidates",
      "discovery_sessions",
      "topic_a_entries",
      "finance_verdicts",
      "approval_requests",
      "orchestrator_events",
      "store_readiness",
      "onboarding_profiles",
      "journey_states",
      "side_statuses",
      "workspaces",
    ]);
  });

  it("ends with workspaces so FKs are satisfied", () => {
    expect(
      WORKSPACE_CASCADE_DELETE_ORDER[WORKSPACE_CASCADE_DELETE_ORDER.length - 1],
    ).toBe("workspaces");
    expect(new Set(WORKSPACE_CASCADE_DELETE_ORDER).size).toBe(
      WORKSPACE_CASCADE_DELETE_ORDER.length,
    );
  });
});
