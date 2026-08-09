/**
 * In-memory Assess listing cache (supplierId + url + content hash + locale).
 */

import type { AssessListingSuccess } from "@/lib/supplier/diligence/types";

const MAX_ENTRIES = 80;

type Entry = {
  key: string;
  value: AssessListingSuccess;
  at: number;
};

const store = new Map<string, Entry>();

/** Cheap stable hash for scrape text (not crypto). */
export function hashDiligenceContent(text: string): string {
  let h = 2166136261;
  const sample =
    text.length <= 4000
      ? text
      : `${text.slice(0, 2000)}:${text.length}:${text.slice(-2000)}`;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function diligenceCacheKey(input: {
  supplierId: string;
  sourceUrl: string;
  contentHash: string;
  locale: string;
}): string {
  return [
    input.supplierId,
    input.sourceUrl.trim().toLowerCase(),
    input.contentHash,
    input.locale,
  ].join("|");
}

export function getDiligenceCache(
  key: string,
): AssessListingSuccess | undefined {
  const e = store.get(key);
  return e?.value;
}

export function setDiligenceCache(
  key: string,
  value: AssessListingSuccess,
): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.values()].sort((a, b) => a.at - b.at)[0];
    if (oldest) store.delete(oldest.key);
  }
  store.set(key, { key, value, at: Date.now() });
}

/** Test helper. */
export function clearDiligenceCache(): void {
  store.clear();
}
