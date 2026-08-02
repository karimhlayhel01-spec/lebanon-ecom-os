import { describe, expect, it, beforeEach } from "vitest";
import {
  LOGIN_RATE_LIMIT,
  checkLoginRateLimit,
  clearLoginRateLimits,
  isLoginRateLimited,
  loginRateLimitKey,
  recordLoginFailure,
  recordLoginFailures,
  resetLoginRateLimitStoreForTests,
} from "@/lib/auth/login-rate-limit";

describe("login rate limit", () => {
  beforeEach(() => {
    resetLoginRateLimitStoreForTests();
  });

  it("allows under the failed-attempt budget", () => {
    const key = loginRateLimitKey("email", "a@b.com");
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxAttempts - 1; i++) {
      recordLoginFailure(key);
    }
    expect(checkLoginRateLimit(key).ok).toBe(true);
  });

  it("blocks after max failed attempts in the window", () => {
    const key = loginRateLimitKey("email", "a@b.com");
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxAttempts; i++) {
      recordLoginFailure(key);
    }
    const result = checkLoginRateLimit(key);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("blocks when either email or IP is exhausted", () => {
    const emailKey = loginRateLimitKey("email", "a@b.com");
    const ipKey = loginRateLimitKey("ip", "1.2.3.4");
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxAttempts; i++) {
      recordLoginFailure(emailKey);
    }
    expect(isLoginRateLimited({ emailKey, ipKey })).toBe(true);
  });

  it("clears both keys after success path", () => {
    const emailKey = loginRateLimitKey("email", "a@b.com");
    const ipKey = loginRateLimitKey("ip", "1.2.3.4");
    recordLoginFailures({ emailKey, ipKey });
    clearLoginRateLimits({ emailKey, ipKey });
    expect(isLoginRateLimited({ emailKey, ipKey })).toBe(false);
  });

  it("documents the default window and max", () => {
    expect(LOGIN_RATE_LIMIT.maxAttempts).toBe(10);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });
});
