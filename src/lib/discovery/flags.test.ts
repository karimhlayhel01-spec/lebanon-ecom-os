import { afterEach, describe, expect, it } from "vitest";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
  isSoftCompetitionBudgetEnabled,
} from "@/lib/discovery/flags";

const KEYS = [
  "DISCOVERY_POOL_V2",
  "DISCOVERY_LIVE_SEARCH",
  "DISCOVERY_SOFT_COMPETITION_BUDGET",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("discovery feature flags", () => {
  it("defaults pool and live search off", () => {
    expect(isDiscoveryPoolV2Enabled()).toBe(false);
    expect(isDiscoveryLiveSearchEnabled()).toBe(false);
  });

  it("enables pool / live search on 1|true", () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "true";
    expect(isDiscoveryPoolV2Enabled()).toBe(true);
    expect(isDiscoveryLiveSearchEnabled()).toBe(true);
  });

  it("defaults soft competition×budget on (WAVE-2 safe)", () => {
    expect(isSoftCompetitionBudgetEnabled()).toBe(true);
    process.env.DISCOVERY_SOFT_COMPETITION_BUDGET = "1";
    expect(isSoftCompetitionBudgetEnabled()).toBe(true);
  });

  it("allows hard mode only when soft flag is explicitly 0|false", () => {
    process.env.DISCOVERY_SOFT_COMPETITION_BUDGET = "0";
    expect(isSoftCompetitionBudgetEnabled()).toBe(false);
    process.env.DISCOVERY_SOFT_COMPETITION_BUDGET = "false";
    expect(isSoftCompetitionBudgetEnabled()).toBe(false);
  });
});
