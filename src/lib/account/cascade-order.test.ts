import { describe, expect, it } from "vitest";
import {
  DEMO_JOURNEY_RESET_DELETE_ORDER,
  SKU_WIPE_DELETE_ORDER,
  WORKSPACE_CASCADE_DELETE_ORDER,
  WORKSPACE_CASCADE_TABLES,
  WORKSPACE_IDENTITY_CUTOFF,
  WORKSPACE_IDENTITY_TABLES,
} from "@/lib/account/cascade-order";

describe("WORKSPACE_CASCADE_TABLES", () => {
  it("is the single source for full delete order", () => {
    expect(WORKSPACE_CASCADE_DELETE_ORDER).toBe(WORKSPACE_CASCADE_TABLES);
    expect([...WORKSPACE_CASCADE_DELETE_ORDER]).toEqual([
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
      "discovery_metric_events",
      "orchestrator_events",
      "store_readiness",
      "onboarding_profiles",
      "journey_states",
      "side_statuses",
      "workspaces",
    ]);
  });

  it("ends with workspaces and has no duplicates", () => {
    expect(
      WORKSPACE_CASCADE_DELETE_ORDER[WORKSPACE_CASCADE_DELETE_ORDER.length - 1],
    ).toBe("workspaces");
    expect(new Set(WORKSPACE_CASCADE_DELETE_ORDER).size).toBe(
      WORKSPACE_CASCADE_DELETE_ORDER.length,
    );
  });
});

describe("DEMO_JOURNEY_RESET_DELETE_ORDER", () => {
  it("is the cascade prefix before onboarding/workspace identity", () => {
    expect([...DEMO_JOURNEY_RESET_DELETE_ORDER]).toEqual([
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
      "discovery_metric_events",
      "orchestrator_events",
      "store_readiness",
    ]);
    expect(WORKSPACE_IDENTITY_CUTOFF).toBe("onboarding_profiles");
    expect([...WORKSPACE_IDENTITY_TABLES]).toEqual([
      "onboarding_profiles",
      "journey_states",
      "side_statuses",
      "workspaces",
    ]);
    expect(
      WORKSPACE_CASCADE_DELETE_ORDER.slice(
        0,
        DEMO_JOURNEY_RESET_DELETE_ORDER.length,
      ),
    ).toEqual([...DEMO_JOURNEY_RESET_DELETE_ORDER]);
    for (const table of DEMO_JOURNEY_RESET_DELETE_ORDER) {
      expect(WORKSPACE_IDENTITY_TABLES).not.toContain(table);
    }
  });
});

describe("SKU_WIPE_DELETE_ORDER", () => {
  it("is a relative-order subset of the master cascade", () => {
    expect([...SKU_WIPE_DELETE_ORDER]).toEqual([
      "sample_records",
      "supplier_options",
      "marketing_kits",
      "sku_journeys",
      "approval_requests",
    ]);
    let lastIndex = -1;
    for (const table of SKU_WIPE_DELETE_ORDER) {
      const index = WORKSPACE_CASCADE_TABLES.indexOf(table);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });
});
