/**
 * Topic A `per_sku_sold_left` JSON parse/serialize.
 * Shared so inventory ledger + finance service share one SoT (no circular imports).
 */

/** null / missing / non-finite → unknown (do not invent 0). */
function parseOptionalUnitsLeft(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shop / multi-SKU left roll-up: sum known values only.
 * All unknown → null (never invent 0 as sold-out).
 */
export function rollUpKnownUnitsLeft(
  lefts: readonly (number | null | undefined)[],
): number | null {
  let sum = 0;
  let anyKnown = false;
  for (const left of lefts) {
    if (left != null && Number.isFinite(left)) {
      sum += left;
      anyKnown = true;
    }
  }
  return anyKnown ? sum : null;
}

/**
 * Parse `per_sku_sold_left` JSON.
 * Legacy: `{ orders, sku: { sold, left } }` or `{ orders, sold, left }`
 * Mode C: `{ orders, skus: { [skuId]: { sold, left, sales } } }`
 * `left: null` / omitted = unknown (never coerce to 0 on per-SKU lines).
 */
export function parsePerSkuSoldLeft(raw: string): {
  orders: number;
  skuSold: number;
  /** Shop roll-up; null when legacy week left is unknown (not invented 0). */
  skuLeft: number | null;
  skus: Record<string, { sold: number; left: number | null; sales: number }>;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const orders = Number(parsed.orders ?? 0);
    if (parsed.skus && typeof parsed.skus === "object") {
      const skus: Record<
        string,
        { sold: number; left: number | null; sales: number }
      > = {};
      let skuSold = 0;
      const lefts: (number | null)[] = [];
      for (const [id, v] of Object.entries(
        parsed.skus as Record<
          string,
          { sold?: number; left?: number | null; sales?: number }
        >,
      )) {
        const sold = Number(v?.sold ?? 0);
        const left = parseOptionalUnitsLeft(v?.left);
        const sales = Number(v?.sales ?? 0);
        skus[id] = { sold, left, sales };
        skuSold += sold;
        lefts.push(left);
      }
      return {
        orders,
        skuSold,
        skuLeft: rollUpKnownUnitsLeft(lefts),
        skus,
      };
    }
    const legacySku =
      parsed.sku && typeof parsed.sku === "object"
        ? (parsed.sku as { sold?: number; left?: number | null })
        : null;
    const legacyLeft = parseOptionalUnitsLeft(
      legacySku?.left ?? (parsed as { left?: number | null }).left,
    );
    return {
      orders,
      skuSold: Number(legacySku?.sold ?? parsed.sold ?? 0),
      skuLeft: legacyLeft,
      skus: {},
    };
  } catch {
    return { orders: 0, skuSold: 0, skuLeft: null, skus: {} };
  }
}

export function serializePerSkuSoldLeft(input: {
  orders: number;
  skuSold?: number;
  skuLeft?: number | null;
  skus?: Record<string, { sold: number; left: number | null; sales: number }>;
}): string {
  if (input.skus && Object.keys(input.skus).length > 0) {
    return JSON.stringify({ orders: input.orders, skus: input.skus });
  }
  return JSON.stringify({
    orders: input.orders,
    sku: {
      sold: input.skuSold ?? 0,
      left: input.skuLeft ?? null,
    },
  });
}
