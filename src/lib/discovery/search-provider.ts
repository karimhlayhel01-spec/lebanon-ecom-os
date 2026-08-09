/**
 * Wave 2 web/shopping search provider seam — the ONLY production bind point.
 * Vendors are swappable by env alone (§9 / §10): DISCOVERY_SEARCH_VENDOR picks
 * the scoring vendor, and every vendor implements the same DiscoverySearchProvider.
 *
 * Path 1 intake always routes to SerpAPI: shopping intake needs price/merchant,
 * which Brave and Serper web search do not return (see .env.example).
 *
 * Discovery UI never calls this on page load (Approach A).
 * Env: SERPAPI_API_KEY (or SEARCH_API_KEY), BRAVE_SEARCH_API_KEY, SERPER_API_KEY.
 * Requires DISCOVERY_LIVE_SEARCH=1.
 */

import {
  createBraveSearchProvider,
  resolveBraveSearchKey,
} from "@/lib/discovery/providers/brave";
import {
  createSerpApiProvider,
  resolveSerpApiKey,
} from "@/lib/discovery/providers/serpapi";
import {
  createSerperSearchProvider,
  resolveSerperKey,
} from "@/lib/discovery/providers/serper";
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

export type SearchVendor = "serpapi" | "brave" | "serper";

/** Vendor for the scoring legs. Unknown / unset keeps the shipped default. */
export function resolveSearchVendor(
  env: Record<string, string | undefined> = process.env,
): SearchVendor {
  const raw = env.DISCOVERY_SEARCH_VENDOR?.trim().toLowerCase();
  if (raw === "brave") return "brave";
  if (raw === "serper") return "serper";
  return "serpapi";
}

export type SearchProviderRouting = {
  /** Vendor serving abroad / Lebanon / competition legs. */
  scoring: SearchVendor | "noop";
  /** Vendor serving Path 1 shopping intake (needs price + merchant). */
  intake: "serpapi" | "noop";
};

/**
 * Which vendor serves which leg, given env. Exported for the CLI banner and
 * tests — resolving this without constructing clients keeps it side-effect free.
 */
export function describeSearchProviderRouting(
  env: Record<string, string | undefined> = process.env,
): SearchProviderRouting {
  const serpKey = resolveSerpApiKey(env);
  const braveKey = resolveBraveSearchKey(env);
  const serperKey = resolveSerperKey(env);
  const vendor = resolveSearchVendor(env);

  let scoring: SearchVendor | "noop";
  if (vendor === "brave") {
    scoring = braveKey ? "brave" : "noop";
  } else if (vendor === "serper") {
    scoring = serperKey ? "serper" : "noop";
  } else {
    scoring = serpKey ? "serpapi" : "noop";
  }

  return { scoring, intake: serpKey ? "serpapi" : "noop" };
}

/**
 * Resolve the active provider.
 * Flag off or no usable key → noop (no network). Scoring legs follow
 * DISCOVERY_SEARCH_VENDOR; Path 1 intake stays on SerpAPI for price/merchant.
 */
export function getDiscoverySearchProvider(): DiscoverySearchProvider {
  if (providerOverride) return providerOverride;
  if (!isDiscoveryLiveSearchEnabled()) return noopSearchProvider;

  const routing = describeSearchProviderRouting();
  if (routing.scoring === "noop" && routing.intake === "noop") {
    return noopSearchProvider;
  }

  const serpKey = resolveSerpApiKey();
  const braveKey = resolveBraveSearchKey();
  const serperKey = resolveSerperKey();
  const intake =
    routing.intake === "serpapi" && serpKey
      ? createSerpApiProvider({ apiKey: serpKey })
      : noopSearchProvider;

  let scoring: DiscoverySearchProvider = noopSearchProvider;
  if (routing.scoring === "serper" && serperKey) {
    scoring = createSerperSearchProvider({ apiKey: serperKey });
  } else if (routing.scoring === "brave" && braveKey) {
    scoring = createBraveSearchProvider({ apiKey: braveKey });
  } else if (routing.scoring === "serpapi" && serpKey) {
    scoring = createSerpApiProvider({ apiKey: serpKey });
  }

  return {
    async search(input) {
      const target = input.kind === "path1_intake" ? intake : scoring;
      return target.search(input);
    },
  };
}

/** Named provider id for docs / job messages. */
export const DISCOVERY_SEARCH_PROVIDER_NAME = "SerpAPI" as const;

/** Founder-readable vendor label for CLI output. */
export function searchVendorLabel(vendor: SearchVendor | "noop"): string {
  if (vendor === "brave") return "Brave Search";
  if (vendor === "serper") return "Serper Search";
  if (vendor === "serpapi") return DISCOVERY_SEARCH_PROVIDER_NAME;
  return "none";
}
