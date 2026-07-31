export const JOURNEY_STEPS = [
  "discovery",
  "accepted",
  "sample",
  "batch",
  "arrived",
  "selling",
] as const;

export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/**
 * Map SKU primary journey state → JourneyStrip step.
 * When paused, pass effective state (pausedFromState) as primaryState.
 */
export function primaryStateToJourneyStep(primaryState: string): JourneyStep {
  switch (primaryState) {
    case "discovery":
      return "discovery";
    case "supplier_sample":
      return "accepted";
    case "sample_approved":
    case "store_setup":
      return "sample";
    case "batch_ordered":
      return "batch";
    case "batch_arrived_ready":
      return "arrived";
    case "selling":
      return "selling";
    default:
      return "discovery";
  }
}
