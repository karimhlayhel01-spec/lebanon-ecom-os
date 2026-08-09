/**
 * Serper.dev Google Search API client — Wave 2 scoring vendor (§9 / §10).
 * Selected by DISCOVERY_SEARCH_VENDOR=serper; same DiscoverySearchProvider
 * interface, so nothing outside the seam changes.
 *
 * Scoring legs only need title / url / snippet. Serper's `/search` returns
 * Google organic results with no shopping price/merchant, so Path 1 intake
 * stays on SerpAPI — same rule as Brave (see search-provider.ts routing).
 *
 * Contract verified against Serper OpenAPI (fetched 2026-08-07):
 *   https://apis.io/apis/serper/serper-search-api/
 *   (mirrors https://serper.dev — POST google.serper.dev/search)
 * - Auth: `X-API-KEY: <SERPER_API_KEY>` header
 * - Endpoint: POST https://google.serper.dev/search
 * - Body: q / gl (ISO 3166-1 alpha-2) / hl / num
 * - Results: organic[].title / link / snippet
 * - No dedicated domain filter → embed `site:${site}` into q (SerpAPI style)
 * - Geography: lebanon_demand + local_competition → gl=lb; abroad_demand +
 *   tier1_competition → gl=us; hl=en
 *
 * Free trial is one-time (~2,500 queries), not a monthly refill — keep the
 * monthly ledger cap tight so a runaway job cannot burn the trial.
 *
 * Env: SERPER_API_KEY.
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

const SERPER_ENDPOINT = "https://google.serper.dev/search";

export type SerperProviderOptions = SearchResilienceOptions & {
  apiKey: string;
  /** Inject for unit tests — no network. */
  fetchFn?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
};

type SerperOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
};

type SerperJson = {
  organic?: SerperOrganicResult[];
  message?: string;
  error?: string;
};

export type SerperSearchBody = {
  q: string;
  gl: "lb" | "us";
  hl: "en";
  num: number;
};

/**
 * Map Serper organic results onto the shared item shape. No merchant field
 * exists — evidence.ts falls back to domainFromUrl, same as Brave.
 */
export function mapSerperOrganicResults(
  results: readonly SerperOrganicResult[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  for (const r of results) {
    const title = (r.title ?? "").trim();
    const url = (r.link ?? "").trim();
    if (!title || !url) continue;
    const snippet = r.snippet?.trim() || undefined;
    items.push({ title, url, snippet });
  }
  return items;
}

/**
 * Build the POST body. Serper documents no dedicated domain field, so a
 * SearchQuery.site is embedded as `site:${site}` in q (SerpAPI style).
 *
 * gl follows Google country codes (ISO 3166-1 alpha-2): Lebanon demand and
 * local competition read the LB index; abroad demand and Tier-1 checks read US.
 */
export function buildSerperSearchBody(input: SearchQuery): SerperSearchBody {
  const q = input.site?.trim()
    ? `site:${input.site.trim()} ${input.query}`
    : input.query;
  const gl =
    input.kind === "lebanon_demand" || input.kind === "local_competition"
      ? "lb"
      : "us";
  return { q, gl, hl: "en", num: 10 };
}

function serperErrorMessage(json: SerperJson): string | null {
  if (typeof json.message === "string" && json.message.trim()) {
    return json.message.trim();
  }
  if (typeof json.error === "string" && json.error.trim()) {
    return json.error.trim();
  }
  return null;
}

export function createSerperSearchProvider(
  opts: SerperProviderOptions,
): DiscoverySearchProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const endpoint = opts.endpoint ?? SERPER_ENDPOINT;

  return {
    async search(input: SearchQuery): Promise<SearchProviderResponse> {
      // Path 1 needs shopping price/merchant — Serper /search cannot invent it.
      // Routing already sends intake to SerpAPI; fail closed if somehow called.
      if (input.kind === "path1_intake") {
        throw new Error(
          "Serper Search does not serve Path 1 intake (needs shopping price/merchant — use SerpAPI)",
        );
      }

      const body = buildSerperSearchBody(input);
      // Isolation suite asserts the abort signal is wired onto the request.
      const url = endpoint;
      return runBoundedSearchAttempts({
        label: "Serper Search",
        opts: {
          timeoutMs: opts.timeoutMs ?? DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
          maxAttempts: opts.maxAttempts ?? DISCOVERY_SEARCH_MAX_ATTEMPTS,
          sleepFn: opts.sleepFn,
        },
        async attempt(signal): Promise<SearchAttemptOutcome> {
          const res = await fetchFn(url, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-API-KEY": opts.apiKey,
            },
            body: JSON.stringify(body),
            signal,
          });

          if (!res.ok) {
            const error = `Serper Search HTTP ${res.status}`;
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

          const json = (await res.json()) as SerperJson;
          const detail = serperErrorMessage(json);
          if (detail) {
            return { kind: "fatal", error: `Serper Search: ${detail}` };
          }

          return {
            kind: "ok",
            response: {
              items: mapSerperOrganicResults(json.organic ?? []),
              queriesUsed: 1,
            },
          };
        },
      });
    },
  };
}

export function resolveSerperKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.SERPER_API_KEY?.trim() || undefined;
}
