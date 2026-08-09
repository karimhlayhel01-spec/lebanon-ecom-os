/**
 * Serper.dev Search provider — mocked network only (WAVE-2 §9 / §10).
 * Never hits google.serper.dev; fetchFn is always injected.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  buildSerperSearchBody,
  createSerperSearchProvider,
  mapSerperOrganicResults,
  resolveSerperKey,
} from "@/lib/discovery/providers/serper";
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

describe("mapSerperOrganicResults", () => {
  it("maps title / link→url / snippet and tolerates a missing merchant", () => {
    expect(
      mapSerperOrganicResults([
        {
          title: "LED wand Lebanon",
          link: "https://shop.example/wand",
          snippet: "Popular in Beirut shops",
        },
        { title: "", link: "https://drop.example/x" },
        { title: "No URL", link: "" },
        { title: "Title only", link: "https://ok.example/a" },
      ]),
    ).toEqual([
      {
        title: "LED wand Lebanon",
        url: "https://shop.example/wand",
        snippet: "Popular in Beirut shops",
      },
      {
        title: "Title only",
        url: "https://ok.example/a",
        snippet: undefined,
      },
    ]);
  });

  it("handles empty or malformed organic lists without throwing", () => {
    expect(mapSerperOrganicResults([])).toEqual([]);
    expect(mapSerperOrganicResults([{ title: "  ", link: "  " }])).toEqual([]);
  });
});

describe("buildSerperSearchBody", () => {
  it("sets gl=lb for lebanon_demand and local_competition", () => {
    expect(
      buildSerperSearchBody({ kind: "lebanon_demand", query: "wand" }),
    ).toMatchObject({ gl: "lb", hl: "en", num: 10, q: "wand" });
    expect(
      buildSerperSearchBody({ kind: "local_competition", query: "wand" }).gl,
    ).toBe("lb");
  });

  it("sets gl=us for abroad_demand and tier1_competition", () => {
    expect(
      buildSerperSearchBody({ kind: "abroad_demand", query: "wand" }).gl,
    ).toBe("us");
    expect(
      buildSerperSearchBody({ kind: "tier1_competition", query: "wand" }).gl,
    ).toBe("us");
  });

  it("embeds SearchQuery.site as site: in q (no dedicated domain field)", () => {
    const body = buildSerperSearchBody({
      kind: "tier1_competition",
      query: "led wand",
      site: "ishtari.com",
    });
    expect(body.q).toBe("site:ishtari.com led wand");
    expect(body).not.toHaveProperty("include_domains");
  });
});

describe("createSerperSearchProvider", () => {
  it("sends X-API-KEY, correct gl/hl, and reports queriesUsed: 1", async () => {
    let seenKey = "";
    let seenBody: unknown = null;
    const fetchFn: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      seenKey = headers.get("X-API-KEY") ?? "";
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse({
        organic: [
          {
            title: "Hit",
            link: "https://example.com/a",
            snippet: "snippet text",
          },
        ],
      });
    };

    const res = await createSerperSearchProvider({
      apiKey: "serper-test",
      fetchFn,
    }).search({ kind: "abroad_demand", query: "led wand" });

    expect(seenKey).toBe("serper-test");
    expect(seenBody).toEqual({
      q: "led wand",
      gl: "us",
      hl: "en",
      num: 10,
    });
    expect(res.queriesUsed).toBe(1);
    expect(res.items).toEqual([
      {
        title: "Hit",
        url: "https://example.com/a",
        snippet: "snippet text",
      },
    ]);
  });

  it("puts the tier1 site into q as site: on the wire", async () => {
    let seenBody: { q?: string } = {};
    const fetchFn: typeof fetch = async (_url, init) => {
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse({ organic: [] });
    };

    await createSerperSearchProvider({ apiKey: "k", fetchFn }).search({
      kind: "tier1_competition",
      query: "wand lebanon",
      site: "ishtari.com",
    });

    expect(seenBody.q).toBe("site:ishtari.com wand lebanon");
  });

  it("returns an empty list for empty organic without throwing", async () => {
    const provider = createSerperSearchProvider({
      apiKey: "k",
      fetchFn: async () => jsonResponse({ organic: null }),
    });
    await expect(
      provider.search({ kind: "abroad_demand", query: "x" }),
    ).resolves.toEqual({ items: [], queriesUsed: 1 });
  });

  it("fails closed if path1_intake is somehow called", async () => {
    await expect(
      createSerperSearchProvider({
        apiKey: "k",
        fetchFn: async () => {
          throw new Error("must not fetch for path1_intake");
        },
      }).search({ kind: "path1_intake", query: "x" }),
    ).rejects.toThrow(/does not serve Path 1 intake/);
  });

  it("times out through resilience.ts and exhausts the attempt bound", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const fetchFn: typeof fetch = (_url, init) => {
      const signal = init?.signal ?? undefined;
      seen.push(signal);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    };

    await expect(
      createSerperSearchProvider({
        apiKey: "k",
        fetchFn,
        timeoutMs: 5,
        maxAttempts: 2,
        sleepFn: async () => {},
      }).search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow(/timed out after 5ms \(after 2 attempts\)/);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("retries a 429, honours Retry-After, then succeeds", async () => {
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
        organic: [{ title: "Hit", link: "https://example.com/a" }],
      });
    };

    const res = await createSerperSearchProvider({
      apiKey: "k",
      fetchFn,
      maxAttempts: 3,
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    }).search({ kind: "abroad_demand", query: "x" });

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

    await expect(
      createSerperSearchProvider({
        apiKey: "k",
        fetchFn,
        maxAttempts: 3,
        sleepFn: async () => {},
      }).search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow(/Serper Search HTTP 503 \(after 3 attempts\)/);
    expect(calls).toBe(3);
  });

  it("does not retry a non-transient 401", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response("bad key", { status: 401 });
    };

    await expect(
      createSerperSearchProvider({
        apiKey: "k",
        fetchFn,
        maxAttempts: 3,
        sleepFn: async () => {},
      }).search({ kind: "abroad_demand", query: "x" }),
    ).rejects.toThrow("Serper Search HTTP 401");
    expect(calls).toBe(1);
  });
});

describe("resolveSerperKey", () => {
  it("reads SERPER_API_KEY", () => {
    expect(resolveSerperKey({})).toBeUndefined();
    expect(resolveSerperKey({ SERPER_API_KEY: " sk-x " })).toBe("sk-x");
  });
});

describe("Serper routing (swappable by env alone)", () => {
  it("accepts serper as a scoring vendor; unset still defaults to serpapi", () => {
    expect(resolveSearchVendor({})).toBe("serpapi");
    expect(resolveSearchVendor({ DISCOVERY_SEARCH_VENDOR: "Serper" })).toBe(
      "serper",
    );
  });

  it("Serper-only → scoring serper, intake noop", () => {
    expect(
      describeSearchProviderRouting({
        DISCOVERY_SEARCH_VENDOR: "serper",
        SERPER_API_KEY: "s",
      }),
    ).toEqual({ scoring: "serper", intake: "noop" });
  });

  it("Serper + SerpAPI → scoring serper, intake serpapi", () => {
    expect(
      describeSearchProviderRouting({
        DISCOVERY_SEARCH_VENDOR: "serper",
        SERPER_API_KEY: "s",
        SERPAPI_API_KEY: "serp",
      }),
    ).toEqual({ scoring: "serper", intake: "serpapi" });
  });

  it("missing Serper key with vendor=serper reports scoring noop", () => {
    expect(
      describeSearchProviderRouting({ DISCOVERY_SEARCH_VENDOR: "serper" }),
    ).toEqual({ scoring: "noop", intake: "noop" });
  });

  it("live flag off → noop regardless of vendor or keys", async () => {
    process.env.DISCOVERY_SEARCH_VENDOR = "serper";
    process.env.SERPER_API_KEY = "s";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    const res = await getDiscoverySearchProvider().search({
      kind: "abroad_demand",
      query: "x",
    });
    expect(res).toEqual({ items: [], queriesUsed: 0 });
  });

  it("a Serper-only setup leaves intake as a noop rather than a broken call", async () => {
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    process.env.DISCOVERY_SEARCH_VENDOR = "serper";
    process.env.SERPER_API_KEY = "s";

    const intake = await getDiscoverySearchProvider().search({
      kind: "path1_intake",
      query: "x",
    });
    expect(intake).toEqual({ items: [], queriesUsed: 0 });
  });
});
