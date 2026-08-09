import { afterEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_SEARCH_MAX_ATTEMPTS,
  DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";
import {
  backoffDelayMs,
  isRetriableSearchStatus,
  parseRetryAfterMs,
  SEARCH_BACKOFF_BASE_MS,
  SEARCH_BACKOFF_MAX_MS,
} from "@/lib/discovery/providers/resilience";
import { createSerpApiProvider } from "@/lib/discovery/providers/serpapi";
import {
  buildBraveRequestUrl,
  createBraveSearchProvider,
  mapBraveWebResults,
  resolveBraveSearchKey,
} from "@/lib/discovery/providers/brave";
import {
  describeSearchProviderRouting,
  getDiscoverySearchProvider,
  resolveSearchVendor,
  setDiscoverySearchProviderForTests,
} from "@/lib/discovery/search-provider";

afterEach(() => {
  setDiscoverySearchProviderForTests(null);
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.DISCOVERY_SEARCH_VENDOR;
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SERPER_API_KEY;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("search retry policy (pure)", () => {
  it("treats 429 and 5xx as transient, everything else as final", () => {
    expect(isRetriableSearchStatus(429)).toBe(true);
    expect(isRetriableSearchStatus(500)).toBe(true);
    expect(isRetriableSearchStatus(503)).toBe(true);
    expect(isRetriableSearchStatus(401)).toBe(false);
    expect(isRetriableSearchStatus(400)).toBe(false);
    expect(isRetriableSearchStatus(404)).toBe(false);
  });

  it("parses Retry-After as delta-seconds and as an HTTP date", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();

    const now = Date.parse("2026-08-07T10:00:00Z");
    expect(
      parseRetryAfterMs("Fri, 07 Aug 2026 10:00:05 GMT", now),
    ).toBe(5000);
    // A date already in the past means "retry now", not a negative wait.
    expect(parseRetryAfterMs("Fri, 07 Aug 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("backs off exponentially and honours Retry-After under a hard ceiling", () => {
    expect(backoffDelayMs(1)).toBe(SEARCH_BACKOFF_BASE_MS);
    expect(backoffDelayMs(2)).toBe(SEARCH_BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(3)).toBe(SEARCH_BACKOFF_BASE_MS * 4);
    expect(backoffDelayMs(1, 1500)).toBe(1500);
    // A vendor asking for 10 minutes must not park the cron for 10 minutes.
    expect(backoffDelayMs(1, 600_000)).toBe(SEARCH_BACKOFF_MAX_MS);
    expect(backoffDelayMs(50)).toBe(SEARCH_BACKOFF_MAX_MS);
  });

  it("documents the shipped timeout and attempt bounds", () => {
    expect(DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(DISCOVERY_SEARCH_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe("SerpAPI timeout + bounded retry (mocked fetch — no network)", () => {
  it("aborts a hung request and surfaces a timeout failure", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchFn: typeof fetch = (_url, init) => {
      const signal = init?.signal ?? undefined;
      seen.push(signal);
      // Never resolves on its own — only the timeout can end this.
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    };

    const provider = createSerpApiProvider({
      apiKey: "k",
      fetchFn,
      timeoutMs: 5,
      maxAttempts: 2,
      sleepFn: async () => {},
    });

    await expect(
      provider.search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow(/timed out after 5ms \(after 2 attempts\)/);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("retries a 429, honours Retry-After, and succeeds on the next attempt", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return jsonResponse({
        organic_results: [{ title: "Hit", link: "https://example.com/a" }],
      });
    };

    const provider = createSerpApiProvider({
      apiKey: "k",
      fetchFn,
      maxAttempts: 3,
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });

    const res = await provider.search({ kind: "abroad_demand", query: "x" });
    expect(calls).toBe(2);
    expect(waits).toEqual([2000]);
    expect(res.queriesUsed).toBe(1);
    expect(res.items[0]?.title).toBe("Hit");
  });

  it("gives up after the attempt bound on a persistent 503", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response("nope", { status: 503 });
    };

    const provider = createSerpApiProvider({
      apiKey: "k",
      fetchFn,
      maxAttempts: 3,
      sleepFn: async () => {},
    });

    await expect(
      provider.search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow(/SerpAPI HTTP 503 \(after 3 attempts\)/);
    expect(calls).toBe(3);
  });

  it("does not retry a non-transient failure", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response("bad key", { status: 401 });
    };

    const provider = createSerpApiProvider({
      apiKey: "k",
      fetchFn,
      maxAttempts: 3,
      sleepFn: async () => {},
    });

    await expect(
      provider.search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow("SerpAPI HTTP 401");
    expect(calls).toBe(1);
  });

  it("does not retry a 200 response carrying a SerpAPI error payload", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: "Invalid API key" });
    };

    const provider = createSerpApiProvider({
      apiKey: "k",
      fetchFn,
      maxAttempts: 3,
      sleepFn: async () => {},
    });

    await expect(
      provider.search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow("SerpAPI: Invalid API key");
    expect(calls).toBe(1);
  });
});

describe("Brave Search provider (alternate vendor)", () => {
  it("maps web results to the shared item shape and strips highlight markup", () => {
    expect(
      mapBraveWebResults([
        {
          title: "Wand review",
          url: "https://blog.example/r",
          description: "the <strong>LED wand</strong> is popular",
        },
        { title: "", url: "https://drop.example/x" },
        { title: "No URL", url: "" },
      ]),
    ).toEqual([
      {
        title: "Wand review",
        url: "https://blog.example/r",
        snippet: "the LED wand is popular",
      },
    ]);
  });

  it("targets the LB index only for the Lebanon demand leg", () => {
    expect(
      buildBraveRequestUrl({ kind: "lebanon_demand", query: "wand" }),
    ).toContain("country=LB");
    expect(
      buildBraveRequestUrl({ kind: "abroad_demand", query: "wand" }),
    ).toContain("country=US");
    expect(
      buildBraveRequestUrl({
        kind: "local_competition",
        query: "wand",
        site: "ishtari.com",
      }),
    ).toContain("site%3Aishtari.com");
  });

  it("sends the subscription token and retries transient failures", async () => {
    let calls = 0;
    const tokens: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      tokens.push(headers.get("X-Subscription-Token") ?? "");
      if (calls === 1) return new Response("slow down", { status: 429 });
      return jsonResponse({
        web: { results: [{ title: "Hit", url: "https://example.com/a" }] },
      });
    };

    const provider = createBraveSearchProvider({
      apiKey: "brave-key",
      fetchFn,
      maxAttempts: 2,
      sleepFn: async () => {},
    });

    const res = await provider.search({ kind: "abroad_demand", query: "x" });
    expect(calls).toBe(2);
    expect(tokens[0]).toBe("brave-key");
    expect(res.queriesUsed).toBe(1);
    expect(res.items[0]?.url).toBe("https://example.com/a");
  });

  it("resolveBraveSearchKey reads BRAVE_SEARCH_API_KEY", () => {
    expect(resolveBraveSearchKey({})).toBeUndefined();
    expect(resolveBraveSearchKey({ BRAVE_SEARCH_API_KEY: " b " })).toBe("b");
  });
});

describe("provider seam routing (swappable by env alone)", () => {
  it("defaults to SerpAPI for both legs", () => {
    expect(resolveSearchVendor({})).toBe("serpapi");
    expect(
      describeSearchProviderRouting({ SERPAPI_API_KEY: "s" }),
    ).toEqual({ scoring: "serpapi", intake: "serpapi" });
  });

  it("routes scoring to Brave while Path 1 intake stays on SerpAPI", () => {
    expect(resolveSearchVendor({ DISCOVERY_SEARCH_VENDOR: "Brave" })).toBe(
      "brave",
    );
    // Brave web search has no shopping price/merchant, which intake requires.
    expect(
      describeSearchProviderRouting({
        DISCOVERY_SEARCH_VENDOR: "brave",
        BRAVE_SEARCH_API_KEY: "b",
        SERPAPI_API_KEY: "s",
      }),
    ).toEqual({ scoring: "brave", intake: "serpapi" });
  });

  it("reports noop for a leg whose key is missing", () => {
    expect(
      describeSearchProviderRouting({
        DISCOVERY_SEARCH_VENDOR: "brave",
        BRAVE_SEARCH_API_KEY: "b",
      }),
    ).toEqual({ scoring: "brave", intake: "noop" });
    expect(
      describeSearchProviderRouting({ DISCOVERY_SEARCH_VENDOR: "brave" }),
    ).toEqual({ scoring: "noop", intake: "noop" });
  });

  it("stays noop when the live flag is off, whatever the vendor", async () => {
    process.env.DISCOVERY_SEARCH_VENDOR = "brave";
    process.env.BRAVE_SEARCH_API_KEY = "b";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    const res = await getDiscoverySearchProvider().search({
      kind: "abroad_demand",
      query: "x",
    });
    expect(res).toEqual({ items: [], queriesUsed: 0 });
  });

  it("a Brave-only setup leaves intake as a noop rather than a broken call", async () => {
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    process.env.DISCOVERY_SEARCH_VENDOR = "brave";
    process.env.BRAVE_SEARCH_API_KEY = "b";

    const intake = await getDiscoverySearchProvider().search({
      kind: "path1_intake",
      query: "x",
    });
    expect(intake).toEqual({ items: [], queriesUsed: 0 });
  });
});
