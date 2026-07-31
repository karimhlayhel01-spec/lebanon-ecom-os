/**
 * Pure spine helper for approvals — exported for unit tests.
 */
import { PRIMARY_STATES, type PrimaryJourneyState } from "@/lib/constants";

export function isAtOrPastOnSpine(
  current: string,
  target: PrimaryJourneyState,
): boolean {
  const order = PRIMARY_STATES as readonly string[];
  const ci = order.indexOf(current);
  const ti = order.indexOf(target);
  if (ci < 0 || ti < 0) return false;
  return ci >= ti;
}
