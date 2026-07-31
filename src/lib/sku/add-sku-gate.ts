/**
 * Wave 1 multi-SKU: add-SKU finance/experience gates.
 *
 * Bar (shop Topic A, combined): ≥15 healthy weeks total AND the last 5
 * consecutive logged weeks are all healthy.
 *
 * - beginner: HARD BLOCK until bar met (cannot add SKU #2+)
 * - some: may add earlier WITH warning; no warning if bar already met
 * - experienced: anytime after first product accepted
 * - SKU #3+: same bar; soft warning if SKU #2 finance looks weak
 */

export const ADD_SKU_HEALTHY_WEEKS_MIN = 15;
export const ADD_SKU_LAST_HEALTHY_STREAK = 5;

export type ExperienceLevel = "beginner" | "some" | "experienced";

export type WeekVerdict = "healthy" | "watch" | "risk";

export type AddSkuGateInput = {
  experience: ExperienceLevel;
  /** Count of live (non-archived) SKUs before adding. */
  liveSkuCount: number;
  /** Shop Topic A weekly verdicts in chronological order (oldest → newest). */
  weekVerdicts: readonly WeekVerdict[];
  /**
   * Optional soft signal for SKU #3+: true when the previous live SKU (#2)
   * looks weak on recent Topic A (caller decides how).
   */
  previousSkuWeak?: boolean;
};

export type AddSkuGateResult =
  | { ok: true; warning?: "early_add" | "watch_previous_sku" | "both" }
  | { ok: false; error: "need_first_sku" | "beginner_blocked" };

export function shopTopicABarMet(
  weekVerdicts: readonly WeekVerdict[],
): boolean {
  if (weekVerdicts.length < ADD_SKU_HEALTHY_WEEKS_MIN) return false;
  const healthyTotal = weekVerdicts.filter((v) => v === "healthy").length;
  if (healthyTotal < ADD_SKU_HEALTHY_WEEKS_MIN) return false;
  const last = weekVerdicts.slice(-ADD_SKU_LAST_HEALTHY_STREAK);
  if (last.length < ADD_SKU_LAST_HEALTHY_STREAK) return false;
  return last.every((v) => v === "healthy");
}

/**
 * Pure gate for adding the next live SKU. Does not mutate state.
 * `liveSkuCount` is the count BEFORE the add (0 = first SKU).
 */
export function evaluateAddSkuGate(input: AddSkuGateInput): AddSkuGateResult {
  const { experience, liveSkuCount, weekVerdicts, previousSkuWeak } = input;

  if (liveSkuCount < 0) {
    return { ok: false, error: "need_first_sku" };
  }

  // First SKU — always allowed (discovery accept path).
  if (liveSkuCount === 0) {
    return { ok: true };
  }

  const barMet = shopTopicABarMet(weekVerdicts);

  if (experience === "beginner") {
    if (!barMet) return { ok: false, error: "beginner_blocked" };
    return softWarnings(liveSkuCount, previousSkuWeak, false);
  }

  if (experience === "experienced") {
    return softWarnings(liveSkuCount, previousSkuWeak, false);
  }

  // some: early add warning unless bar already met
  const earlyWarning = !barMet;
  return softWarnings(liveSkuCount, previousSkuWeak, earlyWarning);
}

function softWarnings(
  liveSkuCount: number,
  previousSkuWeak: boolean | undefined,
  earlyWarning: boolean,
): AddSkuGateResult {
  const watchPrev = liveSkuCount >= 2 && !!previousSkuWeak;
  if (earlyWarning && watchPrev) return { ok: true, warning: "both" };
  if (earlyWarning) return { ok: true, warning: "early_add" };
  if (watchPrev) return { ok: true, warning: "watch_previous_sku" };
  return { ok: true };
}

/** Landing target after auth for Wave 1 IA rules. */
export type LandingTarget =
  | { kind: "hub" }
  | { kind: "sku"; skuId: string };

export function resolvePostLoginLanding(
  liveSkus: readonly { id: string }[],
): LandingTarget {
  if (liveSkus.length === 0) return { kind: "hub" };
  if (liveSkus.length === 1) return { kind: "sku", skuId: liveSkus[0].id };
  return { kind: "hub" };
}

/**
 * Explicit Shop navigation (`?hub=1`) always shows the hub — even with 1 live SKU.
 * Default landing still sends 1-SKU founders to the SKU page.
 */
export function shouldShowShopHub(args: {
  liveSkuCount: number;
  forceHub: boolean;
}): boolean {
  if (args.forceHub) return true;
  if (args.liveSkuCount === 0) return true;
  if (args.liveSkuCount >= 2) return true;
  return false;
}

/**
 * Seriousness ack is required only after onboarding experience was raised
 * TO experienced (pending flag), not for every experienced founder.
 */
export function shouldRequireExperiencedSeriousnessAck(
  experienceRaisedPendingAck: boolean,
): boolean {
  return experienceRaisedPendingAck;
}

/** Add-SKU discovery mounts only after the Add SKU CTA (`?addSku=1`). */
export function shouldShowAddSkuDiscovery(args: {
  liveSkuCount: number;
  addSkuFlag: boolean;
}): boolean {
  return args.liveSkuCount >= 1 && args.addSkuFlag;
}
