import { describe, expect, it, afterEach, vi } from "vitest";
import {
  DISCOVERY_INITIAL_COUNT,
  DISCOVERY_SESSION_CAP,
  DISCOVERY_SHOW_MORE_MAX,
} from "@/lib/constants";
import { computeShowMoreRemaining } from "@/lib/discovery/show-more";
import {
  buildDemoScoredPool,
  padDemoScoredPool,
} from "@/lib/demo/seed-discovery";
import { isDemoWipeEmptyEnabled } from "@/lib/demo/config";
import type { schema } from "@/db";

type OnboardingRow = typeof schema.onboardingProfiles.$inferSelect;

function demoOnboarding(
  overrides: Partial<OnboardingRow> = {},
): OnboardingRow {
  return {
    id: "ob",
    workspaceId: "ws",
    budgetUsd: 3000,
    monthlyFollowOnBudget: 500,
    hoursPerWeek: 10,
    experience: "beginner",
    uiLanguage: "en",
    storageDescription: "closet",
    storageLimits: "",
    riskTolerance: "medium",
    categoryLikes: JSON.stringify(["home_kitchen"]),
    lebanonSellabilityAck: true,
    codComfort: "ok",
    shopifyStatus: "not_started",
    maxLandedCost: 25,
    deliveryBandDays: "7-10",
    sampleClearanceReady: false,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildDemoScoredPool", () => {
  it("yields a full invent/catalog session pool (≥25) for typical onboarding", () => {
    const scored = buildDemoScoredPool(demoOnboarding());
    expect(scored.length).toBe(DISCOVERY_SESSION_CAP);
    expect(scored.every((s) => s.margin.pass && !s.p.oversized)).toBe(true);
  });

  it("still fills the session cap when the saved maxLandedCost is tight", () => {
    const scored = buildDemoScoredPool(
      demoOnboarding({ maxLandedCost: 12, hoursPerWeek: 4 }),
    );
    expect(scored.length).toBe(DISCOVERY_SESSION_CAP);
  });
});

describe("padDemoScoredPool", () => {
  it("is a no-op when already at the target", () => {
    const scored = buildDemoScoredPool(demoOnboarding());
    expect(padDemoScoredPool(scored, DISCOVERY_SESSION_CAP)).toHaveLength(
      DISCOVERY_SESSION_CAP,
    );
  });

  it("pads a thin list up to the session cap", () => {
    const scored = buildDemoScoredPool(demoOnboarding()).slice(0, 3);
    const padded = padDemoScoredPool(scored, DISCOVERY_SESSION_CAP);
    expect(padded).toHaveLength(DISCOVERY_SESSION_CAP);
    expect(padded[0]?.p.key).toBe(scored[0]?.p.key);
  });
});

describe("demo restore reveal math", () => {
  it("matches 5 → 25 with DISCOVERY_SHOW_MORE_MAX clicks", () => {
    const productsShown = DISCOVERY_INITIAL_COUNT;
    const cap = DISCOVERY_SESSION_CAP;
    expect(computeShowMoreRemaining(productsShown, cap)).toBe(
      DISCOVERY_SHOW_MORE_MAX,
    );
    let shown = productsShown;
    let used = 0;
    while (
      shown < cap &&
      used < DISCOVERY_SHOW_MORE_MAX
    ) {
      shown = Math.min(cap, shown + DISCOVERY_INITIAL_COUNT);
      used += 1;
    }
    expect(shown).toBe(DISCOVERY_SESSION_CAP);
    expect(used).toBe(DISCOVERY_SHOW_MORE_MAX);
  });
});

describe("isDemoWipeEmptyEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off in production even when DEMO_RESET is allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_RESET", "1");
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", "1");
    expect(isDemoWipeEmptyEnabled()).toBe(false);
  });

  it("follows DEMO_RESET outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_RESET", "1");
    expect(isDemoWipeEmptyEnabled()).toBe(true);
    vi.stubEnv("DEMO_RESET", "0");
    expect(isDemoWipeEmptyEnabled()).toBe(false);
  });
});
