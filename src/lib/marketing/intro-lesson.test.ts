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
    expect(llm).toMatch(/Nano Banana Generate is IN this OS/);
    expect(llm).not.toMatch(/Say tools are external/);
    expect(llm).toMatch(/Do not name Higgsfield/);
    expect(llm).toMatch(/ai_video_seedance/);
  });

  it("literacy kicker does not say every tool is external", () => {
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.lessonAiLiteracyIntro).toMatch(/Nano Generate is in this OS/i);
    expect(en.Marketing.lessonAiLiteracyIntro).not.toMatch(/tools stay external/i);
    expect(ar.Marketing.lessonAiLiteracyIntro).toMatch(/توليد Nano داخل هذا النظام/);
    expect(ar.Marketing.lessonAiLiteracyIntro).not.toMatch(/الأدوات خارجية/);
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
