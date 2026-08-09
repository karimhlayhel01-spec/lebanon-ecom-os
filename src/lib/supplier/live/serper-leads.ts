/**
 * Wave 3 — Serper organic leads for Import (Alibaba / AliExpress listing queries).
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
import { isAllowedImportListingUrl } from "@/lib/supplier/live/url-filter";
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
 * Map one organic hit → live lead, or null when URL is not a listing/company page.
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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function serperOrganicSearch(
  apiKey: string,
  q: string,
  num: number,
): Promise<{ results: SerperOrganic[]; ok: boolean }> {
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
        body: JSON.stringify({ q, gl: "us", hl: "en", num }),
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
 * Local source returns empty (heuristic pads) until a Local live path is locked.
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
    const { results, ok } = await serperOrganicSearch(apiKey, q, perSite);
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
