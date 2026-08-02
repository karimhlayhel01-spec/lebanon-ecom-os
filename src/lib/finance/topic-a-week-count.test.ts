import { describe, expect, it } from "vitest";
import { topicAWeekCountFromRowCount } from "@/lib/finance/topic-a-week-count";

describe("topicAWeekCountFromRowCount", () => {
  it("mirrors COUNT(topic_a_entries) — not stale mirror + 1", () => {
    // Stale side.topicAWeekCount=5 with only 3 real rows must become 3, not 6.
    expect(topicAWeekCountFromRowCount(3)).toBe(3);
    expect(topicAWeekCountFromRowCount(0)).toBe(0);
    expect(topicAWeekCountFromRowCount(12)).toBe(12);
  });

  it("floors and clamps non-finite / negative", () => {
    expect(topicAWeekCountFromRowCount(2.9)).toBe(2);
    expect(topicAWeekCountFromRowCount(-1)).toBe(0);
    expect(topicAWeekCountFromRowCount(Number.NaN)).toBe(0);
  });

  it("after N successful week inserts, mirror equals N (SoT contract)", () => {
    // Simulates post-insert COUNT inside the same transaction.
    const rowsAfterSaves = [1, 2, 3];
    for (const n of rowsAfterSaves) {
      expect(topicAWeekCountFromRowCount(n)).toBe(n);
    }
  });
});
