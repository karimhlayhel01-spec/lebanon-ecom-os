import { describe, expect, it } from "vitest";
import { evaluateOnboardingGate } from "@/lib/onboarding-gate";

describe("evaluateOnboardingGate", () => {
  it("allows when onboardingComplete is true", () => {
    expect(evaluateOnboardingGate({ onboardingComplete: true })).toEqual({
      ok: true,
    });
  });

  it("rejects incomplete or missing side (mutating actions must stop)", () => {
    expect(evaluateOnboardingGate({ onboardingComplete: false })).toEqual({
      ok: false,
      error: "onboarding_required",
    });
    expect(evaluateOnboardingGate(null)).toEqual({
      ok: false,
      error: "onboarding_required",
    });
    expect(evaluateOnboardingGate(undefined)).toEqual({
      ok: false,
      error: "onboarding_required",
    });
  });
});
