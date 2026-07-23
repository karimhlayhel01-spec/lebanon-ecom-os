import { describe, expect, it } from "vitest";
import {
  STORE_CHECKLIST_BUILD_KEYS,
  STORE_CHECKLIST_GO_LIVE_KEYS,
  STORE_CHECKLIST_KEYS,
} from "@/lib/constants";
import {
  buildComplete,
  canCheckStoreChecklistKey,
  goLiveReadyForTest,
  type StoreChecklistState,
} from "./gating";

function empty(): StoreChecklistState {
  return Object.fromEntries(
    STORE_CHECKLIST_KEYS.map((k) => [k, false]),
  ) as StoreChecklistState;
}

function withBuildDone(extra: Partial<StoreChecklistState> = {}): StoreChecklistState {
  const c = empty();
  for (const k of STORE_CHECKLIST_BUILD_KEYS) c[k] = true;
  return { ...c, ...extra };
}

describe("store checklist gating", () => {
  it("buildComplete requires every build key", () => {
    const c = empty();
    expect(buildComplete(c)).toBe(false);
    for (const k of STORE_CHECKLIST_BUILD_KEYS) c[k] = true;
    expect(buildComplete(c)).toBe(true);
    c.shopifyCreated = false;
    expect(buildComplete(c)).toBe(false);
  });

  it("goLiveReadyForTest ignores testCheckout and Build", () => {
    const c = empty();
    expect(goLiveReadyForTest(c)).toBe(false);
    c.sellToLebanon = true;
    c.shippingRates = true;
    c.storePublic = true;
    expect(goLiveReadyForTest(c)).toBe(true);
    c.testCheckout = false;
    expect(goLiveReadyForTest(c)).toBe(true);
  });

  it("blocks Go live checks until Build is complete", () => {
    const c = empty();
    for (const k of STORE_CHECKLIST_GO_LIVE_KEYS) {
      expect(canCheckStoreChecklistKey(c, k)).toBe(false);
    }
    for (const k of STORE_CHECKLIST_BUILD_KEYS) {
      expect(canCheckStoreChecklistKey(c, k)).toBe(true);
    }
  });

  it("allows other Go live after Build; testCheckout last", () => {
    const c = withBuildDone();
    expect(canCheckStoreChecklistKey(c, "sellToLebanon")).toBe(true);
    expect(canCheckStoreChecklistKey(c, "testCheckout")).toBe(false);
    c.sellToLebanon = true;
    c.shippingRates = true;
    c.storePublic = true;
    expect(canCheckStoreChecklistKey(c, "testCheckout")).toBe(true);
  });
});
