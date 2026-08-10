/**
 * Sample-card actions (mark received / decide), first-batch actions
 * (Mark ordered / Mark arrived), and next-batch reorder actions must never
 * auto-scroll the SKU page (especially to #finance). Durable lock survives
 * remount/revalidate.
 *
 * Clear ONLY on intentional deep-link navigation to a *different* URL key
 * (hub Next / new ?attn= / #section) — never because revalidate remounted with
 * the same leftover ?attn=#finance.
 *
 * Topic A writes (Start selling / Save week) on /sku/[id] only: pin #finance +
 * stay-finance flag so remount restores Finance once (prefer #finance-actual)
 * instead of jumping to Supplier / sample / Order next batch.
 * Batch/reorder actions must clear that stay-finance flag so it cannot leak.
 * Dedicated /finance never sets stay-finance (already on Finance).
 *
 * Marketing Generate/Save kit on /sku/[id]: pin #marketing + suppress so a
 * leftover #batch-arrival-eta (Set ETA CTA) cannot re-scroll on revalidate.
 */

const STORAGE_PREFIX = "lebanon-ecom:sku-cold-hold:";
const STORAGE_URL_PREFIX = "lebanon-ecom:sku-cold-hold-url:";
const STAY_FINANCE_PREFIX = "lebanon-ecom:sku-stay-finance:";

/** Sync hold (survives client remounts in the same JS realm). */
const heldSkuIds = new Set<string>();

/** Location key (path+search+hash) when the lock was set — remounts match this. */
const lockLocationBySku = new Map<string, string>();

/** One-shot: restore Finance after Topic A action remount (sell / log week). */
const stayFinanceSkuIds = new Set<string>();

/** Short belt-and-suspenders window (not the primary guard). */
let suppressedUntil = 0;

function storageKey(skuId: string): string {
  return `${STORAGE_PREFIX}${skuId}`;
}

function storageUrlKey(skuId: string): string {
  return `${STORAGE_URL_PREFIX}${skuId}`;
}

function stayFinanceKey(skuId: string): string {
  return `${STAY_FINANCE_PREFIX}${skuId}`;
}

/** Full URL key used to detect remount-with-same-deep-link vs new hub Next. */
export function skuFocusLocationKey(
  pathname?: string,
  search?: string,
  hash?: string,
): string {
  if (typeof window === "undefined") {
    return `${pathname ?? ""}${search ?? ""}${hash ?? ""}`;
  }
  return `${pathname ?? window.location.pathname}${search ?? window.location.search}${hash ?? window.location.hash}`;
}

/** True on /sku or /sku/[id] paths (locale prefix OK). Not /finance. */
export function isSkuPagePathname(pathname?: string | null): boolean {
  const p =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "");
  return /\/sku(\/|$)/.test(p);
}

/**
 * True when the element's top edge is near the viewport top (already landed).
 * Pure — pass getBoundingClientRect().top for DOM checks.
 */
export function isElementStartInView(
  elementTop: number,
  tolerancePx = 96,
): boolean {
  return elementTop >= -tolerancePx && elementTop <= tolerancePx;
}

function topicAFinanceAnchorEl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.getElementById("finance-actual") ??
    document.getElementById("finance")
  );
}

export function isTopicAFinanceAnchorInView(tolerancePx = 96): boolean {
  const el = topicAFinanceAnchorEl();
  if (!el) return false;
  return isElementStartInView(el.getBoundingClientRect().top, tolerancePx);
}

function persistHold(skuId: string, locationKey: string): void {
  heldSkuIds.add(skuId);
  lockLocationBySku.set(skuId, locationKey);
  try {
    sessionStorage.setItem(storageKey(skuId), "1");
    sessionStorage.setItem(storageUrlKey(skuId), locationKey);
  } catch {
    /* private mode / SSR */
  }
}

function dropHold(skuId: string): void {
  heldSkuIds.delete(skuId);
  lockLocationBySku.delete(skuId);
  try {
    sessionStorage.removeItem(storageKey(skuId));
    sessionStorage.removeItem(storageUrlKey(skuId));
  } catch {
    /* ignore */
  }
}

function dropStayFinance(skuId: string): void {
  stayFinanceSkuIds.delete(skuId);
  try {
    sessionStorage.removeItem(stayFinanceKey(skuId));
  } catch {
    /* ignore */
  }
}

/**
 * Call before Start selling or Save week from Finance on the SKU page only.
 * No-op on /finance (already on Topic A — avoid remount scroll cascade).
 * Pass `pathname` from the router when available; otherwise reads window.
 * Pins #finance and sets a one-shot remount restore so Supplier/reorder
 * does not steal scroll after revalidate.
 */
export function markStayOnFinanceAfterTopicAAction(
  skuId: string,
  pathname?: string | null,
): void {
  if (!isSkuPagePathname(pathname)) return;
  stayFinanceSkuIds.add(skuId);
  try {
    sessionStorage.setItem(stayFinanceKey(skuId), "1");
  } catch {
    /* private mode / SSR */
  }
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}`;
  if (window.location.hash !== "#finance") {
    window.history.replaceState(null, "", `${path}#finance`);
  }
}

/** @deprecated Use markStayOnFinanceAfterTopicAAction */
export const markStayOnFinanceAfterStartSelling =
  markStayOnFinanceAfterTopicAAction;

/**
 * Call BEFORE Generate / Regenerate kit or Save creatives on the SKU page.
 * Pins #marketing and locks auto-scroll at that URL so remount/revalidate
 * cannot jump to leftover #batch-arrival-eta (Marketing “Set ETA” CTA).
 * No-op off /sku paths. Prefer stay-put — do not force-scroll Marketing.
 */
export function markStayOnMarketingAfterKitAction(
  skuId: string,
  pathname?: string | null,
): void {
  if (!isSkuPagePathname(pathname)) return;
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}`;
  if (window.location.hash !== "#marketing") {
    window.history.replaceState(null, "", `${path}#marketing`);
  }
  suppressSkuAutoScroll(skuId, 5000, skuFocusLocationKey());
}

/**
 * After an intentional #batch-arrival-eta scroll (CTA or fresh deep-link):
 * lock that locationKey so remount/revalidate with the same leftover hash
 * does not re-scroll. New location keys still unlock via consumeDeepLinkIfUnlocked.
 */
export function markBatchArrivalEtaDeepLinkConsumed(
  skuId: string,
  locationKey?: string,
): void {
  suppressSkuAutoScroll(skuId, 5000, locationKey ?? skuFocusLocationKey());
}

/**
 * Allow one scroll to #batch-arrival-eta; remount with the same locationKey
 * returns false. Call markBatchArrivalEtaDeepLinkConsumed after scrolling.
 */
export function consumeBatchArrivalEtaDeepLinkOnce(
  skuId: string,
  locationKey: string,
): boolean {
  return consumeDeepLinkIfUnlocked(skuId, locationKey);
}

export function isStayOnFinanceAfterTopicAAction(skuId: string): boolean {
  if (stayFinanceSkuIds.has(skuId)) return true;
  try {
    if (sessionStorage.getItem(stayFinanceKey(skuId)) === "1") {
      stayFinanceSkuIds.add(skuId);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** @deprecated Use isStayOnFinanceAfterTopicAAction */
export const isStayOnFinanceAfterStartSelling =
  isStayOnFinanceAfterTopicAAction;

/** Clear one-shot (after restore, or when an intentional other deep-link wins). */
export function clearStayOnFinanceAfterTopicAAction(skuId?: string): void {
  if (skuId) {
    dropStayFinance(skuId);
    return;
  }
  for (const id of [...stayFinanceSkuIds]) dropStayFinance(id);
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STAY_FINANCE_PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** @deprecated Use clearStayOnFinanceAfterTopicAAction */
export const clearStayOnFinanceAfterStartSelling =
  clearStayOnFinanceAfterTopicAAction;

/**
 * Prefer margin-after-ads strip inside Finance; fall back to #finance section.
 */
export function scrollToTopicAFinanceAnchor(
  behavior: ScrollBehavior = "smooth",
): void {
  const el = topicAFinanceAnchorEl();
  el?.scrollIntoView({ behavior, block: "start" });
}

/**
 * One calm scroll to Topic A only when the anchor is not already in view.
 * Returns true if a scroll was started.
 */
export function scrollToTopicAFinanceAnchorIfNeeded(
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (isTopicAFinanceAnchorInView()) return false;
  scrollToTopicAFinanceAnchor(behavior);
  return true;
}

/**
 * If a Topic A action asked to stay on Finance, consume the flag and report
 * true unless the URL already targets another section (explicit reorder CTA).
 */
export function consumeStayOnFinanceAfterTopicAAction(
  skuId: string,
  opts?: { hashSection?: string | null; attn?: string | null },
): boolean {
  if (!isStayOnFinanceAfterTopicAAction(skuId)) return false;
  const hash = opts?.hashSection ?? null;
  const attn = opts?.attn ?? null;
  // Explicit other-section deep links win (hub ?attn=reorder#supplier, etc.).
  if (hash && hash !== "finance") {
    dropStayFinance(skuId);
    return false;
  }
  if (attn && attn !== "selling" && attn !== "topicA") {
    dropStayFinance(skuId);
    return false;
  }
  dropStayFinance(skuId);
  return true;
}

/** @deprecated Use consumeStayOnFinanceAfterTopicAAction */
export const consumeStayOnFinanceAfterStartSelling =
  consumeStayOnFinanceAfterTopicAAction;

function readPersistedHold(skuId: string): boolean {
  try {
    return sessionStorage.getItem(storageKey(skuId)) === "1";
  } catch {
    return false;
  }
}

function readPersistedLockUrl(skuId: string): string | null {
  try {
    return sessionStorage.getItem(storageUrlKey(skuId));
  } catch {
    return null;
  }
}

function lockLocationFor(skuId: string): string | null {
  const mem = lockLocationBySku.get(skuId);
  if (mem) return mem;
  const stored = readPersistedLockUrl(skuId);
  if (stored) {
    lockLocationBySku.set(skuId, stored);
    return stored;
  }
  return null;
}

/**
 * Call BEFORE mark received / save checklist / approve / replace / reject.
 * Durable hold for this skuId at the current URL (+ optional short timer).
 */
export function suppressSkuAutoScroll(
  skuId: string,
  ms = 5000,
  locationKey?: string,
): void {
  const key = locationKey ?? skuFocusLocationKey();
  persistHold(skuId, key);
  suppressedUntil = Math.max(suppressedUntil, Date.now() + ms);
}

/**
 * Call BEFORE Mark batch ordered / Mark batch arrived / next-batch order /
 * Mark reorder arrived on Supplier.
 * Same remount stay-put as sample cards, and clears stay-finance so a prior
 * Start selling / Save week cannot pull scroll to Topic A after revalidate.
 */
export function suppressSkuAutoScrollAfterBatchAction(
  skuId: string,
  ms = 5000,
  locationKey?: string,
): void {
  clearStayOnFinanceAfterTopicAAction(skuId);
  suppressSkuAutoScroll(skuId, ms, locationKey);
}

/** Clear lock — only after intentional new deep-link (caller decides). */
export function clearSkuAutoScrollSuppress(skuId?: string): void {
  if (skuId) {
    dropHold(skuId);
    dropStayFinance(skuId);
  } else {
    for (const id of [...heldSkuIds]) dropHold(id);
    for (const id of [...stayFinanceSkuIds]) dropStayFinance(id);
    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (
          k?.startsWith(STORAGE_PREFIX) ||
          k?.startsWith(STORAGE_URL_PREFIX) ||
          k?.startsWith(STAY_FINANCE_PREFIX)
        ) {
          keys.push(k);
        }
      }
      for (const k of keys) sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  suppressedUntil = 0;
}

export function isSkuAutoScrollSuppressed(skuId: string): boolean {
  if (heldSkuIds.has(skuId)) return true;
  if (readPersistedHold(skuId)) {
    heldSkuIds.add(skuId);
    return true;
  }
  return Date.now() < suppressedUntil;
}

/**
 * While locked: block ALL SkuSectionFocus auto-scroll if the URL is unchanged
 * (sample revalidate remount with leftover ?attn=#finance).
 * Unlock + allow scroll only when the location key changes (new hub Next).
 */
export function shouldBlockSkuFocusScroll(
  skuId: string,
  locationKey: string,
): boolean {
  if (!isSkuAutoScrollSuppressed(skuId)) return false;
  const lockedAt = lockLocationFor(skuId);
  // No stored URL (legacy) → block while held (safer than scrolling to Topic A).
  if (lockedAt == null) return true;
  return lockedAt === locationKey;
}

/**
 * Intentional deep-link to a *new* URL while locked → clear lock and allow scroll.
 * Same URL remount → keep lock, block scroll.
 */
export function consumeDeepLinkIfUnlocked(
  skuId: string,
  locationKey: string,
): boolean {
  if (!isSkuAutoScrollSuppressed(skuId)) {
    return true; // not locked — deep-link scroll OK
  }
  if (shouldBlockSkuFocusScroll(skuId, locationKey)) {
    return false; // remount with same URL — stay put
  }
  // New deep-link URL while locked — clear and allow
  clearSkuAutoScrollSuppress(skuId);
  return true;
}
