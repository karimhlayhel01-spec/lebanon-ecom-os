/**
 * Niche-aware creative kits for pre_launch / launch / weekly_refresh.
 *
 * Same niche spine as Intro (via brief.ts). Pre-launch = ETA week-phased soft
 * teasers (warm early / “batch in transit” later) — no gift, buyer-UGC proof,
 * or hard order CTAs. Launch v1 = fixed 2-week plan (open → convert) with
 * WhatsApp order OK; not tied to batch ETA. `weekly_refresh` v1 = 1-week
 * selling plan (open/convert + weekly extras) with schedules.
 * Full regenerate resets scheduleIgnored (new creative ids).
 * No COD-as-marketing-wow. Deterministic builder = skeleton + fail-closed
 * fallback; Wave 4 Gemini may fill text fields via creatives-llm.
 */

/** v1 Launch plan length — not a permanent schema law (v2 may choose N). */
export const LAUNCH_PLAN_WEEKS = 2;

/** v1 weekly refresh (stage id weekly_refresh) — single selling week with schedule slots. */
export const WEEKLY_PLAN_WEEKS = 1;

import { newId } from "@/lib/ids";
import type { MarketingCapacityTier, MarketingStage } from "@/lib/constants";
import {
  fillNiche,
  nicheFor,
  textHasCodPitch,
  usefulHookLine,
  type NicheWorld,
} from "@/lib/marketing/brief";
import {
  DEFAULT_ETA_WEEKS,
  MAX_ETA_WEEKS,
  MIN_ETA_WEEKS,
  weekLabelAr,
  weekLabelEn,
} from "@/lib/supplier/batch-eta";

export type Creative = {
  id: string;
  format: string; // reel | story | post | carousel | ugc | testimonial
  angleEn: string;
  angleAr: string;
  captionEn: string;
  captionAr: string;
  shots: string[];
  /** Optional series stem + number, e.g. "Desk fix #2". */
  seriesLabelEn: string;
  seriesLabelAr: string;
  /** First 1–3s instruction (hook-first). */
  hookEn: string;
  hookAr: string;
  /** Pre-launch plan week (1…N). 0 = not week-phased. */
  weekIndex: number;
  weekLabelEn: string;
  weekLabelAr: string;
  /**
   * Optional posting suggestion (pre-launch plan). Keys for day/band;
   * UI translates. scheduleIgnored hides suggestion until restored.
   * Full regenerate resets ignore (new creative ids).
   */
  suggestedDay: string;
  suggestedTimeBand: string;
  whyEn: string;
  whyAr: string;
  scheduleIgnored: boolean;
};

export type SuggestedDay =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";
export type SuggestedTimeBand = "morning" | "afternoon" | "evening";

const DAYS: SuggestedDay[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
const TIME_BANDS: SuggestedTimeBand[] = [
  "morning",
  "afternoon",
  "evening",
];

/** Mon morning → Sun evening (21 slots) — posting calendar spine. */
const WEEK_TIMELINE: {
  day: SuggestedDay;
  band: SuggestedTimeBand;
}[] = DAYS.flatMap((day) => TIME_BANDS.map((band) => ({ day, band })));

export function dayRank(day: string): number {
  const i = DAYS.indexOf(day as SuggestedDay);
  return i >= 0 ? i : 99;
}

export function timeBandRank(band: string): number {
  const i = TIME_BANDS.indexOf(band as SuggestedTimeBand);
  return i >= 0 ? i : 99;
}

/** Week → day Mon–Sun → band morning–evening → id. */
export function compareCreativesByCalendar(a: Creative, b: Creative): number {
  return (
    a.weekIndex - b.weekIndex ||
    dayRank(a.suggestedDay) - dayRank(b.suggestedDay) ||
    timeBandRank(a.suggestedTimeBand) - timeBandRank(b.suggestedTimeBand) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * 1-based badge indexes matching calendar display order
 * (Week 1…N → day → band → id). Same order the Pre-launch UI stacks.
 */
export function calendarDisplayIndexes(
  creatives: Creative[],
): Record<string, number> {
  const ordered = [...creatives].sort(compareCreativesByCalendar);
  const out: Record<string, number> = {};
  ordered.forEach((c, i) => {
    out[c.id] = i + 1;
  });
  return out;
}

/** Parse trailing `#N` from a series label (EN/AR). */
export function seriesNumberFromLabel(label: string): number {
  const m = label.trim().match(/#(\d+)\s*$/);
  return m ? Number(m[1]) : -1;
}

export type BuildCreativesInput = {
  name: string;
  category: string;
  hooks?: string[];
  stage: Extract<
    MarketingStage,
    "pre_launch" | "launch" | "weekly_refresh"
  >;
  capacityTier: MarketingCapacityTier;
  /** Rotates angle order, series numbers, caption variants. */
  varianceSeed: number;
  /**
   * Pre-launch only: weeks spanning ETA (2 / 4 / 8…). Ignored for other stages.
   * Defaults to 1-month (4) when omitted.
   */
  weekCount?: number;
};

type AngleDef = {
  angleEn: string;
  angleAr: string;
  hookEn: string;
  hookAr: string;
  seriesStemEn: string;
  seriesStemAr: string;
  captionLeadEn: string;
  captionLeadAr: string;
};

const PRE_FORMATS = ["reel", "story", "carousel", "post"] as const;
const LAUNCH_FORMATS = [
  "reel",
  "story",
  "carousel",
  "ugc",
  "post",
  "testimonial",
] as const;

/** Soft CTAs only — follow / save / poll / waitlist / when stock lands. */
const SOFT_CTA_EN = [
  "Follow for the next tip in this series.",
  "Save this for when stock lands.",
  "Poll in stories — which tip do you want next?",
  "Interested when it arrives? Drop a 👋 in comments.",
] as const;
const SOFT_CTA_AR = [
  "تابع للجزء التالي من السلسلة.",
  "احفظ هذا لموعد وصول المخزون.",
  "تصويت في الستوري — أي نصيحة تريد التالية؟",
  "مهتم عند الوصول؟ اترك 👋 في التعليقات.",
] as const;

/** Launch / weekly refresh — clear how-to-order (WhatsApp), never COD flex. */
const ORDER_CTA_EN = [
  "Message us on WhatsApp to order.",
  "WhatsApp us for price + delivery window.",
  "Ready to try it? Order on WhatsApp.",
  "Tap WhatsApp — we’ll confirm how to order.",
] as const;
const ORDER_CTA_AR = [
  "راسلنا على واتساب للطلب.",
  "واتساب للسعر ونافذة التوصيل.",
  "جاهز تجربه؟ اطلب عبر واتساب.",
  "اضغط واتساب — نؤكد لك طريقة الطلب.",
] as const;

/**
 * Map hours-tier 6/10/14 → creative counts.
 * pre_launch is lighter (4/6/8); launch + weekly refresh use full tier.
 */
export function creativeCountFor(
  stage: BuildCreativesInput["stage"],
  capacityTier: MarketingCapacityTier,
): number {
  if (stage === "pre_launch") {
    if (capacityTier >= 14) return 8;
    if (capacityTier >= 10) return 6;
    return 4;
  }
  return capacityTier;
}

/** Early half = warm niche; later half = batch-in-transit teaser. */
export function weekPhase(
  weekIndex: number,
  weekCount: number,
): "warm" | "teaser" {
  if (weekCount <= 1) return "warm";
  const mid = Math.ceil(weekCount / 2);
  return weekIndex <= mid ? "warm" : "teaser";
}

/** Launch week 1 = open/stock-here; week 2+ = convert/proof. */
export function launchWeekPhase(weekIndex: number): "open" | "convert" {
  return weekIndex <= 1 ? "open" : "convert";
}

export type SchedulePhase =
  | "warm"
  | "teaser"
  | "open"
  | "convert"
  | "monthly";

/** Positive modulo — JS `%` is signed; negative seeds must not index -1. */
function modPositive(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Ordered day/band slots for one pre-launch week.
 * Spreads across Mon–Sun × bands; seed/weekIndex rotates the window so
 * regenerate varies, then slots are sorted back to calendar order.
 */
export function scheduleSlotsForWeek(args: {
  count: number;
  seed: number;
  weekIndex: number;
}): { day: SuggestedDay; band: SuggestedTimeBand }[] {
  const n = Math.max(0, Math.floor(args.count));
  const total = WEEK_TIMELINE.length;
  if (n === 0) return [];

  const offset = modPositive(args.seed + args.weekIndex * 7, total);

  if (n === 1) {
    const slot = WEEK_TIMELINE[offset]!;
    return [{ day: slot.day, band: slot.band }];
  }

  // Evenly spaced indices (non-decreasing; duplicates when n > total).
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    base.push(Math.floor((i * (total - 1)) / (n - 1)));
  }

  // Rotate emphasis via seed, then restore chronological order.
  const shifted = base
    .map((idx) => modPositive(idx + offset, total))
    .sort((a, b) => a - b);

  return shifted.map((idx) => {
    const slot = WEEK_TIMELINE[idx]!;
    return { day: slot.day, band: slot.band };
  });
}

/** Phase-aware why copy for an already-chosen day/band. */
export function suggestSchedule(args: {
  phase: SchedulePhase;
  format: string;
  suggestedDay: SuggestedDay;
  suggestedTimeBand: SuggestedTimeBand;
}): {
  suggestedDay: SuggestedDay;
  suggestedTimeBand: SuggestedTimeBand;
  whyEn: string;
  whyAr: string;
} {
  const day = args.suggestedDay;
  const band = args.suggestedTimeBand;
  const bandAr =
    band === "morning"
      ? "الصباح"
      : band === "afternoon"
        ? "بعد الظهر"
        : "المساء";

  if (args.phase === "monthly") {
    return {
      suggestedDay: day,
      suggestedTimeBand: band,
      whyEn: `This week’s refresh — ${args.format} in ${band}: keep selling with a clear WhatsApp order path.`,
      whyAr: `تحديث هذا الأسبوع — ${args.format} في ${bandAr}: واصل البيع بمسار طلب واتساب واضح.`,
    };
  }
  if (args.phase === "open") {
    return {
      suggestedDay: day,
      suggestedTimeBand: band,
      whyEn: `Launch week 1 — ${args.format} in ${band}: stock is here; make how-to-order obvious.`,
      whyAr: `أسبوع الإطلاق 1 — ${args.format} في ${bandAr}: المخزون هنا؛ اجعل طريقة الطلب واضحة.`,
    };
  }
  if (args.phase === "convert") {
    return {
      suggestedDay: day,
      suggestedTimeBand: band,
      whyEn: `Launch week 2 — ${args.format} in ${band}: proof + stronger WhatsApp order push.`,
      whyAr: `أسبوع الإطلاق 2 — ${args.format} في ${bandAr}: إثبات + دفعة طلب واتساب أقوى.`,
    };
  }
  if (args.phase === "teaser") {
    return {
      suggestedDay: day,
      suggestedTimeBand: band,
      whyEn: `Later-week teaser — ${args.format} when your niche is scrolling (${band}). Soft reminder that stock is close.`,
      whyAr: `تشويقية أواخر الخطة — ${args.format} عندما يتمرّر النيش (${bandAr}). تذكير خفيف أن المخزون قريب.`,
    };
  }
  return {
    suggestedDay: day,
    suggestedTimeBand: band,
    whyEn: `Early-week warm-up — ${args.format} fits a calm ${band} slot while you grow follows.`,
    whyAr: `تهيئة أوائل الخطة — ${args.format} يناسب وقت ${bandAr} الهادئ بينما تبني المتابعات.`,
  };
}

function emptySchedule(): Pick<
  Creative,
  | "suggestedDay"
  | "suggestedTimeBand"
  | "whyEn"
  | "whyAr"
  | "scheduleIgnored"
> {
  return {
    suggestedDay: "",
    suggestedTimeBand: "",
    whyEn: "",
    whyAr: "",
    scheduleIgnored: false,
  };
}

function worldSnippet(niche: NicheWorld): { en: string; ar: string } {
  return {
    en: niche.worldEn.split(",")[0]!.trim(),
    ar: niche.worldAr.split("و")[0]!.trim(),
  };
}

/** Warm pre-launch: niche / follow / series — no gift, UGC proof, or buy CTA. */
function buildWarmPreLaunchPool(
  niche: NicheWorld,
  name: string,
  hookFromSku: string | null,
): AngleDef[] {
  const s1En = fillNiche(niche.series1En, name);
  const s1Ar = fillNiche(niche.series1Ar, name);
  const s2En = fillNiche(niche.series2En, name);
  const s2Ar = fillNiche(niche.series2Ar, name);
  const s3En = fillNiche(niche.series3En, name);
  const s3Ar = fillNiche(niche.series3Ar, name);
  const strongEn = fillNiche(niche.strongHookEn, name);
  const strongAr = fillNiche(niche.strongHookAr, name);
  const problemEn = fillNiche(niche.problemEn, name);
  const problemAr = fillNiche(niche.problemAr, name);
  const promiseEn = fillNiche(niche.promiseEn, name);
  const promiseAr = fillNiche(niche.promiseAr, name);
  const shortEn = niche.seriesShortEn;
  const shortAr = niche.seriesShortAr;
  const world = worldSnippet(niche);

  const pool: AngleDef[] = [
    {
      angleEn: `Series open — ${s1En}`,
      angleAr: `افتتاح السلسلة — ${s1Ar}`,
      hookEn: strongEn,
      hookAr: strongAr,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `${s1En}. Warming the ${world.en} niche — follow for part 2.`,
      captionLeadAr: `${s1Ar}. نهيّئ جمهور ${world.ar} — تابع للجزء ٢.`,
    },
    {
      angleEn: s2En,
      angleAr: s2Ar,
      hookEn: `Watch if ${problemEn} sounds familiar…`,
      hookAr: `شاهد إذا كان ${problemAr} مألوفاً…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `${s2En}. Save for later — stock isn’t for sale yet.`,
      captionLeadAr: `${s2Ar}. احفظ للاحقاً — المخزون ليس للبيع بعد.`,
    },
    {
      angleEn: s3En,
      angleAr: s3Ar,
      hookEn: strongEn,
      hookAr: strongAr,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `${s3En}. Promise: ${promiseEn}.`,
      captionLeadAr: `${s3Ar}. الوعد: ${promiseAr}.`,
    },
    {
      angleEn: `Why follow for ${promiseEn}`,
      angleAr: `لماذا تتابع لأجل ${promiseAr}`,
      hookEn: `Follow if you want ${promiseEn}…`,
      hookAr: `تابع إذا أردت ${promiseAr}…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `Niche promise: ${promiseEn}. Come back tomorrow.`,
      captionLeadAr: `وعد النيش: ${promiseAr}. عد غداً.`,
    },
    {
      angleEn: `Myth vs fact about ${name}`,
      angleAr: `خرافة مقابل حقيقة عن ${name}`,
      hookEn: `Myth check — then peek at ${name}…`,
      hookAr: `فحص خرافة — ثم لمحة عن ${name}…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `Clear the myth. Soft demo only — not selling yet.`,
      captionLeadAr: `أزل الخرافة. عرض خفيف فقط — لسنا نبيع بعد.`,
    },
    {
      angleEn: `Day-in-the-life beat with ${name}`,
      angleAr: `لحظة من يوم مع ${name}`,
      hookEn: `Stop if ${name} belongs in this moment…`,
      hookAr: `توقّف إذا كان ${name} ينتمي لهذه اللحظة…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `A ${world.en} moment. Follow for the series.`,
      captionLeadAr: `لحظة في ${world.ar}. تابع للسلسلة.`,
    },
    {
      angleEn: `Common mistake ${name} fixes`,
      angleAr: `الخطأ الشائع الذي يصلحه ${name}`,
      hookEn: `Still doing this? ${name} changes it…`,
      hookAr: `ما زلت تفعل هذا؟ ${name} يغيّره…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `One mistake, one tip — ${name}. Poll: which tip next?`,
      captionLeadAr: `خطأ واحد، نصيحة واحدة — ${name}. تصويت: أي نصيحة تالية؟`,
    },
  ];

  if (hookFromSku) {
    pool.unshift({
      // Short label only — hook carries the SKU line (don't repeat it here).
      angleEn: "Your product angle",
      angleAr: "زاوية منتجك",
      hookEn: hookFromSku,
      // No real AR yet — empty so UI doesn't duplicate EN as hookAr.
      hookAr: "",
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `${hookFromSku} — teaser for ${name}. Follow along.`,
      captionLeadAr: `${hookFromSku} — تشويقية لـ ${name}. تابع معنا.`,
    });
  }

  return pool;
}

/** Later pre-launch weeks: batch in transit / almost launch — still no hard sell. */
function buildTeaserPreLaunchPool(
  niche: NicheWorld,
  name: string,
): AngleDef[] {
  const strongEn = fillNiche(niche.strongHookEn, name);
  const strongAr = fillNiche(niche.strongHookAr, name);
  const problemEn = fillNiche(niche.problemEn, name);
  const problemAr = fillNiche(niche.problemAr, name);
  const promiseEn = fillNiche(niche.promiseEn, name);
  const promiseAr = fillNiche(niche.promiseAr, name);
  const resultEn = fillNiche(niche.resultEn, name);
  const resultAr = fillNiche(niche.resultAr, name);
  const shortEn = niche.seriesShortEn;
  const shortAr = niche.seriesShortAr;
  const world = worldSnippet(niche);

  return [
    {
      angleEn: `Batch in transit — ${name} almost here`,
      angleAr: `الشحنة في الطريق — ${name} قريب`,
      hookEn: `Stock is moving — ${strongEn}`,
      hookAr: `المخزون يتحرّك — ${strongAr}`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `${name} is on the way. Save this for launch day.`,
      captionLeadAr: `${name} في الطريق. احفظ هذا ليوم الإطلاق.`,
    },
    {
      angleEn: `Almost launch — ${promiseEn}`,
      angleAr: `الإطلاق قريب — ${promiseAr}`,
      hookEn: `When stock lands: ${resultEn}`,
      hookAr: `عند وصول المخزون: ${resultAr}`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `Countdown for ${world.en}. Waitlist interest? Comment 👋.`,
      captionLeadAr: `عدّ تنازلي لـ ${world.ar}. مهتم بالقائمة؟ علّق 👋.`,
    },
    {
      angleEn: `Pre-launch peek — ${problemEn}`,
      angleAr: `لمحة ما قبل الإطلاق — ${problemAr}`,
      hookEn: strongEn,
      hookAr: strongAr,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `Soft peek at ${name}. Not selling yet — follow for the drop.`,
      captionLeadAr: `لمحة خفيفة لـ ${name}. لسنا نبيع بعد — تابع للإطلاق.`,
    },
    {
      angleEn: `What changes when ${name} lands`,
      angleAr: `ما يتغيّر عند وصول ${name}`,
      hookEn: `Imagine ${resultEn}…`,
      hookAr: `تخيّل ${resultAr}…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `When stock lands, this becomes real. Save the tip.`,
      captionLeadAr: `عند وصول المخزون يصبح هذا واقعياً. احفظ النصيحة.`,
    },
    {
      angleEn: `Final warm-up before ${name} launch`,
      angleAr: `التهيئة الأخيرة قبل إطلاق ${name}`,
      hookEn: `One more tip before stock lands…`,
      hookAr: `نصيحة أخيرة قبل وصول المخزون…`,
      seriesStemEn: shortEn,
      seriesStemAr: shortAr,
      captionLeadEn: `Last pre-launch beat for ${world.en}. Follow so you don’t miss it.`,
      captionLeadAr: `آخر إيقاع قبل الإطلاق لـ ${world.ar}. تابع كي لا تفوّته.`,
    },
  ];
}

type LaunchNicheBits = {
  s1En: string;
  s1Ar: string;
  s2En: string;
  s2Ar: string;
  strongEn: string;
  strongAr: string;
  problemEn: string;
  problemAr: string;
  resultEn: string;
  resultAr: string;
  promiseEn: string;
  promiseAr: string;
  shortEn: string;
  shortAr: string;
  world: { en: string; ar: string };
};

function launchNicheBits(niche: NicheWorld, name: string): LaunchNicheBits {
  return {
    s1En: fillNiche(niche.series1En, name),
    s1Ar: fillNiche(niche.series1Ar, name),
    s2En: fillNiche(niche.series2En, name),
    s2Ar: fillNiche(niche.series2Ar, name),
    strongEn: fillNiche(niche.strongHookEn, name),
    strongAr: fillNiche(niche.strongHookAr, name),
    problemEn: fillNiche(niche.problemEn, name),
    problemAr: fillNiche(niche.problemAr, name),
    resultEn: fillNiche(niche.resultEn, name),
    resultAr: fillNiche(niche.resultAr, name),
    promiseEn: fillNiche(niche.promiseEn, name),
    promiseAr: fillNiche(niche.promiseAr, name),
    shortEn: niche.seriesShortEn,
    shortAr: niche.seriesShortAr,
    world: worldSnippet(niche),
  };
}

/** Week 1 open: stock-here, benefit, how-to-order. */
function buildLaunchOpenPool(
  niche: NicheWorld,
  name: string,
  hookFromSku: string | null,
): AngleDef[] {
  const b = launchNicheBits(niche, name);
  const pool: AngleDef[] = [
    {
      angleEn: `Problem → result: ${b.problemEn}`,
      angleAr: `المشكلة ← النتيجة: ${b.problemAr}`,
      hookEn: b.strongEn,
      hookAr: b.strongAr,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${name} for ${b.world.en}. Launch push — clear benefit + how to order.`,
      captionLeadAr: `${name} لـ ${b.world.ar}. دفعة إطلاق — فائدة واضحة + طريقة الطلب.`,
    },
    {
      angleEn: b.s1En,
      angleAr: b.s1Ar,
      hookEn: `Part of the series — ${b.strongEn}`,
      hookAr: `جزء من السلسلة — ${b.strongAr}`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${b.s1En}. ${b.resultEn}.`,
      captionLeadAr: `${b.s1Ar}. ${b.resultAr}.`,
    },
    {
      angleEn: b.s2En,
      angleAr: b.s2Ar,
      hookEn: `Watch this if ${b.problemEn} sounds familiar…`,
      hookAr: `شاهد هذا إذا كان ${b.problemAr} مألوفاً…`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${b.s2En} — ${b.resultEn}.`,
      captionLeadAr: `${b.s2Ar} — ${b.resultAr}.`,
    },
    {
      angleEn: `Fast demo — ${b.resultEn}`,
      angleAr: `عرض سريع — ${b.resultAr}`,
      hookEn: b.strongEn,
      hookAr: b.strongAr,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `No fluff — ${name} in action.`,
      captionLeadAr: `بلا حشو — ${name} في العمل.`,
    },
    {
      angleEn: `Detail close-up — why ${name} works`,
      angleAr: `لقطة تفاصيل — لماذا ينجح ${name}`,
      hookEn: `Zoom in — this is why ${name} sticks…`,
      hookAr: `قرّب — لهذا يبقى ${name}…`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Close-up proof for ${name}.`,
      captionLeadAr: `دليل قريب لـ ${name}.`,
    },
    {
      angleEn: `How to order ${name} this week`,
      angleAr: `كيف تطلب ${name} هذا الأسبوع`,
      hookEn: `Ready for ${b.resultEn}?`,
      hookAr: `جاهز لـ ${b.resultAr}؟`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${name} is in stock. Clear next step below.`,
      captionLeadAr: `${name} متوفر. الخطوة التالية واضحة أدناه.`,
    },
  ];
  if (hookFromSku) {
    pool.unshift({
      // Short label only — hook carries the SKU line (don't repeat it here).
      angleEn: "Your product angle",
      angleAr: "زاوية منتجك",
      hookEn: hookFromSku,
      // No real AR yet — empty so UI doesn't duplicate EN as hookAr.
      hookAr: "",
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${hookFromSku} — ${name}.`,
      captionLeadAr: `تشويقية لـ ${name} — ${hookFromSku}.`,
    });
  }
  return pool;
}

/** Week 2 convert: proof, gift/UGC/testimonial, stronger order. */
function buildLaunchConvertPool(niche: NicheWorld, name: string): AngleDef[] {
  const b = launchNicheBits(niche, name);
  return [
    {
      angleEn: `Before / after with ${name}`,
      angleAr: `قبل / بعد مع ${name}`,
      hookEn: `Before: ${b.problemEn}. After: ${b.resultEn}.`,
      hookAr: `قبل: ${b.problemAr}. بعد: ${b.resultAr}.`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Before → after proof with ${name}.`,
      captionLeadAr: `دليل قبل ← بعد مع ${name}.`,
    },
    {
      angleEn: `UGC-style honest reaction to ${name}`,
      angleAr: `ردة فعل صادقة على ${name}`,
      hookEn: `Honest take — first use of ${name}…`,
      hookAr: `رأي صادق — أول استخدام لـ ${name}…`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Real reaction. Real ${name}.`,
      captionLeadAr: `ردة فعل حقيقية. ${name} حقيقي.`,
    },
    {
      angleEn: `Gift / share angle for ${name}`,
      angleAr: `زاوية هدية / مشاركة لـ ${name}`,
      hookEn: `Know someone stuck with ${b.problemEn}?`,
      hookAr: `تعرف أحداً عالقاً مع ${b.problemAr}؟`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Share-worthy ${name} tip — or gift it.`,
      captionLeadAr: `نصيحة ${name} تستحق المشاركة — أو أهدِها.`,
    },
    {
      angleEn: `Customer-style testimonial beat for ${name}`,
      angleAr: `إيقاع شهادة بأسلوب العميل لـ ${name}`,
      hookEn: `“${b.promiseEn}” — here’s how…`,
      hookAr: `«${b.promiseAr}» — هكذا…`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Social proof angle for ${name}.`,
      captionLeadAr: `زاوية إثبات اجتماعي لـ ${name}.`,
    },
    {
      angleEn: `Order ${name} on WhatsApp today`,
      angleAr: `اطلب ${name} على واتساب اليوم`,
      hookEn: `Ready to try ${name}? Order now.`,
      hookAr: `جاهز تجرب ${name}؟ اطلب الآن.`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `${name} is selling — clear WhatsApp order path.`,
      captionLeadAr: `${name} يُباع — مسار طلب واتساب واضح.`,
    },
  ];
}

/** Weekly refresh pool: open + convert angles + weekly extras. */
function buildLaunchPool(
  niche: NicheWorld,
  name: string,
  stage: "launch" | "weekly_refresh",
  hookFromSku: string | null,
): AngleDef[] {
  const open = buildLaunchOpenPool(niche, name, hookFromSku);
  const convert = buildLaunchConvertPool(niche, name);
  const pool = [...open, ...convert];
  if (stage === "weekly_refresh") {
    const b = launchNicheBits(niche, name);
    pool.push({
      angleEn: `New weekly angle — ${b.resultEn}`,
      angleAr: `زاوية أسبوعية جديدة — ${b.resultAr}`,
      hookEn: `This week’s take: ${b.strongEn}`,
      hookAr: `زاوية هذا الأسبوع: ${b.strongAr}`,
      seriesStemEn: b.shortEn,
      seriesStemAr: b.shortAr,
      captionLeadEn: `Fresh cut of ${name} for ${b.world.en}.`,
      captionLeadAr: `قصّة جديدة لـ ${name} في ${b.world.ar}.`,
    });
  }
  return pool;
}

function shotListPreLaunch(
  format: string,
  name: string,
  hookEn: string,
  problemEn: string,
  phase: "warm" | "teaser",
): string[] {
  const hookShot = `0–3s hook (problem/result): ${hookEn}`;
  const endWarm = "End: follow / save — not selling yet";
  const endTeaser = "End: waitlist interest / when stock lands — soft only";
  const end = phase === "teaser" ? endTeaser : endWarm;

  const base: Record<string, string[]> = {
    reel: [
      hookShot,
      `Show ${problemEn} (2s)`,
      `Soft peek at ${name} (no hard sell)`,
      "On-screen text with the niche tip",
      end,
    ],
    story: [
      hookShot,
      `Vertical clip of ${name} in niche context`,
      "Poll or question sticker (niche-safe)",
      end,
    ],
    carousel: [
      hookShot,
      "Slide 2–3: niche tip / series beat",
      "Slide 4: why follow this world",
      `Slide 5: ${phase === "teaser" ? "when stock lands — soft CTA" : "follow for next part"}`,
    ],
    post: [
      hookShot,
      `Clean product photo of ${name} in niche context`,
      "Short tip-led caption (no order ask)",
      end,
    ],
  };
  return base[format] ?? base.post!;
}

function shotListLaunch(
  format: string,
  name: string,
  hookEn: string,
  problemEn: string,
  resultEn: string,
): string[] {
  const hookShot = `0–3s hook (problem/result): ${hookEn}`;
  const base: Record<string, string[]> = {
    reel: [
      hookShot,
      `Show ${problemEn} (2s)`,
      `Demo ${name} → ${resultEn} (3s)`,
      "On-screen text with the main benefit",
      "End card: WhatsApp — how to order",
    ],
    story: [
      hookShot,
      `Vertical clip of ${name} solving it`,
      "Poll or question sticker (niche-safe)",
      "WhatsApp contact sticker — how to order",
    ],
    carousel: [
      hookShot,
      "Slide 2–3: niche features with photos",
      "Slide 4: benefit + what's included",
      "Slide 5: how to order on WhatsApp",
    ],
    ugc: [
      hookShot,
      `Honest reaction using ${name}`,
      `Point to ${resultEn}`,
      "Casual CTA: message us on WhatsApp",
    ],
    post: [
      hookShot,
      `Clean product photo of ${name} in niche context`,
      "Short benefit-led caption",
      "CTA: WhatsApp to order",
    ],
    testimonial: [
      hookShot,
      "Customer quote on screen (benefit-led)",
      `B-roll of ${name} → ${resultEn}`,
      "WhatsApp CTA — how to order",
    ],
  };
  return base[format] ?? base.post!;
}

/** Stable PRNG for rotate/shuffle from varianceSeed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate<T>(arr: T[], offset: number): T[] {
  if (arr.length === 0) return [];
  const o = ((offset % arr.length) + arr.length) % arr.length;
  return [...arr.slice(o), ...arr.slice(0, o)];
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Normalize a stored creative — old kits without new fields still parse.
 */
export function normalizeCreative(raw: unknown): Creative | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const shots = Array.isArray(c.shots)
    ? c.shots.map((s) => String(s))
    : [];
  return {
    id: typeof c.id === "string" && c.id ? c.id : newId(),
    format: typeof c.format === "string" && c.format ? c.format : "post",
    angleEn: typeof c.angleEn === "string" ? c.angleEn : "",
    angleAr: typeof c.angleAr === "string" ? c.angleAr : "",
    captionEn: typeof c.captionEn === "string" ? c.captionEn : "",
    captionAr: typeof c.captionAr === "string" ? c.captionAr : "",
    shots,
    seriesLabelEn:
      typeof c.seriesLabelEn === "string" ? c.seriesLabelEn : "",
    seriesLabelAr:
      typeof c.seriesLabelAr === "string" ? c.seriesLabelAr : "",
    hookEn: typeof c.hookEn === "string" ? c.hookEn : "",
    hookAr: typeof c.hookAr === "string" ? c.hookAr : "",
    weekIndex:
      typeof c.weekIndex === "number" && Number.isFinite(c.weekIndex)
        ? Math.max(0, Math.round(c.weekIndex))
        : 0,
    weekLabelEn: typeof c.weekLabelEn === "string" ? c.weekLabelEn : "",
    weekLabelAr: typeof c.weekLabelAr === "string" ? c.weekLabelAr : "",
    suggestedDay: typeof c.suggestedDay === "string" ? c.suggestedDay : "",
    suggestedTimeBand:
      typeof c.suggestedTimeBand === "string" ? c.suggestedTimeBand : "",
    whyEn: typeof c.whyEn === "string" ? c.whyEn : "",
    whyAr: typeof c.whyAr === "string" ? c.whyAr : "",
    scheduleIgnored: c.scheduleIgnored === true,
  };
}

/** True if any creative pitches COD / cash-on-delivery as a marketing wow. */
export function creativesHaveCodPitch(creatives: Creative[]): boolean {
  const blob = creatives
    .map(
      (c) =>
        `${c.angleEn}\n${c.angleAr}\n${c.captionEn}\n${c.captionAr}\n${c.hookEn}\n${c.hookAr}\n${c.seriesLabelEn}\n${c.seriesLabelAr}\n${c.shots.join("\n")}`,
    )
    .join("\n");
  return textHasCodPitch(blob);
}

/**
 * Pre-launch must not gift-to-customer, buyer-UGC/testimonial-as-proof,
 * or hard order / WhatsApp-to-buy as primary CTA.
 */
export function preLaunchHasForbiddenPitch(creatives: Creative[]): boolean {
  const blob = creatives
    .map(
      (c) =>
        `${c.format}\n${c.angleEn}\n${c.angleAr}\n${c.captionEn}\n${c.captionAr}\n${c.hookEn}\n${c.hookAr}\n${c.shots.join("\n")}`,
    )
    .join("\n")
    .toLowerCase();

  if (creatives.some((c) => c.format === "ugc" || c.format === "testimonial")) {
    return true;
  }
  // Gift-to-customer / gift-share marketing angle — not product packaging mentions.
  if (
    /gift\s*\/\s*share/i.test(blob) ||
    /\bgift it\b/i.test(blob) ||
    /\bor gift\b/i.test(blob) ||
    /\bgift angle\b/i.test(blob) ||
    blob.includes("زاوية هدية") ||
    blob.includes("أهدِها") ||
    blob.includes("أو أهد")
  ) {
    return true;
  }
  if (
    blob.includes("customer quote") ||
    blob.includes("social proof") ||
    blob.includes("شهادة") ||
    blob.includes("إثبات اجتماعي")
  ) {
    return true;
  }
  // Hard order CTAs
  if (
    blob.includes("message us on whatsapp to order") ||
    blob.includes("order on whatsapp") ||
    blob.includes("whatsapp to order") ||
    blob.includes("how to order") ||
    blob.includes("ready to try") ||
    blob.includes("اطلب عبر واتساب") ||
    blob.includes("راسلنا على واتساب للطلب") ||
    blob.includes("كيف تطلب")
  ) {
    return true;
  }
  return textHasCodPitch(blob);
}

/**
 * Content fingerprint excluding volatile ids — used to assert regenerate varies.
 */
export function creativesContentKey(creatives: Creative[]): string {
  return JSON.stringify(
    creatives.map(({ id: _id, ...rest }) => rest),
  );
}

export function buildCreatives(input: BuildCreativesInput): Creative[] {
  const name = input.name.trim() || "your product";
  const category = input.category.trim();
  const niche = nicheFor(category);
  const hookFromSku = usefulHookLine(input.hooks, name);
  const baseCount = creativeCountFor(input.stage, input.capacityTier);
  const weekCount =
    input.stage === "pre_launch"
      ? Math.min(
          MAX_ETA_WEEKS,
          Math.max(
            MIN_ETA_WEEKS,
            Math.round(input.weekCount ?? DEFAULT_ETA_WEEKS),
          ),
        )
      : input.stage === "launch"
        ? LAUNCH_PLAN_WEEKS
        : input.stage === "weekly_refresh"
          ? WEEKLY_PLAN_WEEKS
          : 0;
  // Week plans: at least one creative per week so Week 1…N all appear.
  const count =
    weekCount > 0 ? Math.max(baseCount, weekCount) : baseCount;
  // Force uint32 — Date.now()|0 can be negative; signed % breaks schedule indexes.
  const seed = (input.varianceSeed | 0) >>> 0;
  const rand = mulberry32(seed === 0 ? 1 : seed);

  const problemEn = fillNiche(niche.problemEn, name);
  const resultEn = fillNiche(niche.resultEn, name);
  const seriesBase = (Math.abs(seed) % 7) + 1;

  if (input.stage === "pre_launch") {
    const warm = buildWarmPreLaunchPool(niche, name, hookFromSku);
    const teaser = buildTeaserPreLaunchPool(niche, name);
    shuffleInPlace(warm, rand);
    shuffleInPlace(teaser, rand);
    const warmRot = rotate(warm, seed);
    const teaserRot = rotate(teaser, seed + 11);
    const formats = rotate([...PRE_FORMATS], seed + 3);
    const ctaOffset = Math.abs(seed) % SOFT_CTA_EN.length;

    // Round-robin week sizes (same distribution as i % weekCount).
    const weekSizes = Array.from({ length: weekCount }, () => 0);
    for (let i = 0; i < count; i++) {
      weekSizes[i % weekCount]!++;
    }

    // Build each week earliest→latest: narrative + series + slot[j] share index j.
    // Global series numbers ascend in final calendar order across weeks.
    const creatives: Creative[] = [];
    let warmIdx = 0;
    let teaserIdx = 0;
    let calendarSeq = 0;

    for (let w = 1; w <= weekCount; w++) {
      const n = weekSizes[w - 1]!;
      const slots = scheduleSlotsForWeek({
        count: n,
        seed,
        weekIndex: w,
      });
      const phase = weekPhase(w, weekCount);
      const pool = phase === "warm" ? warmRot : teaserRot;

      for (let j = 0; j < n; j++) {
        const angleIdx = phase === "warm" ? warmIdx++ : teaserIdx++;
        const angle = pool[angleIdx % pool.length]!;
        const format = formats[calendarSeq % formats.length]!;
        const ctaEn =
          SOFT_CTA_EN[(ctaOffset + calendarSeq) % SOFT_CTA_EN.length]!;
        const ctaAr =
          SOFT_CTA_AR[(ctaOffset + calendarSeq) % SOFT_CTA_AR.length]!;
        const seriesNum = seriesBase + calendarSeq;
        const slot = slots[j]!;
        const schedule = suggestSchedule({
          phase,
          format,
          suggestedDay: slot.day,
          suggestedTimeBand: slot.band,
        });

        creatives.push({
          id: newId(),
          format,
          angleEn: angle.angleEn,
          angleAr: angle.angleAr,
          captionEn: `${angle.captionLeadEn} ${ctaEn}`,
          captionAr: `${angle.captionLeadAr} ${ctaAr}`,
          shots: shotListPreLaunch(
            format,
            name,
            angle.hookEn,
            problemEn,
            phase,
          ),
          seriesLabelEn: `${angle.seriesStemEn} #${seriesNum}`,
          seriesLabelAr: `${angle.seriesStemAr} #${seriesNum}`,
          hookEn: angle.hookEn,
          hookAr: angle.hookAr,
          weekIndex: w,
          weekLabelEn: weekLabelEn(w),
          weekLabelAr: weekLabelAr(w),
          suggestedDay: schedule.suggestedDay,
          suggestedTimeBand: schedule.suggestedTimeBand,
          whyEn: schedule.whyEn,
          whyAr: schedule.whyAr,
          scheduleIgnored: false,
        });
        calendarSeq++;
      }
    }

    // Safety — build already walks Week → slot order.
    creatives.sort(compareCreativesByCalendar);
    return creatives;
  }

  if (input.stage === "launch") {
    const openRaw = buildLaunchOpenPool(niche, name, hookFromSku);
    const convert = buildLaunchConvertPool(niche, name);
    // Keep SKU hook first in open week when present (don't lose it to shuffle).
    const openPinned = hookFromSku ? openRaw[0]! : null;
    const openRest = openPinned ? openRaw.slice(1) : openRaw;
    shuffleInPlace(openRest, rand);
    shuffleInPlace(convert, rand);
    const openRot = openPinned
      ? [openPinned, ...rotate(openRest, seed)]
      : rotate(openRest, seed);
    const convertRot = rotate(convert, seed + 17);
    const formats = rotate([...LAUNCH_FORMATS], seed + 3);
    const ctaOffset = Math.abs(seed) % ORDER_CTA_EN.length;

    const weekSizes = Array.from({ length: weekCount }, () => 0);
    for (let i = 0; i < count; i++) {
      weekSizes[i % weekCount]!++;
    }

    const creatives: Creative[] = [];
    let openIdx = 0;
    let convertIdx = 0;
    let calendarSeq = 0;

    for (let w = 1; w <= weekCount; w++) {
      const n = weekSizes[w - 1]!;
      const slots = scheduleSlotsForWeek({
        count: n,
        seed,
        weekIndex: w,
      });
      const phase = launchWeekPhase(w);
      const pool = phase === "open" ? openRot : convertRot;

      for (let j = 0; j < n; j++) {
        const angleIdx = phase === "open" ? openIdx++ : convertIdx++;
        const angle = pool[angleIdx % pool.length]!;
        const format = formats[calendarSeq % formats.length]!;
        const ctaEn =
          ORDER_CTA_EN[(ctaOffset + calendarSeq) % ORDER_CTA_EN.length]!;
        const ctaAr =
          ORDER_CTA_AR[(ctaOffset + calendarSeq) % ORDER_CTA_AR.length]!;
        const seriesNum = seriesBase + calendarSeq;
        const slot = slots[j]!;
        const schedule = suggestSchedule({
          phase,
          format,
          suggestedDay: slot.day,
          suggestedTimeBand: slot.band,
        });

        creatives.push({
          id: newId(),
          format,
          angleEn: angle.angleEn,
          angleAr: angle.angleAr,
          captionEn: `${angle.captionLeadEn} ${ctaEn}`,
          captionAr: `${angle.captionLeadAr} ${ctaAr}`,
          shots: shotListLaunch(
            format,
            name,
            angle.hookEn,
            problemEn,
            resultEn,
          ),
          seriesLabelEn: `${angle.seriesStemEn} #${seriesNum}`,
          seriesLabelAr: `${angle.seriesStemAr} #${seriesNum}`,
          hookEn: angle.hookEn,
          hookAr: angle.hookAr,
          weekIndex: w,
          weekLabelEn: weekLabelEn(w),
          weekLabelAr: weekLabelAr(w),
          suggestedDay: schedule.suggestedDay,
          suggestedTimeBand: schedule.suggestedTimeBand,
          whyEn: schedule.whyEn,
          whyAr: schedule.whyAr,
          scheduleIgnored: false,
        });
        calendarSeq++;
      }
    }

    creatives.sort(compareCreativesByCalendar);
    return creatives;
  }

  // weekly_refresh (weekly refresh) — 1-week selling plan with schedules.
  {
    const pool = buildLaunchPool(
      niche,
      name,
      "weekly_refresh",
      hookFromSku,
    );
    const pinned = hookFromSku ? pool[0]! : null;
    const rest = pinned ? pool.slice(1) : pool;
    shuffleInPlace(rest, rand);
    const ordered = pinned
      ? [pinned, ...rotate(rest, seed)]
      : rotate(rest, seed);
    const formats = rotate([...LAUNCH_FORMATS], seed + 3);
    const ctaOffset = Math.abs(seed) % ORDER_CTA_EN.length;

    const w = 1;
    const n = count;
    const slots = scheduleSlotsForWeek({
      count: n,
      seed,
      weekIndex: w,
    });

    const creatives: Creative[] = [];
    for (let j = 0; j < n; j++) {
      const angle = ordered[j % ordered.length]!;
      const format = formats[j % formats.length]!;
      const ctaEn = ORDER_CTA_EN[(ctaOffset + j) % ORDER_CTA_EN.length]!;
      const ctaAr = ORDER_CTA_AR[(ctaOffset + j) % ORDER_CTA_AR.length]!;
      const seriesNum = seriesBase + j;
      const slot = slots[j]!;
      const schedule = suggestSchedule({
        phase: "monthly",
        format,
        suggestedDay: slot.day,
        suggestedTimeBand: slot.band,
      });

      creatives.push({
        id: newId(),
        format,
        angleEn: angle.angleEn,
        angleAr: angle.angleAr,
        captionEn: `${angle.captionLeadEn} ${ctaEn}`,
        captionAr: `${angle.captionLeadAr} ${ctaAr}`,
        shots: shotListLaunch(
          format,
          name,
          angle.hookEn,
          problemEn,
          resultEn,
        ),
        seriesLabelEn: `${angle.seriesStemEn} #${seriesNum}`,
        seriesLabelAr: `${angle.seriesStemAr} #${seriesNum}`,
        hookEn: angle.hookEn,
        hookAr: angle.hookAr,
        weekIndex: w,
        weekLabelEn: weekLabelEn(w),
        weekLabelAr: weekLabelAr(w),
        suggestedDay: schedule.suggestedDay,
        suggestedTimeBand: schedule.suggestedTimeBand,
        whyEn: schedule.whyEn,
        whyAr: schedule.whyAr,
        scheduleIgnored: false,
      });
    }

    creatives.sort(compareCreativesByCalendar);
    return creatives;
  }
}
