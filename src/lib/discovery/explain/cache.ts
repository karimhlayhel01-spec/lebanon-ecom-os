/**
 * In-memory cache + rate-limit for §6.1 Why / §6.2 Compare (per process).
 * Cache keys never mutate scores/gates.
 */

import type { CompareExplainResult } from "@/lib/discovery/explain/compare";
import type { WhyPickResult } from "@/lib/discovery/explain/why-pick";

const cache = new Map<string, WhyPickResult>();
const compareCache = new Map<string, CompareExplainResult>();
const hits: { workspaceId: string; at: number }[] = [];

/** Bump to invalidate in-memory explain paragraphs after copy/voice changes. */
export const WHY_PICK_CACHE_VERSION = "v8-single-reason-retry";
/** Bump when compare brief shape / voice changes. */
export const COMPARE_CACHE_VERSION = "v1-worth-considering-compare";

/** Max explains (Why + Compare) per workspace inside the sliding window. */
export const WHY_PICK_RATE_LIMIT = 12;
/** Sliding window ms. */
export const WHY_PICK_RATE_WINDOW_MS = 5 * 60 * 1000;

export function whyPickCacheKey(
  sessionId: string,
  candidateId: string,
  locale: string,
): string {
  return `${WHY_PICK_CACHE_VERSION}:${sessionId}:${candidateId}:${locale}`;
}

export function compareCacheKey(
  sessionId: string,
  candidateIds: readonly string[],
  locale: string,
): string {
  const sorted = [...candidateIds].sort().join(",");
  return `${COMPARE_CACHE_VERSION}:${sessionId}:${sorted}:${locale}`;
}

export function getCachedWhyPick(key: string): WhyPickResult | undefined {
  return cache.get(key);
}

export function setCachedWhyPick(key: string, value: WhyPickResult): void {
  cache.set(key, value);
}

export function deleteCachedWhyPick(key: string): void {
  cache.delete(key);
}

export function getCachedCompare(
  key: string,
): CompareExplainResult | undefined {
  return compareCache.get(key);
}

export function setCachedCompare(
  key: string,
  value: CompareExplainResult,
): void {
  compareCache.set(key, value);
}

export function deleteCachedCompare(key: string): void {
  compareCache.delete(key);
}

export function clearWhyPickCacheForTests(): void {
  cache.clear();
  compareCache.clear();
  hits.length = 0;
}

export type RateLimitResult = { allowed: boolean; retryAfterMs?: number };

export function checkWhyPickRateLimit(
  workspaceId: string,
  now = Date.now(),
): RateLimitResult {
  const cutoff = now - WHY_PICK_RATE_WINDOW_MS;
  while (hits.length > 0 && hits[0].at < cutoff) hits.shift();

  const recent = hits.filter((h) => h.workspaceId === workspaceId);
  if (recent.length >= WHY_PICK_RATE_LIMIT) {
    const oldest = recent[0].at;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, oldest + WHY_PICK_RATE_WINDOW_MS - now),
    };
  }
  return { allowed: true };
}

export function recordWhyPickRateHit(
  workspaceId: string,
  now = Date.now(),
): void {
  hits.push({ workspaceId, at: now });
}
