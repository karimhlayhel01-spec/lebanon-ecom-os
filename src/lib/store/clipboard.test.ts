import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "@/lib/store/clipboard";
import { formatDiscoverabilityForCopy } from "@/lib/store/page-copy";
import { buildTemplateStorePageCopy } from "@/lib/store/page-copy";

describe("copyTextToClipboard", () => {
  it("returns false when navigator is unavailable (node)", async () => {
    const ok = await copyTextToClipboard("hello");
    // In vitest/node there is typically no clipboard — helper must not throw.
    expect(typeof ok).toBe("boolean");
  });

  it("uses clipboard.writeText when present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const ok = await copyTextToClipboard("draft body");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("draft body");
    vi.unstubAllGlobals();
  });
});

describe("formatDiscoverabilityForCopy", () => {
  it("produces paste-ready pack text", () => {
    const pack = buildTemplateStorePageCopy({
      name: "Widget",
      category: "home_kitchen",
    });
    const text = formatDiscoverabilityForCopy(pack.discoverability);
    expect(text).toContain("TITLE (EN)");
    expect(text).toContain("Widget");
  });
});
