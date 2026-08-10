/**
 * Wave 3 — Serper organic leads for Import (Alibaba / AliExpress) and Local (Lebanon).
 * Approach A: called only from ensureSuppliers / explicit refresh, not every render.
 */

import {
  DISCOVERY_SEARCH_MAX_ATTEMPTS,
  DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";
import {
  backoffDelayMs,
  isRetriableSearchStatus,
  parseRetryAfterMs,
} from "@/lib/discovery/providers/resilience";
import { resolveContactFacingLeadName } from "@/lib/supplier/live/company-name";
import { isLocalHitRelevantToProduct } from "@/lib/supplier/live/local-relevance";
import {
  isAllowedImportListingUrl,
  isAllowedLocalListingUrl,
} from "@/lib/supplier/live/url-filter";
import type {
  GatherSupplierLeadsInput,
  GatherSupplierLeadsResult,
  SupplierLead,
  SupplierLeadPlatform,
} from "@/lib/supplier/live/types";

export type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
};

function platformFromUrl(url: string): SupplierLeadPlatform {
  const u = url.toLowerCase();
  if (u.includes("alibaba.com")) return "alibaba";
  if (u.includes("aliexpress.com")) return "aliexpress";
  return "other";
}

/**
 * Map one organic hit → live Import lead, or null when URL is not a listing/company page.
 * Pure — unit-tested with fixtures (no network).
 */
export function mapOrganicHitToImportLead(
  row: SerperOrganic,
  productName: string,
): SupplierLead | null {
  const url = (row.link ?? "").trim();
  const title = (row.title ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (!isAllowedImportListingUrl(url)) return null;

  const platform = platformFromUrl(url);
  if (platform === "other") return null;

  const product = productName.replace(/\s+/g, " ").trim() || "product";
  const externalTitle = title || product;
  const { name } = resolveContactFacingLeadName({
    title: externalTitle,
    url,
    snippet: row.snippet,
    productName: product,
    platform,
  });

  return {
    name,
    platform,
    sourceUrl: url,
    externalTitle: externalTitle.slice(0, 240),
    unitPriceHint: null,
    leadSource: "live_search",
  };
}

/**
 * Map one organic hit → live Local (Lebanon) lead, or null when URL/snippet
 * fails the Lebanon gate or the hit is not product-relevant to the SKU.
 * Pure — unit-tested with fixtures (no network).
 */
export function mapOrganicHitToLocalLead(
  row: SerperOrganic,
  productName: string,
): SupplierLead | null {
  const url = (row.link ?? "").trim();
  const title = (row.title ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (!isAllowedLocalListingUrl(url, row.snippet)) return null;
  if (!isLocalHitRelevantToProduct(productName, title, row.snippet)) return null;

  const product = productName.replace(/\s+/g, " ").trim() || "product";
  const externalTitle = title || product;
  const { name } = resolveContactFacingLeadName({
    title: externalTitle,
    url,
    snippet: row.snippet,
    productName: product,
    platform: "local_web",
  });

  return {
    name,
    platform: "local_web",
    sourceUrl: url,
    externalTitle: externalTitle.slice(0, 240),
    unitPriceHint: null,
    leadSource: "live_search",
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function serperOrganicSearch(
  apiKey: string,
  q: string,
  num: number,
  opts?: { gl?: string; hl?: string },
): Promise<{ results: SerperOrganic[]; ok: boolean }> {
  const gl = opts?.gl ?? "us";
  const hl = opts?.hl ?? "en";
  let lastRetryAfter: number | null = null;
  for (let attempt = 1; attempt <= DISCOVERY_SEARCH_MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q, gl, hl, num }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        lastRetryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
        if (
          isRetriableSearchStatus(res.status) &&
          attempt < DISCOVERY_SEARCH_MAX_ATTEMPTS
        ) {
          await sleep(backoffDelayMs(attempt, lastRetryAfter));
          continue;
        }
        return { results: [], ok: false };
      }
      const json = (await res.json()) as { organic?: SerperOrganic[] };
      return { results: json.organic ?? [], ok: true };
    } catch {
      if (attempt < DISCOVERY_SEARCH_MAX_ATTEMPTS) {
        await sleep(backoffDelayMs(attempt, lastRetryAfter));
        continue;
      }
      return { results: [], ok: false };
    } finally {
      clearTimeout(timer);
    }
  }
  return { results: [], ok: false };
}

/**
 * Import leads: listing-biased site queries (2 max).
 */
export async function gatherImportLeadsWithSerper(
  input: GatherSupplierLeadsInput,
  apiKey: string,
): Promise<GatherSupplierLeadsResult> {
  if (input.source !== "import") {
    return { leads: [], queriesUsed: 0, noop: false };
  }

  const product = input.productName.replace(/\s+/g, " ").trim() || "product";
  const perSite = Math.max(3, Math.ceil(input.limit / 2));
  // Bias organic toward product/listing paths (still ≤2 Serper calls).
  const queries = [
    `site:alibaba.com/product-detail ${product}`,
    `site:aliexpress.com/item ${product}`,
  ];

  const leads: SupplierLead[] = [];
  const seen = new Set<string>();
  let queriesUsed = 0;
  let anyOk = false;

  for (const q of queries) {
    if (leads.length >= input.limit) break;
    const { results, ok } = await serperOrganicSearch(apiKey, q, perSite, {
      gl: "us",
      hl: "en",
    });
    queriesUsed += 1;
    if (ok) anyOk = true;
    for (const row of results) {
      if (leads.length >= input.limit) break;
      const lead = mapOrganicHitToImportLead(row, product);
      if (!lead) continue;
      const key = lead.sourceUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push(lead);
    }
  }

  return {
    leads,
    queriesUsed,
    noop: false,
    error: anyOk || leads.length > 0 ? undefined : "serper_gather_failed",
  };
}

/**
 * Local (Lebanon) leads: quoted product phrase + Lebanon bias (≤3), gl=lb.
 * Prefer fewer product-relevant seats over invent theater or loose category hits.
 */
export async function gatherLocalLeadsWithSerper(
  input: GatherSupplierLeadsInput,
  apiKey: string,
): Promise<GatherSupplierLeadsResult> {
  if (input.source !== "local") {
    return { leads: [], queriesUsed: 0, noop: false };
  }

  const product = input.productName.replace(/\s+/g, " ").trim() || "product";
  const quoted = `"${product.replace(/"/g, "")}"`;
  const perQuery = Math.max(4, Math.ceil(input.limit / 2));
  const queries: Array<{ q: string; gl: string; hl: string }> = [
    { q: `${quoted} wholesale Lebanon`, gl: "lb", hl: "en" },
    { q: `${quoted} supplier Lebanon`, gl: "lb", hl: "en" },
    { q: `${quoted} مورد لبنان`, gl: "lb", hl: "ar" },
  ];

  const leads: SupplierLead[] = [];
  const seen = new Set<string>();
  let queriesUsed = 0;
  let anyOk = false;

  for (const { q, gl, hl } of queries) {
    if (leads.length >= input.limit) break;
    const { results, ok } = await serperOrganicSearch(apiKey, q, perQuery, {
      gl,
      hl,
    });
    queriesUsed += 1;
    if (ok) anyOk = true;
    for (const row of results) {
      if (leads.length >= input.limit) break;
      const lead = mapOrganicHitToLocalLead(row, product);
      if (!lead) continue;
      const key = lead.sourceUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push(lead);
    }
  }

  return {
    leads,
    queriesUsed,
    noop: false,
    error: anyOk || leads.length > 0 ? undefined : "serper_gather_failed",
  };
}
