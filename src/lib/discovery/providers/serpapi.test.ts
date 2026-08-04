import { afterEach, describe, expect, it } from "vitest";
import {
  buildSerpApiRequestUrl,
  createSerpApiProvider,
  mapSerpOrganicResults,
  mapSerpShoppingResults,
  resolveSerpApiKey,
} from "@/lib/discovery/providers/serpapi";
import {
  getDiscoverySearchProvider,
  setDiscoverySearchProviderForTests,
} from "@/lib/discovery/search-provider";

afterEach(() => {
  setDiscoverySearchProviderForTests(null);
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SEARCH_API_KEY;
});

describe("SerpAPI provider (mocked fetch — no network)", () => {
  it("builds shopping URL for path1_intake and organic for scoring kinds", () => {
    const intake = buildSerpApiRequestUrl(
      { kind: "path1_intake", query: "best selling home kitchen" },
      "test-key",
    );
    expect(intake).toContain("engine=google_shopping");
    expect(intake).toContain("gl=us");
    expect(intake).toContain("api_key=test-key");

    const leb = buildSerpApiRequestUrl(
      { kind: "lebanon_demand", query: "product Lebanon" },
      "test-key",
    );
    expect(leb).toContain("engine=google");
    expect(leb).toContain("gl=lb");
  });

  it("maps shopping + organic JSON without network", () => {
    expect(
      mapSerpShoppingResults([
        {
          title: "Widget",
          link: "https://shop.example/w",
          extracted_price: 19.5,
          source: "ExampleMart",
        },
      ]),
    ).toEqual([
      {
        title: "Widget",
        url: "https://shop.example/w",
        snippet: "ExampleMart",
        price: 19.5,
        merchant: "ExampleMart",
      },
    ]);
    expect(
      mapSerpOrganicResults([
        { title: "Review", link: "https://blog.example/r", snippet: "hi" },
      ]),
    ).toEqual([
      { title: "Review", url: "https://blog.example/r", snippet: "hi" },
    ]);
  });

  it("createSerpApiProvider uses injected fetch (no real HTTP)", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          shopping_results: [
            {
              title: "Mock Product",
              link: "https://example.com/p",
              extracted_price: 22,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const provider = createSerpApiProvider({ apiKey: "k", fetchFn });
    const res = await provider.search({
      kind: "path1_intake",
      query: "test",
    });
    expect(res.queriesUsed).toBe(1);
    expect(res.items[0]?.title).toBe("Mock Product");
    expect(res.items[0]?.price).toBe(22);
  });

  it("resolveSerpApiKey prefers SERPAPI_API_KEY", () => {
    expect(resolveSerpApiKey({})).toBeUndefined();
    expect(resolveSerpApiKey({ SEARCH_API_KEY: "s" })).toBe("s");
    expect(
      resolveSerpApiKey({ SERPAPI_API_KEY: "serp", SEARCH_API_KEY: "s" }),
    ).toBe("serp");
  });

  it("getDiscoverySearchProvider stays noop when live flag off", async () => {
    process.env.SERPAPI_API_KEY = "secret";
    delete process.env.DISCOVERY_LIVE_SEARCH;
    const p = getDiscoverySearchProvider();
    const res = await p.search({ kind: "path1_intake", query: "x" });
    expect(res.queriesUsed).toBe(0);
    expect(res.items).toEqual([]);
  });
});
