import { describe, expect, it } from "vitest";
import {
  checkTransitionApproval,
  evaluateApprovalDecision,
  gateForTransition,
  gateTargetState,
} from "@/lib/approvals/gates";

describe("approval gates — transition mapping", () => {
  it("maps each guarded transition to its gate", () => {
    expect(gateForTransition("supplier_sample")).toBe("accept_product");
    expect(gateForTransition("sample_approved")).toBe("sample_decision");
    expect(gateForTransition("batch_ordered")).toBe("batch_ordered");
    expect(gateForTransition("batch_arrived_ready")).toBe("batch_arrived_ready");
    expect(gateForTransition("selling")).toBe("mark_selling");
  });

  it("requires no approval to focus store setup", () => {
    expect(gateForTransition("store_setup")).toBeNull();
  });

  it("exposes target states, side-only gates map to null", () => {
    expect(gateTargetState("accept_product")).toBe("supplier_sample");
    expect(gateTargetState("mark_selling")).toBe("selling");
    expect(gateTargetState("store_ready")).toBeNull();
    expect(gateTargetState("tier1_customize_or_drop")).toBeNull();
    expect(gateTargetState("stuck_over_10k_path_c")).toBeNull();
    expect(gateTargetState("start_launch_marketing")).toBeNull();
  });
});

describe("approval gates — decision reducer", () => {
  it("approves when required acknowledgements are present", () => {
    const result = evaluateApprovalDecision(
      { status: "pending" },
      ["cash_ack", "risk_ack"],
      { type: "approve", acknowledgements: ["cash_ack", "risk_ack"], note: "ok" },
    );
    expect(result).toEqual({
      ok: true,
      status: "approved",
      acknowledgements: ["cash_ack", "risk_ack"],
      decisionNote: "ok",
    });
  });

  it("blocks approval when acknowledgements are missing", () => {
    const result = evaluateApprovalDecision(
      { status: "pending" },
      ["cash_ack", "risk_ack"],
      { type: "approve", acknowledgements: ["cash_ack"] },
    );
    expect(result).toEqual({
      ok: false,
      error: "missing_acknowledgements",
      missing: ["risk_ack"],
    });
  });

  it("allows rejection without acknowledgements", () => {
    const result = evaluateApprovalDecision(
      { status: "pending" },
      ["inventory_ack"],
      { type: "reject", note: "not ready" },
    );
    expect(result).toEqual({
      ok: true,
      status: "rejected",
      acknowledgements: [],
      decisionNote: "not ready",
    });
  });

  it("refuses to re-decide an already-decided request", () => {
    expect(
      evaluateApprovalDecision({ status: "approved" }, [], {
        type: "approve",
        acknowledgements: [],
      }),
    ).toEqual({ ok: false, error: "already_decided" });
  });
});

describe("approval gates — server transition guard", () => {
  it("passes side-only targets with no gate", () => {
    expect(checkTransitionApproval("store_setup", [])).toEqual({ ok: true });
  });

  it("passes when the guarding gate is approved", () => {
    expect(
      checkTransitionApproval("supplier_sample", [
        { gateId: "accept_product", status: "approved" },
      ]),
    ).toEqual({ ok: true });
  });

  it("blocks when the gate is only pending", () => {
    expect(
      checkTransitionApproval("selling", [
        { gateId: "mark_selling", status: "pending" },
      ]),
    ).toEqual({ ok: false, error: "approval_required", gate: "mark_selling" });
  });

  it("blocks when no approval exists for the gate", () => {
    expect(checkTransitionApproval("batch_ordered", [])).toEqual({
      ok: false,
      error: "approval_required",
      gate: "batch_ordered",
    });
  });
});
