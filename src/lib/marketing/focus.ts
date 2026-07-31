import type { MarketingStage } from "@/lib/constants";

export type MarketingStageInfo = {
  stage: MarketingStage;
  unlocked: boolean;
  paidRule: "none" | "capped" | "full";
};

const SAMPLE_APPROVED_STATES = new Set([
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
]);

const BATCH_ORDERED_STATES = new Set([
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
]);

const BATCH_ARRIVED_STATES = new Set(["batch_arrived_ready", "selling"]);

export type SkuMarketingJourneyInput = {
  primaryState: string;
  pausedFromState?: string | null;
  sampleStatus?: string | null;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  marketingStage?: string | null;
  batchArrivalEta?: string | null;
};

export type LegacyMarketingJourneyInput = {
  primaryState: string;
  sampleStatus?: string | null;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  marketingStage?: string | null;
  batchArrivalEta?: string | null;
};

export type ResolvedMarketingJourneyFlags = {
  primaryState: string;
  sampleApproved: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  marketingStage: MarketingStage;
  batchArrivalEta: string | null;
};

/**
 * Per-SKU marketing unlocks: when `skuJourney` exists, use that SKU only.
 * Never OR workspace sideStatuses into a SKU that has its own journey row.
 * Legacy single-SKU (no skuJourney) falls back to workspace journey/side.
 */
export function resolveMarketingJourneyFlags(args: {
  skuJourney: SkuMarketingJourneyInput | null;
  legacy: LegacyMarketingJourneyInput | null;
}): ResolvedMarketingJourneyFlags {
  const src = args.skuJourney ?? args.legacy;
  if (!src) {
    return {
      primaryState: "",
      sampleApproved: false,
      batchOrdered: false,
      batchArrivedReady: false,
      marketingStage: "none",
      batchArrivalEta: null,
    };
  }

  let primaryState = src.primaryState;
  if (
    args.skuJourney &&
    primaryState === "paused" &&
    args.skuJourney.pausedFromState
  ) {
    primaryState = args.skuJourney.pausedFromState;
  }

  const sampleApproved =
    src.sampleStatus === "approved" ||
    SAMPLE_APPROVED_STATES.has(primaryState);
  const batchOrdered =
    src.batchOrdered || BATCH_ORDERED_STATES.has(primaryState);
  const batchArrivedReady =
    src.batchArrivedReady || BATCH_ARRIVED_STATES.has(primaryState);

  const rawStage = src.marketingStage ?? "none";
  const marketingStage = (
    [
      "none",
      "intro_pdf",
      "pre_launch",
      "launch",
      "monthly_refresh",
    ] as const
  ).includes(rawStage as MarketingStage)
    ? (rawStage as MarketingStage)
    : "none";

  return {
    primaryState,
    sampleApproved,
    batchOrdered,
    batchArrivedReady,
    marketingStage,
    batchArrivalEta: src.batchArrivalEta ?? null,
  };
}

export function resolveUnlockedStages(flags: {
  sampleApproved: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  hasLaunchKit: boolean;
}): MarketingStageInfo[] {
  return [
    {
      stage: "intro_pdf",
      unlocked: flags.sampleApproved,
      paidRule: "none",
    },
    {
      stage: "pre_launch",
      unlocked: flags.batchOrdered,
      paidRule: "capped",
    },
    {
      stage: "launch",
      unlocked: flags.batchArrivedReady,
      paidRule: "full",
    },
    {
      stage: "monthly_refresh",
      unlocked: flags.hasLaunchKit,
      paidRule: "full",
    },
  ];
}

/**
 * Default "Current" focus for the marketing rail.
 *
 * Unlock rules are separate (monthly_refresh may unlock as soon as a launch kit
 * exists). Focus follows the journey so Launch is not skipped at
 * batch_arrived_ready just because monthly_refresh is already unlocked.
 *
 * Last-generated kit stage is only used when it matches the journey focus —
 * never to jump ahead (old furthest-unlocked behavior).
 */
export function resolveDefaultFocusStage(args: {
  primaryState: string;
  sampleApproved: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  stages: MarketingStageInfo[];
  sideStage: MarketingStage;
}): MarketingStage {
  const unlocked = (s: MarketingStage) =>
    args.stages.some((x) => x.stage === s && x.unlocked);

  let preferred: MarketingStage = "none";
  if (args.primaryState === "selling") {
    if (unlocked("monthly_refresh")) preferred = "monthly_refresh";
    else if (unlocked("launch")) preferred = "launch";
    else if (unlocked("pre_launch")) preferred = "pre_launch";
    else if (unlocked("intro_pdf")) preferred = "intro_pdf";
  } else if (
    args.primaryState === "batch_arrived_ready" ||
    args.batchArrivedReady
  ) {
    // Prefer Launch even when monthly_refresh is unlocked.
    if (unlocked("launch")) preferred = "launch";
    else if (unlocked("pre_launch")) preferred = "pre_launch";
    else if (unlocked("intro_pdf")) preferred = "intro_pdf";
  } else if (args.primaryState === "batch_ordered" || args.batchOrdered) {
    if (unlocked("pre_launch")) preferred = "pre_launch";
    else if (unlocked("intro_pdf")) preferred = "intro_pdf";
  } else if (args.sampleApproved) {
    if (unlocked("intro_pdf")) preferred = "intro_pdf";
  }

  // Honor last-generated stage only when it is the journey-appropriate focus
  // (and unlocked). Blocks monthly_refresh from stealing Current at Launch.
  if (
    args.sideStage !== "none" &&
    args.sideStage === preferred &&
    unlocked(args.sideStage)
  ) {
    return args.sideStage;
  }
  return preferred;
}
