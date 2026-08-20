import type { IndustryOptionId } from "@/lib/constants";
import type { StorageFootprint } from "@/lib/skills/fit";
import type { AppLocale } from "@/i18n/routing";

/**
 * Curated product catalog + injectable DemandProvider.
 *
 * v1 uses a curated candidate pool (no MCP). The `DemandProvider` interface is
 * the seam that a real demand MCP/API swaps into later without touching
 * Discovery. Demand in v1 is "curated candidates + founder-confirmed signal
 * (URL / note / screenshot) + AI structured summary".
 */

type LocalizedText = { name: string; summary: string; differentiation: string };

export type CatalogProduct = {
  key: string;
  category: IndustryOptionId;
  en: LocalizedText;
  ar: LocalizedText;
  sellPrice: number;
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  difficulty: 0 | 1 | 2;
  risk: 0 | 1 | 2;
  timeNeed: number;
  workload: 0 | 1 | 2;
  storageFootprint: StorageFootprint;
  oversized: boolean;
  tier1Marketplaces: string[];
  /** Pool photo URL when stored; agent UI uses a placeholder if missing. */
  imageUrl?: string | null;
};

type Row = [
  key: string,
  category: IndustryOptionId,
  en: LocalizedText,
  ar: LocalizedText,
  price: number,
  cost: number,
  ship: number,
  clr: number,
  courier: number,
  difficulty: 0 | 1 | 2,
  risk: 0 | 1 | 2,
  timeNeed: number,
  workload: 0 | 1 | 2,
  footprint: StorageFootprint,
  oversized: boolean,
  tier1: string[],
];

// prettier-ignore
const ROWS: Row[] = [
  ["led_facial_wand","beauty_personal_care",
    {name:"LED Facial Wand",summary:"Rechargeable red-light skincare wand.",differentiation:"Bundle with a local Arabic skincare guide."},
    {name:"جهاز الوجه بالضوء",summary:"جهاز عناية بالبشرة بالضوء الأحمر قابل للشحن.",differentiation:"يُباع مع دليل عناية بالبشرة بالعربية."},
    45,5,3,1,2,1,1,5,1,"small",false,[]],
  ["gua_sha_set","beauty_personal_care",
    {name:"Gua Sha Facial Set",summary:"Stone facial massage set with pouch.",differentiation:"Premium gift packaging for local gifting."},
    {name:"طقم غوا شا",summary:"طقم تدليك للوجه بالحجر مع حقيبة.",differentiation:"تغليف هدايا فاخر للسوق المحلي."},
    25,2,2,1,1,0,0,3,0,"small",false,["Ishtari"]],
  ["silicone_kitchen_set","home_kitchen",
    {name:"Silicone Kitchen Set",summary:"Heat-safe cooking utensil set.",differentiation:"Color options matched to local taste."},
    {name:"طقم مطبخ سيليكون",summary:"طقم أدوات طهي مقاوم للحرارة.",differentiation:"ألوان تناسب الذوق المحلي."},
    34,3,2,1,2,0,0,4,1,"medium",false,[]],
  ["collapsible_containers","home_kitchen",
    {name:"Collapsible Food Containers",summary:"Space-saving stackable lunch set.",differentiation:"Leak-proof seal demoed in short reels."},
    {name:"علب طعام قابلة للطي",summary:"طقم غداء قابل للطي وتوفير المساحة.",differentiation:"إغلاق مانع للتسرب يظهر في الفيديوهات."},
    32,3,2,1,2,0,1,4,1,"medium",false,[]],
  ["magnetic_charger","phone_tech_accessories",
    {name:"Magnetic Fast Charger",summary:"MagSafe-style 15W wireless charger.",differentiation:"Certified cable + Arabic quick-start."},
    {name:"شاحن مغناطيسي سريع",summary:"شاحن لاسلكي مغناطيسي ١٥ واط.",differentiation:"كابل معتمد ودليل بدء سريع بالعربية."},
    39,5,2,1,2,1,1,5,1,"small",false,["EGLOW"]],
  ["phone_tripod","phone_tech_accessories",
    {name:"Creator Phone Tripod",summary:"Flexible tripod with remote shutter.",differentiation:"Positioned for local content creators."},
    {name:"حامل هاتف للمبدعين",summary:"حامل ثلاثي مرن مع زر تحكم عن بعد.",differentiation:"موجّه لصنّاع المحتوى المحليين."},
    29,3,1,1,2,1,1,6,2,"small",false,[]],
  ["baby_bottle_warmer","kids_baby_accessories",
    {name:"Portable Bottle Warmer",summary:"USB travel bottle warmer for babies.",differentiation:"Fast-warm demo + safety notes in Arabic."},
    {name:"سخّان رضّاعة محمول",summary:"سخّان رضّاعة محمول عبر USB للأطفال.",differentiation:"عرض تسخين سريع وملاحظات أمان بالعربية."},
    38,4,2,1,2,1,1,5,1,"small",false,[]],
  ["kids_night_light","kids_baby_accessories",
    {name:"Kids Night Light",summary:"Rechargeable silicone squeeze light.",differentiation:"Cute characters popular with local parents."},
    {name:"إضاءة ليلية للأطفال",summary:"إضاءة سيليكون قابلة للشحن والضغط.",differentiation:"شخصيات محببة للأهل في السوق المحلي."},
    22,2,1,1,1,0,0,3,0,"small",false,[]],
  ["resistance_bands","fitness_lifestyle",
    {name:"Resistance Band Set",summary:"5-level home workout band set.",differentiation:"Arabic home-workout plan included."},
    {name:"طقم أشرطة مقاومة",summary:"طقم أشرطة تمارين منزلية ٥ مستويات.",differentiation:"خطة تمارين منزلية بالعربية مرفقة."},
    27,3,1,1,2,0,1,4,1,"small",false,[]],
  ["smart_water_bottle","fitness_lifestyle",
    {name:"Smart Water Bottle",summary:"Hydration-tracking insulated bottle.",differentiation:"Ramadan hydration angle for local push."},
    {name:"زجاجة ماء ذكية",summary:"زجاجة معزولة تتابع شرب الماء.",differentiation:"زاوية ترطيب رمضانية للحملة المحلية."},
    35,4,2,1,2,1,1,5,1,"medium",false,["Platza"]],
  ["minimalist_wallet","fashion_accessories",
    {name:"Slim RFID Wallet",summary:"Leather RFID-blocking card wallet.",differentiation:"Monogram add-on for gifting."},
    {name:"محفظة رفيعة RFID",summary:"محفظة بطاقات جلدية بحماية RFID.",differentiation:"إضافة حرف الاسم كهدية."},
    28,3,1,1,2,0,0,3,0,"small",false,[]],
  ["sunglasses_polarized","fashion_accessories",
    {name:"Polarized Sunglasses",summary:"UV400 polarized unisex sunglasses.",differentiation:"Local influencer styling shots."},
    {name:"نظارات شمسية مستقطبة",summary:"نظارات شمسية مستقطبة UV400 للجنسين.",differentiation:"صور تنسيق مع مؤثرين محليين."},
    30,3,1,1,2,1,1,4,1,"small",false,[]],
  ["car_vacuum","car_accessories",
    {name:"Cordless Car Vacuum",summary:"Portable high-suction car cleaner.",differentiation:"Bundled detailing brush set."},
    {name:"مكنسة سيارة لاسلكية",summary:"منظّف سيارة محمول بشفط قوي.",differentiation:"يُباع مع طقم فرش تنظيف."},
    42,5,2,1,2,1,1,6,1,"medium",false,[]],
  ["car_phone_mount","car_accessories",
    {name:"Magnetic Car Mount",summary:"Dashboard magnetic phone holder.",differentiation:"One-hand mount demoed in reels."},
    {name:"حامل هاتف للسيارة",summary:"حامل هاتف مغناطيسي للوحة القيادة.",differentiation:"تركيب بيد واحدة يظهر في الفيديوهات."},
    24,2,1,1,2,0,0,3,0,"small",false,[]],
  ["pet_grooming_glove","pet_accessories",
    {name:"Pet Grooming Glove",summary:"De-shedding massage grooming glove.",differentiation:"Before/after fur demo content."},
    {name:"قفاز تنظيف الحيوانات",summary:"قفاز تدليك وإزالة الوبر.",differentiation:"محتوى قبل/بعد لإزالة الوبر."},
    23,2,1,1,1,0,0,3,0,"small",false,[]],
  ["pet_water_fountain","pet_accessories",
    {name:"Pet Water Fountain",summary:"Filtered circulating pet fountain.",differentiation:"Quiet-pump angle for apartments."},
    {name:"نافورة ماء للحيوانات",summary:"نافورة ماء دائرية مع فلتر.",differentiation:"مضخة هادئة تناسب الشقق."},
    40,5,2,1,2,1,1,5,1,"medium",false,[]],
  ["desk_organizer","office_desk_gadgets",
    {name:"Desk Organizer Station",summary:"Multi-slot desk + charging organizer.",differentiation:"Cable-tidy angle for remote workers."},
    {name:"منظّم مكتب",summary:"منظّم مكتب متعدد الفتحات مع شحن.",differentiation:"ترتيب الأسلاك للعاملين عن بعد."},
    33,3,2,1,2,0,0,4,0,"medium",false,[]],
  ["mechanical_keypad","office_desk_gadgets",
    {name:"Mini Mechanical Keypad",summary:"Programmable macro keypad.",differentiation:"Preset shortcuts for creators."},
    {name:"لوحة مفاتيح ميكانيكية",summary:"لوحة ماكرو قابلة للبرمجة.",differentiation:"اختصارات جاهزة للمبدعين."},
    36,4,2,1,2,2,1,7,2,"small",false,[]],
  ["posture_corrector","health_wellness_gadgets",
    {name:"Posture Corrector",summary:"Adjustable back posture support.",differentiation:"Desk-worker posture routine in Arabic."},
    {name:"مصحّح الوضعية",summary:"دعامة ظهر قابلة للتعديل.",differentiation:"روتين وضعية للعاملين بالعربية."},
    26,2,1,1,2,1,1,4,1,"small",false,[]],
  ["massage_gun","health_wellness_gadgets",
    {name:"Mini Massage Gun",summary:"Percussion muscle recovery device.",differentiation:"Quiet motor + travel case."},
    {name:"مسدس تدليك صغير",summary:"جهاز استشفاء عضلي بالاهتزاز.",differentiation:"محرك هادئ وحقيبة سفر."},
    44,6,2,1,2,1,1,5,1,"small",false,["Ishtari"]],
  // Intentionally margin-blocked (landed cost too high) — shown with explanation.
  ["premium_blender","home_kitchen",
    {name:"Portable Blender Pro",summary:"High-power rechargeable blender.",differentiation:"Strong build, premium positioning."},
    {name:"خلاط محمول برو",summary:"خلاط محمول عالي القوة قابل للشحن.",differentiation:"تصنيع قوي وتموضع فاخر."},
    35,15,4,2,4,1,1,5,1,"medium",false,[]],
  ["smart_scale","health_wellness_gadgets",
    {name:"Smart Body Scale",summary:"Bluetooth body-composition scale.",differentiation:"App syncs with Arabic labels."},
    {name:"ميزان جسم ذكي",summary:"ميزان تركيب الجسم بالبلوتوث.",differentiation:"تطبيق بواجهة عربية."},
    30,13,3,2,4,2,2,6,2,"medium",false,[]],
  // Intentionally oversized (hard block).
  ["folding_treadmill","fitness_lifestyle",
    {name:"Folding Treadmill",summary:"Compact under-desk walking pad.",differentiation:"Apartment-friendly compact fold."},
    {name:"جهاز مشي قابل للطي",summary:"جهاز مشي مدمج تحت المكتب.",differentiation:"طيّ مدمج يناسب الشقق."},
    180,70,40,15,20,2,2,8,2,"large",true,[]],
  ["standing_mirror","home_kitchen",
    {name:"LED Standing Mirror",summary:"Full-length LED vanity mirror.",differentiation:"Influencer vanity content angle."},
    {name:"مرآة أرضية بإضاءة",summary:"مرآة طويلة بإضاءة LED.",differentiation:"محتوى زينة مع المؤثرين."},
    120,45,35,12,18,1,1,6,1,"large",true,[]],
  ["beard_kit","beauty_personal_care",
    {name:"Beard Grooming Kit",summary:"Trimmer, oil, and comb bundle.",differentiation:"Local barber co-branding angle."},
    {name:"طقم عناية باللحية",summary:"ماكينة وزيت ومشط في طقم واحد.",differentiation:"تعاون مع صالونات محلية."},
    34,3,2,1,2,0,1,4,1,"small",false,[]],
  // Extra accept-ready rows so a demo session can fill DISCOVERY_SESSION_CAP (25).
  ["cable_organizer","office_desk_gadgets",
    {name:"Cable Organizer Clips",summary:"Adhesive desk cable clip pack.",differentiation:"Before/after tidy desk reels."},
    {name:"منظّم كابلات",summary:"مشابك لاصقة لتنظيم كابلات المكتب.",differentiation:"فيديوهات قبل/بعد لمكتب مرتّب."},
    18,2,1,1,1,0,0,2,0,"small",false,[]],
  ["ice_roller","beauty_personal_care",
    {name:"Facial Ice Roller",summary:"Stainless ice roller for puffiness.",differentiation:"Morning routine clips in Arabic."},
    {name:"رولر ثلج للوجه",summary:"رولر ثلج من الستانلس لتقليل الانتفاخ.",differentiation:"مقاطع روتين صباحي بالعربية."},
    22,2,1,1,1,0,0,3,0,"small",false,[]],
  ["yoga_socks","fitness_lifestyle",
    {name:"Grip Yoga Socks",summary:"Non-slip socks for home yoga.",differentiation:"Bundle with a 7-day Arabic flow."},
    {name:"جوارب يوغا مانعة للانزلاق",summary:"جوارب مانعة للانزلاق لليوغا المنزلية.",differentiation:"تُباع مع خطة تمارين ٧ أيام بالعربية."},
    20,2,1,1,1,0,0,3,0,"small",false,[]],
  ["lunch_bag","home_kitchen",
    {name:"Insulated Lunch Bag",summary:"Compact leak-resistant lunch tote.",differentiation:"Office-worker packing demos."},
    {name:"حقيبة غداء معزولة",summary:"حقيبة غداء مدمجة مقاومة للتسرب.",differentiation:"عروض تجهيز غداء لموظفي المكاتب."},
    28,3,2,1,2,0,0,4,1,"medium",false,[]],
];

export const CATALOG: CatalogProduct[] = ROWS.map((r) => ({
  key: r[0],
  category: r[1],
  en: r[2],
  ar: r[3],
  sellPrice: r[4],
  productCost: r[5],
  intlShip: r[6],
  clearanceTaxes: r[7],
  localCourier: r[8],
  difficulty: r[9],
  risk: r[10],
  timeNeed: r[11],
  workload: r[12],
  storageFootprint: r[13],
  oversized: r[14],
  tier1Marketplaces: r[15],
}));

const CATALOG_BY_KEY = new Map(CATALOG.map((p) => [p.key, p]));

export function getCatalogProduct(key: string): CatalogProduct | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function localizedProduct(
  product: CatalogProduct,
  locale: AppLocale,
): LocalizedText {
  return locale === "ar" ? product.ar : product.en;
}

// ---------------------------------------------------------------------------
// DemandProvider — injectable seam (curated stub in v1, MCP later)
// ---------------------------------------------------------------------------

export type DemandInput = {
  productName: string;
  category: string;
  url?: string | null;
  note?: string | null;
  screenshotNote?: string | null;
  locale: AppLocale;
};

export type DemandSummary = {
  summary: string;
  confidence: number;
};

export interface DemandProvider {
  summarize(input: DemandInput): DemandSummary;
}

/**
 * Curated, deterministic demand provider. Produces a structured AI-style
 * summary from the founder's confirmed signal. A real MCP provider can replace
 * this without changing Discovery.
 */
export const curatedDemandProvider: DemandProvider = {
  summarize(input) {
    const signals: string[] = [];
    if (input.url) signals.push(input.locale === "ar" ? "رابط" : "a link");
    if (input.note) signals.push(input.locale === "ar" ? "ملاحظة" : "a note");
    if (input.screenshotNote)
      signals.push(input.locale === "ar" ? "لقطة شاشة" : "a screenshot");

    const signalCount = signals.length;
    const confidence = Math.min(0.9, 0.4 + signalCount * 0.15);

    if (input.locale === "ar") {
      const src = signalCount ? ` بناءً على ${signals.join(" و")}` : "";
      return {
        summary:
          `قراءة الطلب لـ «${input.productName}»${src}: إشارة طلب مؤكدة من المؤسس. ` +
          `الاهتمام يبدو متوسطاً إلى قوي في فئة «${input.category}» ضمن السوق اللبناني. ` +
          `يُنصح بالتحقق من الموسمية والمنافسة قبل الالتزام بالشحنة.`,
        confidence,
      };
    }

    const src = signalCount ? ` based on ${signals.join(" and ")}` : "";
    return {
      summary:
        `Demand read for "${input.productName}"${src}: founder-confirmed signal recorded. ` +
        `Interest looks moderate-to-strong for the "${input.category}" category in the Lebanese market. ` +
        `Validate seasonality and competition before committing a batch.`,
      confidence,
    };
  },
};
