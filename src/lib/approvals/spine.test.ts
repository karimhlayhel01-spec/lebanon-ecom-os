import { describe, expect, it } from "vitest";
import { isAtOrPastOnSpine } from "@/lib/approvals/spine";

describe("isAtOrPastOnSpine", () => {
  it("treats selling as past sample_approved (warm backup)", () => {
    expect(isAtOrPastOnSpine("selling", "sample_approved")).toBe(true);
    expect(isAtOrPastOnSpine("batch_ordered", "sample_approved")).toBe(true);
    expect(isAtOrPastOnSpine("supplier_sample", "sample_approved")).toBe(false);
    expect(isAtOrPastOnSpine("sample_approved", "sample_approved")).toBe(true);
  });
});
