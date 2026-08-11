/**
 * Store page copy + discoverability pack (Wave 4 Phase 2).
 * Deterministic templates = fail-closed fallback. No ranking / citation promises.
 */

export type StoreFaqItem = {
  qEn: string;
  aEn: string;
  qAr: string;
  aAr: string;
};

export type DiscoverabilityPack = {
  titleEn: string;
  titleAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  searchPhrasesEn: string[];
  searchPhrasesAr: string[];
  faqs: StoreFaqItem[];
  attractivenessTipsEn: string[];
  attractivenessTipsAr: string[];
};

export type StorePageCopySource = "gemini" | "template";

export type StorePageCopyPayload = {
  contentDraftEn: string;
  contentDraftAr: string;
  policiesDraft: string;
  discoverability: DiscoverabilityPack;
  source: StorePageCopySource;
};

export type StorePageCopyInput = {
  name: string;
  category: string;
  differentiation?: string;
  hooks?: string[];
  sellPrice?: number | null;
};

export type StorePageCopyValidateError =
  | "invalid_shape"
  | "too_short"
  | "missing_product_name"
  | "ranking_promise"
  | "cod_wow";

const RANKING_PROMISE =
  /rank\s*#?\s*1|guaranteed\s+rank|seo\s*#?\s*1|will\s+cite|chatbot\s+citation|google\s+merchant\s+guarantee|يضمن\s*الترتيب|الأولى\s+في\s+جوجل|استشهاد\s+الروبوت/i;

/** COD pitched as a marketing wow / differentiator (ops COD in policies is OK). */
const COD_WOW =
  /\b(wow|unique|advantage|differentiator|selling\s+point)\b.{0,48}\b(cod|cash[\s-]?on[\s-]?delivery)\b|\b(cod|cash[\s-]?on[\s-]?delivery)\b.{0,48}\b(wow|unique|advantage|differentiator|selling\s+point)\b|(ميزة|تفرد|تفوّق).{0,40}(الدفع عند الاستلام|كود)|(?:الدفع عند الاستلام|كود).{0,40}(ميزة|تفرد|تفوّق)/i;

export function buildTemplateStorePageCopy(
  input: StorePageCopyInput,
): StorePageCopyPayload {
  const name = input.name.trim() || "your product";
  const diff = input.differentiation?.trim();
  const hook = (input.hooks ?? [])
    .map((h) => h.trim())
    .find((h) => h && !h.startsWith("@"));
  const price =
    input.sellPrice != null && Number.isFinite(input.sellPrice)
      ? `$${Math.round(input.sellPrice)}`
      : null;

  const contentDraftEn = [
    `Title: ${name}`,
    ``,
    `• What it is: ${diff || `one clear sentence on the main benefit of ${name} for the buyer.`}`,
    hook ? `• Angle: ${hook}` : `• Why it helps: the everyday problem ${name} solves in Lebanon.`,
    `• What's included: contents + any bundle with ${name}.`,
    `• How you receive it: delivery in about 3–7 days nationwide. Pay cash to the delivery person when it arrives (COD).`,
    `• Support: message us on WhatsApp with any question before you order.`,
    price ? `• Price reference: ${price} (confirm on your Shopify product).` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const contentDraftAr = [
    `العنوان: ${name}`,
    ``,
    `• ما هو: ${diff || `جملة واحدة واضحة عن الفائدة الأساسية لـ ${name} للمشتري.`}`,
    hook ? `• الزاوية: ${hook}` : `• لماذا يفيد: المشكلة اليومية التي يحلّها ${name} في لبنان.`,
    `• ما يتضمّنه: المحتويات وأي عرض مجمّع مع ${name}.`,
    `• كيف يصلك: توصيل خلال نحو ٣–٧ أيام لكل لبنان. ادفع نقداً لمندوب التوصيل عند الوصول (الدفع عند الاستلام).`,
    `• الدعم: راسلنا على واتساب لأي سؤال قبل الطلب.`,
    price ? `• مرجع السعر: ${price} (أكّده على منتج Shopify).` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const policiesDraft = [
    "Shipping: 3–7 business days nationwide via a local delivery company.",
    "Cash on delivery: pay the delivery person when your order arrives.",
    "Returns: 3-day return for unused items in original packaging.",
    "Damaged/wrong item: we replace or refund — contact us on WhatsApp.",
    "These lines are drafts for your Shopify policies — not legal advice.",
  ].join("\n");

  const discoverability: DiscoverabilityPack = {
    titleEn: `${name} — practical upgrade for daily life`,
    titleAr: `${name} — تحسين عملي لحياتك اليومية`,
    shortDescriptionEn: diff
      ? `${name}: ${diff} Order on WhatsApp-friendly checkout; delivery across Lebanon.`
      : `${name} helps with an everyday problem. Clear benefit, easy order, delivery across Lebanon.`,
    shortDescriptionAr: diff
      ? `${name}: ${diff} اطلب بسهولة؛ توصيل في لبنان.`
      : `${name} يساعد في مشكلة يومية. فائدة واضحة، طلب سهل، توصيل في لبنان.`,
    searchPhrasesEn: [
      name,
      `${name} Lebanon`,
      `${name} buy online`,
      input.category.replace(/_/g, " ") || "home product",
    ].slice(0, 6),
    searchPhrasesAr: [
      name,
      `${name} لبنان`,
      `شراء ${name}`,
      "توصيل لبنان",
    ].slice(0, 6),
    faqs: [
      {
        qEn: `What is ${name}?`,
        aEn: diff || `${name} is a practical product for everyday use. See the product page for what's included.`,
        qAr: `ما هو ${name}؟`,
        aAr: diff || `${name} منتج عملي للاستخدام اليومي. راجع صفحة المنتج لما يتضمّنه.`,
      },
      {
        qEn: "How long does delivery take?",
        aEn: "About 3–7 business days nationwide with a local delivery company.",
        qAr: "كم يستغرق التوصيل؟",
        aAr: "نحو ٣–٧ أيام عمل لكل لبنان مع شركة توصيل محلية.",
      },
      {
        qEn: "How do I pay?",
        aEn: "Cash to the delivery person when the order arrives (COD). Message us on WhatsApp with questions.",
        qAr: "كيف أدفع؟",
        aAr: "نقداً لمندوب التوصيل عند وصول الطلب (الدفع عند الاستلام). راسلنا على واتساب لأي سؤال.",
      },
    ],
    attractivenessTipsEn: [
      `Lead the product page with the job ${name} does in the first line — not brand history.`,
      "Use 3–5 clear photos: product, in-use, what's in the box.",
      "Keep WhatsApp visible; buyers in Lebanon often ask before checkout.",
      "Paste the discoverability title + short description into Shopify SEO fields — no ranking guarantees.",
    ],
    attractivenessTipsAr: [
      `ابدأ صفحة ${name} بوظيفة المنتج من السطر الأول — لا بتاريخ العلامة.`,
      "استخدم ٣–٥ صور واضحة: المنتج، الاستخدام، محتوى العلبة.",
      "أظهر واتساب بوضوح؛ المشترون في لبنان غالباً يسألون قبل الدفع.",
      "الصق العنوان والوصف القصير في حقول SEO في Shopify — بلا وعود ترتيب.",
    ],
  };

  return {
    contentDraftEn,
    contentDraftAr,
    policiesDraft,
    discoverability,
    source: "template",
  };
}

export function formatDiscoverabilityForCopy(pack: DiscoverabilityPack): string {
  const faqs = pack.faqs
    .map(
      (f, i) =>
        `${i + 1}. ${f.qEn}\n${f.aEn}\n\n${f.qAr}\n${f.aAr}`,
    )
    .join("\n\n");
  return [
    `TITLE (EN): ${pack.titleEn}`,
    `TITLE (AR): ${pack.titleAr}`,
    ``,
    `SHORT DESCRIPTION (EN):`,
    pack.shortDescriptionEn,
    ``,
    `SHORT DESCRIPTION (AR):`,
    pack.shortDescriptionAr,
    ``,
    `SEARCH PHRASES (EN):`,
    pack.searchPhrasesEn.map((p) => `• ${p}`).join("\n"),
    ``,
    `SEARCH PHRASES (AR):`,
    pack.searchPhrasesAr.map((p) => `• ${p}`).join("\n"),
    ``,
    `FAQs:`,
    faqs,
  ].join("\n");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asStringArray(v: unknown, min: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length >= min ? out : null;
}

export function validateStorePageCopyPayload(
  raw: unknown,
  productName: string,
  source: StorePageCopySource = "gemini",
):
  | { ok: true; payload: StorePageCopyPayload }
  | { ok: false; error: StorePageCopyValidateError } {
  const name = productName.trim() || "your product";
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_shape" };
  }
  const o = raw as Record<string, unknown>;
  const contentDraftEn = o.contentDraftEn;
  const contentDraftAr = o.contentDraftAr;
  const policiesDraft = o.policiesDraft;
  const disc = o.discoverability;
  if (
    !isNonEmptyString(contentDraftEn) ||
    !isNonEmptyString(contentDraftAr) ||
    !isNonEmptyString(policiesDraft) ||
    !disc ||
    typeof disc !== "object"
  ) {
    return { ok: false, error: "invalid_shape" };
  }

  const d = disc as Record<string, unknown>;
  const titleEn = d.titleEn;
  const titleAr = d.titleAr;
  const shortDescriptionEn = d.shortDescriptionEn;
  const shortDescriptionAr = d.shortDescriptionAr;
  const searchPhrasesEn = asStringArray(d.searchPhrasesEn, 2);
  const searchPhrasesAr = asStringArray(d.searchPhrasesAr, 2);
  const tipsEn = asStringArray(d.attractivenessTipsEn, 2);
  const tipsAr = asStringArray(d.attractivenessTipsAr, 2);
  if (
    !isNonEmptyString(titleEn) ||
    !isNonEmptyString(titleAr) ||
    !isNonEmptyString(shortDescriptionEn) ||
    !isNonEmptyString(shortDescriptionAr) ||
    !searchPhrasesEn ||
    !searchPhrasesAr ||
    !tipsEn ||
    !tipsAr ||
    !Array.isArray(d.faqs) ||
    d.faqs.length < 2
  ) {
    return { ok: false, error: "invalid_shape" };
  }

  const faqs: StoreFaqItem[] = [];
  for (const row of d.faqs) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "invalid_shape" };
    }
    const f = row as Record<string, unknown>;
    if (
      !isNonEmptyString(f.qEn) ||
      !isNonEmptyString(f.aEn) ||
      !isNonEmptyString(f.qAr) ||
      !isNonEmptyString(f.aAr)
    ) {
      return { ok: false, error: "invalid_shape" };
    }
    faqs.push({
      qEn: f.qEn.trim(),
      aEn: f.aEn.trim(),
      qAr: f.qAr.trim(),
      aAr: f.aAr.trim(),
    });
  }

  const blob = [
    contentDraftEn,
    contentDraftAr,
    titleEn,
    titleAr,
    shortDescriptionEn,
    shortDescriptionAr,
    ...tipsEn,
    ...tipsAr,
  ].join("\n");

  if (contentDraftEn.trim().length < 80 || contentDraftAr.trim().length < 60) {
    return { ok: false, error: "too_short" };
  }
  if (
    !contentDraftEn.includes(name) &&
    !titleEn.includes(name)
  ) {
    return { ok: false, error: "missing_product_name" };
  }
  if (RANKING_PROMISE.test(blob)) {
    return { ok: false, error: "ranking_promise" };
  }
  if (COD_WOW.test(blob)) {
    return { ok: false, error: "cod_wow" };
  }

  return {
    ok: true,
    payload: {
      contentDraftEn: contentDraftEn.trim(),
      contentDraftAr: contentDraftAr.trim(),
      policiesDraft: policiesDraft.trim(),
      discoverability: {
        titleEn: titleEn.trim(),
        titleAr: titleAr.trim(),
        shortDescriptionEn: shortDescriptionEn.trim(),
        shortDescriptionAr: shortDescriptionAr.trim(),
        searchPhrasesEn,
        searchPhrasesAr,
        faqs,
        attractivenessTipsEn: tipsEn,
        attractivenessTipsAr: tipsAr,
      },
      source,
    },
  };
}

export function parseDiscoverabilityPack(
  raw: string | null | undefined,
): DiscoverabilityPack | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const d =
      root.discoverability && typeof root.discoverability === "object"
        ? (root.discoverability as Record<string, unknown>)
        : root;
    if (
      typeof d.titleEn !== "string" ||
      typeof d.titleAr !== "string" ||
      typeof d.shortDescriptionEn !== "string" ||
      typeof d.shortDescriptionAr !== "string" ||
      !Array.isArray(d.searchPhrasesEn) ||
      !Array.isArray(d.searchPhrasesAr) ||
      !Array.isArray(d.faqs) ||
      !Array.isArray(d.attractivenessTipsEn) ||
      !Array.isArray(d.attractivenessTipsAr)
    ) {
      return null;
    }
    return {
      titleEn: d.titleEn,
      titleAr: d.titleAr,
      shortDescriptionEn: d.shortDescriptionEn,
      shortDescriptionAr: d.shortDescriptionAr,
      searchPhrasesEn: d.searchPhrasesEn.filter(
        (x): x is string => typeof x === "string",
      ),
      searchPhrasesAr: d.searchPhrasesAr.filter(
        (x): x is string => typeof x === "string",
      ),
      faqs: d.faqs
        .filter((f): f is StoreFaqItem => {
          if (!f || typeof f !== "object") return false;
          const row = f as Record<string, unknown>;
          return (
            typeof row.qEn === "string" &&
            typeof row.aEn === "string" &&
            typeof row.qAr === "string" &&
            typeof row.aAr === "string"
          );
        })
        .map((f) => ({
          qEn: f.qEn,
          aEn: f.aEn,
          qAr: f.qAr,
          aAr: f.aAr,
        })),
      attractivenessTipsEn: d.attractivenessTipsEn.filter(
        (x): x is string => typeof x === "string",
      ),
      attractivenessTipsAr: d.attractivenessTipsAr.filter(
        (x): x is string => typeof x === "string",
      ),
    };
  } catch {
    return null;
  }
}

export function serializeDiscoverabilityPack(
  pack: DiscoverabilityPack,
  source: StorePageCopySource,
): string {
  return JSON.stringify({ ...pack, source });
}

export function parseStoredPackSource(
  raw: string | null | undefined,
): StorePageCopySource | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: unknown };
    if (parsed.source === "gemini" || parsed.source === "template") {
      return parsed.source;
    }
  } catch {
    /* ignore */
  }
  return null;
}
