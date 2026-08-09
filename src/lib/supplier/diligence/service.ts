/**
 * Assess listing orchestration — scrape → extract → skills recommend → Gemini narrate.
 * Approach A: on-click only. Fail-closed ownership + keys.
 */

import { and, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { resolveGeminiApiKey } from "@/lib/discovery/explain/llm";
import {
  allowanceForBatch,
  loadMonthlySearchUsage,
  recordMonthlySearchQueries,
  resolveMonthlySearchQueryCap,
} from "@/lib/discovery/search-usage";
import {
  diligenceCacheKey,
  getDiligenceCache,
  hashDiligenceContent,
  setDiligenceCache,
} from "@/lib/supplier/diligence/cache";
import { extractDiligenceFacts } from "@/lib/supplier/diligence/extract";
import { narrateDiligenceWithGemini } from "@/lib/supplier/diligence/gemini";
import { pickSupplierDiligenceRecommendation } from "@/lib/supplier/diligence/recommend";
import { isHttpListingUrl } from "@/lib/supplier/diligence/listing-url";
import {
  resolveSerperApiKey,
  scrapeListingPage,
} from "@/lib/supplier/diligence/scrape";
import type {
  AssessListingResult,
  AssessListingSuccess,
  DiligenceFacts,
  ScrapeListingResult,
} from "@/lib/supplier/diligence/types";
import { isPlatformListingFallbackName } from "@/lib/supplier/live/company-name";

export type AssessListingDeps = {
  env?: Record<string, string | undefined>;
  scrapeFn?: (input: {
    url: string;
    apiKey: string;
  }) => Promise<ScrapeListingResult>;
  narrateFn?: typeof narrateDiligenceWithGemini;
  skipSpendLedger?: boolean;
};

/**
 * No-op: Assess no longer renames supplier cards from extracted company names.
 * Kept so callers/tests that imported it do not break.
 */
export async function persistAssessedSupplierName(_input: {
  workspaceId: string;
  supplierId: string;
  currentName: string;
  companyName: string | null;
  companyNameSource: "page" | "card" | null;
}): Promise<string | null> {
  return null;
}

/**
 * Core pipeline after a successful scrape (also used in unit tests).
 * Empty scrape must never call this — callers gate on scrape.ok.
 */
export async function assessFromPageText(input: {
  pageText: string;
  sourceUrl: string;
  skuName: string;
  fallbackCompanyName?: string | null;
  supplierId: string;
  locale: "en" | "ar";
  apiKey: string;
  env?: Record<string, string | undefined>;
  narrateFn?: typeof narrateDiligenceWithGemini;
}): Promise<AssessListingSuccess> {
  const contentHash = hashDiligenceContent(input.pageText);
  const cacheKey = diligenceCacheKey({
    supplierId: input.supplierId,
    sourceUrl: input.sourceUrl,
    contentHash,
    locale: input.locale,
  });
  const cached = getDiligenceCache(cacheKey);
  if (cached) return cached;

  const facts: DiligenceFacts = extractDiligenceFacts({
    pageText: input.pageText,
    sourceUrl: input.sourceUrl,
    skuName: input.skuName,
    fallbackCompanyName: input.fallbackCompanyName ?? null,
  });

  const recommendation = pickSupplierDiligenceRecommendation(
    facts,
    input.skuName,
  );

  const narrate = input.narrateFn ?? narrateDiligenceWithGemini;
  const narrated = await narrate({
    facts,
    skuName: input.skuName,
    recommendation,
    locale: input.locale,
    apiKey: input.apiKey,
    env: input.env,
  });

  const success: AssessListingSuccess = {
    ok: true,
    recommendation,
    summary: narrated.ok ? narrated.summary : null,
    facts,
    honestyKey: "assessListingHonesty",
    narrationSource: narrated.ok ? "llm" : "skills_only",
  };
  setDiligenceCache(cacheKey, success);
  return success;
}

/**
 * On-demand listing diligence for one owned supplier option.
 * Never auto-requests a sample.
 */
export async function assessSupplierListing(
  workspaceId: string,
  supplierId: string,
  locale: "en" | "ar",
  deps: AssessListingDeps = {},
): Promise<AssessListingResult> {
  await ensureMigrated();
  const env = deps.env ?? process.env;

  const supplier = await db
    .select()
    .from(schema.supplierOptions)
    .where(
      and(
        eq(schema.supplierOptions.id, supplierId),
        eq(schema.supplierOptions.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!supplier) return { ok: false, error: "not_found" };

  const sku = await db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.id, supplier.skuId),
        eq(schema.skuCards.workspaceId, workspaceId),
      ),
    )
    .then((rows) => rows[0]);
  if (!sku) return { ok: false, error: "not_found" };

  const sourceUrl = supplier.sourceUrl?.trim() ?? "";
  if (!isHttpListingUrl(sourceUrl)) {
    return { ok: false, error: "no_url" };
  }

  const geminiKey = resolveGeminiApiKey(env);
  if (!geminiKey) {
    return { ok: false, error: "missing_key" };
  }

  const serperKey = resolveSerperApiKey(env);
  if (!serperKey) {
    return { ok: false, error: "missing_scrape_key" };
  }

  if (!deps.skipSpendLedger) {
    const cap = resolveMonthlySearchQueryCap(env);
    const usage = await loadMonthlySearchUsage();
    if (allowanceForBatch({ cap, used: usage.queriesUsed, requested: 1 }) < 1) {
      return { ok: false, error: "quota" };
    }
  }

  const scrape =
    deps.scrapeFn != null
      ? await deps.scrapeFn({ url: sourceUrl, apiKey: serperKey })
      : await scrapeListingPage({ url: sourceUrl, apiKey: serperKey });

  if (!scrape.ok) {
    return { ok: false, error: "scrape_failed" };
  }

  if (!deps.skipSpendLedger) {
    await recordMonthlySearchQueries({ queries: 1 });
  }

  return assessFromPageText({
    pageText: scrape.text,
    sourceUrl,
    skuName: sku.name,
    // Never feed “Alibaba listing · SKU” into extract as company identity.
    fallbackCompanyName: isPlatformListingFallbackName(supplier.name)
      ? null
      : supplier.name,
    supplierId,
    locale,
    apiKey: geminiKey,
    env,
    narrateFn: deps.narrateFn,
  });
}
