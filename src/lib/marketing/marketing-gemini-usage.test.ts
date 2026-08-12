import { describe, expect, it } from "vitest";
import { MARKETING_GEMINI_MONTHLY_CAP_DEFAULT } from "@/lib/constants";
import {
  canSpendMarketingGeminiCall,
  currentMonthKey,
  remainingMarketingGeminiAllowance,
  resolveMarketingGeminiMonthlyCap,
} from "@/lib/marketing/marketing-gemini-usage";

describe("marketing Gemini monthly ledger helpers (pure)", () => {
  it("buckets by UTC month", () => {
    expect(currentMonthKey(new Date("2026-08-12T15:00:00Z"))).toBe("2026-08");
    expect(currentMonthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("falls back to the safe default for missing or nonsense caps", () => {
    expect(resolveMarketingGeminiMonthlyCap({})).toBe(
      MARKETING_GEMINI_MONTHLY_CAP_DEFAULT,
    );
    expect(
      resolveMarketingGeminiMonthlyCap({ MARKETING_GEMINI_MONTHLY_CAP: "" }),
    ).toBe(MARKETING_GEMINI_MONTHLY_CAP_DEFAULT);
    expect(
      resolveMarketingGeminiMonthlyCap({
        MARKETING_GEMINI_MONTHLY_CAP: "unlimited",
      }),
    ).toBe(MARKETING_GEMINI_MONTHLY_CAP_DEFAULT);
    expect(
      resolveMarketingGeminiMonthlyCap({ MARKETING_GEMINI_MONTHLY_CAP: "-3" }),
    ).toBe(MARKETING_GEMINI_MONTHLY_CAP_DEFAULT);
    expect(
      resolveMarketingGeminiMonthlyCap({ MARKETING_GEMINI_MONTHLY_CAP: "80" }),
    ).toBe(80);
    expect(
      resolveMarketingGeminiMonthlyCap({ MARKETING_GEMINI_MONTHLY_CAP: "0" }),
    ).toBe(0);
  });

  it("never reports a negative remaining allowance", () => {
    expect(remainingMarketingGeminiAllowance(40, 10)).toBe(30);
    expect(remainingMarketingGeminiAllowance(40, 40)).toBe(0);
    expect(remainingMarketingGeminiAllowance(40, 55)).toBe(0);
  });

  it("gates spend at the cap (fail-closed)", () => {
    expect(canSpendMarketingGeminiCall(40, 0)).toBe(true);
    expect(canSpendMarketingGeminiCall(40, 39)).toBe(true);
    expect(canSpendMarketingGeminiCall(40, 40)).toBe(false);
    expect(canSpendMarketingGeminiCall(0, 0)).toBe(false);
  });

  it("documents increment semantics: used+1 reduces remaining by 1", () => {
    const cap = 40;
    let used = 0;
    expect(canSpendMarketingGeminiCall(cap, used)).toBe(true);
    used += 1; // successful Intro / creatives Gemini call
    expect(remainingMarketingGeminiAllowance(cap, used)).toBe(39);
    used = cap;
    expect(canSpendMarketingGeminiCall(cap, used)).toBe(false);
  });
});
