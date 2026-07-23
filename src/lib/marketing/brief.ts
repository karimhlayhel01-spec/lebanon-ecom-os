/**
 * Shared marketing niche vocabulary — used by Intro lesson + creative kits.
 * Deterministic templates; unknown category → DEFAULT_NICHE. No LLM.
 */

export type NicheWorld = {
  worldEn: string;
  worldAr: string;
  similarViewersEn: string;
  similarViewersAr: string;
  series1En: string;
  series1Ar: string;
  series2En: string;
  series2Ar: string;
  series3En: string;
  series3Ar: string;
  /** Short series stem for creative labels, e.g. "Desk fix". */
  seriesShortEn: string;
  seriesShortAr: string;
  strongHookEn: string;
  strongHookAr: string;
  weakHookEn: string;
  weakHookAr: string;
  followPullEn: string;
  followPullAr: string;
  followMissEn: string;
  followMissAr: string;
  promiseEn: string;
  promiseAr: string;
  /** Problem shot stem for hook-first creative shot lists. */
  problemEn: string;
  problemAr: string;
  resultEn: string;
  resultAr: string;
};

export const DEFAULT_NICHE: NicheWorld = {
  worldEn: "people who care about practical everyday upgrades",
  worldAr: "أشخاص يهتمّون بتحسينات عملية يومية",
  similarViewersEn:
    "viewers who already watch short demos of useful small products",
  similarViewersAr:
    "مشاهدين يشاهدون أصلاً عروضاً قصيرة لمنتجات صغيرة مفيدة",
  series1En: "Day-in-the-life with {name}",
  series1Ar: "يوم من الحياة مع {name}",
  series2En: "3 mistakes people make without {name}",
  series2Ar: "٣ أخطاء يرتكبها الناس بدون {name}",
  series3En: "Quick fix Friday — one problem, one clip",
  series3Ar: "جمعة الإصلاح السريع — مشكلة واحدة، مقطع واحد",
  seriesShortEn: "Quick fix",
  seriesShortAr: "إصلاح سريع",
  strongHookEn: "Stop scrolling if {name} would fix this in 10 seconds…",
  strongHookAr: "توقّف عن التمرير إذا كان {name} سيحلّ هذا خلال ١٠ ثوانٍ…",
  weakHookEn: "Hi guys, welcome to my page, today I want to talk about…",
  weakHookAr: "مرحباً جميعاً، أهلاً بكم في صفحتي، اليوم أريد أن أتحدّث عن…",
  followPullEn: "a clear niche promise + a reason to come back tomorrow",
  followPullAr: "وعد واضح في النيش + سبب للعودة غداً",
  followMissEn: "generic “shop with us” posts with no product world",
  followMissAr: "منشورات عامة «تسوّق معنا» بلا عالم منتج",
  promiseEn: "useful {name} tips for your daily routine",
  promiseAr: "نصائح مفيدة عن {name} لروتينك اليومي",
  problemEn: "the daily friction this viewer already feels",
  problemAr: "الاحتكاك اليومي الذي يشعر به المشاهد أصلاً",
  resultEn: "a clearer, easier moment with {name}",
  resultAr: "لحظة أوضح وأسهل مع {name}",
};

export const CATEGORY_NICHES: Record<string, NicheWorld> = {
  beauty_personal_care: {
    worldEn: "skincare / self-care routines and “get ready with me” viewers",
    worldAr: "روتين العناية بالبشرة / العناية الذاتية ومشاهدو «تجهّزي معي»",
    similarViewersEn:
      "people already watching facial tools, routines, and before/after clips",
    similarViewersAr:
      "أشخاص يشاهدون أصلاً أدوات الوجه والروتينات ومقاطع قبل/بعد",
    series1En: "Night routine with {name} — 3 nights",
    series1Ar: "روتين الليل مع {name} — ٣ ليالٍ",
    series2En: "Texture / feel close-ups of {name}",
    series2Ar: "لقطات قريبة على ملمس / إحساس {name}",
    series3En: "Myths vs facts about {name}",
    series3Ar: "خرافات مقابل حقائق عن {name}",
    seriesShortEn: "Routine tip",
    seriesShortAr: "خطوة روتينية",
    strongHookEn: "Your skin looks tired? Watch what {name} does in 5 seconds…",
    strongHookAr: "بشرتك تبدو متعبة؟ شاهد ما يفعله {name} خلال ٥ ثوانٍ…",
    weakHookEn: "New product alert! Check out my store…",
    weakHookAr: "تنبيه منتج جديد! تفقد متجري…",
    followPullEn: "routine results and honest texture demos",
    followPullAr: "نتائج الروتين وعروض ملمس صادقة",
    followMissEn: "random beauty dumps with no routine story",
    followMissAr: "محتوى تجميل عشوائي بلا قصة روتين",
    promiseEn: "simple self-care wins with {name}",
    promiseAr: "عناية أبسط مع {name}",
    problemEn: "tired-looking skin / skipped routine moment",
    problemAr: "بشرة متعبة المظهر / لحظة روتين متجاوَز",
    resultEn: "a calmer routine beat with {name}",
    resultAr: "روتين أهدأ مع {name}",
  },
  home_kitchen: {
    worldEn: "home cooks, apartment kitchens, and “make it easier” viewers",
    worldAr: "طهاة المنازل ومطابخ الشقق ومشاهدو «سهّلها»",
    similarViewersEn:
      "people watching kitchen hacks, storage tips, and meal-prep clips",
    similarViewersAr:
      "أشخاص يشاهدون حيل المطبخ ونصائح التخزين ومقاطع تحضير الوجبات",
    series1En: "One meal, faster with {name}",
    series1Ar: "وجبة واحدة، أسرع مع {name}",
    series2En: "Tiny kitchen vs {name}",
    series2Ar: "مطبخ صغير مقابل {name}",
    series3En: "Clean-as-you-go with {name}",
    series3Ar: "نظّف أثناء الطبخ مع {name}",
    seriesShortEn: "Kitchen fix",
    seriesShortAr: "إصلاح المطبخ",
    strongHookEn: "If your counter is chaos, {name} fixes this in one move…",
    strongHookAr: "إذا كان سطح مطبخك فوضى، {name} يصلح هذا بحركة واحدة…",
    weakHookEn: "Hello everyone, please like and share…",
    weakHookAr: "مرحباً بالجميع، من فضلكم لايك ومشاركة…",
    followPullEn: "faster prep and cleaner counters",
    followPullAr: "تحضير أسرع وسطح أنظف",
    followMissEn: "stock photos of gadgets with no kitchen context",
    followMissAr: "صور مخزّنة لأدوات بلا سياق مطبخ",
    promiseEn: "easier kitchen days with {name}",
    promiseAr: "أيام مطبخ أسهل مع {name}",
    problemEn: "counter clutter / slow prep frustration",
    problemAr: "فوضى السطح / إحباط التحضير البطيء",
    resultEn: "one cleaner, faster kitchen move with {name}",
    resultAr: "حركة مطبخ أنظف وأسرع مع {name}",
  },
  phone_tech_accessories: {
    worldEn: "phone power users, desk setups, and “cable chaos” viewers",
    worldAr: "مستخدمو الهاتف المكثّفون وإعدادات المكتب ومشاهدو فوضى الكابلات",
    similarViewersEn:
      "people watching desk setups, charging tips, and accessory reviews",
    similarViewersAr:
      "أشخاص يشاهدون إعدادات المكتب ونصائح الشحن ومراجعات الإكسسوارات",
    series1En: "Desk setup upgrades with {name}",
    series1Ar: "ترقيات إعداد المكتب مع {name}",
    series2En: "Battery / cable myths — {name} edition",
    series2Ar: "خرافات البطارية / الكابلات — نسخة {name}",
    series3En: "Travel day kit featuring {name}",
    series3Ar: "عدة يوم السفر مع {name}",
    seriesShortEn: "Phone fix",
    seriesShortAr: "إصلاح الهاتف",
    strongHookEn: "Your phone dies by noon? {name} changes that…",
    strongHookAr: "هاتفك ينطفئ ظهراً؟ {name} يغيّر ذلك…",
    weakHookEn: "Best accessories 2026 — part 1…",
    weakHookAr: "أفضل الإكسسوارات ٢٠٢٦ — الجزء ١…",
    followPullEn: "cleaner setups and fewer dead-battery moments",
    followPullAr: "إعدادات أنظف ولحظات بطارية فارغة أقل",
    followMissEn: "unboxing piles with no problem stated",
    followMissAr: "أكوام فتح علب بلا مشكلة مذكورة",
    promiseEn: "smarter phone days with {name}",
    promiseAr: "أيام هاتف أذكى مع {name}",
    problemEn: "dead battery / cable tangle moment",
    problemAr: "بطارية فارغة / لحظة تشابك كابلات",
    resultEn: "a calmer charge/setup moment with {name}",
    resultAr: "لحظة شحن/إعداد أهدأ مع {name}",
  },
  kids_baby_accessories: {
    worldEn: "parents hunting practical, calm, everyday kid wins",
    worldAr: "أهل يبحثون عن حلول عملية وهادئة لليومي مع الأطفال",
    similarViewersEn:
      "parents already watching kid hacks, packing tips, and honest product clips",
    similarViewersAr:
      "أهل يشاهدون أصلاً حيل الأطفال ونصائح التجهيز ومقاطع منتجات صادقة",
    series1En: "Morning rush fixes with {name}",
    series1Ar: "إصلاحات صباح العجلة مع {name}",
    series2En: "What I’d skip — and why I keep {name}",
    series2Ar: "ما أتخطّاه — ولماذا أبقي {name}",
    series3En: "One problem, one parent tip with {name}",
    series3Ar: "مشكلة واحدة، نصيحة أهل واحدة مع {name}",
    seriesShortEn: "Parent tip",
    seriesShortAr: "نصيحة أهل",
    strongHookEn: "Parents — this {name} moment saves the morning…",
    strongHookAr: "أيها الأهل — لحظة {name} هذه تنقذ الصباح…",
    weakHookEn: "Cute products for kids, follow for more…",
    weakHookAr: "منتجات لطيفة للأطفال، تابعوا للمزيد…",
    followPullEn: "real parent problems solved in under 15 seconds",
    followPullAr: "مشاكل أهل حقيقية تُحلّ في أقل من ١٥ ثانية",
    followMissEn: "cute aesthetic posts with no parenting payoff",
    followMissAr: "منشورات جمالية لطيفة بلا فائدة أبوية",
    promiseEn: "calmer kid days with {name}",
    promiseAr: "أيام أهدأ مع الأطفال بفضل {name}",
    problemEn: "morning rush / kid-day friction",
    problemAr: "عجلة الصباح / احتكاك يوم الطفل",
    resultEn: "one calmer parent win with {name}",
    resultAr: "لحظة أهل أهدأ مع {name}",
  },
  fitness_lifestyle: {
    worldEn: "home-workout and “small habit” lifestyle viewers",
    worldAr: "مشاهدو التمرين المنزلي وعادات نمط الحياة الصغيرة",
    similarViewersEn:
      "people watching short home workouts, mobility clips, and habit streaks",
    similarViewersAr:
      "أشخاص يشاهدون تمارين منزلية قصيرة ومقاطع مرونة وسلاسل عادات",
    series1En: "7-day habit with {name}",
    series1Ar: "عادة ٧ أيام مع {name}",
    series2En: "Apartment workout using {name}",
    series2Ar: "تمرين شقة باستخدام {name}",
    series3En: "Form check — {name} tips",
    series3Ar: "فحص الوضعية — نصائح {name}",
    seriesShortEn: "Habit day",
    seriesShortAr: "يوم عادة",
    strongHookEn: "No gym? {name} still gets this movement done…",
    strongHookAr: "بلا صالة؟ {name} ما زال ينجز هذه الحركة…",
    weakHookEn: "Fitness motivation Monday…",
    weakHookAr: "تحفيز اللياقة يوم الاثنين…",
    followPullEn: "short, doable sessions they can repeat",
    followPullAr: "جلسات قصيرة قابلة للتكرار",
    followMissEn: "hype captions with no demo of {name}",
    followMissAr: "عناوين حماسية بلا عرض لـ {name}",
    promiseEn: "doable home fitness with {name}",
    promiseAr: "لياقة منزلية قابلة للتنفيذ مع {name}",
    problemEn: "skipped workout / no-gym excuse",
    problemAr: "تمرين متجاوَز / عذر بلا صالة",
    resultEn: "a doable home move with {name}",
    resultAr: "حركة منزلية قابلة للتنفيذ مع {name}",
  },
  fashion_accessories: {
    worldEn: "outfit finishers and “how I wear it” fashion viewers",
    worldAr: "مشاهدو إكمال الإطلالة و«كيف أرتديه» في الموضة",
    similarViewersEn:
      "people watching GRWM, styling clips, and accessory close-ups",
    similarViewersAr:
      "أشخاص يشاهدون تجهّزي معي ومقاطع التنسيق ولقطات إكسسوارات قريبة",
    series1En: "3 ways to wear {name}",
    series1Ar: "٣ طرق لارتداء {name}",
    series2En: "Day-to-night with {name}",
    series2Ar: "من النهار إلى الليل مع {name}",
    series3En: "Detail shots — why {name} works",
    series3Ar: "لقطات تفاصيل — لماذا ينجح {name}",
    seriesShortEn: "Style finish",
    seriesShortAr: "لمسة أسلوب",
    strongHookEn: "This outfit was missing one thing — {name}…",
    strongHookAr: "هذه الإطلالة كانت تنقصها شيء واحد — {name}…",
    weakHookEn: "New arrivals in my shop…",
    weakHookAr: "وصلات جديدة في متجري…",
    followPullEn: "styling ideas they can copy this week",
    followPullAr: "أفكار تنسيق يمكنهم نسخها هذا الأسبوع",
    followMissEn: "flat lays with no wear context",
    followMissAr: "صور مسطّحة بلا سياق ارتداء",
    promiseEn: "easy style finishes with {name}",
    promiseAr: "لمسات أسلوب سهلة مع {name}",
    problemEn: "outfit that feels unfinished",
    problemAr: "إطلالة تبدو غير مكتملة",
    resultEn: "a finished look with {name}",
    resultAr: "إطلالة مكتملة مع {name}",
  },
  car_accessories: {
    worldEn: "drivers who want cleaner, safer, less-annoying car days",
    worldAr: "سائقون يريدون أياماً أنظف وأكثر أماناً وأقل إزعاجاً في السيارة",
    similarViewersEn:
      "people watching car organization, road-trip tips, and cabin upgrades",
    similarViewersAr:
      "أشخاص يشاهدون تنظيم السيارة ونصائح الرحلات وترقيات المقصورة",
    series1En: "Cabin reset with {name}",
    series1Ar: "إعادة ضبط المقصورة مع {name}",
    series2En: "Road-trip kit — {name} role",
    series2Ar: "عدة الرحلة — دور {name}",
    series3En: "Before / after clutter with {name}",
    series3Ar: "قبل / بعد الفوضى مع {name}",
    seriesShortEn: "Cabin fix",
    seriesShortAr: "إصلاح المقصورة",
    strongHookEn: "Your passenger seat looks like this? {name} fixes it…",
    strongHookAr: "مقعد الراكب يبدو هكذا؟ {name} يصلحه…",
    weakHookEn: "Car gadgets you need…",
    weakHookAr: "أدوات سيارة تحتاجها…",
    followPullEn: "cleaner rides and fewer daily annoyances",
    followPullAr: "رحلات أنظف وإزعاج يومي أقل",
    followMissEn: "product dumps with no car scenario",
    followMissAr: "أكوام منتجات بلا سيناريو سيارة",
    promiseEn: "smoother drives with {name}",
    promiseAr: "قيادة أسلس مع {name}",
    problemEn: "passenger-seat clutter / cabin annoyance",
    problemAr: "فوضى مقعد الراكب / إزعاج المقصورة",
    resultEn: "a cleaner cabin beat with {name}",
    resultAr: "مقصورة أنظف مع {name}",
  },
  pet_accessories: {
    worldEn: "pet owners watching training, care, and “pet life” clips",
    worldAr: "أصحاب حيوانات يشاهدون التدريب والعناية ومقاطع حياة الحيوانات",
    similarViewersEn:
      "people already watching pet hacks, grooming tips, and honest reactions",
    similarViewersAr:
      "أشخاص يشاهدون أصلاً حيل الحيوانات ونصائح العناية وردود فعل صادقة",
    series1En: "One week with {name} + my pet",
    series1Ar: "أسبوع مع {name} وحيواني",
    series2En: "Training / calm moments using {name}",
    series2Ar: "لحظات تدريب / هدوء باستخدام {name}",
    series3En: "What I’d repurchase — {name}",
    series3Ar: "ما سأعيد شراءه — {name}",
    seriesShortEn: "Pet fix",
    seriesShortAr: "إصلاح الحيوان",
    strongHookEn: "Pet owners — this {name} moment changes walk time…",
    strongHookAr: "أصحاب الحيوانات — لحظة {name} هذه تغيّر وقت النزهة…",
    weakHookEn: "Cute pets and products…",
    weakHookAr: "حيوانات لطيفة ومنتجات…",
    followPullEn: "honest pet-life fixes, not just cute clips",
    followPullAr: "إصلاحات صادقة لحياة الحيوان، لا مقاطع لطيفة فقط",
    followMissEn: "aesthetic pet posts with no product job",
    followMissAr: "منشورات جمالية بلا وظيفة للمنتج",
    promiseEn: "easier pet days with {name}",
    promiseAr: "أيام أسهل مع حيوانك بفضل {name}",
    problemEn: "walk-time / pet-day friction",
    problemAr: "احتكاك وقت النزهة / يوم الحيوان",
    resultEn: "a calmer pet moment with {name}",
    resultAr: "لحظة حيوان أهدأ مع {name}",
  },
  office_desk_gadgets: {
    worldEn: "remote workers and desk-setup viewers",
    worldAr: "العاملون عن بُعد ومشاهدو إعدادات المكتب",
    similarViewersEn:
      "people watching desk tours, cable management, and focus setups",
    similarViewersAr:
      "أشخاص يشاهدون جولات المكتب وتنظيم الكابلات وإعدادات التركيز",
    series1En: "Desk reset series with {name}",
    series1Ar: "سلسلة إعادة ضبط المكتب مع {name}",
    series2En: "Cable chaos → calm with {name}",
    series2Ar: "فوضى الكابلات ← هدوء مع {name}",
    series3En: "Focus hour — tools including {name}",
    series3Ar: "ساعة تركيز — أدوات منها {name}",
    seriesShortEn: "Desk fix",
    seriesShortAr: "إصلاح المكتب",
    strongHookEn: "Your desk looks like spaghetti? {name} ends that…",
    strongHookAr: "مكتبك يبدو كالمعكرونة؟ {name} ينهي ذلك…",
    weakHookEn: "Work from home essentials list…",
    weakHookAr: "قائمة أساسيات العمل من المنزل…",
    followPullEn: "cleaner desks and fewer focus killers",
    followPullAr: "مكاتب أنظف ومشتّتات تركيز أقل",
    followMissEn: "product grids with no desk story",
    followMissAr: "شبكات منتجات بلا قصة مكتب",
    promiseEn: "a calmer desk with {name}",
    promiseAr: "مكتب أهدأ مع {name}",
    problemEn: "cable spaghetti / desk clutter",
    problemAr: "فوضى كابلات / فوضى المكتب",
    resultEn: "a calmer desk setup with {name}",
    resultAr: "إعداد مكتب أهدأ مع {name}",
  },
  health_wellness_gadgets: {
    worldEn: "wellness curiosity and “feel better at home” viewers",
    worldAr: "فضول العافية ومشاهدو «اشعر بتحسّن في المنزل»",
    similarViewersEn:
      "people watching recovery tips, stretch routines, and gentle gadget demos",
    similarViewersAr:
      "أشخاص يشاهدون نصائح التعافي وروتين التمدّد وعروض أدوات لطيفة",
    series1En: "Evening wind-down with {name}",
    series1Ar: "تهدئة المساء مع {name}",
    series2En: "What changed after 5 days with {name}",
    series2Ar: "ما تغيّر بعد ٥ أيام مع {name}",
    series3En: "Gentle demo — how {name} feels",
    series3Ar: "عرض لطيف — كيف يبدو إحساس {name}",
    seriesShortEn: "Wellness tip",
    seriesShortAr: "نصيحة عافية",
    strongHookEn: "Stiff after sitting all day? Try this with {name}…",
    strongHookAr: "تيبس بعد الجلوس طوال اليوم؟ جرّب هذا مع {name}…",
    weakHookEn: "Wellness products you should buy…",
    weakHookAr: "منتجات عافية يجب أن تشتريها…",
    followPullEn: "calm, believable demos — not medical claims",
    followPullAr: "عروض هادئة وقابلة للتصديق — لا ادّعاءات طبية",
    followMissEn: "miracle language with no real demo",
    followMissAr: "لغة معجزات بلا عرض حقيقي",
    promiseEn: "gentler home wellness with {name}",
    promiseAr: "عافية منزلية ألطف مع {name}",
    problemEn: "stiffness / end-of-day tension",
    problemAr: "تيبس / توتر نهاية اليوم",
    resultEn: "a gentler wind-down with {name}",
    resultAr: "تهدئة ألطف مع {name}",
  },
};

export function fillNiche(template: string, name: string): string {
  return template.replaceAll("{name}", name);
}

export function nicheFor(category: string): NicheWorld {
  return CATEGORY_NICHES[category] ?? DEFAULT_NICHE;
}

/** First usable SKU marketing hook, or null. Skips internal @placeholders. */
export function usefulHookLine(
  hooks: string[] | undefined,
  name: string,
): string | null {
  if (!hooks?.length) return null;
  for (const h of hooks) {
    const trimmed = h.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("@")) continue;
    return trimmed.includes(name) ? trimmed : `${trimmed} — shown with ${name}`;
  }
  return null;
}

/** True if text pitches COD / cash-on-delivery as a marketing wow. */
export function textHasCodPitch(blob: string): boolean {
  const lower = blob.toLowerCase();
  return (
    lower.includes("cash on delivery") ||
    lower.includes("cash-on-delivery") ||
    /\bcod\b/.test(lower) ||
    lower.includes("الدفع عند الاستلام") ||
    lower.includes("دفع عند الاستلام")
  );
}
