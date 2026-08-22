import { afterEach, describe, expect, it } from "vitest";
import {
  extractUnitPriceUsd,
  lbpToUsd,
  resolveUsdLbpRate,
} from "@/lib/supplier/live/unit-price";

afterEach(() => {
  delete process.env.USD_LBP_RATE;
});

describe("extractUnitPriceUsd", () => {
  it("parses USD shop prices", () => {
    expect(extractUnitPriceUsd("$8.50 / piece")).toBe(8.5);
    expect(extractUnitPriceUsd("Unit price US$ 1.85 / piece")).toBe(1.85);
    expect(extractUnitPriceUsd("USD 12.00 per unit")).toBe(12);
  });

  it("converts LBP when USD_LBP_RATE is set (LBP per 1 USD)", () => {
    expect(extractUnitPriceUsd("LBP 300000", 89500)).toBeCloseTo(3.35, 2);
    expect(extractUnitPriceUsd("ل.ل 89500", 89500)).toBe(1);
    expect(lbpToUsd(300000, 89500)).toBeCloseTo(3.35, 2);
  });

  it("does not write LBP digits as dollars when the rate is missing or invalid", () => {
    expect(extractUnitPriceUsd("LBP 300000", null)).toBeNull();
    expect(extractUnitPriceUsd("LBP 300000")).toBeNull();
    expect(resolveUsdLbpRate({})).toBeNull();
    expect(resolveUsdLbpRate({ USD_LBP_RATE: "" })).toBeNull();
    expect(resolveUsdLbpRate({ USD_LBP_RATE: "0" })).toBeNull();
    expect(resolveUsdLbpRate({ USD_LBP_RATE: "-1" })).toBeNull();
    expect(lbpToUsd(300000, null)).toBeNull();
  });

  it("prefers USD when both currencies appear", () => {
    expect(
      extractUnitPriceUsd("US$ 8.50 / piece · LBP 300000", 89500),
    ).toBe(8.5);
  });

  it("takes the listing range low ($320-340 → 320), not coupon chrome", () => {
    expect(extractUnitPriceUsd("$320-340")).toBe(320);
    expect(extractUnitPriceUsd("$320–340")).toBe(320);
    expect(extractUnitPriceUsd("US$ 320-340 / pair")).toBe(320);
    expect(extractUnitPriceUsd("US$ 320")).toBe(320);
    const coupon = extractUnitPriceUsd("$5 off $300");
    expect(coupon).not.toBe(5);
    expect(coupon).not.toBe(300);
    expect(coupon).toBeNull();
    expect(extractUnitPriceUsd("$5 off $300 · RingConn $320-340")).toBe(320);
  });
});
