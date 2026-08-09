import { describe, expect, it } from "vitest";
import {
  extractCompanyFromSnippet,
  extractCompanyFromTitle,
  extractCompanyFromUrl,
  extractStorefrontFromHost,
  isPlatformListingFallbackName,
  resolveContactFacingLeadName,
  resolveNameUpdateAfterAssess,
} from "@/lib/supplier/live/company-name";
import { mapOrganicHitToImportLead } from "@/lib/supplier/live/serper-leads";
import { isAllowedImportListingUrl } from "@/lib/supplier/live/url-filter";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import type { SupplierLead } from "@/lib/supplier/live/types";

describe("isAllowedImportListingUrl", () => {
  it("accepts Alibaba product-detail and company paths", () => {
    expect(
      isAllowedImportListingUrl(
        "https://www.alibaba.com/product-detail/Collapsible-Food-Containers_123.html",
      ),
    ).toBe(true);
    expect(
      isAllowedImportListingUrl(
        "https://www.alibaba.com/company/shenzhen-foo-co-ltd.html",
      ),
    ).toBe(true);
    expect(
      isAllowedImportListingUrl(
        "https://shenzhenfoo.en.alibaba.com/company_profile.html",
      ),
    ).toBe(true);
  });

  it("accepts AliExpress item URLs", () => {
    expect(
      isAllowedImportListingUrl(
        "https://www.aliexpress.com/item/1005001234567890.html",
      ),
    ).toBe(true);
    expect(
      isAllowedImportListingUrl("https://www.aliexpress.com/i/100500123.html"),
    ).toBe(true);
  });

  it("rejects LifeTips / blog / tip article URLs", () => {
    expect(
      isAllowedImportListingUrl(
        "https://www.alibaba.com/lifetips/Are-Collapsible-Worth-It.html",
      ),
    ).toBe(false);
    expect(
      isAllowedImportListingUrl(
        "https://www.alibaba.com/blog/collapsible-food-containers-guide",
      ),
    ).toBe(false);
    expect(
      isAllowedImportListingUrl(
        "https://www.aliexpress.com/help/article.html",
      ),
    ).toBe(false);
  });
});

describe("contact-facing lead names", () => {
  it("extracts company after dash from product title", () => {
    const title =
      "3 Pcs Set Collapsible Food Containers - Shenzhen Foo Co., Ltd.";
    expect(extractCompanyFromTitle(title)).toMatch(/Shenzhen Foo Co/i);
    const resolved = resolveContactFacingLeadName({
      title,
      url: "https://www.alibaba.com/product-detail/x.html",
      productName: "Collapsible food containers",
      platform: "alibaba",
    });
    expect(resolved.confidence).toBe("company");
    expect(resolved.name).toMatch(/Shenzhen Foo/i);
    expect(resolved.name).not.toMatch(/^3 Pcs/i);
  });

  it("does not use marketing / question headlines as the company name", () => {
    const title = "Are Collapsible Food Containers Worth It? - LifeTips";
    expect(extractCompanyFromTitle(title)).toBeNull();
    const resolved = resolveContactFacingLeadName({
      title,
      url: "https://www.alibaba.com/product-detail/x.html",
      productName: "Collapsible food containers",
      platform: "alibaba",
    });
    expect(resolved.confidence).toBe("fallback");
    expect(resolved.name).toMatch(/Alibaba listing/i);
    expect(resolved.name).not.toMatch(/Worth It/i);
    expect(resolved.name).not.toMatch(/LifeTips/i);
  });

  it("reads company-like slug from /company/ URL", () => {
    expect(
      extractCompanyFromUrl(
        "https://www.alibaba.com/company/shenzhen-foo-trading-co-ltd.html",
      ),
    ).toMatch(/Shenzhen Foo Trading/i);
  });

  it("humanizes storefront host foo-bar.en.alibaba.com (not platform fallback)", () => {
    expect(
      extractStorefrontFromHost(
        "https://foo-bar.en.alibaba.com/product/Collapsible_123.html",
      ),
    ).toBe("Foo Bar");
    const resolved = resolveContactFacingLeadName({
      title: "3 Pcs Set Collapsible Silicone Lunch Boxes Best Sellers 2024",
      url: "https://foo-bar.en.alibaba.com/product/Collapsible_123.html",
      productName: "Collapsible food containers",
      platform: "alibaba",
    });
    expect(resolved.confidence).toBe("company");
    expect(resolved.name).toBe("Foo Bar");
    expect(resolved.name).not.toMatch(/Alibaba listing/i);
  });

  it("ignores www.en.alibaba.com and login hosts as storefronts", () => {
    expect(
      extractStorefrontFromHost("https://www.en.alibaba.com/product/x.html"),
    ).toBeNull();
    expect(
      extractStorefrontFromHost("https://login.en.alibaba.com/"),
    ).toBeNull();
  });

  it("marketing-only title on www.alibaba.com/product-detail → fallback OK", () => {
    const resolved = resolveContactFacingLeadName({
      title: "3 Pcs Set Collapsible Silicone Lunch Boxes Best Sellers 2024",
      url: "https://www.alibaba.com/product-detail/Collapsible_123.html",
      productName: "Collapsible food containers",
      platform: "alibaba",
    });
    expect(resolved.confidence).toBe("fallback");
    expect(resolved.name).toMatch(/Alibaba listing/i);
    expect(isPlatformListingFallbackName(resolved.name)).toBe(true);
  });

  it("Assess name update prefers page company over listing fallback", () => {
    expect(
      resolveNameUpdateAfterAssess({
        currentName: "Alibaba listing · Collapsible Food Containers",
        companyName: "Shenzhen Homelux Silicone Co., Ltd.",
        companyNameSource: "page",
      }),
    ).toMatch(/Homelux/i);
    expect(
      resolveNameUpdateAfterAssess({
        currentName: "Shenzhen Homelux Silicone Co., Ltd.",
        companyName: "Shenzhen Homelux Silicone Co., Ltd.",
        companyNameSource: "page",
      }),
    ).toBeNull();
    expect(
      resolveNameUpdateAfterAssess({
        currentName: "Good Existing Name",
        companyName: "Card Contact",
        companyNameSource: "card",
      }),
    ).toBeNull();
    expect(
      resolveNameUpdateAfterAssess({
        currentName: "Alibaba listing · Widget",
        companyName: "Card Contact Seller",
        companyNameSource: "card",
      }),
    ).toBe("Card Contact Seller");
  });

  it("uses strict snippet labels only", () => {
    expect(
      extractCompanyFromSnippet(
        "Supplier: Guangzhou Bar Factory offers silicone lids.",
      ),
    ).toMatch(/Guangzhou Bar Factory/i);
    expect(
      extractCompanyFromSnippet("Great product for camping and kitchen use."),
    ).toBeNull();
  });
});

describe("mapOrganicHitToImportLead", () => {
  const product = "Collapsible food containers";

  it("rejects tip article organic hits", () => {
    expect(
      mapOrganicHitToImportLead(
        {
          title: "Are Collapsible… Worth It? - LifeTips",
          link: "https://www.alibaba.com/lifetips/collapsible-worth-it.html",
          snippet: "Tips for buyers…",
        },
        product,
      ),
    ).toBeNull();
  });

  it("accepts product-detail with company in title; keeps raw externalTitle", () => {
    const lead = mapOrganicHitToImportLead(
      {
        title:
          "Collapsible Food Container Set - Shenzhen Foo Co., Ltd.",
        link: "https://www.alibaba.com/product-detail/Collapsible-Food_1600.html",
        snippet: "Wholesale collapsible boxes.",
      },
      product,
    );
    expect(lead).not.toBeNull();
    expect(lead!.leadSource).toBe("live_search");
    expect(lead!.sourceUrl).toContain("product-detail");
    expect(lead!.name).toMatch(/Shenzhen Foo Co/i);
    expect(lead!.externalTitle).toContain("Collapsible Food Container Set");
    expect(lead!.externalTitle).toContain("Shenzhen Foo");
  });

  it("accepts listing URL with marketing-only title → honest fallback name", () => {
    const lead = mapOrganicHitToImportLead(
      {
        title: "3 Pcs Set Collapsible Silicone Lunch Boxes Best Sellers 2024",
        link: "https://www.aliexpress.com/item/100500999.html",
      },
      product,
    );
    expect(lead).not.toBeNull();
    expect(lead!.name).toMatch(/AliExpress seller listing/i);
    expect(lead!.name).not.toMatch(/Best Sellers/i);
    expect(lead!.externalTitle).toContain("3 Pcs Set");
  });

  it("merge still tags live_search + sourceUrl", () => {
    const lead = mapOrganicHitToImportLead(
      {
        title: "Widget - Ningbo Bar Trading Co., Ltd.",
        link: "https://www.alibaba.com/product-detail/Widget_1.html",
      },
      "Widget",
    )!;
    const heuristic = [
      {
        name: "Invent Commerce Ltd.",
        role: "primary" as const,
        rank: 0,
        source: "import" as const,
        years: 5,
        rating: 4.5,
        verified: true,
        moq: 150,
        unitPrice: 10,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead] as SupplierLead[],
      heuristic,
    });
    expect(merged[0]?.leadSource).toBe("live_search");
    expect(merged[0]?.sourceUrl).toContain("product-detail");
    expect(merged[0]?.name).toMatch(/Ningbo Bar Trading/i);
  });
});
