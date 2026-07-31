import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  clearSkuAutoScrollSuppress,
  consumeDeepLinkIfUnlocked,
  isSkuAutoScrollSuppressed,
  shouldBlockSkuFocusScroll,
  suppressSkuAutoScroll,
} from "@/lib/sku/suppress-auto-scroll";

const SKU = "sku-test-1";
const SELLING_KEY = `/en/sku/${SKU}?attn=selling#finance`;
const SAMPLE_KEY = `/en/sku/${SKU}?attn=sample#supplier`;
const BARE_KEY = `/en/sku/${SKU}`;

describe("suppressSkuAutoScroll (durable sample-card lock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    clearSkuAutoScrollSuppress();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSkuAutoScrollSuppress();
  });

  it("is inactive before suppress", () => {
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
  });

  it("durable hold survives past the short timer window", () => {
    suppressSkuAutoScroll(SKU, 1000, SELLING_KEY);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
  });

  it("blocks deep-link remount at the same URL after Mark received", () => {
    suppressSkuAutoScroll(SKU, 5000, SELLING_KEY);
    expect(shouldBlockSkuFocusScroll(SKU, SELLING_KEY)).toBe(true);
    expect(consumeDeepLinkIfUnlocked(SKU, SELLING_KEY)).toBe(false);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
  });

  it("new hub Next URL clears lock and allows scroll", () => {
    suppressSkuAutoScroll(SKU, 5000, SELLING_KEY);
    expect(shouldBlockSkuFocusScroll(SKU, SELLING_KEY)).toBe(true);

    expect(consumeDeepLinkIfUnlocked(SKU, SAMPLE_KEY)).toBe(true);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
  });

  it("clearSkuAutoScrollSuppress unlocks immediately", () => {
    suppressSkuAutoScroll(SKU, 5000, SELLING_KEY);
    clearSkuAutoScrollSuppress(SKU);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
    expect(shouldBlockSkuFocusScroll(SKU, SELLING_KEY)).toBe(false);
  });

  it("empty-hash remount while locked never allows cold scroll", () => {
    suppressSkuAutoScroll(SKU, 5000, BARE_KEY);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
    expect(shouldBlockSkuFocusScroll(SKU, BARE_KEY)).toBe(true);
  });
});
