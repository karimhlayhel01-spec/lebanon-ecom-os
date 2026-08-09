/**
 * Bounded listing-page scrape via Serper (https://scrape.serper.dev),
 * with a bounded direct HTML fetch fallback when Serper text lacks company chrome.
 * Injectable fetch for tests — no live burns in vitest.
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
import { pageTextHasCompanySignal } from "@/lib/supplier/diligence/extract";
import type { ScrapeListingResult } from "@/lib/supplier/diligence/types";
import { isHttpListingUrl } from "@/lib/supplier/diligence/listing-url";

/** Cap stored page text so extract + Gemini stay bounded. */
export const DILIGENCE_SCRAPE_MAX_CHARS = 28_000;

const SERPER_SCRAPE_URL = "https://scrape.serper.dev";
const DIRECT_FETCH_MAX_CHARS = 400_000;

export function resolveSerperApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env.SERPER_API_KEY?.trim();
  return key || undefined;
}

export function clipDiligenceText(
  raw: string,
  max = DILIGENCE_SCRAPE_MAX_CHARS,
): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Strip scripts/styles/tags for a coarse text dump (secondary fetch). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchListingHtmlText(input: {
  url: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<ScrapeListingResult> {
  if (!isHttpListingUrl(input.url)) {
    return { ok: false, error: "empty" };
  }
  const fetchFn = input.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    input.timeoutMs ?? DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
  );
  try {
    const res = await fetchFn(input.url.trim(), {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; LebanonEcomOS/1.0; +https://localhost; diligence)",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "blocked" };
      }
      return { ok: false, error: "api_error" };
    }
    const html = (await res.text()).slice(0, DIRECT_FETCH_MAX_CHARS);
    const text = clipDiligenceText(htmlToPlainText(html));
    if (text.length < 80) return { ok: false, error: "empty" };
    return { ok: true, text, markdown: null };
  } catch {
    return { ok: false, error: "api_error" };
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeViaSerper(input: {
  url: string;
  apiKey: string;
  fetchFn: typeof fetch;
}): Promise<ScrapeListingResult> {
  let lastRetryAfter: number | undefined;

  for (let attempt = 1; attempt <= DISCOVERY_SEARCH_MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await input.fetchFn(SERPER_SCRAPE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": input.apiKey,
        },
        body: JSON.stringify({
          url: input.url.trim(),
          includeMarkdown: true,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
        lastRetryAfter = retryAfter ?? undefined;
        if (
          isRetriableSearchStatus(res.status) &&
          attempt < DISCOVERY_SEARCH_MAX_ATTEMPTS
        ) {
          await sleep(backoffDelayMs(attempt, lastRetryAfter));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: "blocked" };
        }
        return { ok: false, error: "api_error" };
      }
      const json = (await res.json()) as {
        text?: string;
        markdown?: string;
      };
      // Prefer concatenating text + markdown so supplier chrome is less likely dropped.
      const merged = clipDiligenceText(
        [json.text ?? "", json.markdown ?? ""].filter(Boolean).join("\n\n"),
      );
      if (merged.length < 80) {
        return { ok: false, error: "empty" };
      }
      return {
        ok: true,
        text: merged,
        markdown: json.markdown ? clipDiligenceText(json.markdown) : null,
      };
    } catch {
      if (attempt < DISCOVERY_SEARCH_MAX_ATTEMPTS) {
        await sleep(backoffDelayMs(attempt, lastRetryAfter));
        continue;
      }
      return { ok: false, error: "api_error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: "api_error" };
}

/**
 * Scrape a public listing URL.
 * Serper first; if text lacks Co.,Ltd. / supplier chrome, try bounded direct fetch and merge.
 * scrape_failed only when both yield unusable text.
 */
export async function scrapeListingPage(input: {
  url: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Test seam: skip direct HTML fallback. */
  skipDirectFetch?: boolean;
}): Promise<ScrapeListingResult> {
  if (!isHttpListingUrl(input.url)) {
    return { ok: false, error: "empty" };
  }

  const fetchFn = input.fetchFn ?? fetch;
  const serper = await scrapeViaSerper({
    url: input.url,
    apiKey: input.apiKey,
    fetchFn,
  });

  if (serper.ok && pageTextHasCompanySignal(serper.text)) {
    return serper;
  }

  if (!input.skipDirectFetch) {
    const direct = await fetchListingHtmlText({
      url: input.url,
      fetchFn,
    });
    if (direct.ok) {
      const merged = clipDiligenceText(
        [serper.ok ? serper.text : "", direct.text].filter(Boolean).join("\n\n"),
      );
      if (merged.length >= 80) {
        return {
          ok: true,
          text: merged,
          markdown: serper.ok ? serper.markdown : null,
        };
      }
    }
  }

  // Serper had usable length but no company chrome — still return for extract
  // (companyName may be null; recommendation will not green-light without page identity).
  if (serper.ok) return serper;

  return { ok: false, error: serper.error };
}
