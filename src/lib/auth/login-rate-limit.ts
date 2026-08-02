/**
 * Login attempt throttle (in-memory, per Node process).
 *
 * Limits (defaults):
 * - Window: 15 minutes
 * - Max failed attempts: 10 per email key AND 10 per client IP key
 * - Only failed logins increment; success clears both keys
 * - Not shared across serverless instances / restarts (best-effort)
 *
 * Keys: `email:<normalized>` and `ip:<address|unknown>`
 */

export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
} as const;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Test / process reset — not for production call sites. */
export function resetLoginRateLimitStoreForTests(): void {
  buckets.clear();
}

export function loginRateLimitKey(
  kind: "email" | "ip",
  value: string,
): string {
  return `${kind}:${value}`;
}

export type LoginRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

export function checkLoginRateLimit(key: string): LoginRateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    return { ok: true };
  }
  if (bucket.count >= LOGIN_RATE_LIMIT.maxAttempts) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true };
}

/** Record a failed login against a key (opens/refreshes the window). */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + LOGIN_RATE_LIMIT.windowMs,
    });
    return;
  }
  bucket.count += 1;
}

export function clearLoginRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * True when either email or IP is over the failed-attempt budget.
 * Call before credential work; on failure call recordLoginFailures.
 */
export function isLoginRateLimited(args: {
  emailKey: string;
  ipKey: string;
}): boolean {
  return (
    !checkLoginRateLimit(args.emailKey).ok ||
    !checkLoginRateLimit(args.ipKey).ok
  );
}

export function recordLoginFailures(args: {
  emailKey: string;
  ipKey: string;
}): void {
  recordLoginFailure(args.emailKey);
  recordLoginFailure(args.ipKey);
}

export function clearLoginRateLimits(args: {
  emailKey: string;
  ipKey: string;
}): void {
  clearLoginRateLimit(args.emailKey);
  clearLoginRateLimit(args.ipKey);
}
