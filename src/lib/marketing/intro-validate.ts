/**
 * Intro lesson body validation — accept Gemini fill or reject to template fallback.
 */

import { nicheFor, textHasCodPitch } from "@/lib/marketing/brief";
import {
  ALL_INTRO_SECTION_IDS,
  INTRO_LESSON_SECTION_IDS,
  INTRO_LITERACY_SECTION_IDS,
  INTRO_SECTION_TITLES,
  applyCanonicalTitles,
  type IntroLessonInput,
  type IntroLessonPayload,
  type IntroLessonSection,
  type IntroLessonSectionId,
  isIntroLessonSectionId,
} from "@/lib/marketing/intro-lesson";

export const INTRO_BODY_MIN_CORE = 48;
export const INTRO_BODY_MIN_LITERACY = 36;

export type IntroValidateError =
  | "missing_sections"
  | "unknown_id"
  | "empty_body"
  | "too_short"
  | "cod_pitch"
  | "missing_product_name"
  | "invalid_shape";

export type IntroValidateResult =
  | { ok: true; lesson: IntroLessonPayload }
  | { ok: false; error: IntroValidateError };

export type IntroBodyFill = {
  id: string;
  bodyEn: string;
  bodyAr: string;
};

function minFor(id: IntroLessonSectionId): number {
  return (INTRO_LITERACY_SECTION_IDS as readonly string[]).includes(id)
    ? INTRO_BODY_MIN_LITERACY
    : INTRO_BODY_MIN_CORE;
}

/** Core sections must name the product in EN (and preferably AR). */
function requiresProductName(id: IntroLessonSectionId): boolean {
  return (INTRO_LESSON_SECTION_IDS as readonly string[]).includes(id);
}

/**
 * Build a validated Intro payload from model body fills + facts.
 * Titles always come from INTRO_SECTION_TITLES (model titles ignored).
 */
export function validateAndAssembleIntroLesson(args: {
  productName: string;
  category: string;
  bodies: IntroBodyFill[];
  source?: IntroLessonPayload["source"];
}): IntroValidateResult {
  const productName = args.productName.trim() || "your product";
  const category = args.category.trim() || "unknown";

  if (!Array.isArray(args.bodies) || args.bodies.length === 0) {
    return { ok: false, error: "invalid_shape" };
  }

  const byId = new Map<string, IntroBodyFill>();
  for (const row of args.bodies) {
    if (!row || typeof row.id !== "string") {
      return { ok: false, error: "invalid_shape" };
    }
    if (!isIntroLessonSectionId(row.id)) {
      return { ok: false, error: "unknown_id" };
    }
    const bodyEn = typeof row.bodyEn === "string" ? row.bodyEn.trim() : "";
    const bodyAr = typeof row.bodyAr === "string" ? row.bodyAr.trim() : "";
    byId.set(row.id, { id: row.id, bodyEn, bodyAr });
  }

  for (const id of ALL_INTRO_SECTION_IDS) {
    if (!byId.has(id)) {
      return { ok: false, error: "missing_sections" };
    }
  }

  const sections: IntroLessonSection[] = [];
  for (const id of ALL_INTRO_SECTION_IDS) {
    const row = byId.get(id)!;
    if (!row.bodyEn || !row.bodyAr) {
      return { ok: false, error: "empty_body" };
    }
    const min = minFor(id);
    if (row.bodyEn.length < min || row.bodyAr.length < min) {
      return { ok: false, error: "too_short" };
    }
    if (textHasCodPitch(`${row.bodyEn}\n${row.bodyAr}`)) {
      return { ok: false, error: "cod_pitch" };
    }
    if (requiresProductName(id)) {
      const enHas = row.bodyEn.includes(productName);
      const arHas = row.bodyAr.includes(productName);
      if (!enHas && !arHas) {
        return { ok: false, error: "missing_product_name" };
      }
      // Prefer EN always names the product for core sections.
      if (!enHas) {
        return { ok: false, error: "missing_product_name" };
      }
    }
    const titles = INTRO_SECTION_TITLES[id];
    sections.push({
      id,
      titleEn: titles.titleEn,
      titleAr: titles.titleAr,
      bodyEn: row.bodyEn,
      bodyAr: row.bodyAr,
    });
  }

  return {
    ok: true,
    lesson: applyCanonicalTitles({
      kind: "intro_lesson",
      productName,
      category,
      source: args.source ?? "gemini",
      sections,
    }),
  };
}

/** Facts pack sent to the Marketing LLM (no secrets). */
export function buildIntroFactsPack(input: IntroLessonInput) {
  const name = input.name.trim() || "your product";
  const category = input.category.trim();
  const niche = nicheFor(category);
  return {
    productName: name,
    category: category || "unknown",
    differentiation: input.differentiation?.trim() || null,
    hooks: (input.hooks ?? [])
      .map((h) => h.trim())
      .filter((h) => h && !h.startsWith("@"))
      .slice(0, 5),
    niche: {
      worldEn: niche.worldEn,
      worldAr: niche.worldAr,
      similarViewersEn: niche.similarViewersEn,
      similarViewersAr: niche.similarViewersAr,
      promiseEn: niche.promiseEn.replace(/\{name\}/g, name),
      promiseAr: niche.promiseAr.replace(/\{name\}/g, name),
      series1En: niche.series1En.replace(/\{name\}/g, name),
      series1Ar: niche.series1Ar.replace(/\{name\}/g, name),
      series2En: niche.series2En.replace(/\{name\}/g, name),
      series2Ar: niche.series2Ar.replace(/\{name\}/g, name),
      series3En: niche.series3En.replace(/\{name\}/g, name),
      series3Ar: niche.series3Ar.replace(/\{name\}/g, name),
      strongHookEn: niche.strongHookEn.replace(/\{name\}/g, name),
      strongHookAr: niche.strongHookAr.replace(/\{name\}/g, name),
      weakHookEn: niche.weakHookEn.replace(/\{name\}/g, name),
      weakHookAr: niche.weakHookAr.replace(/\{name\}/g, name),
    },
    sectionIds: [...ALL_INTRO_SECTION_IDS],
    coreIds: [...INTRO_LESSON_SECTION_IDS],
    literacyIds: [...INTRO_LITERACY_SECTION_IDS],
  };
}
