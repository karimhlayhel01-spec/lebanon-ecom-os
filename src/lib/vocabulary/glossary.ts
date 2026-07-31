/**
 * Shared Vocabulary glossary — journey-phase tagged terms for the app-wide
 * sidebar. Message copy lives under the Vocabulary next-intl namespace; this
 * module owns ids, phase tags, and highlight mapping only.
 */

export const VOCAB_PHASES = [
  "discovery",
  "sample_request",
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_received",
  "selling",
] as const;

export type VocabPhase = (typeof VOCAB_PHASES)[number];

export const GLOSSARY_TERM_IDS = [
  "sku",
  "fit",
  "strongFit",
  "okayFit",
  "demandSignal",
  "differentiation",
  "tier1Marketplace",
  "landedCost",
  "marginBeforeAds",
  "marginAfterAds",
  "showMore",
  "curatedCatalog",
  "activeSku",
  "approvalGate",
  "sample",
  "sampleFirst",
  "supplier",
  "primarySupplier",
  "backupSupplier",
  "workingSupplier",
  "warmedSpare",
  "cantFulfillSwitch",
  "nextBatch",
  "importVsLocal",
  "addSku",
  "archiveSku",
  "moq",
  "unitPrice",
  "negotiation",
  "qualityChecklist",
  "clearance",
  "cashLock",
  "stuckPath",
  "sampleApproved",
  "introMarketing",
  "parallelNextSteps",
  "costQuotes",
  "batchVsSample",
  "shopify",
  "storeReadiness",
  "cod",
  "localPayments",
  "deliveryCompany",
  "policyPages",
  "whatsappCommerce",
  "sideStatus",
  "batch",
  "firstBatch",
  "preLaunchMarketing",
  "paidCap",
  "inventoryInTransit",
  "eta",
  "inventory",
  "batchArrived",
  "readyToSell",
  "launchKit",
  "preSalesEstimate",
  "topicA",
  "topicB",
  "weeklyHealth",
  "codOutstanding",
  "adSpend",
  "courierFees",
  "investNext",
  "conversion",
  "creativeFatigue",
  "weeklyRefresh",
] as const;

export type GlossaryTermId = (typeof GLOSSARY_TERM_IDS)[number];

export type GlossaryEntry = {
  id: GlossaryTermId;
  /** Phases where this term appears. Multi-phase terms need distinct whyItMatters per phase. */
  phases: readonly VocabPhase[];
};

/**
 * Canonical term list. Order within each phase follows first appearance here.
 * Multi-phase examples (distinct why per phase): sku, landedCost, marginBeforeAds,
 * marginAfterAds, moq, cod, inventory, approvalGate.
 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  { id: "sku", phases: ["discovery", "sample_request", "store_setup", "selling"] },
  { id: "fit", phases: ["discovery"] },
  { id: "strongFit", phases: ["discovery"] },
  { id: "okayFit", phases: ["discovery"] },
  { id: "demandSignal", phases: ["discovery"] },
  { id: "differentiation", phases: ["discovery"] },
  { id: "tier1Marketplace", phases: ["discovery"] },
  {
    id: "landedCost",
    phases: ["discovery", "sample_approved", "batch_ordered"],
  },
  {
    id: "marginBeforeAds",
    phases: ["discovery", "sample_approved", "selling"],
  },
  { id: "marginAfterAds", phases: ["discovery", "selling"] },
  { id: "showMore", phases: ["discovery"] },
  { id: "curatedCatalog", phases: ["discovery"] },
  { id: "activeSku", phases: ["discovery", "selling"] },
  { id: "approvalGate", phases: ["discovery", "sample_request"] },
  { id: "moq", phases: ["discovery", "sample_request", "batch_ordered"] },

  { id: "sample", phases: ["sample_request"] },
  { id: "sampleFirst", phases: ["sample_request"] },
  { id: "supplier", phases: ["sample_request"] },
  { id: "primarySupplier", phases: ["sample_request", "sample_approved"] },
  {
    id: "backupSupplier",
    phases: ["sample_request", "sample_approved", "selling"],
  },
  { id: "importVsLocal", phases: ["sample_request", "sample_approved"] },
  { id: "unitPrice", phases: ["sample_request"] },
  { id: "negotiation", phases: ["sample_request"] },
  { id: "qualityChecklist", phases: ["sample_request"] },
  {
    id: "clearance",
    phases: ["sample_request", "batch_ordered", "batch_received"],
  },
  { id: "cashLock", phases: ["sample_request"] },
  { id: "stuckPath", phases: ["sample_request"] },

  { id: "sampleApproved", phases: ["sample_approved"] },
  {
    id: "workingSupplier",
    phases: ["sample_approved", "batch_ordered", "selling"],
  },
  {
    id: "warmedSpare",
    phases: ["sample_approved", "batch_ordered", "selling"],
  },
  { id: "introMarketing", phases: ["sample_approved"] },
  { id: "parallelNextSteps", phases: ["sample_approved"] },
  { id: "costQuotes", phases: ["sample_approved"] },
  { id: "batchVsSample", phases: ["sample_approved"] },

  { id: "shopify", phases: ["store_setup"] },
  { id: "storeReadiness", phases: ["store_setup"] },
  { id: "cod", phases: ["store_setup", "selling"] },
  { id: "localPayments", phases: ["store_setup"] },
  { id: "deliveryCompany", phases: ["store_setup"] },
  { id: "policyPages", phases: ["store_setup"] },
  { id: "whatsappCommerce", phases: ["store_setup"] },
  { id: "sideStatus", phases: ["store_setup"] },

  { id: "batch", phases: ["batch_ordered"] },
  { id: "firstBatch", phases: ["batch_ordered"] },
  { id: "preLaunchMarketing", phases: ["batch_ordered"] },
  { id: "paidCap", phases: ["batch_ordered"] },
  { id: "inventoryInTransit", phases: ["batch_ordered"] },
  { id: "eta", phases: ["batch_ordered"] },
  {
    id: "inventory",
    phases: ["batch_ordered", "batch_received", "selling"],
  },

  { id: "batchArrived", phases: ["batch_received"] },
  { id: "readyToSell", phases: ["batch_received"] },
  { id: "launchKit", phases: ["batch_received"] },
  { id: "preSalesEstimate", phases: ["batch_received"] },

  { id: "topicA", phases: ["selling"] },
  { id: "topicB", phases: ["selling"] },
  { id: "weeklyHealth", phases: ["selling"] },
  { id: "codOutstanding", phases: ["selling"] },
  { id: "adSpend", phases: ["selling"] },
  { id: "courierFees", phases: ["selling"] },
  { id: "investNext", phases: ["selling"] },
  { id: "nextBatch", phases: ["selling"] },
  { id: "cantFulfillSwitch", phases: ["selling"] },
  { id: "addSku", phases: ["discovery", "selling"] },
  { id: "archiveSku", phases: ["selling"] },
  { id: "conversion", phases: ["selling"] },
  { id: "creativeFatigue", phases: ["selling"] },
  { id: "weeklyRefresh", phases: ["selling"] },
];

const JOURNEY_TO_VOCAB_PHASE: Record<string, VocabPhase> = {
  discovery: "discovery",
  supplier_sample: "sample_request",
  sample_approved: "sample_approved",
  store_setup: "store_setup",
  batch_ordered: "batch_ordered",
  batch_arrived_ready: "batch_received",
  selling: "selling",
};

/**
 * Soft-highlight target for the Vocabulary panel.
 * Paused → pausedFromState; blocked / unknown → no highlight.
 */
export function resolveVocabHighlightPhase(
  primaryState: string | null | undefined,
  pausedFromState?: string | null,
): VocabPhase | null {
  if (!primaryState || primaryState === "blocked") return null;

  const effective =
    primaryState === "paused" ? (pausedFromState ?? null) : primaryState;
  if (!effective) return null;

  return JOURNEY_TO_VOCAB_PHASE[effective] ?? null;
}

/**
 * Hub vocabulary soft-highlight: prefer the active live SKU’s stage.
 * If no active SKU, use a shared phase only when every live SKU agrees;
 * otherwise null (mixed / unclear — no soft “where you are”).
 */
export function resolveHubVocabHighlightPhase(
  skus: readonly {
    id: string;
    primaryState: string;
    pausedFromState?: string | null;
  }[],
  activeSkuId: string | null | undefined,
): VocabPhase | null {
  if (skus.length === 0) {
    return resolveVocabHighlightPhase("discovery");
  }

  const active = activeSkuId
    ? skus.find((s) => s.id === activeSkuId)
    : undefined;
  if (active) {
    return resolveVocabHighlightPhase(
      active.primaryState,
      active.pausedFromState,
    );
  }

  const phases = skus.map((s) =>
    resolveVocabHighlightPhase(s.primaryState, s.pausedFromState),
  );
  const defined = phases.filter((p): p is VocabPhase => p != null);
  if (defined.length === 0) return null;
  const first = defined[0]!;
  if (defined.every((p) => p === first) && defined.length === skus.length) {
    return first;
  }
  return null;
}

export function termsForPhase(phase: VocabPhase): GlossaryTermId[] {
  return GLOSSARY.filter((entry) => entry.phases.includes(phase)).map(
    (entry) => entry.id,
  );
}

export function getGlossaryEntry(
  id: GlossaryTermId,
): GlossaryEntry | undefined {
  return GLOSSARY.find((entry) => entry.id === id);
}
