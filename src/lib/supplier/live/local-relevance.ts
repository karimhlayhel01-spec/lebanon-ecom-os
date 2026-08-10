/**
 * Wave 3 — Local SERP product-relevance gate.
 * Prefer fewer accurate seats over loose category matches (e.g. “food containers”
 * without “collapsible” when the SKU is Collapsible Food Containers).
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "via",
  "as",
  "is",
  "are",
  "be",
  "set",
  "pack",
  "pcs",
  "pc",
  "new",
]);

/** Product modifiers that must not be soft-dropped by SERP category matches. */
const MODIFIERS = new Set([
  "collapsible",
  "foldable",
  "folding",
  "silicone",
  "reusable",
  "portable",
  "magnetic",
  "stainless",
  "insulated",
  "waterproof",
  "leakproof",
  "leak-proof",
  "stackable",
  "adjustable",
  "wireless",
  "cordless",
  "rechargeable",
  "organic",
  "bamboo",
  "ceramic",
  "glass",
  "plastic",
  "metal",
  "mini",
  "compact",
  "heavy-duty",
  "heavyduty",
]);

/**
 * Broad head nouns that alone never prove SKU fit when the product also has
 * modifiers / more specific tokens.
 */
const BROAD_HEADS = new Set([
  "food",
  "container",
  "containers",
  "product",
  "products",
  "item",
  "items",
  "good",
  "goods",
  "supply",
  "supplies",
  "wholesale",
  "supplier",
  "suppliers",
  "store",
  "shop",
  "box",
  "boxes",
  "bag",
  "bags",
  "kit",
  "kits",
  "set",
  "sets",
  "home",
  "kitchen",
  "house",
  "general",
  "trading",
  "company",
  "lebanon",
  "beirut",
]);

function stemToken(token: string): string {
  const t = token.toLowerCase();
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) {
    return t.slice(0, -1);
  }
  return t;
}

function tokenizeProduct(productName: string): string[] {
  return productName
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/gi, " ")
    .split(/[\s/-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function haystackHasToken(haystack: string, token: string): boolean {
  const t = token.toLowerCase();
  const stem = stemToken(t);
  // Word-ish boundaries: avoid “container” matching inside unrelated compounds poorly,
  // but allow simple substring for multi-word SERP titles.
  if (haystack.includes(t)) return true;
  if (stem !== t && haystack.includes(stem)) return true;
  // Plural in haystack when token is singular
  if (!t.endsWith("s") && haystack.includes(`${t}s`)) return true;
  return false;
}

/**
 * True when title+snippet are product-relevant to the SKU name (not a bare category).
 * Pure — unit-tested with fixtures (no network).
 */
export function isLocalHitRelevantToProduct(
  productName: string,
  title: string,
  snippet?: string | null,
): boolean {
  const product = productName.replace(/\s+/g, " ").trim();
  if (!product) return false;

  const haystack = `${title} ${snippet ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;

  const phrase = product.toLowerCase();
  if (haystack.includes(phrase)) return true;

  const tokens = tokenizeProduct(product);
  if (tokens.length === 0) return false;

  const modifiers = tokens.filter((t) => MODIFIERS.has(t) || MODIFIERS.has(stemToken(t)));
  const distinctive = tokens.filter((t) => {
    if (MODIFIERS.has(t) || MODIFIERS.has(stemToken(t))) return true;
    if (t.length < 4) return false;
    const stem = stemToken(t);
    if (BROAD_HEADS.has(t) || BROAD_HEADS.has(stem)) return false;
    return true;
  });

  // SKU has modifiers → every modifier must appear (no soft-drop of “collapsible”).
  if (modifiers.length > 0) {
    if (!modifiers.every((m) => haystackHasToken(haystack, m))) return false;
  }

  // All distinctive non-broad tokens (len≥4) must appear.
  if (distinctive.length > 0) {
    return distinctive.every((t) => haystackHasToken(haystack, t));
  }

  // Only weak / broad tokens (e.g. “food containers”) — require full phrase or ≥80%.
  if (tokens.length <= 2) {
    const hitCount = tokens.filter((t) => haystackHasToken(haystack, t)).length;
    return hitCount === tokens.length;
  }
  const need = Math.ceil(tokens.length * 0.8);
  const hitCount = tokens.filter((t) => haystackHasToken(haystack, t)).length;
  return hitCount >= need;
}
