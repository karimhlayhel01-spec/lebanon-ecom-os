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
  /** SKU industry id. Habitat fallback; pack photos + card beat still win. */
  category?: string;
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

export function skuLooksLikeChargingRing(args: {
  category: string;
  productName: string;
  hook: string;
  shots: string[];
}): boolean {
  const blob = [args.productName, args.hook, ...args.shots]
    .join(" ")
    .toLowerCase();
  if (/\bring lights?\b/.test(blob)) return false;
  if (/\b(ringconn|smart ring)\b/.test(blob)) return true;
  if (/\b(charging case|charging dock)\b/.test(blob)) return true;
  const cat = args.category.trim();
  if (
    (cat === "health_wellness_gadgets" || cat === "fashion_accessories") &&
    /\brings?\b/.test(blob)
  ) {
    return true;
  }
  return false;
}

/** Positive room for this SKU. Do not name banned props (plate, village, mug). */
export function nanoVisualHabitat(args: {
  category: string;
  productName: string;
  hook: string;
  shots: string[];
}): { en: string; ar: string } {
  if (skuLooksLikeChargingRing(args)) {
    return {
      en: "Indoor nightstand. The ring sits in its charging case. Window light from the side.",
      ar: "منضدة داخلية. الخاتم في علبة الشحن الخاصة به. ضوء نافذة جانبي.",
    };
  }
  switch (args.category.trim()) {
    case "home_kitchen":
      return {
        en: "Clean kitchen counter that fits this tool. Window light from the side.",
        ar: "سطح مطبخ نظيف يناسب هذه الأداة. ضوء نافذة جانبي.",
      };
    case "phone_tech_accessories":
      return {
        en: "Indoor desk. This product and its own cable or charger only. Window light from the side.",
        ar: "مكتب داخلي. هذا المنتج وكابله أو شاحنه فقط. ضوء نافذة جانبي.",
      };
    case "office_desk_gadgets":
      return {
        en: "Indoor desk, window light from the side.",
        ar: "مكتب داخلي، ضوء نافذة جانبي.",
      };
    case "beauty_personal_care":
      return {
        en: "Indoor shelf or sink, this product only. Window light from the side.",
        ar: "رف أو حوض داخلي، هذا المنتج فقط. ضوء نافذة جانبي.",
      };
    case "fashion_accessories":
      return {
        en: "Indoor cloth, this accessory only. Window light from the side.",
        ar: "قماش داخلي، هذه الإكسسوارات فقط. ضوء نافذة جانبي.",
      };
    case "fitness_lifestyle":
      return {
        en: "Apartment floor or mat, this product only. Window light from the side.",
        ar: "أرضية شقة أو حصيرة، هذا المنتج فقط. ضوء نافذة جانبي.",
      };
    case "kids_baby_accessories":
    case "pet_accessories":
      return {
        en: "Calm indoor surface, this product only. Window light from the side.",
        ar: "سطح داخلي هادئ، هذا المنتج فقط. ضوء نافذة جانبي.",
      };
    case "car_accessories":
      return {
        en: "Car cabin or dash, this product only.",
        ar: "مقصورة أو لوحة السيارة، هذا المنتج فقط.",
      };
    case "health_wellness_gadgets":
      return {
        en: "Indoor nightstand, this product only. Window light from the side.",
        ar: "منضدة داخلية، هذا المنتج فقط. ضوء نافذة جانبي.",
      };
    default:
      return {
        en: "Indoor setting that fits this product. Window light from the side.",
        ar: "مشهد داخلي يناسب هذا المنتج. ضوء نافذة جانبي.",
      };
  }
}

/** First still/slide only — do not feed the rest of a carousel into Nano. */
function firstStillComposition(shots: string[]): string {
  const lines = shots.map((s) => s.trim()).filter(Boolean);
  const captionish = /^(caption\b|end card\b)/i;
  const preferred = lines.find(
    (line) =>
      /^(still\s*1|slide\s*1)\b/i.test(line) && !captionish.test(line),
  );
  const first = preferred ?? lines.find((line) => !captionish.test(line));
  return first ?? "";
}

function productOnlyComposition(
  locale: "en" | "ar",
  habitat: { en: string; ar: string },
): string {
  return locale === "ar"
    ? `${habitat.ar} حجم حقيقي. القطع الصغيرة (خواتم) بحجم المجوهرات كما تُباع. بلا أيدٍ أو وجوه أو أشخاص. بلا أدوات مطبخ مخترعة.`
    : `${habitat.en} True-to-life scale. Small items (rings) jewelry-sized as sold. No hands, no faces, no people. No invented kitchenware.`;
}

/** Drop film-plan overlay / timing so Nano is not asked to paint slogans or 0–3s beats. */
function stripNanoFilmPlanNoise(line: string): string {
  let s = line.trim();
  s = s.replace(/^\d+\s*[–-]\s*\d+\s*s\s*\|\s*/i, "");
  s = s.replace(/\btext overlay\s*:\s*['"“”][^'"“”]*['"“”]/gi, "");
  s = s.replace(/\btext overlay\s*:\s*.+$/gi, "");
  s = s.replace(/\bon-screen text\b[^.]*/gi, "");
  s = s.replace(/\bsay or text\s*[:—–-]\s*['"“”][^'"“”]*['"“”]/gi, "");
  s = s.replace(/\bsay or text\b[^.]*/gi, "");
  s = s.replace(/\bproduct large in frame\b/gi, "");
  s = s.replace(/\bkeep(?:s|ing)? the product large\b/gi, "");
  s = s.replace(/\bproduct large\b/gi, "");
  s = s.replace(/\bfill(?:s|ing)?(?: the)? frame(?: with context)?\b/gi, "");
  s = s.replace(/\bphone (?:vertical|horizontal|square)\b/gi, "");
  s = s.replace(/\bhold(?:s|ing)?(?: the)? phone\b/gi, "");
  s = s.replace(/\bhandheld\b/gi, "");
  s = s.replace(/\b(?:mugs?|teacups?|saucers?|plates?|books?|phones?)\b/gi, "");
  s = s.replace(/\btea\b/gi, "");
  s = s.replace(/كوب|شاي|صحن|طبق|كتاب|هاتف/g, "");
  s = s.replace(/\b(villages?|countryside|postcards?|souks?|skylines?)\b/gi, "");
  s = s.replace(/\b(?:scenic\s+)?landscapes?\b/gi, "");
  s = s.replace(/\bmountain towns?\b/gi, "");
  s = s.replace(/قرية|ريف|بطاقة بريدية/g, "");
  s = s.replace(/,\s*,/g, ",").replace(/\s+/g, " ").replace(/[\s,;:—–-]+$/g, "").trim();
  return s;
}

function isPeopleAnatomyShot(line: string): boolean {
  if (
    /\b(hands?|fingers?|faces?|palm|wrist|selfie|wearing|placing|onto a finger|on a finger|people|person|woman|man|yoga)\b/i.test(
      line,
    )
  ) {
    return true;
  }
  return /يد|إصبع|أصابع|أصبع|وجه/.test(line);
}

function nanoStillComposition(
  shots: string[],
  locale: "en" | "ar",
  habitat: { en: string; ar: string },
): string {
  const raw = firstStillComposition(shots);
  if (!raw) return productOnlyComposition(locale, habitat);
  const cleaned = stripNanoFilmPlanNoise(raw);
  if (!cleaned || isPeopleAnatomyShot(cleaned)) {
    return productOnlyComposition(locale, habitat);
  }
  return cleaned;
}

function buildNanoPrompt(args: {
  name: string;
  hook: string;
  shots: string[];
  rules: string;
  locale: "en" | "ar";
  habitat: { en: string; ar: string };
}): string {
  const composition = nanoStillComposition(
    args.shots,
    args.locale,
    args.habitat,
  );
  const habitatLine =
    args.locale === "ar" ? args.habitat.ar : args.habitat.en;
  if (args.locale === "ar") {
    return [
      `أنشئ صورة فوتوغرافية واحدة لمنتج Lebanon ecommerce: ${args.name}.`,
      `المزاج / الفكرة (لا ترسم هذا نصاً على الصورة): ${args.hook || "أظهر المنتج في سياقه اليومي."}`,
      `التكوين (هذا الإطار فقط): ${composition}`,
      `المكان: ${habitatLine}`,
      `قواعد: ${args.rules}`,
      `صورة واحدة فقط — ليست شبكة أو كولاج أو لوحة مزاج أو عدة شرائح في ملف واحد.`,
      `بلا حروف أو كلمات أو شعارات أو علامات مائية أو واجهة تطبيق أو تعليقات مرسومة على الصورة. النقش على المنتج نفسه مقبول.`,
      `بلا أيدٍ أو وجوه أو أشخاص في الإطار. حجم حقيقي في المشهد. المشهد من مزاج البطاقة وصور الحزمة. إضاءة طبيعية، واقعية، جاهزة لسوشيال.`,
    ].join("\n");
  }
  return [
    `Create one photograph of a Lebanon ecommerce product: ${args.name}.`,
    `Mood / idea (do not paint this as text on the image): ${args.hook || "Show the product in its everyday context."}`,
    `Composition (this one frame only): ${composition}`,
    `Setting: ${habitatLine}`,
    `Rules: ${args.rules}`,
    `One photograph only — not a grid, collage, moodboard, multi-panel, or carousel-in-one-file.`,
    `No letters, words, slogans, watermarks, logos, app UI, or captions on the image. Product engraving on the physical item is fine.`,
    `No hands, no faces, no people in the frame. True-to-life scale: the product is its real size in the scene. Scene from this card's mood and pack photos. Natural light, realistic, social-ready.`,
  ].join("\n");
}

function buildSeedancePrompt(args: {
  name: string;
  hook: string;
  shots: string[];
  rules: string;
  locale: "en" | "ar";
  habitat: { en: string; ar: string };
}): string {
  const beat = nanoStillComposition(
    args.shots,
    args.locale,
    args.habitat,
  );
  const habitatLine =
    args.locale === "ar" ? args.habitat.ar : args.habitat.en;
  if (args.locale === "ar") {
    return [
      `أنشئ مقطعاً قصيراً متحركاً (ريل/ستوري) لـ ${args.name}.`,
      `المزاج / الحركة (لا ترسم شعارات على الإطارات): ${args.hook || "اجذب الانتباه فوراً بالمنتج."}`,
      `الحركة (هذا المقطع): ${beat}`,
      `المكان: ${habitatLine}`,
      `قواعد: ${args.rules}`,
      `مقطع واحد قصير — ليست شبكة أو كولاج. حجم حقيقي. المشهد من مزاج البطاقة وصور الحزمة.`,
      `بلا حروف أو شعارات على الإطارات. بلا أيدٍ أو وجوه أو أشخاص. إضاءة طبيعية، إيقاع سريع.`,
    ].join("\n");
  }
  return [
    `Create a short motion clip (reel/story) of a Lebanon ecommerce product: ${args.name}.`,
    `Mood / action (do not paint slogans on the frames): ${args.hook || "Grab attention immediately with the product."}`,
    `Motion (this clip): ${beat}`,
    `Setting: ${habitatLine}`,
    `Rules: ${args.rules}`,
    `One short clip — not a grid, collage, or multi-panel. True-to-life scale. Scene from this card's mood and pack photos.`,
    `No letters or slogans on the frames. No hands, no faces, no people. Natural light, fast pacing.`,
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
    const habitat = nanoVisualHabitat({
      category: input.category ?? "",
      productName: name,
      hook: hookEn,
      shots,
    });
    return {
      tool,
      whyEn: why.en,
      whyAr: why.ar,
      promptEn: buildSeedancePrompt({
        name,
        hook: hookEn,
        shots,
        rules: rules.en,
        locale: "en",
        habitat,
      }),
      promptAr: buildSeedancePrompt({
        name,
        hook: hookAr,
        shots,
        rules: rules.ar,
        locale: "ar",
        habitat,
      }),
    };
  }

  const why = toolWhy("nano_banana");
  const habitat = nanoVisualHabitat({
    category: input.category ?? "",
    productName: name,
    hook: hookEn,
    shots,
  });
  return {
    tool: "nano_banana",
    whyEn: why.en,
    whyAr: why.ar,
    promptEn: buildNanoPrompt({
      name,
      hook: hookEn,
      shots,
      rules: rules.en,
      locale: "en",
      habitat,
    }),
    promptAr: buildNanoPrompt({
      name,
      hook: hookAr,
      shots,
      rules: rules.ar,
      locale: "ar",
      habitat,
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

/** Film-plan leaks that make Nano/Seedance paint overlays / hands. "No hands" is allowed. */
export function isUnsafeHiggsfieldVisualPrompt(
  text: string,
  opts?: { allowClipTimings?: boolean },
): boolean {
  if (/text overlay/i.test(text)) return true;
  if (
    !opts?.allowClipTimings &&
    /\b\d+\s*[–-]\s*\d+\s*s\b/i.test(text)
  ) {
    return true;
  }
  if (/how to shoot:/i.test(text) || /كيف تصوّر:/.test(text)) return true;
  if (/slide\s*2/i.test(text)) return true;
  if (/readable type/i.test(text)) return true;
  if (/\ba hand\b/i.test(text)) return true;
  if (/\bonto a finger\b/i.test(text)) return true;
  if (/\bplacing\b/i.test(text)) return true;
  if (/\bhand gently\b/i.test(text)) return true;
  if (/large in frame/i.test(text)) return true;
  if (/fill(?:s|ing)?(?: the)? frame/i.test(text)) return true;
  if (/\bgiant\b/i.test(text)) return true;
  if (/\bhuge\b/i.test(text)) return true;
  if (/\bmonumental\b/i.test(text)) return true;
  if (/\b(mugs?|teacups?|saucers?|plates?|books?|phones?)\b/i.test(text)) {
    return true;
  }
  if (/\btea\b/i.test(text)) return true;
  if (/كوب|شاي|صحن|طبق|كتاب|هاتف/.test(text)) return true;
  if (/\b(villages?|countryside|postcards?|souks?|skylines?)\b/i.test(text)) {
    return true;
  }
  if (/scenic landscape/i.test(text) || /\blandscapes?\b/i.test(text)) {
    return true;
  }
  if (/\bmountain towns?\b/i.test(text)) return true;
  if (/قرية|ريف|بطاقة بريدية/.test(text)) return true;
  return false;
}

export function isUnsafeNanoHiggsfieldPrompt(text: string): boolean {
  return isUnsafeHiggsfieldVisualPrompt(text);
}

export function isUnsafeSeedanceHiggsfieldPrompt(text: string): boolean {
  return isUnsafeHiggsfieldVisualPrompt(text, { allowClipTimings: true });
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
  if (
    suggestion.tool === "nano_banana" &&
    (isUnsafeNanoHiggsfieldPrompt(suggestion.promptEn) ||
      isUnsafeNanoHiggsfieldPrompt(suggestion.promptAr))
  ) {
    return false;
  }
  if (
    suggestion.tool === "seedance" &&
    (isUnsafeSeedanceHiggsfieldPrompt(suggestion.promptEn) ||
      isUnsafeSeedanceHiggsfieldPrompt(suggestion.promptAr))
  ) {
    return false;
  }
  return true;
}
