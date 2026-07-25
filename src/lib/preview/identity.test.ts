import { describe, expect, it } from "vitest";
import {
  defaultPreviewIdentity,
  resolvePreviewIdentity,
} from "@/lib/preview/identity";

describe("resolvePreviewIdentity", () => {
  it("uses Preview defaults on first seed", () => {
    expect(resolvePreviewIdentity(null)).toEqual(defaultPreviewIdentity());
    expect(defaultPreviewIdentity().workspaceName).toBe("Preview's Store");
  });

  it("keeps a renamed store and custom names across re-seeds", () => {
    expect(
      resolvePreviewIdentity({
        firstName: "Karim",
        lastName: "Demo",
        workspaceName: "Demo Shop",
        language: "ar",
        uiLanguage: "ar",
      }),
    ).toEqual({
      firstName: "Karim",
      lastName: "Demo",
      workspaceName: "Demo Shop",
      language: "ar",
      uiLanguage: "ar",
    });
  });
});
