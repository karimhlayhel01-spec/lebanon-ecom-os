import { describe, expect, it } from "vitest";
import { computeShowMoreRemaining } from "@/lib/discovery/show-more";

describe("computeShowMoreRemaining", () => {
  it("counts batches left until a full 25-product cap", () => {
    expect(computeShowMoreRemaining(5, 25)).toBe(4);
    expect(computeShowMoreRemaining(10, 25)).toBe(3);
    expect(computeShowMoreRemaining(15, 25)).toBe(2);
    expect(computeShowMoreRemaining(20, 25)).toBe(1);
    expect(computeShowMoreRemaining(25, 25)).toBe(0);
  });

  it("handles a non-full pool cap", () => {
    // 5 shown, 13 left → ceil(13/5) = 3 clicks (10, 15, 18)
    expect(computeShowMoreRemaining(5, 18)).toBe(3);
    expect(computeShowMoreRemaining(10, 18)).toBe(2);
    expect(computeShowMoreRemaining(15, 18)).toBe(1);
    expect(computeShowMoreRemaining(18, 18)).toBe(0);
  });

  it("returns 0 when already at or past cap", () => {
    expect(computeShowMoreRemaining(30, 25)).toBe(0);
    expect(computeShowMoreRemaining(0, 0)).toBe(0);
  });
});
