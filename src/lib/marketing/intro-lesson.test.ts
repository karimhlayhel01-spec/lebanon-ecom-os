import { describe, expect, it } from "vitest";
import {
  INTRO_LESSON_SECTION_IDS,
  buildIntroLesson,
  introLessonHasCodPitch,
} from "@/lib/marketing/intro-lesson";

describe("buildIntroLesson", () => {
  it("returns intro_lesson with the same 8 section ids every time", () => {
    const lesson = buildIntroLesson({
      name: "Silicone Kitchen Set",
      category: "home_kitchen",
    });
    expect(lesson.kind).toBe("intro_lesson");
    expect(lesson.sections.map((s) => s.id)).toEqual([
      ...INTRO_LESSON_SECTION_IDS,
    ]);
    expect(lesson.sections).toHaveLength(8);
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
    expect(lesson.sections).toHaveLength(8);
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
});
