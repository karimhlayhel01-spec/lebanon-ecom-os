import type { MarketingStage } from "@/lib/constants";

export type MarketingStageInfo = {
  stage: MarketingStage;
  unlocked: boolean;
  paidRule: "none" | "capped" | "full";
};

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
 * `side.marketingStage` (last generated kit) is only used when it matches the
 * journey focus — never to jump ahead (old furthest-unlocked behavior).
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
