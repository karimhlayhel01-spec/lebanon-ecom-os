/**
 * In-memory cache + rate-limit for §6.1 Why this pick? (per process).
 * Cache key: sessionId + candidateId. Never mutates scores/gates.
 */

import type { WhyPickResult } from "@/lib/discovery/explain/why-pick";

const cache = new Map<string, WhyPickResult>();
const hits: { workspaceId: string; at: number }[] = [];

/** Max explains per workspace inside the sliding window. */
export const WHY_PICK_RATE_LIMIT = 12;
/** Sliding window ms. */
export const WHY_PICK_RATE_WINDOW_MS = 5 * 60 * 1000;

export function whyPickCacheKey(
  sessionId: string,
  candidateId: string,
  locale: string,
): string {
  return `${sessionId}:${candidateId}:${locale}`;
}

export function getCachedWhyPick(key: string): WhyPickResult | undefined {
  return cache.get(key);
}

export function setCachedWhyPick(key: string, value: WhyPickResult): void {
  cache.set(key, value);
}

export function clearWhyPickCacheForTests(): void {
  cache.clear();
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
