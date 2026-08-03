/**
 * Wave 2 web/shopping search provider seam.
 * Real SerpAPI / Bing / PSE / Brave clients plug in later — Discovery UI never
 * calls this on page load (Approach A: jobs write scores; shortlist reads DB).
 */

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

/**
 * Resolve the active provider. Live clients are out of this foundation slice;
 * always returns noop until a later Build wires a real key + client.
 */
export function getDiscoverySearchProvider(): DiscoverySearchProvider {
  return noopSearchProvider;
}
