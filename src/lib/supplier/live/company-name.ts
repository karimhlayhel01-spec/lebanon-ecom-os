/**
 * Wave 3 — contact-facing Import lead names from SERP title/URL/snippet.
 * Never invent “Shenzhen XXX Co.” without evidence. Keep raw title in externalTitle.
 */

import type { SupplierLeadPlatform } from "@/lib/supplier/live/types";

const NAME_MAX = 100;
/** DB / card display clamp (Assess persistence). */
export const SUPPLIER_DISPLAY_NAME_MAX = 160;

/** Company / seller legal-ish markers (EN-heavy SERP titles). */
const COMPANY_MARKER =
  /\b(Co\.?,?\s*Ltd\.?|Company\s+Limited|Limited|Ltd\.?|Trading|Manufacturing|Manufacturer|Factory|LLC|GmbH|Inc\.?|Corp\.?|Corporation|Company|Industrial|Industries|Technology|Technologies|Tech|Group|Enterprise|Enterprises|Wholesale|Importer|Exporter)\b/i;

const QUESTION_OR_ARTICLE =
  /^(are|is|what|why|how|when|which|who|can|should|does|do)\b|[?？]|worth it|life\s*tips|guide:|review:/i;

/** Host labels that are not storefront store slugs. */
const BLOCKED_ALIBABA_SUBDOMAINS = new Set([
  "www",
  "m",
  "login",
  "passport",
  "message",
  "sale",
  "i",
  "u",
  "biz",
  "activities",
  "offer",
  "zh",
  "us",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "jp",
  "kr",
  "mobile",
]);

function clampName(s: string, max = NAME_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function clampSupplierDisplayName(
  name: string,
  max = SUPPLIER_DISPLAY_NAME_MAX,
): string {
  return clampName(name, max);
}

function shortProduct(productName: string): string {
  const parts = productName.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return parts.slice(0, 4).join(" ") || "product";
}

function platformFallback(
  platform: SupplierLeadPlatform,
  productName: string,
): string {
  const short = shortProduct(productName);
  if (platform === "alibaba") return clampName(`Alibaba listing · ${short}`);
  if (platform === "aliexpress") {
    return clampName(`AliExpress seller listing · ${short}`);
  }
  if (platform === "local_web") {
    return clampName(`Local listing · ${short}`);
  }
  return clampName(`Marketplace listing · ${short}`);
}

/** True when the card still shows the honest platform listing placeholder. */
export function isPlatformListingFallbackName(name: string): boolean {
  return /^(Alibaba listing|AliExpress seller listing|Marketplace listing|Local listing)\s*·/i.test(
    name.trim(),
  );
}

/**
 * Pull a company-like segment from a SERP title (often after “ - ” / “ | ”).
 */
export function extractCompanyFromTitle(title: string): string | null {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!cleaned || QUESTION_OR_ARTICLE.test(cleaned)) return null;

  const segments = cleaned
    .split(/\s*[-–—|·•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Prefer trailing segments ( “… - Shenzhen Foo Co., Ltd.” ).
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (seg.length < 4 || seg.length > 120) continue;
    if (QUESTION_OR_ARTICLE.test(seg)) continue;
    if (COMPANY_MARKER.test(seg)) return clampName(seg);
  }

  if (COMPANY_MARKER.test(cleaned) && cleaned.length <= 120) {
    // Title is mostly the company name.
    if (!/^\d+\s*(pcs|pc|set|pack)\b/i.test(cleaned)) {
      return clampName(cleaned);
    }
  }

  return null;
}

/**
 * Humanize an Alibaba storefront subdomain: `foo-bar.en.alibaba.com` → "Foo Bar".
 * Skips www/m/login and other non-store hosts.
 */
export function extractStorefrontFromHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const m = host.match(/^([a-z0-9][a-z0-9-]{1,60})\.en\.alibaba\.com$/i);
  if (!m?.[1]) return null;
  const slug = m[1]!;
  if (BLOCKED_ALIBABA_SUBDOMAINS.has(slug)) return null;
  if (/^\d+$/.test(slug)) return null;

  const parts = slug.split("-").filter(Boolean);
  // Prefer hyphenated storefronts; allow long single-token slugs as last resort.
  if (parts.length < 2 && slug.length < 8) return null;

  const words = parts.map(
    (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
  );
  const name = words.join(" ");
  if (name.length < 4 || name.length > 80) return null;
  return clampName(name);
}

/**
 * Company from /company|/factory|/supplier path, or Alibaba storefront host.
 * AliExpress `/store/{id}` alone is not a name — skipped.
 */
export function extractCompanyFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  const m = path.match(/\/(?:company|factory|supplier)\/([^/?#]+)/i);
  if (m?.[1]) {
    const slug = decodeURIComponent(m[1])
      .replace(/\.(html?|htm)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (slug.length >= 4 && slug.length <= 80 && /[a-z]/i.test(slug)) {
      if (
        COMPANY_MARKER.test(slug) ||
        /\b(co|ltd|trading|factory|tech)\b/i.test(slug)
      ) {
        return clampName(slug.replace(/\b\w/g, (c) => c.toUpperCase()));
      }
    }
  }

  const storefront = extractStorefrontFromHost(url);
  if (storefront) return storefront;

  return null;
}

/**
 * Strict snippet pass: only when a clear “Company: X” / “Supplier: X Co., Ltd” appears.
 */
export function extractCompanyFromSnippet(snippet: string | undefined | null): string | null {
  if (!snippet?.trim()) return null;
  const s = snippet.replace(/\s+/g, " ").trim();
  const labeled = s.match(
    /(?:supplier|company|seller|store|manufacturer)\s*[:：]\s*([A-Z][\w&.\s,'-]{3,80}(?:Co\.?,?\s*Ltd\.?|Limited|Ltd\.?|LLC|Factory|Trading)?)/i,
  );
  if (labeled?.[1] && COMPANY_MARKER.test(labeled[1])) {
    return clampName(labeled[1]);
  }
  return null;
}

export type ContactFacingLeadName = {
  name: string;
  /** company = evidence-backed; fallback = honest platform listing label */
  confidence: "company" | "fallback";
};

/**
 * Card display name for a live Import lead. Caller always stores raw title as externalTitle.
 */
export function resolveContactFacingLeadName(input: {
  title: string;
  url: string;
  snippet?: string | null;
  productName: string;
  platform: SupplierLeadPlatform;
}): ContactFacingLeadName {
  const fromTitle = extractCompanyFromTitle(input.title);
  if (fromTitle) return { name: fromTitle, confidence: "company" };

  const fromUrl = extractCompanyFromUrl(input.url);
  if (fromUrl) return { name: fromUrl, confidence: "company" };

  const fromSnippet = extractCompanyFromSnippet(input.snippet);
  if (fromSnippet) return { name: fromSnippet, confidence: "company" };

  return {
    name: platformFallback(input.platform, input.productName),
    confidence: "fallback",
  };
}

/**
 * After Assess listing: whether to rewrite supplier_options.name.
 * Prefer page-extracted company over “Alibaba listing · …” placeholders.
 * Never returns empty; null = leave current name.
 */
export function resolveNameUpdateAfterAssess(input: {
  currentName: string;
  companyName: string | null | undefined;
  companyNameSource: "page" | "card" | null;
}): string | null {
  const next = clampSupplierDisplayName(input.companyName ?? "");
  if (next.length < 2) return null;

  const current = input.currentName.replace(/\s+/g, " ").trim();
  if (current.toLowerCase() === next.toLowerCase()) return null;

  if (isPlatformListingFallbackName(current)) return next;
  if (input.companyNameSource === "page") return next;
  // Card-sourced name: only replace weak/placeholder current names
  if (!current || isPlatformListingFallbackName(current)) return next;
  return null;
}
