import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  clearSkuAutoScrollSuppress,
  clearStayOnFinanceAfterTopicAAction,
  consumeBatchArrivalEtaDeepLinkOnce,
  consumeDeepLinkIfUnlocked,
  consumeStayOnFinanceAfterTopicAAction,
  isElementStartInView,
  isSkuAutoScrollSuppressed,
  isSkuPagePathname,
  isStayOnFinanceAfterTopicAAction,
  markBatchArrivalEtaDeepLinkConsumed,
  markStayOnFinanceAfterTopicAAction,
  markStayOnFinanceAfterStartSelling,
  markStayOnMarketingAfterKitAction,
  shouldBlockSkuFocusScroll,
  suppressSkuAutoScroll,
  suppressSkuAutoScrollAfterBatchAction,
} from "@/lib/sku/suppress-auto-scroll";

const SKU = "sku-test-1";
const SKU_PATH = `/en/sku/${SKU}`;
const SELLING_KEY = `/en/sku/${SKU}?attn=selling#finance`;
const SAMPLE_KEY = `/en/sku/${SKU}?attn=sample#supplier`;
const BARE_KEY = `/en/sku/${SKU}`;
const BATCH_WITH_LEFTOVER_FINANCE = `/en/sku/${SKU}?attn=batch#finance`;
const REORDER_WITH_LEFTOVER = `/en/sku/${SKU}?attn=reorder#supplier`;
const EXPLICIT_FINANCE_CTA = `/en/sku/${SKU}?attn=selling#finance`;
const REORDER_NEW_CTA = `/en/sku/${SKU}?attn=reorder#supplier&fresh=1`;
const ETA_KEY = `/en/sku/${SKU}#batch-arrival-eta`;
const MARKETING_KEY = `/en/sku/${SKU}#marketing`;
const ETA_KEY_FRESH_QUERY = `/en/sku/${SKU}?attn=batch#batch-arrival-eta`;

describe("suppressSkuAutoScroll (durable sample-card lock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
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

describe("suppressSkuAutoScrollAfterBatchAction (Mark ordered / Mark arrived)", () => {
  beforeEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  afterEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  it("blocks leftover #finance remount after Mark ordered / Mark arrived", () => {
    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, BATCH_WITH_LEFTOVER_FINANCE);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
    expect(shouldBlockSkuFocusScroll(SKU, BATCH_WITH_LEFTOVER_FINANCE)).toBe(
      true,
    );
    expect(consumeDeepLinkIfUnlocked(SKU, BATCH_WITH_LEFTOVER_FINANCE)).toBe(
      false,
    );
    // Stay put — do not deep-link-scroll to Topic A.
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
  });

  it("clears leaked stay-finance so Start selling / Save week cannot pull batch remount", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(true);

    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, BATCH_WITH_LEFTOVER_FINANCE);

    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: "batch",
      }),
    ).toBe(false);
    // Remount still blocked by durable sample-style lock.
    expect(shouldBlockSkuFocusScroll(SKU, BATCH_WITH_LEFTOVER_FINANCE)).toBe(
      true,
    );
  });

  it("explicit #finance CTA (new URL) still scrolls after batch stay-put", () => {
    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, BATCH_WITH_LEFTOVER_FINANCE);
    expect(consumeDeepLinkIfUnlocked(SKU, BATCH_WITH_LEFTOVER_FINANCE)).toBe(
      false,
    );

    // Founder clicks hero Start selling / Tools finance / Topic A chip → new key.
    expect(consumeDeepLinkIfUnlocked(SKU, EXPLICIT_FINANCE_CTA)).toBe(true);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
  });
});

describe("suppressSkuAutoScrollAfterBatchAction (reorder order / arrive)", () => {
  beforeEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  afterEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  it("blocks same leftover reorder URL after Mark reorder arrived", () => {
    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, REORDER_WITH_LEFTOVER);
    expect(shouldBlockSkuFocusScroll(SKU, REORDER_WITH_LEFTOVER)).toBe(true);
    expect(consumeDeepLinkIfUnlocked(SKU, REORDER_WITH_LEFTOVER)).toBe(false);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
  });

  it("clears leaked stay-finance so reorder remount cannot yank to Topic A", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(true);

    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, REORDER_WITH_LEFTOVER);

    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: null,
      }),
    ).toBe(false);
    expect(shouldBlockSkuFocusScroll(SKU, REORDER_WITH_LEFTOVER)).toBe(true);
  });

  it("new hub reorder CTA URL unlocks scroll", () => {
    suppressSkuAutoScrollAfterBatchAction(SKU, 5000, REORDER_WITH_LEFTOVER);
    expect(consumeDeepLinkIfUnlocked(SKU, REORDER_WITH_LEFTOVER)).toBe(false);
    expect(consumeDeepLinkIfUnlocked(SKU, REORDER_NEW_CTA)).toBe(true);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
  });
});

describe("stay on finance after Topic A actions (Start selling / Save week)", () => {
  beforeEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  afterEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  it("marks and consumes one-shot restore to finance", () => {
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(true);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: null,
      }),
    ).toBe(true);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
  });

  it("Start selling alias shares the same one-shot", () => {
    markStayOnFinanceAfterStartSelling(SKU, SKU_PATH);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(true);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: null,
        attn: null,
      }),
    ).toBe(true);
  });

  it("bare hash remount still restores finance after Save week / Start selling", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: null,
        attn: null,
      }),
    ).toBe(true);
  });

  it("consume is single-shot — second call does not restore again", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: null,
      }),
    ).toBe(true);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: null,
      }),
    ).toBe(false);
  });

  it("explicit reorder/supplier deep link cancels stay-finance", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "supplier",
        attn: "reorder",
      }),
    ).toBe(false);
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
  });

  it("attn=selling / topicA still allow stay-finance", () => {
    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: "finance",
        attn: "selling",
      }),
    ).toBe(true);

    markStayOnFinanceAfterTopicAAction(SKU, SKU_PATH);
    expect(
      consumeStayOnFinanceAfterTopicAAction(SKU, {
        hashSection: null,
        attn: "topicA",
      }),
    ).toBe(true);
  });

  it("markStay is a no-op on /finance (not a SKU page)", () => {
    markStayOnFinanceAfterTopicAAction(SKU, "/en/finance");
    expect(isStayOnFinanceAfterTopicAAction(SKU)).toBe(false);
  });
});

describe("batch-arrival-eta deep-link one-shot + Generate kit stay on Marketing", () => {
  beforeEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  afterEach(() => {
    clearSkuAutoScrollSuppress();
    clearStayOnFinanceAfterTopicAAction();
  });

  it("leftover same #batch-arrival-eta locationKey blocks second scroll", () => {
    expect(consumeBatchArrivalEtaDeepLinkOnce(SKU, ETA_KEY)).toBe(true);
    markBatchArrivalEtaDeepLinkConsumed(SKU, ETA_KEY);
    expect(consumeBatchArrivalEtaDeepLinkOnce(SKU, ETA_KEY)).toBe(false);
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
  });

  it("new intentional ETA location key allows scroll once again", () => {
    markBatchArrivalEtaDeepLinkConsumed(SKU, ETA_KEY);
    expect(consumeBatchArrivalEtaDeepLinkOnce(SKU, ETA_KEY)).toBe(false);
    expect(consumeBatchArrivalEtaDeepLinkOnce(SKU, ETA_KEY_FRESH_QUERY)).toBe(
      true,
    );
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(false);
  });

  it("Generate kit / pack pick pins #marketing and blocks leftover ETA remount scroll", () => {
    const loc: { pathname: string; search: string; hash: string } = {
      pathname: `/en/sku/${SKU}`,
      search: "",
      hash: "#batch-arrival-eta",
    };
    const replaceState = vi.fn(
      (_state: unknown, _title: string, url: string) => {
        const hashIdx = url.indexOf("#");
        loc.hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
      },
    );
    vi.stubGlobal("window", {
      location: {
        get pathname() {
          return loc.pathname;
        },
        get search() {
          return loc.search;
        },
        get hash() {
          return loc.hash;
        },
      },
      history: { replaceState },
    });

    markStayOnMarketingAfterKitAction(SKU, SKU_PATH);
    expect(loc.hash).toBe("#marketing");
    expect(replaceState).toHaveBeenCalled();
    expect(isSkuAutoScrollSuppressed(SKU)).toBe(true);
    // Remount still on Marketing stay-put — do not unlock for leftover ETA key
    // after pin (lock is at #marketing). Leftover ETA consume is a different key
    // so a stale BatchArrivalEtaBlock check against ETA_KEY would unlock —
    // Generate clears hash first, so remount sees #marketing only.
    expect(consumeDeepLinkIfUnlocked(SKU, MARKETING_KEY)).toBe(false);
    expect(shouldBlockSkuFocusScroll(SKU, MARKETING_KEY)).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("isSkuPagePathname / isElementStartInView", () => {
  it("detects /sku paths including locale prefix", () => {
    expect(isSkuPagePathname(`/en/sku/${SKU}`)).toBe(true);
    expect(isSkuPagePathname("/sku")).toBe(true);
    expect(isSkuPagePathname("/en/finance")).toBe(false);
    expect(isSkuPagePathname("/en/shop")).toBe(false);
  });

  it("treats element top near viewport top as in view", () => {
    expect(isElementStartInView(0)).toBe(true);
    expect(isElementStartInView(40)).toBe(true);
    expect(isElementStartInView(-40)).toBe(true);
    expect(isElementStartInView(200)).toBe(false);
    expect(isElementStartInView(-200)).toBe(false);
  });
});
