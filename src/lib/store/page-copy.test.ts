import { describe, expect, it } from "vitest";
import {
  buildTemplateStorePageCopy,
  formatDiscoverabilityForCopy,
  parseDiscoverabilityPack,
  serializeDiscoverabilityPack,
  validateStorePageCopyPayload,
} from "@/lib/store/page-copy";
import { improveStorePageCopyWithGemini } from "@/lib/store/page-copy-llm";

describe("buildTemplateStorePageCopy", () => {
  it("includes product name and discoverability fields", () => {
    const pack = buildTemplateStorePageCopy({
      name: "Silicone Spatula Set",
      category: "home_kitchen",
      differentiation: "Heat-safe bundle.",
    });
    expect(pack.source).toBe("template");
    expect(pack.contentDraftEn).toContain("Silicone Spatula Set");
    expect(pack.contentDraftAr).toContain("Silicone Spatula Set");
    expect(pack.discoverability.faqs.length).toBeGreaterThanOrEqual(2);
    expect(pack.discoverability.attractivenessTipsEn.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(pack.policiesDraft.toLowerCase()).toMatch(/shipping|return/);
  });

  it("serializes and parses round-trip", () => {
    const pack = buildTemplateStorePageCopy({
      name: "Desk Organizer",
      category: "office_desk_gadgets",
    });
    const raw = serializeDiscoverabilityPack(
      pack.discoverability,
      pack.source,
    );
    const parsed = parseDiscoverabilityPack(raw);
    expect(parsed?.titleEn).toBe(pack.discoverability.titleEn);
    expect(formatDiscoverabilityForCopy(pack.discoverability)).toContain(
      "TITLE (EN)",
    );
  });
});

describe("validateStorePageCopyPayload", () => {
  function good(name: string) {
    const t = buildTemplateStorePageCopy({
      name,
      category: "home_kitchen",
    });
    return {
      contentDraftEn: t.contentDraftEn,
      contentDraftAr: t.contentDraftAr,
      policiesDraft: t.policiesDraft,
      discoverability: t.discoverability,
    };
  }

  it("accepts template-shaped payload", () => {
    const r = validateStorePageCopyPayload(
      good("Widget Pro"),
      "Widget Pro",
      "gemini",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects ranking promises", () => {
    const base = good("Widget Pro");
    base.discoverability.attractivenessTipsEn = [
      "This will rank #1 on Google guaranteed.",
      "Another tip about photos.",
    ];
    const r = validateStorePageCopyPayload(base, "Widget Pro", "gemini");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("ranking_promise");
  });

  it("rejects COD-as-wow pitch", () => {
    const base = good("Widget Pro");
    base.contentDraftEn =
      `${base.contentDraftEn}\n\nOur unique COD selling point is the wow differentiator for Widget Pro buyers.`;
    const r = validateStorePageCopyPayload(base, "Widget Pro", "gemini");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("cod_wow");
  });

  it("rejects missing product name", () => {
    const base = good("Widget Pro");
    base.contentDraftEn = "A".repeat(100);
    base.discoverability = {
      ...base.discoverability,
      titleEn: "Generic title without the product",
    };
    const r = validateStorePageCopyPayload(base, "Widget Pro", "gemini");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_product_name");
  });
});

describe("improveStorePageCopyWithGemini fail-closed", () => {
  it("returns missing_key without env", async () => {
    const r = await improveStorePageCopyWithGemini(
      { name: "Test", category: "home_kitchen" },
      { env: {} },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_key");
  });
});
