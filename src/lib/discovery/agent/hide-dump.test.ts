import { describe, expect, it } from "vitest";
import { COMPETITION_HIGH_MIN } from "@/lib/discovery/scoring/constants";
import { isDiscoveryDumpHidden } from "@/lib/discovery/agent/hide-dump";

describe("isDiscoveryDumpHidden", () => {
  it("hides high competition with Ishtari/EGLOW/Platza", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: COMPETITION_HIGH_MIN,
        tier1Names: ["Ishtari"],
      }),
    ).toBe(true);
    expect(
      isDiscoveryDumpHidden({
        competition: 0.9,
        tier1Names: ["eglow.store"],
      }),
    ).toBe(true);
  });

  it("does not hide high competition with no Tier-1 names", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: 0.99,
        tier1Names: [],
      }),
    ).toBe(false);
  });

  it("does not hide medium/low competition even with Ishtari", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: COMPETITION_HIGH_MIN - 0.01,
        tier1Names: ["Ishtari"],
      }),
    ).toBe(false);
  });

  it("does not hide when scores are missing", () => {
    expect(
      isDiscoveryDumpHidden({ competition: null, tier1Names: ["Ishtari"] }),
    ).toBe(false);
    expect(
      isDiscoveryDumpHidden({ competition: undefined, tier1Names: ["Platza"] }),
    ).toBe(false);
  });
});
