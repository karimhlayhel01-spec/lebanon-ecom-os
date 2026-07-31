/**
 * Sample-card actions (mark received / decide) must never auto-scroll the SKU
 * page (especially to #finance). Durable lock survives remount/revalidate.
 *
 * Clear ONLY on intentional deep-link navigation to a *different* URL key
 * (hub Next / new ?attn= / #section) — never because revalidate remounted with
 * the same leftover ?attn=#finance.
 */

const STORAGE_PREFIX = "lebanon-ecom:sku-cold-hold:";
const STORAGE_URL_PREFIX = "lebanon-ecom:sku-cold-hold-url:";

/** Sync hold (survives client remounts in the same JS realm). */
const heldSkuIds = new Set<string>();

/** Location key (path+search+hash) when the lock was set — remounts match this. */
const lockLocationBySku = new Map<string, string>();

/** Short belt-and-suspenders window (not the primary guard). */
let suppressedUntil = 0;

function storageKey(skuId: string): string {
  return `${STORAGE_PREFIX}${skuId}`;
}

function storageUrlKey(skuId: string): string {
  return `${STORAGE_URL_PREFIX}${skuId}`;
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

/** Clear lock — only after intentional new deep-link (caller decides). */
export function clearSkuAutoScrollSuppress(skuId?: string): void {
  if (skuId) {
    dropHold(skuId);
  } else {
    for (const id of [...heldSkuIds]) dropHold(id);
    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (
          k?.startsWith(STORAGE_PREFIX) ||
          k?.startsWith(STORAGE_URL_PREFIX)
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
