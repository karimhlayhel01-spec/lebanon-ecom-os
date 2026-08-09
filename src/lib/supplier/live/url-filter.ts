/**
 * Wave 3 — accept only Alibaba/AliExpress listing or company storefront URLs.
 * Prefer fewer live seats over tip/blog/article links.
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
