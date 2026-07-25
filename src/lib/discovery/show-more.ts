import { DISCOVERY_INITIAL_COUNT } from "@/lib/constants";

/**
 * How many Show more clicks remain before the session hit its reveal cap.
 * Initial paint shows `DISCOVERY_INITIAL_COUNT`; each click reveals another
 * batch of that size until `cap` (min of session max and pool size).
 */
export function computeShowMoreRemaining(
  productsShown: number,
  cap: number,
  batchSize: number = DISCOVERY_INITIAL_COUNT,
): number {
  if (productsShown >= cap || batchSize <= 0) return 0;
  return Math.ceil((cap - productsShown) / batchSize);
}
