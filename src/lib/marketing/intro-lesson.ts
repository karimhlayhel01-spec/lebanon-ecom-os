/**
 * Marketing Intro — product-tailored beginner LESSON (not creatives).
 *
 * Deterministic templates: same 8 section ids for every SKU; product name,
 * category niche world, and hooks swap into examples. No LLM. No COD-as-
 * marketing-differentiator copy (Lebanon default — Finance/ops may track COD).
 */

import {
  fillNiche,
  nicheFor,
  textHasCodPitch,
  usefulHookLine,
} from "@/lib/marketing/brief";

export const INTRO_LESSON_SECTION_IDS = [
  "hook",
  "niche_signal",
  "why_follow",
  "reply_loop",
  "series",
  "three_metrics",
  "dm_order_clarity",
  "journey_map",
] as const;

export type IntroLessonSectionId = (typeof INTRO_LESSON_SECTION_IDS)[number];

export type IntroLessonSection = {
  id: IntroLessonSectionId;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
};

export type IntroLessonPayload = {
  kind: "intro_lesson";
  productName: string;
  category: string;
  sections: IntroLessonSection[];
};

export type IntroLessonInput = {
  name: string;
  category: string;
  differentiation?: string;
  hooks?: string[];
};

/**
 * Build a deterministic intro lesson for THIS SKU.
 * Same 8 section ids every time; examples swap with product + category.
 */
export function buildIntroLesson(input: IntroLessonInput): IntroLessonPayload {
  const name = input.name.trim() || "your product";
  const category = input.category.trim();
  const niche = nicheFor(category);
  const hookFromSku = usefulHookLine(input.hooks, name);
  const diff = input.differentiation?.trim();

  const strongEn = fillNiche(niche.strongHookEn, name);
  const strongAr = fillNiche(niche.strongHookAr, name);
  const weakEn = fillNiche(niche.weakHookEn, name);
  const weakAr = fillNiche(niche.weakHookAr, name);
  const series1En = fillNiche(niche.series1En, name);
  const series1Ar = fillNiche(niche.series1Ar, name);
  const series2En = fillNiche(niche.series2En, name);
  const series2Ar = fillNiche(niche.series2Ar, name);
  const series3En = fillNiche(niche.series3En, name);
  const series3Ar = fillNiche(niche.series3Ar, name);
  const promiseEn = fillNiche(niche.promiseEn, name);
  const promiseAr = fillNiche(niche.promiseAr, name);

  const sections: IntroLessonSection[] = [
    {
      id: "hook",
      titleEn: "1. Hook (first 1–3 seconds)",
      titleAr: "١. الخطّاف (الثواني ١–٣ الأولى)",
      bodyEn: [
        `When you sell ${name}, the first 1–3 seconds decide if anyone stays.`,
        `Why it matters: platforms reward watch time. A weak open wastes the rest of the clip.`,
        `Strong opening for ${name}: “${strongEn}”`,
        hookFromSku
          ? `Also lean on your product angle: ${hookFromSku}.`
          : diff
            ? `Also lean on what makes ${name} different: ${diff}.`
            : `Name the problem ${name} solves in the first breath — not your brand name.`,
        `Weak opening (avoid): “${weakEn}” — too slow, no product job.`,
      ].join("\n\n"),
      bodyAr: [
        `عندما تبيع ${name}، الثواني ١–٣ الأولى تقرّر إن بقي أحد.`,
        `لماذا يهم: المنصّات تكافئ وقت المشاهدة. افتتاح ضعيف يضيّع باقي المقطع.`,
        `افتتاح قوي لـ ${name}: «${strongAr}»`,
        hookFromSku
          ? `اعتمد أيضاً زاوية منتجك: ${hookFromSku}.`
          : diff
            ? `اعتمد أيضاً ما يميّز ${name}: ${diff}.`
            : `سمِّ المشكلة التي يحلّها ${name} من أول نفس — لا اسم علامتك.`,
        `افتتاح ضعيف (تجنّبه): «${weakAr}» — بطيء جداً، بلا وظيفة للمنتج.`,
      ].join("\n\n"),
    },
    {
      id: "niche_signal",
      titleEn: "2. Niche signal — your product’s world",
      titleAr: "٢. إشارة النيش — عالم منتجك",
      bodyEn: [
        `Platforms send ${name} to ${niche.similarViewersEn}.`,
        `Your “world” is ${niche.worldEn}. Every post should feel like it belongs there.`,
        `Signal it: same setting, same language, same problem family — so the algorithm knows who ${name} is for.`,
        `If your feed mixes random topics, similar viewers never cluster around ${name}.`,
      ].join("\n\n"),
      bodyAr: [
        `المنصّات ترسل ${name} إلى ${niche.similarViewersAr}.`,
        `«عالمك» هو ${niche.worldAr}. كل منشور يجب أن يبدو منتمياً إليه.`,
        `أشر إليه: نفس المكان، نفس اللغة، نفس عائلة المشاكل — ليعرف الخوارزمية لمن ${name}.`,
        `إذا خلط فيدك مواضيع عشوائية، لن يتجمّع المشاهدون المشابهون حول ${name}.`,
      ].join("\n\n"),
    },
    {
      id: "why_follow",
      titleEn: "3. Why people follow a tiny shop early",
      titleAr: "٣. لماذا يتابع الناس متجراً صغيراً مبكراً",
      bodyEn: [
        `Early follows for ${name} come from ${niche.followPullEn} — not from “we’re a new store.”`,
        `What pulls follows: a promise like “${promiseEn},” repeatable formats, and proof ${name} works in real life.`,
        `What doesn’t: ${niche.followMissEn}, or asking for follows with no reason to return.`,
        `Tiny shops win when every clip answers: “Why come back for ${name} tomorrow?”`,
      ].join("\n\n"),
      bodyAr: [
        `المتابعات المبكرة لـ ${name} تأتي من ${niche.followPullAr} — لا من «نحن متجر جديد».`,
        `ما يجذب المتابعة: وعد مثل «${promiseAr}»، وتنسيقات قابلة للتكرار، ودليل أن ${name} يعمل في الحياة الواقعية.`,
        `ما لا يجذب: ${niche.followMissAr}، أو طلب متابعة بلا سبب للعودة.`,
        `المتاجر الصغيرة تفوز عندما يجيب كل مقطع: «لماذا أعود لـ ${name} غداً؟»`,
      ].join("\n\n"),
    },
    {
      id: "reply_loop",
      titleEn: "4. Reply loop — conversation > broadcasting",
      titleAr: "٤. حلقة الرد — المحادثة أهم من البث",
      bodyEn: [
        `Marketing ${name} is not only posting — it’s closing the loop on comments and DMs.`,
        `Broadcasting: post and leave. Conversation: reply to questions about fit, use, delivery window, and price.`,
        `On comments about ${name}, answer publicly when useful — others learn from the reply.`,
        `Move order details to DM, but keep the public thread warm so the next viewer trusts you.`,
      ].join("\n\n"),
      bodyAr: [
        `تسويق ${name} ليس النشر فقط — بل إغلاق الحلقة على التعليقات والرسائل.`,
        `البث: انشر واترك. المحادثة: رد على أسئلة الملاءمة والاستخدام ونافذة التوصيل والسعر.`,
        `على تعليقات عن ${name}، أجب علناً عندما يفيد — الآخرون يتعلّمون من الرد.`,
        `انقل تفاصيل الطلب إلى الرسائل، لكن أبقِ الخيط العام دافئاً ليثق المشاهد التالي.`,
      ].join("\n\n"),
    },
    {
      id: "series",
      titleEn: "5. Series — why series earn follows",
      titleAr: "٥. السلاسل — لماذا تكسب السلاسل متابعات",
      bodyEn: [
        `One-off clips of ${name} can get views. Series earn follows because people wait for the next part.`,
        `Example series angles for ${name}:`,
        `• ${series1En}`,
        `• ${series2En}`,
        `• ${series3En}`,
        `End each part with a reason to watch the next — not a vague “follow for more.”`,
      ].join("\n\n"),
      bodyAr: [
        `مقاطع لمرة واحدة عن ${name} قد تجلب مشاهدات. السلاسل تكسب متابعات لأن الناس ينتظرون الجزء التالي.`,
        `أمثلة زوايا سلاسل لـ ${name}:`,
        `• ${series1Ar}`,
        `• ${series2Ar}`,
        `• ${series3Ar}`,
        `أنهِ كل جزء بسبب لمشاهدة التالي — لا «تابع للمزيد» المبهم.`,
      ].join("\n\n"),
    },
    {
      id: "three_metrics",
      titleEn: "6. Three metrics — and how to fix them",
      titleAr: "٦. ثلاثة مقاييس — وكيف تصلحها",
      bodyEn: [
        `For ${name}, watch three organic signals before you rush paid ads:`,
        `• Saves / replays — people want to reuse or rewatch the tip.`,
        `• Profile taps — the hook + niche made them curious about you.`,
        `• DMs — they are close to ordering ${name}.`,
        `Pattern A (weak hooks): Rework the first 1–3 seconds. Lead with the problem ${name} solves; cut greetings.`,
        `Pattern B (wrong niche): Post only in ${niche.worldEn}. Drop off-topic content so similar viewers cluster.`,
        `Pattern C (thin profile): Pin a clear promise (“${promiseEn}”), add 3 on-niche clips of ${name}, make WhatsApp easy to find.`,
        `Pattern D (no DMs): End clips with one clear ask (“Message for price + delivery window”). Reply fast with the DM order lines below.`,
        `Pattern E (views but no follows): Turn one-offs into a series (${series1En}). Promise part 2.`,
        `Don’t rush paid ads if Pattern A or D is empty — fix the organic loop first.`,
      ].join("\n\n"),
      bodyAr: [
        `لـ ${name}، راقب ثلاثة إشارات عضوية قبل التسرّع إلى الإعلانات المدفوعة:`,
        `• الحفظ / إعادة المشاهدة — الناس يريدون إعادة استخدام النصيحة أو إعادة مشاهدتها.`,
        `• نقرات الملف — الخطّاف + النيش أثارا فضولهم عنك.`,
        `• الرسائل — هم قريبون من طلب ${name}.`,
        `النمط أ (خطّافات ضعيفة): أعد الثواني ١–٣. ابدأ بمشكلة يحلّها ${name}؛ احذف التحيات.`,
        `النمط ب (نيش خاطئ): انشر فقط ضمن ${niche.worldAr}. أزل المحتوى خارج الموضوع ليتجمّع المشاهدون المشابهون.`,
        `النمط ج (ملف رفيع): ثبّت وعداً واضحاً («${promiseAr}»)، أضف ٣ مقاطع في النيش عن ${name}، واجعل واتساب سهل الإيجاد.`,
        `النمط د (بلا رسائل): أنهِ المقاطع بطلب واحد واضح («راسلني للسعر ونافذة التوصيل»). رد بسرعة بأسطر طلب الرسالة أدناه.`,
        `النمط هـ (مشاهدات بلا متابعات): حوّل المقاطع المنفردة إلى سلسلة (${series1Ar}). وعد بالجزء ٢.`,
        `لا تتسرّع إلى الإعلانات المدفوعة إذا كان النمط أ أو د فارغاً — أصلح الحلقة العضوية أولاً.`,
      ].join("\n\n"),
    },
    {
      id: "dm_order_clarity",
      titleEn: "7. DM order clarity",
      titleAr: "٧. وضوح الطلب في الرسائل",
      bodyEn: [
        `When someone DMs about ${name}, keep the reply short and complete:`,
        `• Benefit — one line on what ${name} does for them.`,
        `• Price — the number in USD.`,
        `• Delivery window — when they can expect it.`,
        `• Name / area / phone — what you need to place the order.`,
        `Payment method is operational detail later — not a marketing pitch or differentiator in your content.`,
      ].join("\n\n"),
      bodyAr: [
        `عندما يراسل أحد عن ${name}، أبقِ الرد قصيراً وكاملاً:`,
        `• الفائدة — سطر واحد عما يفعله ${name} لهم.`,
        `• السعر — الرقم بالدولار.`,
        `• نافذة التوصيل — متى يتوقعونه.`,
        `• الاسم / المنطقة / الهاتف — ما تحتاجه لتسجيل الطلب.`,
        `طريقة الدفع تفصيل تشغيلي لاحقاً — ليست عرضاً تسويقياً أو ميزة تفاضلية في محتواك.`,
      ].join("\n\n"),
    },
    {
      id: "journey_map",
      titleEn: "8. Your marketing journey map",
      titleAr: "٨. خريطة رحلة التسويق",
      bodyEn: [
        `This Intro lesson is how marketing will look when you sell ${name} — the mechanics, not creatives yet.`,
        `Next on your journey:`,
        `• Pre-launch kits — organic creatives (and a small paid cap) once your batch is ordered.`,
        `• Launch kits — real paid budget when inventory is ready, with budget rules acknowledged.`,
        `• Weekly refresh — ongoing creatives after you’re selling.`,
        `Generate those kits when each stage unlocks. Come back to this lesson whenever hooks, niche, or DMs feel unclear.`,
      ].join("\n\n"),
      bodyAr: [
        `هذا الدرس التمهيدي يوضح كيف سيبدو التسويق عندما تبيع ${name} — الآليات، لا الإبداعات بعد.`,
        `التالي في رحلتك:`,
        `• حزم ما قبل الإطلاق — إبداعات عضوية (وحد مدفوع صغير) بعد طلب الشحنة.`,
        `• حزم الإطلاق — ميزانية مدفوعة حقيقية عند جاهزية المخزون، مع إقرار قواعد الميزانية.`,
        `• تحديث أسبوعي — إبداعات مستمرة بعد أن تبدأ البيع.`,
        `ولّد تلك الحزم عند فتح كل مرحلة. عد إلى هذا الدرس متى بدا الخطّاف أو النيش أو الرسائل غير واضح.`,
      ].join("\n\n"),
    },
  ];

  return {
    kind: "intro_lesson",
    productName: name,
    category: category || "unknown",
    sections,
  };
}

/** True if any intro body pitches COD / cash-on-delivery as a marketing wow. */
export function introLessonHasCodPitch(lesson: IntroLessonPayload): boolean {
  const blob = lesson.sections
    .map((s) => `${s.bodyEn}\n${s.bodyAr}\n${s.titleEn}\n${s.titleAr}`)
    .join("\n");
  return textHasCodPitch(blob);
}
