import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAcceptDemandGate,
  evaluateSystemDemandGate,
  isSoftListedHardAcceptBlocked,
  isSystemDemandGateEnabled,
  SYSTEM_DEMAND_GATE_MIN,
} from "@/lib/discovery/dual-gate";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
});

describe("system demand gate flags", () => {
  it("is off when POOL_V2 off (no system score required)", () => {
    delete process.env.DISCOVERY_POOL_V2;
    expect(isSystemDemandGateEnabled()).toBe(false);
  });

  it("is on when POOL_V2 on", () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    expect(isSystemDemandGateEnabled()).toBe(true);
  });
});

describe("evaluateSystemDemandGate", () => {
  it("fails closed when score cache missing", () => {
    expect(evaluateSystemDemandGate(null).status).toBe("missing");
    expect(evaluateSystemDemandGate({ lastScoreStatus: "never" }).pass).toBe(
      false,
    );
  });

  it("passes whitespace OR local-proven above min", () => {
    const whitespace = evaluateSystemDemandGate({
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.2,
      lastScoreStatus: "ok",
    });
    expect(whitespace.pass).toBe(true);
    expect(whitespace.demandPath).toBe("whitespace");
    expect(whitespace.demandScore!).toBeGreaterThanOrEqual(SYSTEM_DEMAND_GATE_MIN);

    const local = evaluateSystemDemandGate({
      abroadDemandScore: 0.2,
      lebanonDemandScore: 0.75,
      lastScoreStatus: "ok",
    });
    expect(local.pass).toBe(true);
    expect(local.demandPath).toBe("local_proven");
  });

  it("fails when demand too weak", () => {
    const weak = evaluateSystemDemandGate({
      abroadDemandScore: 0.15,
      lebanonDemandScore: 0.15,
      lastScoreStatus: "ok",
    });
    expect(weak.pass).toBe(false);
    expect(weak.status).toBe("fail");
  });
});

describe("accept — evaluateAcceptDemandGate (no paste)", () => {
  const goodSystem = {
    abroadDemandScore: 0.8,
    lebanonDemandScore: 0.2,
    lastScoreStatus: "ok" as const,
  };

  it("POOL_V2 off: accept without paste or system score", () => {
    const r = evaluateAcceptDemandGate({
      system: null,
      systemGateEnabled: false,
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
  });

  it("POOL_V2 on: missing system score → needs_system_demand_missing", () => {
    const r = evaluateAcceptDemandGate({
      system: null,
      systemGateEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("needs_system_demand_missing");
  });

  it("POOL_V2 on: good system score → ok without paste", () => {
    const r = evaluateAcceptDemandGate({
      system: goodSystem,
      systemGateEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.system.pass).toBe(true);
  });

  it("POOL_V2 on: weak system score → needs_system_demand_weak", () => {
    const r = evaluateAcceptDemandGate({
      system: {
        abroadDemandScore: 0.1,
        lebanonDemandScore: 0.1,
        lastScoreStatus: "ok",
      },
      systemGateEnabled: true,
    });
    expect(r.error).toBe("needs_system_demand_weak");
  });

  it("error union never includes needs_demand (paste removed)", () => {
    const r = evaluateAcceptDemandGate({
      system: null,
      systemGateEnabled: true,
    });
    expect(r.error).not.toBe("needs_demand" as never);
    expect([
      "needs_system_demand_missing",
      "needs_system_demand_weak",
      null,
    ]).toContain(r.error);
  });
});

describe("soft-listed vs hard accept mismatch (retired)", () => {
  it("never flags soft_ok for browsing — shortlist is accept-ready only", () => {
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: false,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: true,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
  });
});
