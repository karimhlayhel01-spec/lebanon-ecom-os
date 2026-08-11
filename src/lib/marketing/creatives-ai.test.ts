import { describe, expect, it } from "vitest";
import { buildCreatives, type Creative } from "@/lib/marketing/creatives";
import {
  applyCreativeTextFills,
  parseCreativesKitItems,
  serializeCreativesKit,
  validateFilledCreatives,
  type CreativeTextFill,
} from "@/lib/marketing/creatives-ai";
import { buildExternalAiDeskPrompts, PASTE_CREATIVE_MARKER } from "@/lib/marketing/ai-desk";
import {
  createGeminiMarketingLlmProvider,
  getMarketingLlmProvider,
} from "@/lib/marketing/intro-llm";

const base = {
  name: "GlowLamp",
  category: "home_kitchen",
  hooks: ["warm light"],
  capacityTier: 6 as const,
};

function fillFromSkeleton(c: Creative, productName: string): CreativeTextFill {
  return {
    id: c.id,
    hookEn: `Open on ${productName} in 2 seconds`,
    hookAr: `افتح على ${productName} في ثانيتين`,
    angleEn: `${productName} desk tip for busy mornings`,
    angleAr: `نصيحة مكتب من ${productName} للصباحات المزدحمة`,
    captionEn: `Why ${productName} belongs on your desk — soft waitlist CTA.`,
    captionAr: `لماذا ${productName} يستحق مكتبك — دعوة هادئة للقائمة.`,
    shots: ["Close-up product", "Hands placing item", "Wide desk scene"],
    seriesLabelEn: "Desk fix #1",
    seriesLabelAr: "إصلاح المكتب #١",
    whyEn: "Niche-consistent soft teaser without hard order pitch.",
    whyAr: "تشويقة ناعمة متسقة مع النيش دون طلب شراء قاسٍ.",
  };
}

describe("validateFilledCreatives", () => {
  it("rejects COD pitch", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 11,
    });
    const creatives = skeleton.map((c) => ({
      ...c,
      captionEn: `${c.captionEn} Pay with COD cash on delivery.`,
    }));
    const r = validateFilledCreatives(creatives, "launch", "GlowLamp");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("cod_pitch");
  });

  it("rejects pre_launch hard/WhatsApp order pitch", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "pre_launch",
      varianceSeed: 12,
      weekCount: 4,
    });
    const creatives = skeleton.map((c) => ({ ...c }));
    creatives[0] = {
      ...creatives[0]!,
      captionEn: "Message us on WhatsApp to order GlowLamp today.",
      hookEn: "Hard sell GlowLamp — WhatsApp to buy now.",
    };
    const r = validateFilledCreatives(creatives, "pre_launch", "GlowLamp");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("pre_launch_forbidden");
  });

  it("accepts valid soft pre_launch fills with product name", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "pre_launch",
      varianceSeed: 13,
      weekCount: 2,
    });
    const fills = skeleton.map((c) => fillFromSkeleton(c, "GlowLamp"));
    const merged = applyCreativeTextFills(skeleton, fills);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const r = validateFilledCreatives(
      merged.creatives,
      "pre_launch",
      "GlowLamp",
    );
    expect(r.ok).toBe(true);
  });
});

describe("fillCreativesKitWithGemini / provider", () => {
  it("falls back with missing_key when Gemini env is empty", async () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 14,
    });
    const provider = createGeminiMarketingLlmProvider();
    const r = await provider.improveCreativesKit(
      {
        ...base,
        stage: "launch",
        varianceSeed: 14,
      },
      skeleton,
      { env: {} },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_key");
  });

  it("exposes improveCreativesKit on the active provider seam", () => {
    expect(typeof getMarketingLlmProvider().improveCreativesKit).toBe(
      "function",
    );
  });
});

describe("buildExternalAiDeskPrompts", () => {
  it("includes product name and stage in both role prompts", () => {
    const prompts = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "pre_launch",
    });
    expect(prompts).toHaveLength(2);
    for (const p of prompts) {
      expect(p.body).toContain("GlowLamp Pro");
      expect(p.body.toLowerCase()).toMatch(/pre-launch|pre_launch/);
    }
  });

  it("rewrite tightens one pasted creative — not a new kit", () => {
    const rewrite = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "launch",
    }).find((p) => p.id === "rewrite")!;
    expect(rewrite.body).toContain(PASTE_CREATIVE_MARKER);
    expect(rewrite.body.toLowerCase()).toMatch(/do not invent a full/);
    expect(rewrite.body.toLowerCase()).toMatch(/2–3|2-3/);
    expect(rewrite.body.toLowerCase()).not.toMatch(
      /rewrite 3 short creative variants/,
    );
  });

  it("strategy forbids full captions / kit-like posts", () => {
    const strategy = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "monthly_refresh",
    }).find((p) => p.id === "strategy")!;
    expect(strategy.body.toLowerCase()).toMatch(/full caption/);
    expect(strategy.body.toLowerCase()).toMatch(
      /complete posts like a creative kit|not a second creative kit/,
    );
    expect(strategy.body.toLowerCase()).toMatch(/shot list/);
  });

  it("keeps paste-out prompts free of OS product meta", () => {
    const stages = ["pre_launch", "launch", "monthly_refresh"] as const;
    for (const stage of stages) {
      const prompts = buildExternalAiDeskPrompts({
        productName: "GlowLamp Pro",
        category: "home_kitchen",
        stage,
      });
      for (const p of prompts) {
        expect(p.body).not.toContain("Lebanon Ecom OS");
        expect(p.body).not.toContain("Topic A");
        expect(p.body.toLowerCase()).not.toContain("capacity tier");
        expect(p.body.toLowerCase()).not.toContain("stage unlock");
        expect(p.body).not.toMatch(/OS Marketing kit/i);
        expect(p.body).not.toMatch(/source of truth/i);
      }
    }
  });
});

describe("serialize / parse creatives kit wrap", () => {
  it("round-trips wrapped kits and keeps legacy arrays", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 15,
    });
    const json = serializeCreativesKit({
      kind: "creatives",
      source: "template",
      creatives: skeleton,
    });
    const wrapped = parseCreativesKitItems(JSON.parse(json));
    expect(wrapped?.source).toBe("template");
    expect(wrapped?.creatives).toHaveLength(skeleton.length);

    const legacy = parseCreativesKitItems(skeleton);
    expect(legacy?.source).toBeNull();
    expect(legacy?.creatives.length).toBe(skeleton.length);
  });
});
