import { describe, expect, it } from "vitest";
import { MIN_BUDGET_USD, COURIERS_TBD, CLEARANCE_PARTNER_TBD } from "@/lib/constants";

describe("M0 smoke", () => {
  it("enforces minimum budget constant", () => {
    expect(MIN_BUDGET_USD).toBe(2000);
  });

  it("seeds delivery-company options and clearance placeholder", () => {
    expect(COURIERS_TBD).toHaveLength(5);
    expect(COURIERS_TBD).toContain("confirm_later");
    expect(CLEARANCE_PARTNER_TBD).toContain("TBD");
  });
});
