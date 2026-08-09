import { describe, expect, it } from "vitest";
import { DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT } from "@/lib/constants";
import {
  allowanceForBatch,
  currentMonthKey,
  remainingMonthlyAllowance,
  resolveMonthlySearchQueryCap,
} from "@/lib/discovery/search-usage";

describe("monthly search ledger helpers (pure)", () => {
  it("buckets by UTC month so a cron never straddles two buckets", () => {
    expect(currentMonthKey(new Date("2026-08-07T11:00:00Z"))).toBe("2026-08");
    expect(currentMonthKey(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01");
    // 02:00 in Beirut on the 1st is still the previous UTC day, same month here.
    expect(currentMonthKey(new Date("2026-12-31T23:00:00Z"))).toBe("2026-12");
  });

  it("falls back to the safe default for missing or nonsense caps", () => {
    expect(resolveMonthlySearchQueryCap({})).toBe(
      DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT,
    );
    expect(
      resolveMonthlySearchQueryCap({ DISCOVERY_SEARCH_MONTHLY_QUERY_CAP: "" }),
    ).toBe(DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT);
    // "unlimited" must never be read as unlimited.
    expect(
      resolveMonthlySearchQueryCap({
        DISCOVERY_SEARCH_MONTHLY_QUERY_CAP: "unlimited",
      }),
    ).toBe(DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT);
    expect(
      resolveMonthlySearchQueryCap({ DISCOVERY_SEARCH_MONTHLY_QUERY_CAP: "-5" }),
    ).toBe(DISCOVERY_SEARCH_MONTHLY_QUERY_CAP_DEFAULT);
    expect(
      resolveMonthlySearchQueryCap({
        DISCOVERY_SEARCH_MONTHLY_QUERY_CAP: "2500",
      }),
    ).toBe(2500);
    // An explicit 0 is a valid "spend nothing" setting.
    expect(
      resolveMonthlySearchQueryCap({ DISCOVERY_SEARCH_MONTHLY_QUERY_CAP: "0" }),
    ).toBe(0);
  });

  it("never reports a negative allowance, even after an overspend", () => {
    expect(remainingMonthlyAllowance(100, 40)).toBe(60);
    expect(remainingMonthlyAllowance(100, 100)).toBe(0);
    expect(remainingMonthlyAllowance(100, 140)).toBe(0);
  });

  it("clamps a batch to whatever the month has left", () => {
    expect(allowanceForBatch({ cap: 100, used: 0, requested: 6 })).toBe(6);
    expect(allowanceForBatch({ cap: 100, used: 97, requested: 6 })).toBe(3);
    expect(allowanceForBatch({ cap: 100, used: 100, requested: 6 })).toBe(0);
    expect(allowanceForBatch({ cap: 100, used: 120, requested: 6 })).toBe(0);
  });
});
