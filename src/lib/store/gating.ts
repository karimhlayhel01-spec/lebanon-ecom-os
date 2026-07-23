import {
  STORE_CHECKLIST_BUILD_KEYS,
  STORE_CHECKLIST_GO_LIVE_KEYS,
  type StoreChecklistKey,
} from "@/lib/constants";

export type StoreChecklistState = Record<StoreChecklistKey, boolean>;

/** Every Build-section key is checked. */
export function buildComplete(checklist: StoreChecklistState): boolean {
  return STORE_CHECKLIST_BUILD_KEYS.every((k) => checklist[k]);
}

/**
 * Other Go live keys (not testCheckout) are checked — so testCheckout may be ticked.
 * Does not require Build; callers should also require buildComplete.
 */
export function goLiveReadyForTest(checklist: StoreChecklistState): boolean {
  return STORE_CHECKLIST_GO_LIVE_KEYS.filter((k) => k !== "testCheckout").every(
    (k) => checklist[k],
  );
}

/**
 * Whether the founder may check this key ON (v1 gating).
 * Unchecking is always allowed at the UI/server layer.
 */
export function canCheckStoreChecklistKey(
  checklist: StoreChecklistState,
  key: StoreChecklistKey,
): boolean {
  if (STORE_CHECKLIST_BUILD_KEYS.includes(key as (typeof STORE_CHECKLIST_BUILD_KEYS)[number])) {
    return true;
  }
  if (!buildComplete(checklist)) return false;
  if (key === "testCheckout") return goLiveReadyForTest(checklist);
  return true;
}
