import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateDualAcceptGate,
  evaluateSystemDemandGate,
  isDualDemandGateEnabled,
  isSoftListedHardAcceptBlocked,
  SYSTEM_DEMAND_GATE_MIN,
} from "@/lib/discovery/dual-gate";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
});

describe("dual-gate flags", () => {
  it("is off when POOL_V2 off (Wave 1 paste-only)", () => {
    delete process.env.DISCOVERY_POOL_V2;
    expect(isDualDemandGateEnabled()).toBe(false);
  });

  it("is on when POOL_V2 on", () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    expect(isDualDemandGateEnabled()).toBe(true);
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

describe("accept matrix — evaluateDualAcceptGate", () => {
  const goodSystem = {
    abroadDemandScore: 0.8,
    lebanonDemandScore: 0.2,
    lastScoreStatus: "ok" as const,
  };

  it("Wave 1 (dual off): paste only — missing paste blocks", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: false,
      system: goodSystem,
      dualEnabled: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("needs_demand");
  });

  it("Wave 1 (dual off): paste present — ok even without system score", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: null,
      dualEnabled: false,
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
  });

  it("dual on: missing paste → needs_demand", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: false,
      system: goodSystem,
      dualEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("needs_demand");
  });

  it("dual on: missing system score → needs_system_demand", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: null,
      dualEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("needs_system_demand");
  });

  it("dual on: both present → ok", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: goodSystem,
      dualEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.system.pass).toBe(true);
  });

  it("dual on: paste present but weak system score → needs_system_demand", () => {
    const r = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: {
        abroadDemandScore: 0.1,
        lebanonDemandScore: 0.1,
        lastScoreStatus: "ok",
      },
      dualEnabled: true,
    });
    expect(r.error).toBe("needs_system_demand");
  });
});

describe("soft-listed vs hard accept mismatch", () => {
  it("flags soft_ok listing when hard margins fail", () => {
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: false,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(true);
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: true,
        oversized: false,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
    expect(
      isSoftListedHardAcceptBlocked({
        marginsPass: false,
        oversized: true,
        softMarginBand: "soft_ok",
      }),
    ).toBe(false);
  });
});
