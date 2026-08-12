import { describe, expect, it, vi } from "vitest";
import { buildCreatives } from "@/lib/marketing/creatives";
import {
  createGeminiMarketingLlmProvider,
} from "@/lib/marketing/intro-llm";
import {
  routeCreativeVisualTool,
  suggestCreativeVisualTool,
  validateVisualSuggestion,
  visualPromptHasOsMeta,
} from "@/lib/marketing/visual-tool";
import { polishCreativeVisualSuggestionWithGemini } from "@/lib/marketing/visual-tool-llm";
import * as marketingGeminiUsage from "@/lib/marketing/marketing-gemini-usage";
const baseCreative = () =>
  buildCreatives({
    name: "GlowLamp Pro",
    category: "home_kitchen",
    hooks: ["warm desk light"],
    stage: "launch",
    capacityTier: 6,
    varianceSeed: 21,
  })[0]!;

describe("routeCreativeVisualTool", () => {
  it("maps formats to tools", () => {
    expect(routeCreativeVisualTool("post")).toBe("nano_banana");
    expect(routeCreativeVisualTool("carousel")).toBe("nano_banana");
    expect(routeCreativeVisualTool("reel")).toBe("seedance");
    expect(routeCreativeVisualTool("story")).toBe("seedance");
    expect(routeCreativeVisualTool("ugc")).toBe("seedance");
    expect(routeCreativeVisualTool("testimonial")).toBe("phone_film");
  });
});

describe("suggestCreativeVisualTool", () => {
  it("includes product name and hook in prompts", () => {
    const creative = {
      ...baseCreative(),
      format: "post",
      hookEn: "Open on GlowLamp Pro glow",
      hookAr: "افتح على توهج GlowLamp Pro",
      shots: [
        "Still 1 | Eye-level close-up of GlowLamp Pro — window light from the side.",
        "Still 2 | Mid shot desk scene — hold phone steady, product large in frame.",
        "Caption beat | Still frame while writing: benefit-led text — soft CTA, hold readable type.",
      ],
      howToShootEn:
        "Phone stills. Soft window light. Shoot frames in order. Keep product large.",
      howToShootAr:
        "صور ثابتة بالهاتف. ضوء نافذة ناعم. صوّر الإطارات بالترتيب. اجعل المنتج كبيراً.",
    };
    const s = suggestCreativeVisualTool({
      creative,
      productName: "GlowLamp Pro",
      stage: "launch",
    });
    expect(s.tool).toBe("nano_banana");
    expect(s.promptEn).toContain("GlowLamp Pro");
    expect(s.promptEn).toContain("Open on GlowLamp Pro glow");
    expect(s.promptEn).toMatch(/close-up|window light|hold phone/i);
    expect(s.promptEn).toMatch(/How to shoot:/i);
    expect(s.promptEn).toContain(creative.howToShootEn);
    expect(s.promptAr).toContain("GlowLamp Pro");
    expect(validateVisualSuggestion(s, "GlowLamp Pro")).toBe(true);
  });

  it("routes reel to Seedance and testimonial to phone film", () => {
    const reel = suggestCreativeVisualTool({
      creative: { ...baseCreative(), format: "reel" },
      productName: "GlowLamp Pro",
      stage: "pre_launch",
    });
    expect(reel.tool).toBe("seedance");
    expect(reel.promptEn.toLowerCase()).toMatch(/soft teaser|follow/);
    expect(reel.promptEn).toMatch(/phone|close-up|pan|hold|light/i);
    expect(reel.promptEn).toMatch(/How to shoot:/i);

    const testimonial = suggestCreativeVisualTool({
      creative: { ...baseCreative(), format: "testimonial" },
      productName: "GlowLamp Pro",
      stage: "weekly_refresh",
    });
    expect(testimonial.tool).toBe("phone_film");
    expect(testimonial.promptEn.toLowerCase()).toMatch(/phone/);
    expect(testimonial.promptEn).toMatch(/How to shoot:/i);
  });

  it("keeps paste-out free of OS / Topic A meta", () => {
    for (const format of ["post", "reel", "testimonial"] as const) {
      const s = suggestCreativeVisualTool({
        creative: { ...baseCreative(), format },
        productName: "GlowLamp Pro",
        stage: "launch",
      });
      for (const text of [s.whyEn, s.whyAr, s.promptEn, s.promptAr]) {
        expect(visualPromptHasOsMeta(text)).toBe(false);
        expect(text).not.toContain("Lebanon Ecom OS");
        expect(text).not.toContain("Topic A");
      }
    }
  });
});

describe("polishCreativeVisualSuggestion (provider)", () => {
  it("fails closed without Gemini key", async () => {
    const provider = createGeminiMarketingLlmProvider();
    const r = await provider.polishCreativeVisualSuggestion(
      {
        creative: baseCreative(),
        productName: "GlowLamp Pro",
        stage: "launch",
      },
      { env: {} },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_key");
  });

  it("returns monthly_cap when workspace allowance is exhausted", async () => {
    const spy = vi
      .spyOn(marketingGeminiUsage, "checkMarketingGeminiAllowance")
      .mockResolvedValue({ ok: false, error: "monthly_cap" });
    const r = await polishCreativeVisualSuggestionWithGemini(
      {
        creative: baseCreative(),
        productName: "GlowLamp Pro",
        stage: "launch",
      },
      { env: { GEMINI_API_KEY: "fake-key" }, workspaceId: "ws_test" },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("monthly_cap");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
