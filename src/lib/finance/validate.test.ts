import { describe, expect, it } from "vitest";
import {
  encodeImportBatchForWrite,
  encodePerSkuSoldLeftForWrite,
  isValidTopicAWeekStart,
  parseImportBatchInventory,
  parseWeeklyEntryFormData,
  skuWeekLineSchema,
  unitsLeftSchema,
  validateWeeklyEntryInput,
} from "@/lib/finance/validate";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("unitsLeftSchema — fail closed", () => {
  it("accepts null and non-negative finite", () => {
    expect(unitsLeftSchema.parse(null)).toBeNull();
    expect(unitsLeftSchema.parse(12)).toBe(12);
    expect(unitsLeftSchema.parse(0)).toBe(0);
  });

  it("rejects NaN / negative / non-finite (never invent 0)", () => {
    expect(unitsLeftSchema.safeParse(Number.NaN).success).toBe(false);
    expect(unitsLeftSchema.safeParse(-1).success).toBe(false);
    expect(unitsLeftSchema.safeParse(Infinity).success).toBe(false);
    expect(unitsLeftSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("parseWeeklyEntryFormData", () => {
  const base = {
    weekStart: "2026-01-06",
    sales: "1000",
    orders: "40",
    metaSpend: "100",
    tiktokSpend: "50",
    codCollected: "800",
    codOutstanding: "200",
    courierFees: "80",
    skuSold: "40",
  };

  it("accepts a valid week payload", () => {
    const res = parseWeeklyEntryFormData(form(base));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.weekStart).toBe("2026-01-06");
    expect(res.data.sales).toBe(1000);
    expect(res.data.skuSold).toBe(40);
  });

  it("rejects missing / bad weekStart", () => {
    expect(parseWeeklyEntryFormData(form({ ...base, weekStart: "" }))).toEqual({
      ok: false,
      error: "missing_week",
    });
    expect(
      parseWeeklyEntryFormData(form({ ...base, weekStart: "not-a-date" })),
    ).toEqual({ ok: false, error: "invalid_week" });
  });

  it("rejects non YYYY-MM-DD or impossible calendar dates", () => {
    expect(isValidTopicAWeekStart("2026-1-6")).toBe(false);
    expect(isValidTopicAWeekStart("2026/01/06")).toBe(false);
    expect(isValidTopicAWeekStart("2026-13-01")).toBe(false);
    expect(isValidTopicAWeekStart("2026-02-31")).toBe(false);
    expect(isValidTopicAWeekStart("2026-04-31")).toBe(false);
    expect(isValidTopicAWeekStart("2026-01-06")).toBe(true);
    // Leap day ok; non-leap Feb 29 rejected.
    expect(isValidTopicAWeekStart("2024-02-29")).toBe(true);
    expect(isValidTopicAWeekStart("2025-02-29")).toBe(false);

    expect(
      parseWeeklyEntryFormData(form({ ...base, weekStart: "2026-02-31" })),
    ).toEqual({ ok: false, error: "invalid_week" });
    expect(
      validateWeeklyEntryInput({
        weekStart: "2026-13-01",
        sales: 1,
        orders: 1,
        metaSpend: 0,
        tiktokSpend: 0,
        codCollected: 0,
        codOutstanding: 0,
        courierFees: 0,
        skuSold: 1,
      }),
    ).toEqual({ ok: false, error: "invalid_week" });
  });

  it("rejects negative or non-finite money fields", () => {
    expect(
      parseWeeklyEntryFormData(form({ ...base, sales: "-10" })),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(
      parseWeeklyEntryFormData(form({ ...base, metaSpend: "NaN" })),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(
      parseWeeklyEntryFormData(form({ ...base, courierFees: "Infinity" })),
    ).toEqual({ ok: false, error: "invalid_fields" });
  });

  it("rejects negative Topic A spend / COD / units (no silent weird math)", () => {
    for (const key of [
      "metaSpend",
      "tiktokSpend",
      "codCollected",
      "codOutstanding",
      "courierFees",
      "orders",
      "skuSold",
    ] as const) {
      expect(
        parseWeeklyEntryFormData(form({ ...base, [key]: "-1" })),
        key,
      ).toEqual({ ok: false, error: "invalid_fields" });
    }
  });

  it("validateWeeklyEntryInput rejects negatives at service boundary", () => {
    const good = {
      weekStart: "2026-01-06",
      sales: 100,
      orders: 4,
      metaSpend: 10,
      tiktokSpend: 5,
      codCollected: 80,
      codOutstanding: 20,
      courierFees: 8,
      skuSold: 4,
      skuLeft: 10,
    };
    expect(validateWeeklyEntryInput(good).ok).toBe(true);
    expect(validateWeeklyEntryInput({ ...good, skuLeft: null }).ok).toBe(true);
    expect(
      validateWeeklyEntryInput({ ...good, metaSpend: -5 }),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(
      validateWeeklyEntryInput({ ...good, tiktokSpend: -1 }),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(
      validateWeeklyEntryInput({ ...good, codCollected: -2 }),
    ).toEqual({ ok: false, error: "invalid_fields" });
    expect(
      validateWeeklyEntryInput({ ...good, courierFees: Number.NaN }),
    ).toEqual({ ok: false, error: "invalid_fields" });
  });

  it("rejects corrupt skuLines JSON", () => {
    expect(
      parseWeeklyEntryFormData(form({ ...base, skuLines: "{not-json" })),
    ).toEqual({ ok: false, error: "invalid_sku_lines" });
  });

  it("rejects skuLines with bad shape / negative sold", () => {
    expect(
      parseWeeklyEntryFormData(
        form({
          ...base,
          skuLines: JSON.stringify([{ skuId: "a", sold: -1, sales: 10 }]),
        }),
      ),
    ).toEqual({ ok: false, error: "invalid_sku_lines" });
    expect(
      parseWeeklyEntryFormData(
        form({
          ...base,
          skuLines: JSON.stringify([{ sold: 1, sales: 10 }]),
        }),
      ),
    ).toEqual({ ok: false, error: "invalid_sku_lines" });
  });

  it("rejects skuLines left that would invent 0 from NaN", () => {
    expect(
      skuWeekLineSchema.safeParse({
        skuId: "a",
        sold: 1,
        sales: 10,
        left: Number.NaN,
      }).success,
    ).toBe(false);
  });

  it("accepts valid Mode C skuLines (left null ok)", () => {
    const res = parseWeeklyEntryFormData(
      form({
        ...base,
        skuLines: JSON.stringify([
          { skuId: "a", sold: 5, sales: 100, left: null },
          { skuId: "b", sold: 3, sales: 60 },
        ]),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.skuLines).toHaveLength(2);
    expect(res.data.skuLines?.[0]?.left).toBeNull();
  });
});

describe("encodeImportBatchForWrite / parseImportBatchInventory", () => {
  it("encodes valid inventory fields", () => {
    const enc = encodeImportBatchForWrite({
      status: "arrived",
      totalUnitsReceived: 100,
      unitsLeft: 40,
      suggestedFirstBatch: 50,
      notes: ["@import.ok"],
    });
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const parsed = parseImportBatchInventory(enc.json);
    expect(parsed).toEqual({
      totalUnitsReceived: 100,
      unitsLeft: 40,
      suggestedFirstBatch: 50,
    });
  });

  it("rejects NaN inventory (fail closed)", () => {
    expect(
      encodeImportBatchForWrite({
        totalUnitsReceived: Number.NaN,
        unitsLeft: 10,
      }).ok,
    ).toBe(false);
    expect(
      encodeImportBatchForWrite({
        totalUnitsReceived: 10,
        unitsLeft: -1,
      }).ok,
    ).toBe(false);
  });

  it("parse returns null on corrupt JSON (no invented 0)", () => {
    expect(parseImportBatchInventory("{bad")).toBeNull();
    expect(
      parseImportBatchInventory(
        JSON.stringify({ totalUnitsReceived: "nope", unitsLeft: 5 }),
      ),
    ).toBeNull();
  });
});

describe("encodePerSkuSoldLeftForWrite", () => {
  it("accepts Mode C with null left", () => {
    const enc = encodePerSkuSoldLeftForWrite({
      orders: 4,
      skus: { a: { sold: 4, left: null, sales: 100 } },
    });
    expect(enc.ok).toBe(true);
  });

  it("rejects NaN left (do not invent 0)", () => {
    expect(
      encodePerSkuSoldLeftForWrite({
        orders: 1,
        skus: { a: { sold: 1, left: Number.NaN as unknown as null, sales: 10 } },
      }).ok,
    ).toBe(false);
  });

  it("rejects negative sold", () => {
    expect(
      encodePerSkuSoldLeftForWrite({
        orders: 1,
        skuSold: -3,
        skuLeft: null,
      }).ok,
    ).toBe(false);
  });
});
