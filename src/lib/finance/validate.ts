import { z } from "zod";

/**
 * Finance / inventory JSON validation at write boundaries.
 * Fail closed on inventory fields — never invent 0 for unknown units left.
 */

/** Non-negative finite number (money, counts, sold). Rejects NaN/Infinity. */
export const nonNegFiniteSchema = z.number().finite().nonnegative();

/**
 * Units-left field: null (unknown) or non-negative finite.
 * Never coerce missing/invalid → 0.
 */
export const unitsLeftSchema = z.union([z.null(), nonNegFiniteSchema]);

/**
 * Topic A weekStart: exactly YYYY-MM-DD and a real calendar date.
 * No Monday-only policy — product accepts any calendar day the founder picks.
 */
export function isValidTopicAWeekStart(raw: string): boolean {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (![y, m, d].every((n) => Number.isFinite(n))) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

const weekStartSchema = z
  .string()
  .trim()
  .refine(isValidTopicAWeekStart, { message: "invalid_week" });

export const skuWeekLineSchema = z.object({
  skuId: z.string().trim().min(1).max(120),
  sold: nonNegFiniteSchema,
  sales: nonNegFiniteSchema,
  /** Client may send left; server recomputes — shape must still be valid. */
  left: unitsLeftSchema.optional(),
});

export type ParsedSkuWeekLine = z.infer<typeof skuWeekLineSchema>;

export const weeklyEntryFormSchema = z.object({
  weekStart: weekStartSchema,
  sales: nonNegFiniteSchema,
  orders: nonNegFiniteSchema,
  metaSpend: nonNegFiniteSchema,
  tiktokSpend: nonNegFiniteSchema,
  codCollected: nonNegFiniteSchema,
  codOutstanding: nonNegFiniteSchema,
  courierFees: nonNegFiniteSchema,
  skuSold: nonNegFiniteSchema,
  /**
   * Optional client field — ignored for persistence (server-computed).
   * Null = unknown; if present must be non-negative finite (not NaN → 0).
   */
  skuLeft: unitsLeftSchema.optional(),
  skuLines: z.array(skuWeekLineSchema).min(1).optional(),
});

export type ParsedWeeklyEntryForm = z.infer<typeof weeklyEntryFormSchema>;

/**
 * Validate Topic A money + unit fields for addWeeklyEntry (service boundary).
 * Rejects negatives / non-finite — no silent clamp into health math.
 */
export function validateWeeklyEntryInput(input: unknown):
  | { ok: true; data: ParsedWeeklyEntryForm }
  | {
      ok: false;
      error:
        | "missing_week"
        | "invalid_week"
        | "invalid_fields"
        | "invalid_sku_lines";
    } {
  const parsed = weeklyEntryFormSchema.safeParse(input);
  if (!parsed.success) {
    const weekIssue = parsed.error.issues.find((i) => i.path[0] === "weekStart");
    if (weekIssue) {
      const raw =
        input &&
        typeof input === "object" &&
        "weekStart" in input &&
        typeof (input as { weekStart: unknown }).weekStart === "string"
          ? (input as { weekStart: string }).weekStart.trim()
          : "";
      return { ok: false, error: raw ? "invalid_week" : "missing_week" };
    }
    const linesIssue = parsed.error.issues.some((i) => i.path[0] === "skuLines");
    if (linesIssue) return { ok: false, error: "invalid_sku_lines" };
    return { ok: false, error: "invalid_fields" };
  }
  return { ok: true, data: parsed.data };
}

function formNumber(formData: FormData, key: string): unknown {
  const raw = formData.get(key);
  if (raw == null || String(raw).trim() === "") return undefined;
  return Number(raw);
}

/**
 * Parse + validate Topic A week form. Rejects bad money fields and skuLines JSON.
 */
export function parseWeeklyEntryFormData(
  formData: FormData,
):
  | { ok: true; data: ParsedWeeklyEntryForm }
  | {
      ok: false;
      error:
        | "missing_week"
        | "invalid_week"
        | "invalid_fields"
        | "invalid_sku_lines";
    } {
  const weekStartRaw = String(formData.get("weekStart") ?? "").trim();
  if (!weekStartRaw) return { ok: false, error: "missing_week" };

  let skuLines: ParsedSkuWeekLine[] | undefined;
  const skuLinesRaw = String(formData.get("skuLines") ?? "").trim();
  if (skuLinesRaw) {
    let json: unknown;
    try {
      json = JSON.parse(skuLinesRaw);
    } catch {
      return { ok: false, error: "invalid_sku_lines" };
    }
    const lines = z.array(skuWeekLineSchema).min(1).safeParse(json);
    if (!lines.success) return { ok: false, error: "invalid_sku_lines" };
    skuLines = lines.data;
  }

  return validateWeeklyEntryInput({
    weekStart: weekStartRaw,
    sales: formNumber(formData, "sales"),
    orders: formNumber(formData, "orders"),
    metaSpend: formNumber(formData, "metaSpend"),
    tiktokSpend: formNumber(formData, "tiktokSpend"),
    codCollected: formNumber(formData, "codCollected"),
    codOutstanding: formNumber(formData, "codOutstanding"),
    courierFees: formNumber(formData, "courierFees"),
    skuSold: formNumber(formData, "skuSold"),
    skuLeft: formNumber(formData, "skuLeft"),
    skuLines,
  });
}

/** Inventory subset of sku_cards.import_batch JSON (write-validated). */
export const importBatchWriteSchema = z
  .object({
    moq: z.union([z.null(), nonNegFiniteSchema]).optional(),
    status: z.string().min(1).max(40).optional(),
    suggestedFirstBatch: z.union([z.null(), nonNegFiniteSchema]).optional(),
    totalUnitsReceived: unitsLeftSchema.optional(),
    unitsLeft: unitsLeftSchema.optional(),
    notes: z.array(z.string()).optional(),
  })
  .passthrough();

export type ImportBatchWrite = z.infer<typeof importBatchWriteSchema>;

/**
 * Validate importBatch before JSON.stringify on write.
 * Inventory fields must be null or non-negative finite — never NaN/undefined→0.
 */
export function encodeImportBatchForWrite(
  batch: unknown,
): { ok: true; json: string } | { ok: false; error: "invalid_import_batch" } {
  const parsed = importBatchWriteSchema.safeParse(batch);
  if (!parsed.success) return { ok: false, error: "invalid_import_batch" };
  return { ok: true, json: JSON.stringify(parsed.data) };
}

/** Lenient read of importBatch inventory fields; null object on corruption. */
export function parseImportBatchInventory(raw: string): {
  totalUnitsReceived: number | null;
  unitsLeft: number | null;
  suggestedFirstBatch: number | null;
} | null {
  try {
    const json: unknown = JSON.parse(raw);
    const parsed = importBatchWriteSchema.safeParse(json);
    if (!parsed.success) return null;
    return {
      totalUnitsReceived:
        parsed.data.totalUnitsReceived === undefined
          ? null
          : parsed.data.totalUnitsReceived,
      unitsLeft:
        parsed.data.unitsLeft === undefined ? null : parsed.data.unitsLeft,
      suggestedFirstBatch:
        parsed.data.suggestedFirstBatch === undefined
          ? null
          : parsed.data.suggestedFirstBatch,
    };
  } catch {
    return null;
  }
}

const perSkuLineWriteSchema = z.object({
  sold: nonNegFiniteSchema,
  left: unitsLeftSchema,
  sales: nonNegFiniteSchema,
});

export const perSkuSoldLeftWriteSchema = z.union([
  z.object({
    orders: nonNegFiniteSchema,
    skus: z.record(z.string(), perSkuLineWriteSchema),
  }),
  z.object({
    orders: nonNegFiniteSchema,
    sku: z.object({
      sold: nonNegFiniteSchema,
      left: unitsLeftSchema,
    }),
  }),
]);

/**
 * Validate then serialize per_sku_sold_left for Topic A insert.
 * Rejects inventing 0 for left (must be explicit null or finite ≥ 0).
 */
export function encodePerSkuSoldLeftForWrite(input: {
  orders: number;
  skuSold?: number;
  skuLeft?: number | null;
  skus?: Record<string, { sold: number; left: number | null; sales: number }>;
}):
  | { ok: true; json: string }
  | { ok: false; error: "invalid_per_sku_sold_left" } {
  const payload =
    input.skus && Object.keys(input.skus).length > 0
      ? { orders: input.orders, skus: input.skus }
      : {
          orders: input.orders,
          sku: {
            sold: input.skuSold ?? 0,
            left: input.skuLeft ?? null,
          },
        };

  const parsed = perSkuSoldLeftWriteSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "invalid_per_sku_sold_left" };
  }
  return { ok: true, json: JSON.stringify(parsed.data) };
}
