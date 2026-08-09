/**
 * Wave 3 — live supplier lead types (docs/WAVE-3.md).
 * Mapped into supplier_options; heuristic remains the fallback.
 */

export type SupplierLeadPlatform = "alibaba" | "aliexpress" | "other";

export type SupplierLeadSourceKind = "heuristic" | "live_search";

export type SupplierLead = {
  name: string;
  platform: SupplierLeadPlatform;
  sourceUrl: string;
  externalTitle: string;
  /** Optional unit hint from shopping SERP; null → use SKU money snapshot. */
  unitPriceHint: number | null;
  leadSource: "live_search";
};

export type GatherSupplierLeadsInput = {
  productName: string;
  /** import → Alibaba/AliExpress-class; local → optional later */
  source: "import" | "local";
  /** Max leads to return (Import fill uses up to 9 for 3+2). */
  limit: number;
};

export type GatherSupplierLeadsResult = {
  leads: SupplierLead[];
  queriesUsed: number;
  /** True when the provider could not run (missing key / disabled). */
  noop: boolean;
  error?: string;
};
