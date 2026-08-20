import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/discovery/catalog";
import {
  applyDifferAnswer,
  applySellAnswer,
  applySkipRefuseAnswer,
  EMPTY_AGENT_FRAME,
  filterCatalogByIndustries,
  isAgentAskComplete,
  parseAgentFrame,
  resolveAgentBoardPhase,
  resolveAgentRetrievePlan,
  serializeAgentFrame,
  type AgentFrame,
} from "@/lib/discovery/agent/frame";

describe("resolveAgentRetrievePlan", () => {
  it("paintings → home_kitchen retrieve even with no chips", () => {
    const frame = applySellAnswer(EMPTY_AGENT_FRAME, [], "paintings");
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    const plan = resolveAgentRetrievePlan(frame);
    expect(plan.dontDeal).toBe(false);
    expect(plan.industryIds).toEqual(["home_kitchen"]);
    const keys = filterCatalogByIndustries(CATALOG, plan.industryIds).map(
      (p) => p.key,
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) =>
      CATALOG.find((p) => p.key === k)?.category === "home_kitchen",
    )).toBe(true);
  });

  it("bakery → no ids + don’t-deal", () => {
    const frame = applySellAnswer(EMPTY_AGENT_FRAME, [], "a bakery");
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    expect(isAgentAskComplete(frame)).toBe(true);
    const plan = resolveAgentRetrievePlan(frame);
    expect(plan.dontDeal).toBe(true);
    expect(plan.industryIds).toEqual([]);
    expect(filterCatalogByIndustries(CATALOG, plan.industryIds)).toEqual([]);
  });

  it("unmapped Other + home_kitchen chip is not don’t-deal", () => {
    const frame = applySellAnswer(
      EMPTY_AGENT_FRAME,
      ["home_kitchen"],
      "silicone garlic roller",
    );
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    expect(isAgentAskComplete(frame)).toBe(false);
    const plan = resolveAgentRetrievePlan(frame);
    expect(plan.dontDeal).toBe(false);
    expect(plan.industryIds).toEqual(["home_kitchen"]);
  });

  it("used cars with no chips is don’t-deal", () => {
    const frame = applySellAnswer(EMPTY_AGENT_FRAME, [], "used cars");
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    expect(resolveAgentRetrievePlan(frame).dontDeal).toBe(true);
  });

  it("unmapped Other as the only selection is don’t-deal", () => {
    const frame = applySellAnswer(EMPTY_AGENT_FRAME, [], "quantum consulting");
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    expect(resolveAgentRetrievePlan(frame).dontDeal).toBe(true);
    expect(resolveAgentRetrievePlan(frame).industryIds).toEqual([]);
  });

  it("sofas stay don’t-deal even with an industry chip", () => {
    const frame = applySellAnswer(
      EMPTY_AGENT_FRAME,
      ["home_kitchen"],
      "sofas",
    );
    expect("error" in frame).toBe(false);
    if ("error" in frame) return;
    expect(resolveAgentRetrievePlan(frame).dontDeal).toBe(true);
    expect(resolveAgentRetrievePlan(frame).industryIds).toEqual([]);
  });
});

describe("agent phase + persist", () => {
  it("intro once, then ask, then grid", () => {
    expect(
      resolveAgentBoardPhase({
        agentUi: true,
        introSeen: false,
        frame: EMPTY_AGENT_FRAME,
      }),
    ).toBe("intro");
    expect(
      resolveAgentBoardPhase({
        agentUi: true,
        introSeen: true,
        frame: EMPTY_AGENT_FRAME,
      }),
    ).toBe("ask");
    const done = {
      ...EMPTY_AGENT_FRAME,
      askStep: 4,
      industryIds: ["home_kitchen"] as AgentFrame["industryIds"],
    };
    expect(
      resolveAgentBoardPhase({
        agentUi: true,
        introSeen: true,
        frame: done,
      }),
    ).toBe("grid");
    expect(
      resolveAgentBoardPhase({
        agentUi: false,
        introSeen: false,
        frame: EMPTY_AGENT_FRAME,
      }),
    ).toBe("grid");
  });

  it("round-trips session JSON; empty raw is a fresh frame (Refresh)", () => {
    const saved = applySellAnswer(
      EMPTY_AGENT_FRAME,
      ["home_kitchen"],
      "paintings",
    );
    expect("error" in saved).toBe(false);
    if ("error" in saved) return;
    const raw = serializeAgentFrame(saved);
    expect(parseAgentFrame(raw).industryIds).toEqual(["home_kitchen"]);
    expect(parseAgentFrame(raw).otherText).toBe("paintings");
    expect(parseAgentFrame(null)).toEqual(EMPTY_AGENT_FRAME);
    expect(parseAgentFrame(undefined).askStep).toBe(0);
  });

  it("rejects an empty sell answer", () => {
    expect(applySellAnswer(EMPTY_AGENT_FRAME, [], "  ")).toEqual({
      error: "empty_sell",
    });
  });

  it("why pending is its own phase; narrowing forbids skip", () => {
    const pending = { ...EMPTY_AGENT_FRAME, askStep: 4, whyPending: true };
    expect(
      resolveAgentBoardPhase({
        agentUi: true,
        introSeen: true,
        frame: pending,
      }),
    ).toBe("why");
    const narrowing = { ...EMPTY_AGENT_FRAME, narrowing: true, askStep: 1 };
    expect(applySkipRefuseAnswer(narrowing, "skipped")).toEqual({
      error: "skip_not_allowed",
    });
    expect(applySkipRefuseAnswer(EMPTY_AGENT_FRAME, "skipped")).toMatchObject({
      skipRefuse: "skipped",
      askStep: 2,
    });
    expect(applyDifferAnswer(EMPTY_AGENT_FRAME, "skipped")).toEqual({
      error: "skip_not_allowed",
    });
    expect(applyDifferAnswer(EMPTY_AGENT_FRAME, "bundle")).toMatchObject({
      differ: "bundle",
      askStep: 4,
    });
  });
});
