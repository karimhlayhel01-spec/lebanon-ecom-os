/**
 * Brave Search API client — the alternate Wave 2 search vendor (§9 / §10).
 * Selected by DISCOVERY_SEARCH_VENDOR=brave; same DiscoverySearchProvider
 * interface, so nothing outside the seam changes.
 *
 * Scoring legs only need title / url / snippet, which evidence.ts already
 * consumes. Brave web search has no shopping price/merchant, so Path 1 intake
 * stays on SerpAPI — see search-provider.ts routing and .env.example.
 *
 * Env: BRAVE_SEARCH_API_KEY. Docs: https://api-dashboard.search.brave.com/
 */

import {
  DISCOVERY_SEARCH_MAX_ATTEMPTS,
  DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";
import {
  isRetriableSearchStatus,
  parseRetryAfterMs,
  runBoundedSearchAttempts,
  type SearchAttemptOutcome,
  type SearchResilienceOptions,
} from "@/lib/discovery/providers/resilience";
import type {
  DiscoverySearchProvider,
  SearchQuery,
  SearchProviderResponse,
  SearchResultItem,
} from "@/lib/discovery/search-provider";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export type BraveProviderOptions = SearchResilienceOptions & {
  apiKey: string;
  /** Inject for unit tests — no network. */
  fetchFn?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
};

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveJson = {
  web?: { results?: BraveWebResult[] };
  error?: { detail?: string } | string;
};

export function mapBraveWebResults(
  results: readonly BraveWebResult[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  for (const r of results) {
    const title = (r.title ?? "").trim();
    const url = (r.url ?? "").trim();
    if (!title || !url) continue;
    items.push({
      title,
      url,
      // Brave highlights query terms in descriptions with <strong> tags.
      snippet: r.description?.replace(/<[^>]+>/g, "").trim() || undefined,
    });
  }
  return items;
}

/** Lebanon demand reads the LB index; every other leg reads US. */
export function buildBraveRequestUrl(
  input: SearchQuery,
  endpoint: string = BRAVE_ENDPOINT,
): string {
  const params = new URLSearchParams();
  const q = input.site ? `site:${input.site} ${input.query}` : input.query;
  params.set("q", q);
  params.set("count", "10");
  params.set("country", input.kind === "lebanon_demand" ? "LB" : "US");
  params.set("search_lang", "en");
  return `${endpoint}?${params.toString()}`;
}

export function createBraveSearchProvider(
  opts: BraveProviderOptions,
): DiscoverySearchProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const endpoint = opts.endpoint ?? BRAVE_ENDPOINT;

  return {
    async search(input: SearchQuery): Promise<SearchProviderResponse> {
      const url = buildBraveRequestUrl(input, endpoint);
      return runBoundedSearchAttempts({
        label: "Brave Search",
        opts: {
          timeoutMs: opts.timeoutMs ?? DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
          maxAttempts: opts.maxAttempts ?? DISCOVERY_SEARCH_MAX_ATTEMPTS,
          sleepFn: opts.sleepFn,
        },
        async attempt(signal): Promise<SearchAttemptOutcome> {
          const res = await fetchFn(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "X-Subscription-Token": opts.apiKey,
            },
            signal,
          });

          if (!res.ok) {
            const error = `Brave Search HTTP ${res.status}`;
            return isRetriableSearchStatus(res.status)
              ? {
                  kind: "retry",
                  error,
                  retryAfterMs: parseRetryAfterMs(
                    res.headers.get("retry-after"),
                  ),
                }
              : { kind: "fatal", error };
          }

          const json = (await res.json()) as BraveJson;
          if (json.error) {
            const detail =
              typeof json.error === "string"
                ? json.error
                : (json.error.detail ?? "request rejected");
            return { kind: "fatal", error: `Brave Search: ${detail}` };
          }

          return {
            kind: "ok",
            response: {
              items: mapBraveWebResults(json.web?.results ?? []),
              queriesUsed: 1,
            },
          };
        },
      });
    },
  };
}

export function resolveBraveSearchKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
}
