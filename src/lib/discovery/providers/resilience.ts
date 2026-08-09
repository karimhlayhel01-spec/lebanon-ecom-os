/**
 * Wave 2 §7 — shared outbound-search resilience for Discovery providers.
 * Every outbound request gets a timeout and a bounded retry, so one hung or
 * rate-limited vendor call can never stall a scheduled run. Persistent failure
 * is surfaced to the caller, which preserves last-known scores.
 *
 * Pure helpers here so backoff / Retry-After behaviour is unit-testable.
 */

import {
  DISCOVERY_SEARCH_MAX_ATTEMPTS,
  DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";
import type { SearchProviderResponse } from "@/lib/discovery/search-provider";

/** First retry waits this long; each further retry doubles it. */
export const SEARCH_BACKOFF_BASE_MS = 500;
/** Ceiling so a large Retry-After cannot park a cron for minutes. */
export const SEARCH_BACKOFF_MAX_MS = 8_000;

export type SearchResilienceOptions = {
  /** Per-request timeout (default DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Total attempts including the first (default DISCOVERY_SEARCH_MAX_ATTEMPTS). */
  maxAttempts?: number;
  /** Inject in tests so backoff does not really sleep. */
  sleepFn?: (ms: number) => Promise<void>;
};

export type SearchAttemptOutcome =
  | { kind: "ok"; response: SearchProviderResponse }
  | { kind: "retry"; error: string; retryAfterMs?: number | null }
  | { kind: "fatal"; error: string };

/** Transient by contract: rate limit or a server-side fault. */
export function isRetriableSearchStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * `Retry-After` as milliseconds. Accepts delta-seconds and HTTP-date; anything
 * unparseable returns null so the caller uses plain backoff.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const raw = header?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds <= 0 ? 0 : Math.round(seconds * 1000);
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Capped exponential backoff, honouring Retry-After when the vendor sent one.
 * `attempt` is 1-based (the delay after the first failure).
 */
export function backoffDelayMs(
  attempt: number,
  retryAfterMs?: number | null,
): number {
  if (retryAfterMs != null && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, SEARCH_BACKOFF_MAX_MS);
  }
  const exponential = SEARCH_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, SEARCH_BACKOFF_MAX_MS);
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one provider call with a timeout and bounded retries.
 * Throws on persistent failure — job callers turn that into a per-product
 * failure so last-known scores survive.
 */
export async function runBoundedSearchAttempts(input: {
  /** Provider name for error copy, e.g. "SerpAPI". */
  label: string;
  attempt: (signal: AbortSignal) => Promise<SearchAttemptOutcome>;
  opts?: SearchResilienceOptions;
}): Promise<SearchProviderResponse> {
  const timeoutMs = input.opts?.timeoutMs ?? DISCOVERY_SEARCH_REQUEST_TIMEOUT_MS;
  const maxAttempts = Math.max(
    1,
    input.opts?.maxAttempts ?? DISCOVERY_SEARCH_MAX_ATTEMPTS,
  );
  const sleepFn = input.opts?.sleepFn ?? defaultSleep;

  let lastError = `${input.label} request failed`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let outcome: SearchAttemptOutcome;
    try {
      outcome = await input.attempt(controller.signal);
    } catch (err) {
      outcome = isAbortError(err)
        ? {
            kind: "retry",
            error: `${input.label} request timed out after ${timeoutMs}ms`,
          }
        : {
            kind: "fatal",
            error: `${input.label}: ${err instanceof Error ? err.message : String(err)}`,
          };
    } finally {
      clearTimeout(timer);
    }

    if (outcome.kind === "ok") return outcome.response;
    if (outcome.kind === "fatal") throw new Error(outcome.error);

    lastError = outcome.error;
    if (attempt < maxAttempts) {
      await sleepFn(backoffDelayMs(attempt, outcome.retryAfterMs));
    }
  }

  throw new Error(`${lastError} (after ${maxAttempts} attempts)`);
}
