/**
 * Wave 3 — accept only Alibaba/AliExpress listing or company storefront URLs.
 * Prefer fewer live seats over tip/blog/article links.
 * Local: conservative Lebanon business URLs only (see isAllowedLocalListingUrl).
 */

const DENY_PATH_OR_HOST = [
  /lifetips/i,
  /\/blog(?:\/|$)/i,
  /\/tips?(?:\/|$)/i,
  /\/news(?:\/|$)/i,
  /\/help(?:\/|$)/i,
  /\/about(?:\/|$)/i,
  /\/article(?:\/|$)/i,
  /\/reading(?:\/|$)/i,
  /\/categor(?:y|ies)(?:\/|$)/i,
  /\/search(?:\/|$|\?)/i,
  /\/wiki(?:\/|$)/i,
  /\/questions?(?:\/|$)/i,
  /\/ask(?:\/|$)/i,
  /\/showroom(?:\/|$)/i,
  /\/trade(?:r)?show(?:\/|$)/i,
  /\/knowledge(?:\/|$)/i,
  /\/guide(?:\/|$)/i,
];

/**
 * Exact / suffix hosts never allowed as Local leads (social, UGC, news).
 * Marketplace brands are also covered by LOCAL_DENY_BRAND_LABELS (all ccTLDs).
 */
const LOCAL_DENY_HOSTS = [
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "reddit.com",
  "pinterest.com",
  "medium.com",
  "wikipedia.org",
  "quora.com",
  "linkedin.com",
  "made-in-china.com",
  "globalsources.com",
  "tradeindia.com",
  "indiamart.com",
];

/**
 * DNS labels that mark global marketplaces / aggregators on any TLD
 * (ebay.com, ebay.co.uk, www.ubuy.com, amazon.ae, …).
 * Prefer empty Local over “ships to Lebanon” global shops.
 */
const LOCAL_DENY_BRAND_LABELS = new Set([
  "ebay",
  "ubuy",
  "amazon",
  "noon",
  "jumia",
  "wish",
  "etsy",
  "alibaba",
  "aliexpress",
  "dhgate",
  "banggood",
  "shein",
  "temu",
  "walmart",
  "target",
  "rakuten",
  "allegro",
  "joom",
  "lightinthebox",
  "gearbest",
  "1688",
  "taobao",
  "tmall",
  "shopee",
  "lazada",
  "flipkart",
  "mercadolibre",
  "mercadolivre",
  "cdiscount",
  "otto",
  "zalando",
  "asos",
  "fruugo",
  "manomano",
  "onbuy",
  "newegg",
  "bestbuy",
  "homedepot",
  "costco",
  "overstock",
  "wayfair",
]);

const LEBANON_SIGNAL =
  /\.lb\b|lebanon|lebanese|beirut|tripoli|saida|sidon|jounieh|zahle|byblos|لبنان|بيروت|طرابلس|صيدا/i;

function hostIs(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/**
 * True when the URL looks like a product listing or B2B company/storefront page.
 */
export function isAllowedImportListingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const haystack = `${host}${path}${parsed.search.toLowerCase()}`;

  if (DENY_PATH_OR_HOST.some((re) => re.test(haystack))) return false;

  const alibaba = hostIs(host, "alibaba.com");
  const aliexpress = hostIs(host, "aliexpress.com");
  if (!alibaba && !aliexpress) return false;

  if (alibaba) {
    return (
      path.includes("/product-detail/") ||
      /\/product\/[^/]+/i.test(path) ||
      path.includes("/company/") ||
      path.includes("/company_profile") ||
      path.includes("/factory/") ||
      /\/supplier(?:\/|$)/i.test(path)
    );
  }

  // AliExpress commerce listings / store item pages
  return (
    path.includes("/item/") ||
    /\/i\/\d+/i.test(path) ||
    /\/item\/\d+\.html/i.test(path) ||
    (/\/store\/\d+/i.test(path) && /\/item/i.test(path))
  );
}

function hostDeniedForLocal(host: string): boolean {
  if (
    LOCAL_DENY_HOSTS.some((root) => host === root || host.endsWith(`.${root}`))
  ) {
    return true;
  }
  // Brand label on any TLD: ebay.com, ebay.de, www.amazon.co.uk, ubuy.com, …
  const labels = host.split(".").filter(Boolean);
  return labels.some((label) => LOCAL_DENY_BRAND_LABELS.has(label));
}

function isGoogleMapsPlace(host: string, path: string): boolean {
  const mapsHost =
    hostIs(host, "google.com") ||
    hostIs(host, "google.com.lb") ||
    hostIs(host, "maps.google.com") ||
    host === "maps.app.goo.gl" ||
    host.endsWith(".goo.gl");
  if (!mapsHost) return false;
  return (
    /\/maps\//i.test(path) ||
    host.includes("maps") ||
    host === "maps.app.goo.gl"
  );
}

/**
 * Conservative Local (Lebanon) lead URL gate.
 * Allow only:
 *   - `.lb` business sites (after marketplace deny), or
 *   - Google Maps place pages with a Lebanon signal in URL/snippet.
 * Do NOT allow arbitrary hosts solely because the snippet says “Lebanon”
 * (that lets Ubuy/eBay “ships to Lebanon” through). Prefer empty Local.
 */
export function isAllowedLocalListingUrl(
  url: string,
  snippet?: string | null,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const haystack = `${host}${path}${parsed.search.toLowerCase()}`;
  const textBlob = `${haystack} ${snippet ?? ""}`;

  if (hostDeniedForLocal(host)) return false;
  if (DENY_PATH_OR_HOST.some((re) => re.test(haystack))) return false;

  const isLbTld = host === "lb" || host.endsWith(".lb");
  if (isLbTld) return true;

  if (isGoogleMapsPlace(host, path) && LEBANON_SIGNAL.test(textBlob)) {
    return true;
  }

  return false;
}
