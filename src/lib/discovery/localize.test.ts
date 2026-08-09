import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { resolveDisplayProductName } from "@/lib/discovery/localize";
import {
  assertNamesProduct,
  finalizeSuggestionBody,
} from "@/lib/discovery/explain/why-pick";
import {
  assertCompareAdviceAligned,
  buildCompareExplainPayload,
  finalizeCompareBody,
  type CompareProductPayload,
} from "@/lib/discovery/explain/compare";

describe("resolveDisplayProductName", () => {
  it("uses nameAr for Arabic when present", () => {
    expect(
      resolveDisplayProductName({
        locale: "ar",
        nameEn: "LED Facial Wand",
        nameAr: "عصا التجميل بالضوء",
      }),
    ).toBe("عصا التجميل بالضوء");
  });

  it("falls back to nameEn when nameAr is empty (card parity)", () => {
    expect(
      resolveDisplayProductName({
        locale: "ar",
        nameEn: "LED Facial Wand",
        nameAr: "  ",
      }),
    ).toBe("LED Facial Wand");
  });

  it("uses nameEn for English", () => {
    expect(
      resolveDisplayProductName({
        locale: "en",
        nameEn: "LED Facial Wand",
        nameAr: "عصا التجميل بالضوء",
      }),
    ).toBe("LED Facial Wand");
  });

  it("uses fallback when pool names are missing", () => {
    expect(
      resolveDisplayProductName({
        locale: "en",
        nameEn: "",
        nameAr: "",
        fallbackName: "Session Snapshot Name",
      }),
    ).toBe("Session Snapshot Name");
  });
});

describe("locale product name in Why validators", () => {
  const arName = "عصا التجميل بالضوء";
  const enName = "LED Facial Wand";

  const arBody = [
    `${arName} فرصة تقديرية لأن لا دليل بحث حي محفوظ يمكن الاستشهاد به، لذا لا ندّعي طلباً أجنبياً أو محلياً مثبتاً أو أعداد بائعين، ونحدّد فرضية تحتاج تحققاً مدفوعاً قبل أي توسّع.`,
    `الملاءمة 78/100 وهوامش التخطيط التي تتجاوز هدفي 70٪ قبل الإعلانات و35٪ بعدها تفسّر اجتياز المنتج لفحوصات التشغيل والميزانية والاقتصاد دون تحويل هذا الشرح إلى درجة قبول أو رفض.`,
    `الطريقة العملية لطلب ميزة هي زاوية الحامل المقاوم للحرارة كعرض محدد للعميل، لا كقائمة عامة، مع قياس التحويل وتكلفة الاكتساب وقبول السعر من عيّنة صغيرة.`,
    `توصية حسناً تعكس ضعف ثقة أدلة السوق لا ملاءمة متوسطة، لذا عدم اليقين الحقيقي هو الطلب المدفوع وليس قدرة المؤسس التشغيلية على إدارة المنتج يومياً.`,
    `اختبر عيّنة صغيرة بميزانية إعلانات متواضعة، وقس الطلبات المدفوعة الفعلية، وارفض التوسّع من التقدير وحده قبل أن تظهر الأرقام.`,
    `اقبل فقط إذا أتممت هذا التحقق قبل طلب أوسع؛ وإلا تخطَّ المنتج واحفظ الميزانية لفرصة أوضح.`,
  ].join(" ");

  it("accepts a finalized body that quotes nameAr and rejects English-only", () => {
    expect(assertNamesProduct(arBody, arName)).toBe(true);
    expect(assertNamesProduct(arBody, enName)).toBe(false);
    expect(finalizeSuggestionBody(arBody, arName)).toBeTruthy();
    expect(finalizeSuggestionBody(arBody, enName)).toBeNull();
  });
});

describe("locale product name in Compare", () => {
  function product(
    partial: Partial<CompareProductPayload> &
      Pick<CompareProductPayload, "candidateId" | "productName" | "catalogKey">,
  ): CompareProductPayload {
    return {
      fitScore: 90,
      strength: "Strong",
      softMarginBand: "pass",
      marginBefore: 0.72,
      marginAfter: 0.38,
      canCiteMarketSignals: false,
      evidenceSource: "heuristic_seed",
      curatedDifferentiation: "Bundle with a heat-safe stand.",
      marketEvidence: null,
      ...partial,
    };
  }

  it("advisedName follows locale display names from the payload", () => {
    const arName = "عصا التجميل بالضوء";
    const rivalAr = "شاحن محمول";
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [
        product({
          candidateId: "w",
          catalogKey: "wand",
          productName: resolveDisplayProductName({
            locale: "ar",
            nameEn: "LED Facial Wand",
            nameAr: arName,
          }),
          fitScore: 95,
        }),
        product({
          candidateId: "g",
          catalogKey: "charger",
          productName: resolveDisplayProductName({
            locale: "ar",
            nameEn: "Portable Charger",
            nameAr: rivalAr,
          }),
          fitScore: 80,
        }),
      ],
    });
    expect(payload.advisedName).toBe(arName);

    const brief =
      `ننصح بالبدء بـ${arName} لأن ملاءمته 95/100 وهوامش التخطيط حوالي 72 بالمئة قبل الإعلانات و38 بالمئة بعدها أوضح من ${rivalAr} عند ملاءمة 80/100. ` +
      `قراءة السوق للمنتج المنصوح تقديرية لأن لا دليل حي محفوظ، لذا تبقى الفرصة فرضية لا فجوة مثبتة. ` +
      `${rivalAr} أيضاً تقديري فقط مع ملاءمة أضعف ونفس الحاجة لإثبات الطلب المدفوع قبل طلب أوسع. ` +
      `اختبر ${arName} أولاً بعيّنة صغيرة وزاوية الحامل المقاوم للحرارة، مع إعلانات متواضعة حتى تؤكد الطلبات التقدير. ` +
      `القبول يبقى خيارك الحر على أي بطاقة؛ المهارات تنصح فقط بأي منتج موسوم تختبره أولاً بين هذه المجموعة.`;
    const body = finalizeCompareBody(brief, arName, [rivalAr]);
    expect(body).toBeTruthy();
    expect(assertCompareAdviceAligned(body!, payload)).toBe(true);
  });

  it("Why and Compare services resolve display names from the pool", () => {
    const why = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/explain/service.ts"),
      "utf8",
    );
    const compare = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/explain/compare-service.ts"),
      "utf8",
    );
    expect(why).toContain("resolveDisplayProductName");
    expect(why).toContain("nameAr: schema.discoveryProductPool.nameAr");
    expect(compare).toContain("resolveDisplayProductName");
    expect(compare).toContain("nameAr: schema.discoveryProductPool.nameAr");
    expect(why).not.toMatch(/productName:\s*candidate\.name/);
    expect(compare).not.toMatch(/productName:\s*candidate\.name/);
  });
});
