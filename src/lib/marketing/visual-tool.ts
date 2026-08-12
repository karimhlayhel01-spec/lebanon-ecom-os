/**
 * Wave 4 Phase 5 — skills-first visual tool suggest + copyable prompts.
 * Nano Banana (stills) / Seedance (motion) / phone film. No in-app gen.
 * Paste-out text stays founder-facing (no OS / Topic A / unlock meta).
 */

import type { MarketingStage } from "@/lib/constants";
import type { Creative } from "@/lib/marketing/creatives";

export type CreativeVisualTool = "nano_banana" | "seedance" | "phone_film";

export type CreativeVisualSuggestion = {
  tool: CreativeVisualTool;
  whyEn: string;
  whyAr: string;
  promptEn: string;
  promptAr: string;
};

export type SuggestCreativeVisualToolInput = {
  creative: Creative;
  productName: string;
  stage: Extract<
    MarketingStage,
    "pre_launch" | "launch" | "weekly_refresh"
  >;
};

function stageSoftRules(stage: SuggestCreativeVisualToolInput["stage"]): {
  en: string;
  ar: string;
} {
  if (stage === "pre_launch") {
    return {
      en: "Soft teaser only — follow / save / waitlist. No hard order CTA, no gift-to-customer angle, no buyer-UGC-as-proof.",
      ar: "تشويقة ناعمة فقط — متابعة / حفظ / قائمة انتظار. بلا طلب شراء قاسٍ، بلا زاوية هدية للعميل، بلا شهادة مشتري كإثبات.",
    };
  }
  return {
    en: "WhatsApp is the order path. Never pitch COD / cash-on-delivery as a wow. No ROAS, budgets, or finance advice.",
    ar: "واتساب هو مسار الطلب. لا تروّج للدفع عند الاستلام كتميّز. بلا ROAS أو ميزانيات أو نصيحة مالية.",
  };
}

/**
 * Default routing by creative format (skills — not LLM).
 * post/carousel → Nano Banana; reel/story/ugc → Seedance;
 * testimonial → phone film (talking-head friendly).
 */
export function routeCreativeVisualTool(format: string): CreativeVisualTool {
  const f = format.trim().toLowerCase();
  if (f === "post" || f === "carousel") return "nano_banana";
  if (f === "reel" || f === "story" || f === "ugc") return "seedance";
  if (f === "testimonial") return "phone_film";
  // Unknown formats: stills are safest.
  return "nano_banana";
}

function toolWhy(tool: "nano_banana" | "seedance"): { en: string; ar: string } {
  if (tool === "nano_banana") {
    return {
      en: "Still frames / carousels fit Nano Banana — generate a clean product still, then post.",
      ar: "الإطارات الثابتة / الكاروسيل تناسب Nano Banana — ولّد صورة منتج نظيفة ثم انشر.",
    };
  }
  return {
    en: "Short motion fits Seedance — turn the hook + shots into a quick clip.",
    ar: "الحركة القصيرة تناسب Seedance — حوّل الخطّاف واللقطات إلى مقطع سريع.",
  };
}

function phoneFilmWhy(): { en: string; ar: string } {
  return {
    en: "Talking-head / testimonial — film on your phone (no AI). Keep it natural and clear.",
    ar: "شهادة / حديث أمام الكاميرا — صوّر بهاتفك (بدون ذكاء اصطناعي). ابقَ طبيعياً وواضحاً.",
  };
}

function shotsBlock(shots: string[]): string {
  const lines = shots.map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return "- (add 3–5 elaborated shot lines)";
  return lines.map((s) => `- ${s}`).join("\n");
}

function howToLine(howTo: string, locale: "en" | "ar"): string {
  const t = howTo.trim();
  if (!t) {
    return locale === "ar"
      ? "كيف تصوّر: هاتف عمودي، ضوء نافذة، اللقطات بالترتيب."
      : "How to shoot: phone vertical, window light, film shots in order.";
  }
  return locale === "ar" ? `كيف تصوّر: ${t}` : `How to shoot: ${t}`;
}

function buildNanoPrompt(args: {
  name: string;
  hook: string;
  shots: string[];
  howTo: string;
  rules: string;
  locale: "en" | "ar";
}): string {
  if (args.locale === "ar") {
    return [
      `أنشئ صورة ثابتة واضحة لمنتج Lebanon ecommerce: ${args.name}.`,
      `الخطّاف / الفكرة: ${args.hook || "أظهر المنتج في سياقه اليومي."}`,
      `اللقطات / التكوين (اتبع التفاصيل — إطار، ضوء، حركة):`,
      shotsBlock(args.shots),
      howToLine(args.howTo, "ar"),
      `قواعد: ${args.rules}`,
      `لا نص تسويقي كثيف على الصورة. لا شعارات COD. إضاءة طبيعية، واقعية، جاهزة لسوشيال.`,
    ].join("\n");
  }
  return [
    `Create a clean still image for a Lebanon ecommerce product: ${args.name}.`,
    `Hook / idea: ${args.hook || "Show the product in its everyday context."}`,
    `Shots / composition (follow camera, framing, and action cues):`,
    shotsBlock(args.shots),
    howToLine(args.howTo, "en"),
    `Rules: ${args.rules}`,
    `No dense marketing text on the image. No COD slogans. Natural light, realistic, social-ready.`,
  ].join("\n");
}

function buildSeedancePrompt(args: {
  name: string;
  hook: string;
  shots: string[];
  howTo: string;
  rules: string;
  locale: "en" | "ar";
}): string {
  if (args.locale === "ar") {
    return [
      `أنشئ مقطعاً قصيراً متحركاً (ريل/ستوري) لـ ${args.name}.`,
      `افتتاح الخطّاف (١–٣ ثوانٍ): ${args.hook || "اجذب الانتباه فوراً بالمنتج."}`,
      `تسلسل اللقطات (اتبع الإطار والحركة والمدة):`,
      shotsBlock(args.shots),
      howToLine(args.howTo, "ar"),
      `قواعد: ${args.rules}`,
      `إيقاع سريع، نص على الشاشة خفيف إن لزم، بلا pitch للدفع عند الاستلام.`,
    ].join("\n");
  }
  return [
    `Create a short motion clip (reel/story) for ${args.name}.`,
    `Hook open (1–3s): ${args.hook || "Grab attention immediately with the product."}`,
    `Shot sequence (follow framing, camera move, and duration cues):`,
    shotsBlock(args.shots),
    howToLine(args.howTo, "en"),
    `Rules: ${args.rules}`,
    `Fast pacing, light on-screen text if needed, never pitch COD / cash-on-delivery.`,
  ].join("\n");
}

function buildPhoneFilmPrompt(args: {
  name: string;
  hook: string;
  shots: string[];
  howTo: string;
  rules: string;
  locale: "en" | "ar";
}): string {
  if (args.locale === "ar") {
    return [
      `خطة تصوير بالهاتف لشهادة / حديث عن ${args.name} (بدون أدوات توليد فيديو).`,
      `ماذا تقول أولاً: ${args.hook || "لماذا يهم هذا المنتج في جملة واحدة."}`,
      `لقطات (اتبع الإطار والحركة):`,
      shotsBlock(args.shots),
      howToLine(args.howTo, "ar"),
      `قواعد: ${args.rules}`,
      `ثبّت الهاتف، ضوء نافذة، صوت واضح، ١٥–٣٠ ثانية. الصق التعليق من الحزمة بعد التصوير.`,
    ].join("\n");
  }
  return [
    `Phone-film checklist for a testimonial / talking-head about ${args.name} (no AI video tool).`,
    `Say first: ${args.hook || "Why this product matters in one sentence."}`,
    `Shots (follow framing and action cues):`,
    shotsBlock(args.shots),
    howToLine(args.howTo, "en"),
    `Rules: ${args.rules}`,
    `Stabilize the phone, window light, clear audio, 15–30s. Paste the kit caption after you film.`,
  ].join("\n");
}

/**
 * Skills-first suggestion for one creative card (no network).
 */
export function suggestCreativeVisualTool(
  input: SuggestCreativeVisualToolInput,
): CreativeVisualSuggestion {
  const name = input.productName.trim() || "your product";
  const tool = routeCreativeVisualTool(input.creative.format);
  const rules = stageSoftRules(input.stage);
  const hookEn =
    input.creative.hookEn?.trim() ||
    input.creative.angleEn?.trim() ||
    name;
  const hookAr =
    input.creative.hookAr?.trim() ||
    input.creative.angleAr?.trim() ||
    name;
  const shots = input.creative.shots ?? [];
  const howToEn = input.creative.howToShootEn?.trim() ?? "";
  const howToAr = input.creative.howToShootAr?.trim() ?? "";

  if (tool === "phone_film") {
    const why = phoneFilmWhy();
    return {
      tool,
      whyEn: why.en,
      whyAr: why.ar,
      promptEn: buildPhoneFilmPrompt({
        name,
        hook: hookEn,
        shots,
        howTo: howToEn,
        rules: rules.en,
        locale: "en",
      }),
      promptAr: buildPhoneFilmPrompt({
        name,
        hook: hookAr,
        shots,
        howTo: howToAr || howToEn,
        rules: rules.ar,
        locale: "ar",
      }),
    };
  }

  if (tool === "seedance") {
    const why = toolWhy("seedance");
    return {
      tool,
      whyEn: why.en,
      whyAr: why.ar,
      promptEn: buildSeedancePrompt({
        name,
        hook: hookEn,
        shots,
        howTo: howToEn,
        rules: rules.en,
        locale: "en",
      }),
      promptAr: buildSeedancePrompt({
        name,
        hook: hookAr,
        shots,
        howTo: howToAr || howToEn,
        rules: rules.ar,
        locale: "ar",
      }),
    };
  }

  const why = toolWhy("nano_banana");
  return {
    tool: "nano_banana",
    whyEn: why.en,
    whyAr: why.ar,
    promptEn: buildNanoPrompt({
      name,
      hook: hookEn,
      shots,
      howTo: howToEn,
      rules: rules.en,
      locale: "en",
    }),
    promptAr: buildNanoPrompt({
      name,
      hook: hookAr,
      shots,
      howTo: howToAr || howToEn,
      rules: rules.ar,
      locale: "ar",
    }),
  };
}

/** Ban list for paste-out prompts (Phase 3 desk rule). */
export function visualPromptHasOsMeta(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.includes("Lebanon Ecom OS") ||
    text.includes("Topic A") ||
    lower.includes("capacity tier") ||
    lower.includes("stage unlock") ||
    /source of truth/i.test(text)
  );
}

export function validateVisualSuggestion(
  suggestion: CreativeVisualSuggestion,
  productName: string,
): boolean {
  const name = productName.trim() || "your product";
  if (!suggestion.whyEn.trim() || !suggestion.whyAr.trim()) return false;
  if (!suggestion.promptEn.trim() || !suggestion.promptAr.trim()) return false;
  if (
    !suggestion.promptEn.includes(name) &&
    name !== "your product"
  ) {
    return false;
  }
  if (
    visualPromptHasOsMeta(suggestion.promptEn) ||
    visualPromptHasOsMeta(suggestion.promptAr) ||
    visualPromptHasOsMeta(suggestion.whyEn) ||
    visualPromptHasOsMeta(suggestion.whyAr)
  ) {
    return false;
  }
  return true;
}
