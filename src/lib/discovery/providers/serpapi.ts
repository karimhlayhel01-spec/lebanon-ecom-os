/**
 * SerpAPI search/shopping client for Wave 2 Discovery jobs.
 * Path 1 intake prefers Google Shopping (winning-product candidates).
 * Scoring kinds use Google organic (Pass 3). Discovery UI never calls this.
 *
 * Env: SERPAPI_API_KEY (preferred) or SEARCH_API_KEY.
 * Docs: https://serpapi.com/search-api / https://serpapi.com/google-shopping-api
 */

import type {
  DiscoverySearchProvider,
  SearchQuery,
  SearchProviderResponse,
  SearchResultItem,
} from "@/lib/discovery/search-provider";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export type SerpApiProviderOptions = {
  apiKey: string;
  /** Inject for unit tests — no network. */
  fetchFn?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
};

type SerpShoppingResult = {
  title?: string;
  link?: string;
  product_link?: string;
  snippet?: string;
  price?: string;
  extracted_price?: number;
  source?: string;
};

type SerpOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
};

type SerpApiJson = {
  error?: string;
  shopping_results?: SerpShoppingResult[];
  organic_results?: SerpOrganicResult[];
};

function parsePrice(raw: string | undefined, extracted?: number): number | null {
  if (typeof extracted === "number" && Number.isFinite(extracted) && extracted > 0) {
    return extracted;
  }
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function mapSerpShoppingResults(
  results: readonly SerpShoppingResult[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  for (const r of results) {
    const title = (r.title ?? "").trim();
    const url = (r.link ?? r.product_link ?? "").trim();
    if (!title || !url) continue;
    items.push({
      title,
      url,
      snippet: r.snippet ?? r.source ?? undefined,
      price: parsePrice(r.price, r.extracted_price),
      merchant: r.source ?? undefined,
    });
  }
  return items;
}

export function mapSerpOrganicResults(
  results: readonly SerpOrganicResult[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  for (const r of results) {
    const title = (r.title ?? "").trim();
    const url = (r.link ?? "").trim();
    if (!title || !url) continue;
    items.push({
      title,
      url,
      snippet: r.snippet,
    });
  }
  return items;
}

/**
 * Build SerpAPI request URL for a Discovery search query.
 * path1_intake → google_shopping (US gl); other kinds → google organic.
 */
export function buildSerpApiRequestUrl(
  input: SearchQuery,
  apiKey: string,
  endpoint: string = SERPAPI_ENDPOINT,
): string {
  const params = new URLSearchParams();
  params.set("api_key", apiKey);
  params.set("num", "10");

  let q = input.query;
  if (input.site) {
    q = `site:${input.site} ${q}`;
  }

  if (input.kind === "path1_intake") {
    params.set("engine", "google_shopping");
    params.set("google_domain", "google.com");
    params.set("gl", "us");
    params.set("hl", "en");
    params.set("q", q);
  } else {
    params.set("engine", "google");
    params.set("google_domain", "google.com");
    params.set("gl", input.kind === "lebanon_demand" ? "lb" : "us");
    params.set("hl", "en");
    params.set("q", q);
  }

  return `${endpoint}?${params.toString()}`;
}

export function createSerpApiProvider(
  opts: SerpApiProviderOptions,
): DiscoverySearchProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const endpoint = opts.endpoint ?? SERPAPI_ENDPOINT;
  const apiKey = opts.apiKey;

  return {
    async search(input: SearchQuery): Promise<SearchProviderResponse> {
      const url = buildSerpApiRequestUrl(input, apiKey, endpoint);
      const res = await fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`SerpAPI HTTP ${res.status}`);
      }
      const json = (await res.json()) as SerpApiJson;
      if (json.error) {
        throw new Error(`SerpAPI: ${json.error}`);
      }

      const items =
        input.kind === "path1_intake"
          ? mapSerpShoppingResults(json.shopping_results ?? [])
          : mapSerpOrganicResults(json.organic_results ?? []);

      return { items, queriesUsed: 1 };
    },
  };
}

export function resolveSerpApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env.SERPAPI_API_KEY?.trim() || env.SEARCH_API_KEY?.trim();
  return key || undefined;
}
