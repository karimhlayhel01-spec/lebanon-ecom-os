import { describe, expect, it } from "vitest";
import {
  defaultWorkspaceName,
  fullDisplayName,
  isAutoDefaultWorkspaceName,
  resolveWorkspaceNameLocale,
} from "@/lib/workspace-name";

describe("defaultWorkspaceName", () => {
  it("builds the English possessive store title", () => {
    expect(defaultWorkspaceName({ firstName: "Karim", locale: "en" })).toBe(
      "Karim's Store",
    );
  });

  it("builds the Arabic store title", () => {
    expect(defaultWorkspaceName({ firstName: "كريم", locale: "ar" })).toBe(
      "متجر كريم",
    );
  });

  it("trims firstName before formatting", () => {
    expect(defaultWorkspaceName({ firstName: "  Nora  ", locale: "en" })).toBe(
      "Nora's Store",
    );
  });

  it("falls back when firstName is empty", () => {
    expect(defaultWorkspaceName({ firstName: "   ", locale: "en" })).toBe(
      "My Store",
    );
    expect(defaultWorkspaceName({ firstName: "", locale: "ar" })).toBe("متجري");
  });
});

describe("isAutoDefaultWorkspaceName", () => {
  it("matches EN/AR auto-defaults and legacy hard-coded titles", () => {
    expect(isAutoDefaultWorkspaceName("Karim's Store", "Karim")).toBe(true);
    expect(isAutoDefaultWorkspaceName("متجر Karim", "Karim")).toBe(true);
    expect(isAutoDefaultWorkspaceName("My Store", "Karim")).toBe(true);
    expect(isAutoDefaultWorkspaceName("Preview Store", "Preview")).toBe(true);
  });

  it("does not match a customized name", () => {
    expect(isAutoDefaultWorkspaceName("Cedar Co", "Karim")).toBe(false);
  });
});

describe("resolveWorkspaceNameLocale / fullDisplayName", () => {
  it("resolves language with fallback for both", () => {
    expect(resolveWorkspaceNameLocale("ar")).toBe("ar");
    expect(resolveWorkspaceNameLocale("en")).toBe("en");
    expect(resolveWorkspaceNameLocale("both", "ar")).toBe("ar");
  });

  it("joins first and last name", () => {
    expect(fullDisplayName("Karim", "Hlayhel")).toBe("Karim Hlayhel");
  });
});
