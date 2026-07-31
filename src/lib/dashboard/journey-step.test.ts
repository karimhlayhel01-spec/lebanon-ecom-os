import { describe, expect, it } from "vitest";
import { primaryStateToJourneyStep } from "@/lib/dashboard/journey-step";

describe("primaryStateToJourneyStep", () => {
  it("maps spine states to strip steps", () => {
    expect(primaryStateToJourneyStep("discovery")).toBe("discovery");
    expect(primaryStateToJourneyStep("supplier_sample")).toBe("accepted");
    expect(primaryStateToJourneyStep("sample_approved")).toBe("sample");
    expect(primaryStateToJourneyStep("store_setup")).toBe("sample");
    expect(primaryStateToJourneyStep("batch_ordered")).toBe("batch");
    expect(primaryStateToJourneyStep("batch_arrived_ready")).toBe("arrived");
    expect(primaryStateToJourneyStep("selling")).toBe("selling");
  });
});
