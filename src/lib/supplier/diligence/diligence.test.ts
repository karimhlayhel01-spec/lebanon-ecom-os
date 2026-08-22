import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  clearDiligenceCache,
  hashDiligenceContent,
} from "@/lib/supplier/diligence/cache";
import { extractDiligenceFacts } from "@/lib/supplier/diligence/extract";
import {
  hasCredibilitySignal,
  pickSupplierDiligenceRecommendation,
} from "@/lib/supplier/diligence/recommend";
import { canAssessListingUrl } from "@/lib/supplier/diligence/listing-url";
import { persistAssessedSupplierName } from "@/lib/supplier/diligence/service";
import {
  assertDiligenceNarrationGrounded,
  assertOpenListingCta,
  assertRecommendationAligned,
  assertYearsGrounded,
  ensureRecommendationLead,
} from "@/lib/supplier/diligence/validate";
import type { DiligenceFacts } from "@/lib/supplier/diligence/types";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import type { SupplierLead } from "@/lib/supplier/live/types";

const EXAMPLE_PAGE = `
Product detail — Collapsible Silicone Food Container Set.
Supplier / company: Shenzhen Homelux Silicone Co., Ltd. is a Verified Supplier on Alibaba with Trade Assurance.
Years on Alibaba: 8 yrs on Alibaba. Rating 4.7 / 5 from buyer feedback visible on the page.
Certifications mentioned on the listing: FDA LFGB for food-contact silicone.
Description: Collapsible silicone food container lunch box set for storage, portable camping kitchenware.
MOQ: 200 Unit price US$ 1.85 / piece. Shipping and packaging notes follow on the page body.
Additional listing copy pads the scrape so the page is not treated as thin empty HTML.
`.repeat(1);

function exampleFacts(): DiligenceFacts {
  return extractDiligenceFacts({
    pageText: EXAMPLE_PAGE,
    sourceUrl: "https://www.alibaba.com/product-detail/x.html",
    skuName: "Collapsible food containers",
    fallbackCompanyName: "Homelux",
  });
}

const V1_STYLE_DRAFT = [
  "Worth requesting a sample",
  "",
  "This Alibaba listing looks relevant to collapsible food containers. The fetched page shows about 8 years on Alibaba, a Verified Supplier / Trade Assurance style signal, and a public rating around 4.7. Certifications mentioned include FDA / LFGB (confirm with the supplier).",
  "",
  "Click Open on Alibaba on this card to see the full supplier profile (company name, years, verification, certifications, reviews). If that store still looks right, requesting a sample is reasonable. Not a bulk-order approval. Ask MOQ and unit price in the sample email before you commit.",
].join("\n");

describe("canAssessListingUrl", () => {
  it("requires http(s) URL", () => {
    expect(canAssessListingUrl(null)).toBe(false);
    expect(canAssessListingUrl("")).toBe(false);
    expect(canAssessListingUrl("not-a-url")).toBe(false);
    expect(
      canAssessListingUrl("https://www.alibaba.com/product-detail/x.html"),
    ).toBe(true);
  });
});

describe("extract + recommend", () => {
  it("extracts useful signals without inventing extras", () => {
    const f = exampleFacts();
    expect(f.yearsOnPlatform).toBe(8);
    expect(f.verifiedSignals).toContain("Verified Supplier");
    expect(f.rating).toBe(4.7);
    expect(f.skuRelevance).not.toBe("none");
    expect(f.unitPriceHint).toBe(1.85);
  });

  it("worth_sampling without page companyName when relevance + credibility OK", () => {
    const f: DiligenceFacts = {
      companyName: null,
      companyNameSource: null,
      yearsOnPlatform: 8,
      verifiedSignals: ["Verified Supplier"],
      certifications: [],
      rating: 4.7,
      reviewSnippets: [],
      skuRelevance: "strong",
      moqHint: null,
      unitPriceHint: null,
      platform: "alibaba",
      rawExcerpts: [],
      pageTextLength: 2000,
    };
    expect(hasCredibilitySignal(f)).toBe(true);
    expect(pickSupplierDiligenceRecommendation(f)).toBe("worth_sampling");
  });

  it("ignores Alibaba listing · SKU placeholder as companyName", () => {
    const f = extractDiligenceFacts({
      pageText:
        "Collapsible food container product page without a supplier company block. ".repeat(
          6,
        ),
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      skuName: "Collapsible food containers",
      fallbackCompanyName: "Alibaba listing · Collapsible Food Containers",
    });
    expect(f.companyName).toBeNull();
    expect(f.companyNameSource).toBeNull();
  });

  it("screenshot-like chrome still extracts years/rating when present", () => {
    const page = `
Collapsible Silicone Food Container Set Wholesale
Dongguan Shouhongyu Silicone Products Co., Ltd.
9 yrs | CN
Store rating 5.0/5.0
Verified Supplier Trade Assurance
MOQ: 100
Collapsible silicone food containers lunch box
`.repeat(3);
    const f = extractDiligenceFacts({
      pageText: page,
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      skuName: "Collapsible food containers",
      fallbackCompanyName: "Alibaba listing · Collapsible Food Containers",
    });
    expect(f.yearsOnPlatform).toBe(9);
    expect(f.rating).toBe(5);
    expect(pickSupplierDiligenceRecommendation(f)).toBe("worth_sampling");
  });

  it("example signals → worth_sampling", () => {
    const f = exampleFacts();
    expect(pickSupplierDiligenceRecommendation(f)).toBe("worth_sampling");
  });

  it("thin / irrelevant → skip", () => {
    const thin = extractDiligenceFacts({
      pageText: "hi",
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      skuName: "Collapsible food containers",
    });
    expect(pickSupplierDiligenceRecommendation(thin)).toBe("skip");

    const forced: DiligenceFacts = {
      ...exampleFacts(),
      skuRelevance: "none",
      pageTextLength: 2000,
    };
    expect(pickSupplierDiligenceRecommendation(forced)).toBe("skip");
  });

  it("relevant but weak signals → caution", () => {
    const f: DiligenceFacts = {
      companyName: null,
      companyNameSource: null,
      yearsOnPlatform: null,
      verifiedSignals: [],
      certifications: [],
      rating: null,
      reviewSnippets: [],
      skuRelevance: "strong",
      moqHint: null,
      unitPriceHint: null,
      platform: "alibaba",
      rawExcerpts: [],
      pageTextLength: 2000,
    };
    expect(pickSupplierDiligenceRecommendation(f)).toBe("caution");
  });
});

describe("validators + v1 voice", () => {
  it("rejects draft claiming 8 years when facts have no years", () => {
    const f = exampleFacts();
    const noYears: DiligenceFacts = { ...f, yearsOnPlatform: null };
    const draft =
      "This Alibaba listing looks relevant. The page shows about 8 years on Alibaba. Click Open on Alibaba on this card.";
    expect(assertYearsGrounded(draft, noYears)).toBe(false);
    expect(
      assertDiligenceNarrationGrounded(draft, noYears, "caution"),
    ).toBe(false);
  });

  it("requires Open on Alibaba / AliExpress CTA", () => {
    const f = exampleFacts();
    expect(assertOpenListingCta(V1_STYLE_DRAFT, "alibaba")).toBe(true);
    expect(
      assertOpenListingCta(
        "This AliExpress listing looks relevant. Click Open on AliExpress on this card.",
        "aliexpress",
      ),
    ).toBe(true);
    const noCta =
      "Worth requesting a sample\n\nThis Alibaba listing looks relevant to collapsible food containers.";
    expect(assertOpenListingCta(noCta, "alibaba")).toBe(false);
    expect(
      assertDiligenceNarrationGrounded(noCta, f, "worth_sampling"),
    ).toBe(false);
  });

  it("allows grounded v1-style narration without company-name hunt", () => {
    const f = exampleFacts();
    expect(
      assertDiligenceNarrationGrounded(V1_STYLE_DRAFT, f, "worth_sampling"),
    ).toBe(true);
  });

  it("rejects narrating Alibaba listing placeholder as supplier", () => {
    const f = exampleFacts();
    const draft =
      "Worth requesting a sample\n\nAlibaba listing · Collapsible Food Containers appears as the supplier. Click Open on Alibaba on this card.";
    expect(
      assertDiligenceNarrationGrounded(draft, f, "worth_sampling"),
    ).toBe(false);
  });

  it("rejects skills skip soft-pedaled into green", () => {
    expect(
      assertRecommendationAligned(
        "Worth requesting a sample. This looks strong — justify a sample ask.",
        "skip",
      ),
    ).toBe(false);
  });

  it("ensureRecommendationLead prefixes skills tier", () => {
    const body = ensureRecommendationLead(
      "This Alibaba listing looks relevant.",
      "caution",
      "en",
    );
    expect(body.startsWith("Proceed with caution")).toBe(true);
  });

  it("Gemini prompt mentions Open on Alibaba / AliExpress", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/diligence/gemini.ts"),
      "utf8",
    );
    expect(src).toMatch(/Open on Alibaba/);
    expect(src).toMatch(/Open on AliExpress/);
    expect(src).not.toMatch(/MUST open with that exact companyName/);
  });
});

describe("persist name is no-op", () => {
  it("persistAssessedSupplierName returns null", async () => {
    expect(
      await persistAssessedSupplierName({
        workspaceId: "ws",
        supplierId: "sup",
        currentName: "Alibaba listing · Widget",
        companyName: "Dongguan Foo Co., Ltd.",
        companyNameSource: "page",
      }),
    ).toBeNull();
  });
});

describe("merge live seats", () => {
  it("does not force verified true on live overlay", () => {
    const heuristic = [
      {
        name: "H",
        role: "primary" as const,
        rank: 0,
        source: "import" as const,
        years: 5,
        rating: 4.5,
        verified: true,
        moq: 150,
        unitPrice: 10,
        sampleReplies: true,
        negotiationDraft: "d",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
    ];
    const liveLeads: SupplierLead[] = [
      {
        name: "Live Co",
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/product-detail/x.html",
        externalTitle: "Live",
        unitPriceHint: 8,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads,
      heuristic,
    });
    expect(merged[0]?.verified).toBe(false);
    expect(merged[0]?.leadSource).toBe("live_search");
  });
});

describe("pipeline without live network", () => {
  beforeEach(() => clearDiligenceCache());

  it("hash is stable for same text", () => {
    expect(hashDiligenceContent("abc")).toBe(hashDiligenceContent("abc"));
  });

  it("narration failure still returns skills recommendation", async () => {
    const { assessFromPageText } = await import(
      "@/lib/supplier/diligence/service"
    );
    const res = await assessFromPageText({
      pageText: EXAMPLE_PAGE,
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      skuName: "Collapsible food containers",
      fallbackCompanyName: "Homelux",
      supplierId: "sup-1",
      locale: "en",
      apiKey: "test-key",
      narrateFn: async () => ({ ok: false, error: "api_error" }),
    });
    expect(res.ok).toBe(true);
    expect(res.recommendation).toBe("worth_sampling");
    expect(res.summary).toBeNull();
    expect(res.narrationSource).toBe("skills_only");
  });

  it("grounded narrate is kept", async () => {
    const { assessFromPageText } = await import(
      "@/lib/supplier/diligence/service"
    );
    const res = await assessFromPageText({
      pageText: EXAMPLE_PAGE,
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      skuName: "Collapsible food containers",
      fallbackCompanyName: "Homelux",
      supplierId: "sup-2",
      locale: "en",
      apiKey: "test-key",
      narrateFn: async () => ({ ok: true, summary: V1_STYLE_DRAFT }),
    });
    expect(res.summary).toContain("Open on Alibaba");
    expect(res.narrationSource).toBe("llm");
  });
});

describe("server actions safety", () => {
  it("does not re-export AssessListingResult types from actions/supplier", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/actions/supplier.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/export type \{[^}]*AssessListing/);
  });
});
