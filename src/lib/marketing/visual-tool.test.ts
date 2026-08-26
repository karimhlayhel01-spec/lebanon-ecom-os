import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { buildCreatives } from "@/lib/marketing/creatives";
import {
  createGeminiMarketingLlmProvider,
} from "@/lib/marketing/intro-llm";
import {
  routeCreativeVisualTool,
  suggestCreativeVisualTool,
  validateVisualSuggestion,
  visualPromptHasOsMeta,
  isUnsafeNanoHiggsfieldPrompt,
  isUnsafeSeedanceHiggsfieldPrompt,
} from "@/lib/marketing/visual-tool";
import {
  polishCreativeVisualSuggestionWithGemini,
  engineerNanoHiggsfieldBriefWithGemini,
  engineerSeedanceHiggsfieldBriefWithGemini,
  resolveNanoHiggsfieldPrompt,
  resolveSeedanceHiggsfieldPrompt,
} from "@/lib/marketing/visual-tool-llm";
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
  it("Nano prompt is one frame with no on-image type", () => {
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
      category: "home_kitchen",
      stage: "launch",
    });
    expect(s.tool).toBe("nano_banana");
    expect(s.promptEn).toContain("GlowLamp Pro");
    expect(s.promptEn).toContain("Open on GlowLamp Pro glow");
    expect(s.promptEn).toMatch(/close-up|window light/i);
    expect(s.promptEn).toMatch(/one photograph/i);
    expect(s.promptEn).toMatch(/no letters/i);
    expect(s.promptEn).toMatch(/no hands/i);
    expect(s.promptEn).toMatch(/true-to-life scale/i);
    expect(s.promptEn).toMatch(/kitchen counter/i);
    expect(s.promptEn).not.toMatch(/charging case/i);
    expect(s.promptEn).not.toMatch(/\b(mug|tea|plate|book|phone|village|postcard)\b/i);
    expect(s.promptEn).not.toMatch(/large in frame|fill frame/i);
    expect(s.promptEn).not.toMatch(/How to shoot:/i);
    expect(s.promptEn).not.toContain(creative.howToShootEn);
    expect(s.promptEn).not.toMatch(/Still 2/i);
    expect(s.promptEn).not.toMatch(/readable type/i);
    expect(s.promptAr).toContain("GlowLamp Pro");
    expect(s.promptAr).toMatch(/صورة واحدة/);
    expect(s.promptAr).toMatch(/بلا حروف/);
    expect(s.promptAr).not.toMatch(/كيف تصوّر:/);
    expect(validateVisualSuggestion(s, "GlowLamp Pro")).toBe(true);
  });

  it("Nano carousel prompt does not dump later slides", () => {
    const s = suggestCreativeVisualTool({
      creative: {
        ...baseCreative(),
        format: "carousel",
        hookEn: "Arriving soon — follow for RingConn",
        shots: [
          "Slide 1 | Clean still, product large, soft window light.",
          "Slide 2–3 | Niche tip series — product partially in frame.",
          "Slide 4 | Still: why follow this world text on calm background — large readable type.",
          "Slide 5 | Still CTA: when stock lands — Arriving Soon.",
        ],
        howToShootEn:
          "Phone stills. Soft window light from the side. Shoot 4 frames in order (same lighting).",
      },
      productName: "RingConn Gen 3",
      category: "health_wellness_gadgets",
      stage: "pre_launch",
    });
    expect(s.tool).toBe("nano_banana");
    expect(s.promptEn).toMatch(/Slide 1/i);
    expect(s.promptEn).not.toMatch(/Slide 2/i);
    expect(s.promptEn).not.toMatch(/Slide 4/i);
    expect(s.promptEn).not.toMatch(/Slide 5/i);
    expect(s.promptEn).not.toMatch(/readable type/i);
    expect(s.promptEn).not.toMatch(/Shoot 4 frames/i);
    expect(s.promptEn).not.toMatch(/How to shoot:/i);
    expect(s.promptEn).toMatch(/charging case/i);
    expect(s.promptEn).not.toMatch(/\b(mug|tea|plate|village|postcard)\b/i);
  });

  it("Nano sanitizes film-plan first shots to product-only", () => {
    const s = suggestCreativeVisualTool({
      creative: {
        ...baseCreative(),
        format: "post",
        hookEn: "Curious about tracking your wellness journey?",
        shots: [
          "0-3s | Phone vertical, close-up on a hand gently placing RingConn Gen 3 onto a finger. Focus on the sleek design. Text overlay: 'Your wellness journey, simplified.'",
        ],
      },
      productName: "RingConn Gen 3",
      category: "health_wellness_gadgets",
      stage: "pre_launch",
    });
    expect(s.tool).toBe("nano_banana");
    expect(s.promptEn).toContain("RingConn Gen 3");
    expect(s.promptEn).toMatch(/one photograph/i);
    expect(s.promptEn).toMatch(/no letters/i);
    expect(s.promptEn).toMatch(/no hands/i);
    expect(s.promptEn).toMatch(/true-to-life scale|jewelry-sized|real size/i);
    expect(s.promptEn).not.toMatch(/large in frame|fill frame/i);
    expect(s.promptEn).not.toMatch(/Text overlay/i);
    expect(s.promptEn).not.toContain("Your wellness journey, simplified.");
    expect(s.promptEn).not.toMatch(/0-3s|0–3s/);
    expect(s.promptEn).not.toMatch(/\bhand\b|\bfinger\b|\bplacing\b/i);
    expect(s.promptEn).toMatch(/charging case/i);
    expect(s.promptEn).not.toMatch(/\b(mug|tea|plate|book|phone|village)\b/i);
    expect(s.promptAr).not.toMatch(/كوب|شاي|صحن|طبق|كتاب|هاتف|قرية/);
  });

  it("routes reel to Seedance and testimonial to phone film", () => {
    const reel = suggestCreativeVisualTool({
      creative: { ...baseCreative(), format: "reel" },
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "pre_launch",
    });
    expect(reel.tool).toBe("seedance");
    expect(reel.promptEn.toLowerCase()).toMatch(/soft teaser|follow/);
    expect(reel.promptEn).toMatch(/short motion clip|kitchen counter|window light/i);
    expect(reel.promptEn).not.toMatch(/How to shoot:/i);
    expect(reel.promptEn).not.toMatch(/\b(mug|tea|plate|village)\b/i);
    expect(validateVisualSuggestion(reel, "GlowLamp Pro")).toBe(true);

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

  it("polish instructions keep Nano one-frame and no on-image type", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/visual-tool-llm.ts"),
      "utf8",
    );
    expect(src).toMatch(/rewrite a Lebanon ecommerce kit shot list/);
    expect(src).toMatch(/Think like an Ask agent/);
    expect(src).toMatch(/categoryHabitat/);
    expect(src).toMatch(/charging case/);
    expect(src).toMatch(/True-to-life scale/);
    expect(src).toMatch(/If tool is nano_banana/);
    expect(src).toMatch(/one photograph only/);
    expect(src).toMatch(/not overlay text/);
    expect(src).toMatch(/Product-only: no hands, no faces, no people/);
    expect(src).toMatch(/Do not invent mug, tea, plate, book, or phone/i);
    expect(src).toMatch(/Do not restore a full slide list/);
    expect(src).toMatch(/If tool is seedance/);
    expect(src).toMatch(/rewrite a Lebanon ecommerce kit shot list into a Higgsfield Seedance/);
  });
});

describe("isUnsafeNanoHiggsfieldPrompt", () => {
  it("flags film-plan overlay and hand action, not product-only sanitize", () => {
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "0-3s | a hand placing RingConn. Text overlay: 'Your wellness journey, simplified.'",
      ),
    ).toBe(true);
    const skills = suggestCreativeVisualTool({
      creative: {
        ...baseCreative(),
        format: "post",
        shots: [
          "0-3s | Phone vertical, close-up on a hand gently placing RingConn Gen 3 onto a finger. Text overlay: 'Your wellness journey, simplified.'",
        ],
      },
      productName: "RingConn Gen 3",
      stage: "pre_launch",
    });
    expect(isUnsafeNanoHiggsfieldPrompt(skills.promptEn)).toBe(false);
    expect(validateVisualSuggestion(skills, "RingConn Gen 3")).toBe(true);
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "Create one photograph of RingConn Gen 3 filling the frame, giant ring.",
      ),
    ).toBe(true);
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "Jewelry-sized ring on a plate with tea and a mug, window light. No hands.",
      ),
    ).toBe(true);
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "Create one photograph. No hands, no faces, no people. True-to-life scale.",
      ),
    ).toBe(false);
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "RingConn Gen 3 in a Lebanese village, countryside postcard.",
      ),
    ).toBe(true);
    expect(
      isUnsafeNanoHiggsfieldPrompt(
        "Jewelry-sized ring in its charging case on a nightstand. Indoor. Window light. No hands.",
      ),
    ).toBe(false);
  });
});

describe("engineerNanoHiggsfieldBriefWithGemini", () => {
  const filmPlanCreative = () => ({
    ...baseCreative(),
    format: "post" as const,
    hookEn: "Curious about tracking your wellness journey?",
    shots: [
      "0-3s | Phone vertical, close-up on a hand gently placing RingConn Gen 3 onto a finger. Focus on the sleek design. Text overlay: 'Your wellness journey, simplified.'",
    ],
  });

  const filmPlanInput = () => ({
    creative: filmPlanCreative(),
    productName: "RingConn Gen 3",
    category: "health_wellness_gadgets",
    stage: "pre_launch" as const,
  });

  function geminiFetch(body: unknown): typeof fetch {
    return (async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(body) }] } },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
  }

  it("skips Seedance reels", async () => {
    const r = await engineerNanoHiggsfieldBriefWithGemini(
      {
        creative: { ...baseCreative(), format: "reel" },
        productName: "GlowLamp Pro",
        stage: "launch",
      },
      { env: { GEMINI_API_KEY: "fake-key" } },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("skipped");
  });

  it("rejects overlay/hand rewrites and resolveNano fails closed to sanitize", async () => {
    const input = filmPlanInput();
    const bad = await engineerNanoHiggsfieldBriefWithGemini(input, {
      env: { GEMINI_API_KEY: "fake-key" },
      fetchFn: geminiFetch({
        promptEn:
          "0-3s close-up on a hand placing RingConn Gen 3. Text overlay: Your wellness journey, simplified.",
        promptAr: "يد تضع RingConn Gen 3",
      }),
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toBe("invalid");

    const resolved = await resolveNanoHiggsfieldPrompt(input, {
      env: { GEMINI_API_KEY: "fake-key" },
      fetchFn: geminiFetch({
        promptEn:
          "0-3s close-up on a hand placing RingConn Gen 3. Text overlay: Your wellness journey, simplified.",
        promptAr: "يد تضع RingConn Gen 3",
      }),
    });
    expect(resolved.source).toBe("skills");
    expect(resolved.honesty).toBe("api_error");
    expect(resolved.promptEn).toContain("RingConn Gen 3");
    expect(resolved.promptEn).not.toMatch(/Text overlay/i);
    expect(resolved.promptEn).not.toMatch(/\bplacing\b/i);
    expect(resolved.promptEn).toMatch(/charging case/i);
  });

  it("accepts a product-only rewrite of the shot-list beat", async () => {
    const r = await engineerNanoHiggsfieldBriefWithGemini(
      filmPlanInput(),
      {
        env: { GEMINI_API_KEY: "fake-key" },
        fetchFn: geminiFetch({
          promptEn:
            "Create one photograph of RingConn Gen 3. Mood: curious wellness tracking. Jewelry-sized ring in its charging case on a nightstand, window light. True-to-life scale. No hands, no faces, no people. No letters on the image.",
          promptAr:
            "أنشئ صورة فوتوغرافية واحدة لـ RingConn Gen 3. مزاج العافية. خاتم بحجم المجوهرات في علبة الشحن على منضدة. حجم حقيقي. بلا أيدٍ أو وجوه. بلا حروف.",
        }),
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("gemini");
    expect(r.promptEn).toContain("RingConn Gen 3");
    expect(r.promptEn).not.toMatch(/Text overlay/i);
    expect(r.promptEn).not.toMatch(/\ba hand\b/i);
  });

  it("rejects fill-frame / giant-product rewrites", async () => {
    const r = await engineerNanoHiggsfieldBriefWithGemini(
      filmPlanInput(),
      {
        env: { GEMINI_API_KEY: "fake-key" },
        fetchFn: geminiFetch({
          promptEn:
            "Create one photograph of RingConn Gen 3 filling the frame, giant ring, huge product.",
          promptAr: "RingConn Gen 3 يملأ الإطار",
        }),
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid");
  });

  it("rejects kitchen still-life props", async () => {
    const r = await engineerNanoHiggsfieldBriefWithGemini(
      filmPlanInput(),
      {
        env: { GEMINI_API_KEY: "fake-key" },
        fetchFn: geminiFetch({
          promptEn:
            "Create one photograph of RingConn Gen 3 on a plate with tea and a mug. No hands.",
          promptAr: "RingConn Gen 3 على صحن مع شاي.",
        }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid");
  });

  it("rejects village / postcard backdrops", async () => {
    const r = await engineerNanoHiggsfieldBriefWithGemini(filmPlanInput(), {
      env: { GEMINI_API_KEY: "fake-key" },
      fetchFn: geminiFetch({
        promptEn:
          "Create one photograph of RingConn Gen 3 in a mountain village, countryside postcard. No hands.",
        promptAr: "RingConn Gen 3 في قرية.",
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid");
  });
});

describe("isUnsafeSeedanceHiggsfieldPrompt", () => {
  it("allows clip duration wording and still flags overlay / plate / village", () => {
    expect(
      isUnsafeSeedanceHiggsfieldPrompt(
        "Create a 6-second clip of RingConn in its charging case. Slow pan. No people.",
      ),
    ).toBe(false);
    expect(
      isUnsafeSeedanceHiggsfieldPrompt(
        "6-second clip. Text overlay: Charge overnight.",
      ),
    ).toBe(true);
    expect(
      isUnsafeSeedanceHiggsfieldPrompt(
        "Village landscape pan of RingConn on a dinner plate.",
      ),
    ).toBe(true);
  });
});

describe("engineerSeedanceHiggsfieldBriefWithGemini", () => {
  const reelInput = () => ({
    creative: {
      ...baseCreative(),
      format: "reel",
      hookEn: "Charge overnight. Wake ready.",
      hookAr: "اشحن ليلاً. استيقظ جاهزاً.",
      shots: [
        "0-3s | Close-up of RingConn in its charging case on a nightstand.",
      ],
      howToShootEn: "Show the case, then the ring.",
    },
    productName: "RingConn",
    category: "health_wellness_gadgets",
    stage: "pre_launch" as const,
  });

  function geminiFetch(body: unknown): typeof fetch {
    return (async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(body) }] } },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
  }

  it("skips Nano stills", async () => {
    const r = await engineerSeedanceHiggsfieldBriefWithGemini({
      creative: { ...baseCreative(), format: "post" },
      productName: "GlowLamp Pro",
      stage: "launch",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("skipped");
  });

  it("keeps a charging-case clip and drops village and plate", async () => {
    const good = await engineerSeedanceHiggsfieldBriefWithGemini(reelInput(), {
      env: { GEMINI_API_KEY: "fake-key" },
      fetchFn: geminiFetch({
        promptEn:
          "Create a 6-second clip of RingConn in its charging case on a bedroom nightstand. Slow pan. True-to-life scale. No people.",
        promptAr:
          "مقطع ٦ ثوانٍ لـ RingConn في علبة الشحن على طاولة الليل. بدون أشخاص.",
      }),
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.promptEn).toMatch(/charging case/i);
      expect(good.promptEn).toMatch(/clip|second/i);
    }

    const village = await engineerSeedanceHiggsfieldBriefWithGemini(
      reelInput(),
      {
        env: { GEMINI_API_KEY: "fake-key" },
        fetchFn: geminiFetch({
          promptEn:
            "Village landscape pan of RingConn on a dinner plate. 6 seconds.",
          promptAr: "قرية RingConn",
        }),
      },
    );
    expect(village.ok).toBe(false);
    if (!village.ok) expect(village.error).toBe("invalid");

    const resolved = await resolveSeedanceHiggsfieldPrompt(reelInput(), {
      env: { GEMINI_API_KEY: "fake-key" },
      fetchFn: geminiFetch({
        promptEn:
          "Village landscape pan of RingConn on a dinner plate. 6 seconds.",
        promptAr: "قرية RingConn",
      }),
    });
    expect(resolved.source).toBe("skills");
    expect(resolved.honesty).toBe("api_error");
    expect(resolved.promptEn).toMatch(/short motion clip/i);
    expect(resolved.promptEn).toMatch(/charging case/i);
    expect(resolved.promptEn).not.toMatch(/How to shoot:/i);
  });
});
