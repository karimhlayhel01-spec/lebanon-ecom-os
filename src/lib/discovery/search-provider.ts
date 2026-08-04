/**
 * Wave 2 web/shopping search provider seam.
 * Wired provider: **SerpAPI** (Google Shopping for Path 1 intake; Google organic
 * for scoring kinds). Discovery UI never calls this on page load (Approach A).
 *
 * Env: SERPAPI_API_KEY (or SEARCH_API_KEY). Requires DISCOVERY_LIVE_SEARCH=1.
 */

import {
  createSerpApiProvider,
  resolveSerpApiKey,
} from "@/lib/discovery/providers/serpapi";
import { isDiscoveryLiveSearchEnabled } from "@/lib/discovery/flags";

export type SearchQueryKind =
  | "abroad_demand"
  | "lebanon_demand"
  | "tier1_competition"
  | "local_competition"
  | "path1_intake";

export type SearchQuery = {
  kind: SearchQueryKind;
  query: string;
  /** Optional site: restrict (e.g. Ishtari). */
  site?: string;
};

export type SearchResultItem = {
  title: string;
  url: string;
  snippet?: string;
  /** Structured price when provider supplies it (e.g. Google Shopping). */
  price?: number | null;
  merchant?: string;
};

export type SearchProviderResponse = {
  items: SearchResultItem[];
  /** Provider-reported query cost units (for caps). */
  queriesUsed: number;
};

export interface DiscoverySearchProvider {
  search(input: SearchQuery): Promise<SearchProviderResponse>;
}

/** No-op stub — used when DISCOVERY_LIVE_SEARCH is off or no API key. */
export const noopSearchProvider: DiscoverySearchProvider = {
  async search() {
    return { items: [], queriesUsed: 0 };
  },
};

/** Test-only override (unit tests inject a mock; never used in production paths). */
let providerOverride: DiscoverySearchProvider | null = null;

export function setDiscoverySearchProviderForTests(
  provider: DiscoverySearchProvider | null,
): void {
  providerOverride = provider;
}

/**
 * Resolve the active provider.
 * Flag off or missing key → noop (no network). Flag on + SerpAPI key → live client.
 */
export function getDiscoverySearchProvider(): DiscoverySearchProvider {
  if (providerOverride) return providerOverride;
  if (!isDiscoveryLiveSearchEnabled()) return noopSearchProvider;
  const apiKey = resolveSerpApiKey();
  if (!apiKey) return noopSearchProvider;
  return createSerpApiProvider({ apiKey });
}

/** Named provider id for docs / job messages. */
export const DISCOVERY_SEARCH_PROVIDER_NAME = "SerpAPI" as const;
