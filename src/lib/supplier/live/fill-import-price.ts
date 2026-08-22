/**
 * WAVE-3 — fill Import unitPriceHint on ensure/refresh only (Approach A).
 * Serper snippet first; if null, scrape the listing once (max 5 per run).
 * No Gemini FX.
 */

import { isAliExpressLead } from "@/lib/supplier/live/max-landed";
import { extractUnitPriceUsd } from "@/lib/supplier/live/unit-price";
import type { SupplierLead } from "@/lib/supplier/live/types";

export const IMPORT_LEAD_PRICE_SCRAPE_MAX = 5;

/** Scrape / seat AliExpress before Alibaba so the 5-scrape budget hits LBP listings first. */
export function aliexpressFirst<
  T extends { platform?: string | null; sourceUrl?: string | null },
>(leads: readonly T[]): T[] {
  return [...leads].sort(
    (a, b) => Number(isAliExpressLead(b)) - Number(isAliExpressLead(a)),
  );
}

export type ImportPriceScrapeFn = (url: string) => Promise<{
  ok: boolean;
  text?: string;
}>;

/** Dedupe prior + incoming by URL for one AE-first scrape pass. */
export function combineImportLeadsForPriceFill(
  incoming: readonly SupplierLead[],
  prior: readonly SupplierLead[],
): SupplierLead[] {
  const byUrl = new Map<string, SupplierLead>();
  for (const lead of prior) {
    byUrl.set(lead.sourceUrl.toLowerCase(), lead);
  }
  for (const lead of incoming) {
    const key = lead.sourceUrl.toLowerCase();
    const prev = byUrl.get(key);
    const incomingHas =
      lead.unitPriceHint != null && lead.unitPriceHint > 0;
    if (incomingHas || !prev) byUrl.set(key, lead);
  }
  return aliexpressFirst([...byUrl.values()]);
}

export async function fillImportLeadUnitPrices(input: {
  leads: readonly SupplierLead[];
  scrapeFn: ImportPriceScrapeFn;
  maxScrapes?: number;
  usdLbpRate?: number | null;
}): Promise<{ leads: SupplierLead[]; scrapesUsed: number }> {
  const maxScrapes = Math.max(
    0,
    input.maxScrapes ?? IMPORT_LEAD_PRICE_SCRAPE_MAX,
  );
  const out: SupplierLead[] = [];
  let scrapesUsed = 0;
  const ordered = aliexpressFirst(input.leads);

  for (const lead of ordered) {
    if (lead.unitPriceHint != null && lead.unitPriceHint > 0) {
      out.push(lead);
      continue;
    }
    if (scrapesUsed >= maxScrapes) {
      out.push(lead);
      continue;
    }
    scrapesUsed += 1;
    const scraped = await input.scrapeFn(lead.sourceUrl);
    const hint =
      scraped.ok && scraped.text
        ? extractUnitPriceUsd(scraped.text, input.usdLbpRate)
        : null;
    out.push({ ...lead, unitPriceHint: hint });
  }

  return { leads: out, scrapesUsed };
}
