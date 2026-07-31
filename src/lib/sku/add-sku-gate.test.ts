import { describe, expect, it } from "vitest";
import {
  ADD_SKU_HEALTHY_WEEKS_MIN,
  ADD_SKU_LAST_HEALTHY_STREAK,
  evaluateAddSkuGate,
  resolvePostLoginLanding,
  shouldRequireExperiencedSeriousnessAck,
  shouldShowAddSkuDiscovery,
  shouldShowShopHub,
  shopTopicABarMet,
  type WeekVerdict,
} from "@/lib/sku/add-sku-gate";

function healthy(n: number): WeekVerdict[] {
  return Array.from({ length: n }, () => "healthy" as const);
}

describe("shopTopicABarMet", () => {
  it("requires ≥15 healthy weeks and last 5 all healthy", () => {
    expect(shopTopicABarMet(healthy(14))).toBe(false);
    expect(shopTopicABarMet(healthy(15))).toBe(true);
    expect(
      shopTopicABarMet([
        ...healthy(14),
        "watch",
        ...healthy(4),
      ]),
    ).toBe(false);
    // 10 healthy + watch + risk + 5 healthy = 17 weeks, 15 healthy, last 5 healthy → met
    expect(
      shopTopicABarMet([...healthy(10), "watch", "risk", ...healthy(5)]),
    ).toBe(true);
  });

  it("rejects when last streak broken even with enough healthy total", () => {
    const weeks = [...healthy(20)];
    weeks[weeks.length - 1] = "watch";
    expect(shopTopicABarMet(weeks)).toBe(false);
  });
});

describe("evaluateAddSkuGate", () => {
  it("allows first SKU always", () => {
    expect(
      evaluateAddSkuGate({
        experience: "beginner",
        liveSkuCount: 0,
        weekVerdicts: [],
      }),
    ).toEqual({ ok: true });
  });

  it("hard-blocks beginners before the bar", () => {
    expect(
      evaluateAddSkuGate({
        experience: "beginner",
        liveSkuCount: 1,
        weekVerdicts: healthy(10),
      }),
    ).toEqual({ ok: false, error: "beginner_blocked" });
  });

  it("allows beginners once bar is met", () => {
    expect(
      evaluateAddSkuGate({
        experience: "beginner",
        liveSkuCount: 1,
        weekVerdicts: healthy(ADD_SKU_HEALTHY_WEEKS_MIN),
      }),
    ).toEqual({ ok: true });
  });

  it("warns 'some' experience on early add; silent when bar met", () => {
    expect(
      evaluateAddSkuGate({
        experience: "some",
        liveSkuCount: 1,
        weekVerdicts: healthy(3),
      }),
    ).toEqual({ ok: true, warning: "early_add" });

    expect(
      evaluateAddSkuGate({
        experience: "some",
        liveSkuCount: 1,
        weekVerdicts: healthy(15),
      }),
    ).toEqual({ ok: true });
  });

  it("allows experienced anytime after first SKU", () => {
    expect(
      evaluateAddSkuGate({
        experience: "experienced",
        liveSkuCount: 1,
        weekVerdicts: [],
      }),
    ).toEqual({ ok: true });
  });

  it("soft-warns on SKU #3+ when previous SKU looks weak", () => {
    expect(
      evaluateAddSkuGate({
        experience: "experienced",
        liveSkuCount: 2,
        weekVerdicts: healthy(15),
        previousSkuWeak: true,
      }),
    ).toEqual({ ok: true, warning: "watch_previous_sku" });

    expect(
      evaluateAddSkuGate({
        experience: "some",
        liveSkuCount: 2,
        weekVerdicts: healthy(2),
        previousSkuWeak: true,
      }),
    ).toEqual({ ok: true, warning: "both" });
  });
});

describe("resolvePostLoginLanding", () => {
  it("lands hub / single SKU / hub for 0 / 1 / 2+", () => {
    expect(resolvePostLoginLanding([])).toEqual({ kind: "hub" });
    expect(resolvePostLoginLanding([{ id: "a" }])).toEqual({
      kind: "sku",
      skuId: "a",
    });
    expect(resolvePostLoginLanding([{ id: "a" }, { id: "b" }])).toEqual({
      kind: "hub",
    });
  });
});

describe("shouldShowShopHub", () => {
  it("forceHub shows hub even with 1 live SKU", () => {
    expect(shouldShowShopHub({ liveSkuCount: 1, forceHub: true })).toBe(true);
    expect(shouldShowShopHub({ liveSkuCount: 1, forceHub: false })).toBe(false);
    expect(shouldShowShopHub({ liveSkuCount: 0, forceHub: false })).toBe(true);
    expect(shouldShowShopHub({ liveSkuCount: 2, forceHub: false })).toBe(true);
  });
});

describe("shouldShowAddSkuDiscovery", () => {
  it("only after addSku flag when live SKUs exist", () => {
    expect(
      shouldShowAddSkuDiscovery({ liveSkuCount: 1, addSkuFlag: false }),
    ).toBe(false);
    expect(
      shouldShowAddSkuDiscovery({ liveSkuCount: 1, addSkuFlag: true }),
    ).toBe(true);
    expect(
      shouldShowAddSkuDiscovery({ liveSkuCount: 0, addSkuFlag: true }),
    ).toBe(false);
  });
});

describe("shouldRequireExperiencedSeriousnessAck", () => {
  it("only when experience was raised to experienced", () => {
    expect(shouldRequireExperiencedSeriousnessAck(false)).toBe(false);
    expect(shouldRequireExperiencedSeriousnessAck(true)).toBe(true);
  });
});

describe("constants", () => {
  it("locks bar thresholds", () => {
    expect(ADD_SKU_HEALTHY_WEEKS_MIN).toBe(15);
    expect(ADD_SKU_LAST_HEALTHY_STREAK).toBe(5);
  });
});

