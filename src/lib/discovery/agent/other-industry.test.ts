import { describe, expect, it } from "vitest";
import {
  classifyOtherIndustry,
  isOtherDontDeal,
  resolveOtherRetrieveIndustry,
} from "@/lib/discovery/agent/other-industry";

describe("classifyOtherIndustry", () => {
  it("maps paintings / canvas / diamond kits to home_kitchen", () => {
    expect(classifyOtherIndustry("paintings")).toEqual({
      kind: "industry",
      id: "home_kitchen",
    });
    expect(classifyOtherIndustry("Diamond painting kit")).toEqual({
      kind: "industry",
      id: "home_kitchen",
    });
  });

  it("classifies used cars / bakery / sofas as none", () => {
    expect(classifyOtherIndustry("used cars")).toEqual({ kind: "none" });
    expect(classifyOtherIndustry("a bakery")).toEqual({ kind: "none" });
    expect(classifyOtherIndustry("sofas")).toEqual({ kind: "none" });
    expect(classifyOtherIndustry("renting apartments")).toEqual({
      kind: "none",
    });
  });

  it("leaves garlic gadgets unmapped (rank hint with chips)", () => {
    expect(classifyOtherIndustry("silicone garlic roller")).toEqual({
      kind: "unmapped",
    });
  });
});

describe("isOtherDontDeal / resolveOtherRetrieveIndustry", () => {
  it("paintings retrieve home_kitchen even with no chips", () => {
    expect(resolveOtherRetrieveIndustry("paintings", [])).toBe("home_kitchen");
    expect(isOtherDontDeal("paintings", [])).toBe(false);
  });

  it("bakery with no chips is don’t-deal", () => {
    expect(resolveOtherRetrieveIndustry("bakery", [])).toBeNull();
    expect(isOtherDontDeal("bakery", [])).toBe(true);
  });

  it("unmapped Other with home_kitchen chip is not don’t-deal", () => {
    expect(isOtherDontDeal("silicone garlic roller", ["home_kitchen"])).toBe(
      false,
    );
    expect(
      resolveOtherRetrieveIndustry("silicone garlic roller", ["home_kitchen"]),
    ).toBeNull();
  });

  it("unmapped Other alone is don’t-deal", () => {
    expect(isOtherDontDeal("quantum consulting", [])).toBe(true);
  });
});
