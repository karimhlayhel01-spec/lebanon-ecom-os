import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAcceptDemandGate,
  evaluateSystemDemandGate,
  isSoftListedHardAcceptBlocked,
  SYSTEM_DEMAND_GATE_MIN,
} from "@/lib/discovery/dual-gate";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
});

describe("accept matrix — missing / weak / accept-ready", () => {
  it("missing score → needs_system_demand_missing (not weak)", () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    const r = evaluateAcceptDemandGate({
      system: null,
      systemGateEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.system.status).toBe("missing");
    expect(r.error).toBe("needs_system_demand_missing");
    expect(r.error).not.toBe("needs_system_demand_weak");
  });

  it("never / failed status without numerics → missing", () => {
    const never = evaluateSystemDemandGate({ lastScoreStatus: "never" });
    expect(never.status).toBe("missing");
    const failed = evaluateAcceptDemandGate({
      system: { lastScoreStatus: "failed" },
      systemGateEnabled: true,
    });
    expect(failed.error).toBe("needs_system_demand_missing");
  });

  it("weak scored demand → needs_system_demand_weak", () => {
    const r = evaluateAcceptDemandGate({
      system: {
        abroadDemandScore: 0.1,
        lebanonDemandScore: 0.1,
        lastScoreStatus: "ok",
      },
      systemGateEnabled: true,
    });
    expect(r.system.status).toBe("fail");
    expect(r.error).toBe("needs_system_demand_weak");
  });

  it("heuristic-like numeric scores pass when above min (LIVE_SEARCH off path)", () => {
    const r = evaluateAcceptDemandGate({
      system: {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        lastScoreStatus: "ok",
      },
      systemGateEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.system.demandScore!).toBeGreaterThanOrEqual(SYSTEM_DEMAND_GATE_MIN);
  });

  it("soft_ok no longer implies softListedHardAcceptBlocked (listing retired)", () => {
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: false,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
  });

  it("LIVE_SEARCH off + missing cache → heuristic fallback for accept gate", async () => {
    const { resolveSystemDemandInput, evaluateAcceptDemandGate } = await import(
      "@/lib/discovery/dual-gate"
    );
    const resolved = resolveSystemDemandInput({
      cache: null,
      liveSearchEnabled: false,
      heuristicProduct: {
        catalogKey: "path1_test",
        category: "home",
        difficulty: 0,
        risk: 0,
        tier1Marketplaces: "[]",
        nameEn: "Test Product",
      },
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.lastScoreStatus).toBe("ok");
    const gate = evaluateAcceptDemandGate({
      system: resolved,
      systemGateEnabled: true,
    });
    expect(gate.system.status).not.toBe("missing");
    expect(gate.error).not.toBe("needs_system_demand_missing");
  });

  it("LIVE_SEARCH on + missing cache stays fail-closed (no heuristic invent)", async () => {
    const { resolveSystemDemandInput, evaluateAcceptDemandGate } = await import(
      "@/lib/discovery/dual-gate"
    );
    const resolved = resolveSystemDemandInput({
      cache: { lastScoreStatus: "failed" },
      liveSearchEnabled: true,
      heuristicProduct: {
        catalogKey: "path1_test",
        category: "home",
        difficulty: 0,
        risk: 0,
        tier1Marketplaces: "[]",
        nameEn: "Test Product",
      },
    });
    const gate = evaluateAcceptDemandGate({
      system: resolved,
      systemGateEnabled: true,
    });
    expect(gate.error).toBe("needs_system_demand_missing");
  });

  it("UI copy keys distinguish missing vs weak; soft-list browsing path gone", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const en = readFileSync(join(process.cwd(), "messages/en.json"), "utf8");
    expect(en).toContain("acceptNeedsSystemDemandMissing");
    expect(en).toContain("acceptNeedsSystemDemandWeak");
    expect(en).toContain("editOnboardingZeroTitle");
    expect(en).toContain("Score not ready yet");
    expect(en).toContain("too weak for accept");
    const board = readFileSync(
      join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    expect(board).toContain("needs_system_demand_missing");
    expect(board).toContain("needs_system_demand_weak");
    expect(board).toContain("editOnboardingBanner");
    expect(board).not.toContain("softListedHardAcceptBody");
    expect(board).not.toContain("acceptSoftListedBlocked");
  });
});
