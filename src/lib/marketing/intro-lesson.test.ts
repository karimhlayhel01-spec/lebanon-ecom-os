import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_INTRO_SECTION_IDS,
  INTRO_LESSON_SECTION_IDS,
  INTRO_LITERACY_SECTION_IDS,
  INTRO_SECTION_TITLES,
  applyCanonicalTitles,
  buildIntroLesson,
  buildXpozClaudePrompt,
  ensureIntroLessonComplete,
  getIntroSectionTitle,
  introLessonHasCodPitch,
} from "@/lib/marketing/intro-lesson";
import { validateAndAssembleIntroLesson } from "@/lib/marketing/intro-validate";
import {
  createGeminiMarketingLlmProvider,
  resetMarketingLlmProvider,
  setMarketingLlmProvider,
  type MarketingLlmProvider,
} from "@/lib/marketing/intro-llm";

describe("buildIntroLesson", () => {
  it("returns intro_lesson with core + literacy section ids", () => {
    const lesson = buildIntroLesson({
      name: "Silicone Kitchen Set",
      category: "home_kitchen",
    });
    expect(lesson.kind).toBe("intro_lesson");
    expect(lesson.source).toBe("template");
    expect(lesson.sections.map((s) => s.id)).toEqual([
      ...ALL_INTRO_SECTION_IDS,
    ]);
    expect(lesson.sections).toHaveLength(
      INTRO_LESSON_SECTION_IDS.length + INTRO_LITERACY_SECTION_IDS.length,
    );
  });

  it("includes literacy ids with fixed titles", () => {
    const lesson = buildIntroLesson({
      name: "Gua Sha Set",
      category: "beauty_personal_care",
    });
    for (const id of INTRO_LITERACY_SECTION_IDS) {
      const section = lesson.sections.find((s) => s.id === id)!;
      expect(section.titleEn).toBe(INTRO_SECTION_TITLES[id].titleEn);
      expect(section.titleAr).toBe(INTRO_SECTION_TITLES[id].titleAr);
      expect(section.bodyEn.length).toBeGreaterThan(20);
    }
  });

  it("teaches Nano Generate in this OS (not an external image site)", () => {
    const lesson = buildIntroLesson({
      name: "Gua Sha Set",
      category: "beauty_personal_care",
    });
    const nano = lesson.sections.find((s) => s.id === "ai_image_nano")!;
    expect(nano.bodyEn).toContain("Gua Sha Set");
    expect(nano.bodyEn).toMatch(/post and carousel/i);
    expect(nano.bodyEn).toMatch(/Generate for a draft still/);
    expect(nano.bodyEn).toMatch(/Copy prompt is backup/i);
    expect(nano.bodyEn).toMatch(/product photos/);
    expect(nano.bodyEn).toMatch(/caption carries the line/i);
    expect(nano.bodyEn).not.toMatch(/does not generate images/i);
    expect(nano.bodyEn).not.toMatch(/open the tool externally/i);
    expect(nano.bodyEn).not.toMatch(/Higgsfield/i);
    expect(nano.bodyAr).toContain("Gua Sha Set");
    expect(nano.bodyAr).toMatch(/Generate/);
    expect(nano.bodyAr).not.toMatch(/لا يولّد صوراً لك بعد/);
    expect(nano.bodyAr).not.toMatch(/افتح الأداة خارجياً/);
    expect(nano.bodyAr).not.toMatch(/Higgsfield/i);

    const llm = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/intro-llm.ts"),
      "utf8",
    );
    expect(llm).toMatch(/The OS replaces ai_\* bodies with locked teaching/);
    expect(llm).toMatch(/Do NOT write Seedance film-plans/);
    expect(llm).not.toMatch(/Say tools are external/);
    expect(llm).toMatch(/ai_video_seedance/);
    expect(llm).toMatch(/ai_competitors_xpoz/);
    expect(llm).toMatch(/Do not emit ai_captions, ai_chat_claude, or ai_cursor_optional/);
    expect(llm).toMatch(/Do not invent a Seedance clip prompt/);
    expect(INTRO_LITERACY_SECTION_IDS).toEqual([
      "ai_image_nano",
      "ai_video_seedance",
      "ai_competitors_xpoz",
    ]);
  });

  it("literacy kicker does not say every tool is external", () => {
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/Nano Generate is in this OS/i);
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/stills/i);
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/motion/i);
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/Xpoz/i);
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/outside/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/tools stay external/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/every tool is external/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/captions/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/strategy/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/Cursor/i);
    expect(ar.Marketing.lessonAiLiteracyIntro).toMatch(/توليد Nano داخل هذا النظام/);
    expect(ar.Marketing.lessonAiLiteracyIntro).toMatch(/Xpoz/);
    expect(ar.Marketing.lessonAiLiteracyIntro).toMatch(/خارجاً/);
    expect(ar.Marketing.lessonAiLiteracyIntro).not.toMatch(/الأدوات خارجية/);
    expect(ar.Marketing.lessonAiLiteracyIntro).not.toMatch(/التعليقات/);
    expect(ar.Marketing.lessonAiLiteracyIntro).not.toMatch(/الاستراتيجية/);
    expect(ar.Marketing.lessonAiLiteracyIntro).not.toMatch(/Cursor/);
  });

  it("teaches Seedance via Copy prompt + Claude Higgsfield connector", () => {
    const lesson = buildIntroLesson({
      name: "Gua Sha Set",
      category: "beauty_personal_care",
    });
    const seedance = lesson.sections.find((s) => s.id === "ai_video_seedance")!;
    expect(seedance.bodyEn).toMatch(/Copy a Seedance prompt/);
    expect(seedance.bodyEn).toContain("Gua Sha Set");
    expect(seedance.bodyEn).toContain("https://mcp.higgsfield.ai");
    expect(seedance.bodyEn).toMatch(/not generated in this OS/i);
    expect(seedance.bodyEn).toMatch(/ask Claude to run Seedance/);
    expect(seedance.bodyAr).toContain("https://mcp.higgsfield.ai");
    expect(seedance.bodyAr).toContain("Gua Sha Set");
  });

  it("teaches Xpoz competitor discover-then-study (not in this OS)", () => {
    const lesson = buildIntroLesson({
      name: "Gua Sha Set",
      category: "beauty_personal_care",
    });
    const xpoz = lesson.sections.find((s) => s.id === "ai_competitors_xpoz")!;
    expect(xpoz.titleEn).toBe("Competitors with Xpoz");
    expect(xpoz.bodyEn).toContain("Gua Sha Set");
    expect(xpoz.bodyEn).toContain("mcp.xpoz.ai");
    expect(xpoz.bodyEn).toMatch(/not this OS/i);
    expect(xpoz.bodyEn).not.toMatch(/Higgsfield/i);
    expect(xpoz.bodyEn).not.toMatch(/scrape/i);
    expect(xpoz.bodyAr).toContain("Gua Sha Set");
    expect(xpoz.bodyAr).toContain("mcp.xpoz.ai");
  });

  it("buildXpozClaudePrompt names product + Lebanon + find first + ideas only", () => {
    const en = buildXpozClaudePrompt({
      productName: "RingConn",
      category: "fitness_lifestyle",
      locale: "en",
    });
    expect(en).toContain("RingConn");
    expect(en).toMatch(/Lebanon/);
    expect(en).toMatch(/FIND FIRST/);
    expect(en).toMatch(/IDEAS ONLY/);
    expect(en).toMatch(/WhatsApp/);
    expect(en).toMatch(/Do not invent ROAS/);
    expect(en).not.toMatch(/target ROAS|promised ROAS/i);
    expect(en).toContain("mcp.xpoz.ai");

    const ar = buildXpozClaudePrompt({
      productName: "RingConn",
      category: "fitness_lifestyle",
      locale: "ar",
    });
    expect(ar).toContain("RingConn");
    expect(ar).toMatch(/لبنان/);
    expect(ar).toMatch(/ابحث أولاً/);
    expect(ar).toMatch(/أفكار فقط/);
    expect(ar).toMatch(/ROAS/);

    const kitchen = buildXpozClaudePrompt({
      productName: "Collapsible Containers",
      category: "home_kitchen",
      locale: "en",
    });
    expect(kitchen).toMatch(/kitchen/i);
    expect(kitchen).not.toBe(en);
  });

  it("substitutes THIS product name into section bodies", () => {
    const lesson = buildIntroLesson({
      name: "LED Facial Wand",
      category: "beauty_personal_care",
      differentiation: "Arabic routine card included.",
    });
    const hook = lesson.sections.find((s) => s.id === "hook")!;
    expect(hook.bodyEn).toContain("LED Facial Wand");
    expect(hook.bodyAr).toContain("LED Facial Wand");
    expect(hook.bodyEn).not.toMatch(/desk lamp/i);
  });

  it("changes example lines when category / name change", () => {
    const kitchen = buildIntroLesson({
      name: "Collapsible Containers",
      category: "home_kitchen",
    });
    const desk = buildIntroLesson({
      name: "Desk Organizer Station",
      category: "office_desk_gadgets",
    });
    const nicheKitchen = kitchen.sections.find((s) => s.id === "niche_signal")!;
    const nicheDesk = desk.sections.find((s) => s.id === "niche_signal")!;
    expect(nicheKitchen.bodyEn).not.toBe(nicheDesk.bodyEn);
    expect(nicheDesk.bodyEn).toMatch(/desk/i);
    expect(nicheKitchen.bodyEn).toMatch(/kitchen/i);

    const seriesKitchen = kitchen.sections.find((s) => s.id === "series")!;
    const seriesDesk = desk.sections.find((s) => s.id === "series")!;
    expect(seriesKitchen.bodyEn).toContain("Collapsible Containers");
    expect(seriesDesk.bodyEn).toContain("Desk Organizer Station");
    expect(seriesKitchen.bodyEn).not.toBe(seriesDesk.bodyEn);
  });

  it("stays coherent for unknown category using product name", () => {
    const lesson = buildIntroLesson({
      name: "Mystery Gadget",
      category: "",
    });
    expect(lesson.sections).toHaveLength(ALL_INTRO_SECTION_IDS.length);
    expect(lesson.category).toBe("unknown");
    const series = lesson.sections.find((s) => s.id === "series")!;
    expect(series.bodyEn).toContain("Mystery Gadget");
  });

  it("never pitches COD as a marketing differentiator", () => {
    const categories = [
      "beauty_personal_care",
      "home_kitchen",
      "office_desk_gadgets",
      "fitness_lifestyle",
      "",
    ];
    for (const category of categories) {
      const lesson = buildIntroLesson({
        name: "Test SKU",
        category,
      });
      expect(introLessonHasCodPitch(lesson)).toBe(false);
    }
  });

  it("includes Patterns A–E with concrete fixes in three_metrics", () => {
    const lesson = buildIntroLesson({
      name: "Gua Sha Set",
      category: "beauty_personal_care",
    });
    const metrics = lesson.sections.find((s) => s.id === "three_metrics")!;
    expect(metrics.bodyEn).toMatch(/Pattern A/i);
    expect(metrics.bodyEn).toMatch(/Pattern E/i);
    expect(metrics.bodyEn).toMatch(/Don.t rush paid/i);
    expect(metrics.bodyEn).toMatch(/WhatsApp/i);
  });

  it("keeps titles stable via canonical map", () => {
    for (const id of ALL_INTRO_SECTION_IDS) {
      expect(getIntroSectionTitle(id, "en")).toBe(
        INTRO_SECTION_TITLES[id].titleEn,
      );
      expect(getIntroSectionTitle(id, "ar")).toBe(
        INTRO_SECTION_TITLES[id].titleAr,
      );
    }
  });
});

describe("validateAndAssembleIntroLesson", () => {
  function goodBodies(name: string) {
    return ALL_INTRO_SECTION_IDS.map((id) => ({
      id,
      bodyEn: `Lesson about ${name} for section ${id}. `.repeat(3).trim(),
      bodyAr: `درس عن ${name} لقسم ${id}. `.repeat(3).trim(),
    }));
  }

  it("accepts complete bilingual bodies and forces canonical titles", () => {
    const r = validateAndAssembleIntroLesson({
      productName: "Silicone Spatula",
      category: "home_kitchen",
      bodies: goodBodies("Silicone Spatula"),
      source: "gemini",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.source).toBe("gemini");
    expect(r.lesson.sections.map((s) => s.id)).toEqual([
      ...ALL_INTRO_SECTION_IDS,
    ]);
    for (const s of r.lesson.sections) {
      expect(s.titleEn).toBe(INTRO_SECTION_TITLES[s.id].titleEn);
      expect(s.titleAr).toBe(INTRO_SECTION_TITLES[s.id].titleAr);
    }
  });

  it("rejects missing sections", () => {
    const bodies = goodBodies("X").slice(0, 5);
    const r = validateAndAssembleIntroLesson({
      productName: "X",
      category: "home_kitchen",
      bodies,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_sections");
  });

  it("rejects COD pitch", () => {
    const bodies = goodBodies("Widget");
    bodies[0]!.bodyEn =
      "Sell Widget with cash on delivery as your wow marketing angle. ".repeat(
        2,
      );
    const r = validateAndAssembleIntroLesson({
      productName: "Widget",
      category: "home_kitchen",
      bodies,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("cod_pitch");
  });

  it("rejects missing product name on core sections", () => {
    const bodies = goodBodies("Real Name").map((b) =>
      b.id === "hook"
        ? {
            ...b,
            bodyEn:
              "A generic hook with no product mention at all here really. Keep watching because the open still needs a job and a clear problem in the first seconds.",
            bodyAr:
              "نص عربي بدون اسم المنتج هنا فعلاً بما يكفي من الطول للتحقق. أبقِ الافتتاح واضحاً حول المشكلة دون ذكر الاسم المطلوب.",
          }
        : b,
    );
    const r = validateAndAssembleIntroLesson({
      productName: "Real Name",
      category: "home_kitchen",
      bodies,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_product_name");
  });

  it("rejects unknown ids", () => {
    const bodies = [
      ...goodBodies("Y").slice(0, -1),
      {
        id: "not_a_real_section",
        bodyEn: "x".repeat(60),
        bodyAr: "ي".repeat(60),
      },
    ];
    const r = validateAndAssembleIntroLesson({
      productName: "Y",
      category: "home_kitchen",
      bodies,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_id");
  });

  it("ignores retired literacy ids if Gemini still emits them", () => {
    const r = validateAndAssembleIntroLesson({
      productName: "Y",
      category: "home_kitchen",
      bodies: [
        ...goodBodies("Y"),
        {
          id: "ai_captions",
          bodyEn: "x".repeat(60),
          bodyAr: "ي".repeat(60),
        },
        {
          id: "ai_chat_claude",
          bodyEn: "x".repeat(60),
          bodyAr: "ي".repeat(60),
        },
        {
          id: "ai_cursor_optional",
          bodyEn: "x".repeat(60),
          bodyAr: "ي".repeat(60),
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.sections.map((s) => s.id)).not.toContain("ai_captions");
    expect(r.lesson.sections.map((s) => s.id)).not.toContain("ai_chat_claude");
    expect(r.lesson.sections.map((s) => s.id)).not.toContain(
      "ai_cursor_optional",
    );
  });

  it("overwrites Gemini literacy with template how-to; core stays Gemini", () => {
    const bodies = goodBodies("RingConn");
    const seedanceI = bodies.findIndex((b) => b.id === "ai_video_seedance");
    bodies[seedanceI] = {
      id: "ai_video_seedance",
      bodyEn:
        "Seedance film-plan for RingConn: 0–3s text overlay on the hand putting on the ring, then a 5-slide collage of evening stretches. ".repeat(
          2,
        ),
      bodyAr:
        "خطة تصوير Seedance لـ RingConn مع نص على الصورة واليد ثم كولاج. ".repeat(
          3,
        ),
    };
    const nanoI = bodies.findIndex((b) => b.id === "ai_image_nano");
    bodies[nanoI] = {
      id: "ai_image_nano",
      bodyEn:
        "Try this overlay slogan on a hand holding RingConn next to tea and a book. ".repeat(
          3,
        ),
      bodyAr:
        "جرّب شعاراً على الصورة مع يد تمسك RingConn بجانب الشاي. ".repeat(3),
    };
    const xpozI = bodies.findIndex((b) => b.id === "ai_competitors_xpoz");
    bodies[xpozI] = {
      id: "ai_competitors_xpoz",
      bodyEn:
        "Write a long competitor essay for RingConn with invented ROAS and no Xpoz. ".repeat(
          2,
        ),
      bodyAr:
        "اكتب مقالاً طويلاً عن منافسي RingConn بلا Xpoz. ".repeat(3),
    };

    const r = validateAndAssembleIntroLesson({
      productName: "RingConn",
      category: "health_wellness",
      bodies,
      source: "gemini",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const hook = r.lesson.sections.find((s) => s.id === "hook")!;
    expect(hook.bodyEn).toContain("Lesson about RingConn for section hook");

    const seedance = r.lesson.sections.find((s) => s.id === "ai_video_seedance")!;
    expect(seedance.bodyEn).toContain("RingConn");
    expect(seedance.bodyEn).toMatch(/Copy a Seedance prompt/);
    expect(seedance.bodyEn).toContain("https://mcp.higgsfield.ai");
    expect(seedance.bodyEn).toMatch(/Claude/);
    expect(seedance.bodyEn).toMatch(/not generated in this OS/i);
    expect(seedance.bodyEn).not.toMatch(/text overlay/i);
    expect(seedance.bodyEn).not.toMatch(/hand putting/i);
    expect(seedance.bodyEn).not.toMatch(/5-slide collage/i);
    expect(seedance.bodyAr).toContain("https://mcp.higgsfield.ai");

    const nano = r.lesson.sections.find((s) => s.id === "ai_image_nano")!;
    expect(nano.bodyEn).toMatch(/Generate for a draft still/);
    expect(nano.bodyEn).not.toMatch(/overlay slogan/i);
    expect(nano.bodyEn).not.toMatch(/Higgsfield/i);

    const xpoz = r.lesson.sections.find((s) => s.id === "ai_competitors_xpoz")!;
    expect(xpoz.bodyEn).toContain("mcp.xpoz.ai");
    expect(xpoz.bodyEn).toMatch(/find Lebanon shops/i);
    expect(xpoz.bodyEn).toMatch(/ideas only/i);
    expect(xpoz.bodyEn).not.toMatch(/ROAS/);
    expect(xpoz.bodyEn).not.toMatch(/Higgsfield/i);
  });
});

describe("ensureIntroLessonComplete / applyCanonicalTitles", () => {
  it("backfills literacy onto older 8-section kits", () => {
    const full = buildIntroLesson({
      name: "Old Kit Product",
      category: "home_kitchen",
    });
    const legacy = {
      ...full,
      sections: full.sections.filter((s) =>
        (INTRO_LESSON_SECTION_IDS as readonly string[]).includes(s.id),
      ),
    };
    expect(legacy.sections).toHaveLength(8);
    const fixed = ensureIntroLessonComplete(legacy);
    expect(fixed.sections.map((s) => s.id)).toEqual([
      ...ALL_INTRO_SECTION_IDS,
    ]);
    const titles = applyCanonicalTitles({
      ...fixed,
      sections: fixed.sections.map((s) => ({
        ...s,
        titleEn: "MODEL TITLE DRIFT",
        titleAr: "عنوان نموذج",
      })),
    });
    expect(titles.sections[0]!.titleEn).toBe(
      INTRO_SECTION_TITLES.hook.titleEn,
    );
  });

  it("drops retired literacy ids from persisted intros", () => {
    const full = buildIntroLesson({
      name: "Old Kit Product",
      category: "home_kitchen",
    });
    const withRetired = {
      ...full,
      sections: [
        ...full.sections,
        {
          id: "ai_captions",
          titleEn: "AI for captions (ChatGPT / Claude)",
          titleAr: "الذكاء الاصطناعي للتعليقات (ChatGPT / Claude)",
          bodyEn: "Use ChatGPT to draft captions.",
          bodyAr: "استخدم ChatGPT لصياغة التعليقات.",
        },
        {
          id: "ai_chat_claude",
          titleEn: "Strategy help with Claude / ChatGPT",
          titleAr: "مساعدة استراتيجية مع Claude / ChatGPT",
          bodyEn: "Claude can plan angles.",
          bodyAr: "يمكن لـ Claude تخطيط الزوايا.",
        },
        {
          id: "ai_cursor_optional",
          titleEn: "Cursor (optional advanced tip)",
          titleAr: "Cursor (نصيحة متقدّمة اختيارية)",
          bodyEn: "Cursor is optional.",
          bodyAr: "Cursor اختياري.",
        },
      ],
    };
    const fixed = ensureIntroLessonComplete(
      withRetired as typeof full,
    );
    expect(fixed.sections.map((s) => s.id)).toEqual([
      ...ALL_INTRO_SECTION_IDS,
    ]);
    expect(fixed.sections.map((s) => s.id)).not.toContain("ai_captions");
    expect(fixed.sections.map((s) => s.id)).not.toContain("ai_chat_claude");
    expect(fixed.sections.map((s) => s.id)).not.toContain(
      "ai_cursor_optional",
    );
  });

  it("backfills ai_competitors_xpoz onto old 2-literacy intros", () => {
    const full = buildIntroLesson({
      name: "Old Kit Product",
      category: "home_kitchen",
    });
    const oldTwo = {
      ...full,
      sections: full.sections.filter((s) => s.id !== "ai_competitors_xpoz"),
    };
    expect(oldTwo.sections.map((s) => s.id)).not.toContain(
      "ai_competitors_xpoz",
    );
    const nanoBefore = oldTwo.sections.find((s) => s.id === "ai_image_nano")!;
    const seedanceBefore = oldTwo.sections.find(
      (s) => s.id === "ai_video_seedance",
    )!;
    const fixed = ensureIntroLessonComplete(oldTwo);
    expect(fixed.sections.map((s) => s.id)).toEqual([
      ...ALL_INTRO_SECTION_IDS,
    ]);
    expect(fixed.sections.find((s) => s.id === "ai_competitors_xpoz")!.bodyEn).toContain(
      "Old Kit Product",
    );
    expect(fixed.sections.find((s) => s.id === "ai_image_nano")!.bodyEn).toBe(
      nanoBefore.bodyEn,
    );
    expect(
      fixed.sections.find((s) => s.id === "ai_video_seedance")!.bodyEn,
    ).toBe(seedanceBefore.bodyEn);
  });
});

describe("MarketingLlmProvider fallback without key", () => {
  afterEach(() => {
    resetMarketingLlmProvider();
  });

  it("returns missing_key when Gemini env is empty", async () => {
    const provider = createGeminiMarketingLlmProvider();
    const r = await provider.fillIntroLessonBodies(
      { name: "Test", category: "home_kitchen" },
      { env: {} },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_key");
  });

  it("accepts injected provider success for seam swap", async () => {
    const lesson = buildIntroLesson({
      name: "Injected",
      category: "home_kitchen",
    });
    lesson.source = "gemini";
    const fake: MarketingLlmProvider = {
      async fillIntroLessonBodies() {
        return { ok: true, lesson };
      },
      async improveStorePageCopy() {
        return { ok: false, error: "missing_key" };
      },
      async improveStoreShopPageCopy() {
        return { ok: false, error: "missing_key" };
      },
      async improveCreativesKit() {
        return { ok: false, error: "missing_key" };
      },
      async polishCreativeVisualSuggestion() {
        return { ok: false, error: "missing_key" };
      },
    };
    setMarketingLlmProvider(fake);
    const r = await fake.fillIntroLessonBodies({
      name: "Injected",
      category: "home_kitchen",
    });
    expect(r.ok).toBe(true);
  });
});

describe("Intro Xpoz accordion (panel source)", () => {
  it("special-cases ai_competitors_xpoz Copy / Open Claude / Xpoz URL; kit cards do not gain Xpoz", () => {
    const panel = readFileSync(
      path.join(
        process.cwd(),
        "src/components/marketing/MarketingPanel.tsx",
      ),
      "utf8",
    );
    expect(panel).toMatch(/section\.id === "ai_competitors_xpoz"/);
    expect(panel).toMatch(/XPOZ_MCP_CONNECTOR_URL/);
    expect(panel).toMatch(/buildXpozClaudePrompt/);
    expect(panel).toMatch(/lessonXpozHowTo1/);
    expect(panel).toMatch(/lessonXpozHowTo2/);
    expect(panel).toMatch(/lessonXpozHowTo3/);
    expect(panel).toMatch(/lessonXpozOpenClaude/);
    expect(panel).toMatch(/deskCopied/);
    expect(panel).toMatch(/copyTextToClipboard/);

    const xpozAt = panel.indexOf('section.id === "ai_competitors_xpoz"');
    expect(xpozAt).toBeGreaterThan(0);
    const xpozSlice = panel.slice(xpozAt, xpozAt + 2500);
    expect(xpozSlice).not.toMatch(/generateVisualAction/);

    const seedanceHowTo = panel.slice(
      panel.indexOf("visualSeedanceHowTo1"),
      panel.indexOf("visualSeedanceOpenClaude") + 80,
    );
    expect(seedanceHowTo).toMatch(/HIGGSFIELD_MCP_CONNECTOR_URL/);
    expect(seedanceHowTo).not.toMatch(/Xpoz|xpoz|XPOZ/);

    const genAt = panel.indexOf("generateVisualAction(");
    expect(genAt).toBeGreaterThan(0);
    expect(panel.slice(genAt, genAt + 400)).not.toMatch(/Xpoz|xpoz|XPOZ/);

    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.lessonXpozHowTo1).toMatch(/Xpoz/);
    expect(en.Marketing.lessonXpozOpenClaude).toMatch(/Open Claude/i);
    expect(ar.Marketing.lessonXpozHowTo1).toMatch(/Xpoz/);
    expect(ar.Marketing.lessonXpozOpenClaude).toMatch(/Claude/);
  });
});

describe("Intro rail stays fixed (panel source)", () => {
  it("IntroLessonBlock has no audit regenerate; Try AI fill again stays template-only", () => {
    const panel = readFileSync(
      path.join(
        process.cwd(),
        "src/components/marketing/MarketingPanel.tsx",
      ),
      "utf8",
    );
    const introBlock = panel.slice(
      panel.indexOf("function IntroLessonBlock("),
      panel.indexOf("function IntroAccordionRow("),
    );
    expect(introBlock).not.toMatch(/lessonAuditRegenerate/);
    expect(introBlock).not.toMatch(
      /TEMPORARY 2026-08-27 founder audit/,
    );
    expect(introBlock).not.toMatch(/window\.confirm/);
    expect(introBlock).toMatch(/regenerateIntro/);

    const tryAt = introBlock.indexOf('t("tryAiFillAgain")');
    expect(tryAt).toBeGreaterThan(0);
    const beforeTry = introBlock.slice(0, tryAt);
    expect(beforeTry).toMatch(/lesson\.source === "template"/);

    const stageCard = panel.slice(
      panel.indexOf("function StageCard("),
      panel.indexOf("function KitBlock("),
    );
    expect(stageCard).toMatch(
      /showGenerate = !\(stage === "intro_pdf" && hasKit\)/,
    );
    expect(stageCard).toMatch(/\{showGenerate && \(/);
    expect(stageCard).not.toMatch(/lessonAuditRegenerate/);

    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string | undefined> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string | undefined> };
    expect(en.Marketing.lessonAuditRegenerate).toBeUndefined();
    expect(en.Marketing.lessonAuditRegenerateConfirm).toBeUndefined();
    expect(ar.Marketing.lessonAuditRegenerate).toBeUndefined();
    expect(en.Marketing.tryAiFillAgain).toBe("Try AI fill again");
  });
});
