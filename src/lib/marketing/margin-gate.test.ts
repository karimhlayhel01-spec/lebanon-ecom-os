import { describe, expect, it } from "vitest";
import {
  classifyPaidMarketingMargins,
  isPaidMarketingStage,
  needsMarginAckForPaidUi,
  resolveSkuPlanningMargins,
} from "@/lib/marketing/margin-gate";
import { computeMargin } from "@/lib/skills/margin";
import type {
  MoneySnapshotSection,
  QuotedCostsSection,
} from "@/lib/sku/service";

const failSnap: MoneySnapshotSection = {
  sellPrice: 40,
  landedCost: 10,
  marginBefore: 0.5,
  marginAfter: 0.2,
  productCost: 5,
  intlShip: 2,
  clearanceTaxes: 1,
  localCourier: 2,
};

describe("isPaidMarketingStage", () => {
  it("marks pre_launch / launch / weekly_refresh only", () => {
    expect(isPaidMarketingStage("intro_pdf")).toBe(false);
    expect(isPaidMarketingStage("pre_launch")).toBe(true);
    expect(isPaidMarketingStage("launch")).toBe(true);
    expect(isPaidMarketingStage("weekly_refresh")).toBe(true);
  });
});

describe("classifyPaidMarketingMargins (coaching only — never blocks generate)", () => {
  it("pass when both bars met", () => {
    expect(
      classifyPaidMarketingMargins({
        stage: "pre_launch",
        marginBefore: 0.8,
        marginAfter: 0.4,
      }),
    ).toBe("pass");
  });

  it("fail when below bars (informational — generate still allowed)", () => {
    expect(
      classifyPaidMarketingMargins({
        stage: "launch",
        marginBefore: 0.5,
        marginAfter: 0.2,
      }),
    ).toBe("fail");
  });

  it("intro stage always skip even when margins fail", () => {
    expect(
      classifyPaidMarketingMargins({
        stage: "intro_pdf",
        marginBefore: 0.1,
        marginAfter: 0.05,
      }),
    ).toBe("skip");
  });

  it("unknown when numbers missing", () => {
    expect(
      classifyPaidMarketingMargins({
        stage: "launch",
        marginBefore: null,
        marginAfter: 0.4,
      }),
    ).toBe("unknown");
  });
});

describe("needsMarginAckForPaidUi (fail note flag)", () => {
  it("true only when both numbers known and below bars", () => {
    expect(
      needsMarginAckForPaidUi({ marginBefore: 0.8, marginAfter: 0.4 }),
    ).toBe(false);
    expect(
      needsMarginAckForPaidUi({ marginBefore: 0.5, marginAfter: 0.2 }),
    ).toBe(true);
    expect(
      needsMarginAckForPaidUi({ marginBefore: null, marginAfter: 0.2 }),
    ).toBe(false);
  });
});

describe("resolveSkuPlanningMargins", () => {
  it("uses moneySnapshot when no quotes", () => {
    expect(
      resolveSkuPlanningMargins({
        quotedCosts: null,
        moneySnapshot: failSnap,
        monthlyFollowOnBudget: 300,
      }),
    ).toEqual({ before: 0.5, after: 0.2 });
  });

  it("recomputes from quotes via Margin skill when saved", () => {
    const quoted: QuotedCostsSection = {
      productCost: 5,
      intlShip: 2,
      clearanceTaxes: 1,
      localCourier: 2,
      sellPrice: 40,
      landedCost: 10,
      expectedMarginBefore: 0.75,
      savedAt: "2026-01-01",
      source: "import",
    };
    const resolved = resolveSkuPlanningMargins({
      quotedCosts: quoted,
      moneySnapshot: failSnap,
      monthlyFollowOnBudget: 300,
    });
    const expected = computeMargin({
      sellPrice: 40,
      productCost: 5,
      intlShip: 2,
      clearanceTaxes: 1,
      localCourier: 2,
      monthlyFollowOnBudget: 300,
    });
    expect(resolved.before).toBeCloseTo(expected.marginBefore, 10);
    expect(resolved.after).toBeCloseTo(expected.marginAfter, 10);
    expect(resolved.before).not.toBe(failSnap.marginBefore);
  });
});
