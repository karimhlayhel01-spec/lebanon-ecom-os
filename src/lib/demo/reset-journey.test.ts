import { describe, expect, it, afterEach, vi } from "vitest";
import { DEMO_JOURNEY_RESET_DELETE_ORDER as CANONICAL_RESET_ORDER } from "@/lib/account/cascade-order";
import { isDemoResetEnabled } from "@/lib/demo/config";
import { DEMO_JOURNEY_RESET_DELETE_ORDER } from "@/lib/demo/reset-journey";

describe("DEMO_JOURNEY_RESET_DELETE_ORDER re-export", () => {
  it("points at the shared cascade module", () => {
    expect(DEMO_JOURNEY_RESET_DELETE_ORDER).toBe(CANONICAL_RESET_ORDER);
  });
});

describe("isDemoResetEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default", () => {
    vi.stubEnv("DEMO_RESET", undefined);
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", undefined);
    expect(isDemoResetEnabled()).toBe(false);
  });

  it("accepts 1 or true outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_RESET", "1");
    expect(isDemoResetEnabled()).toBe(true);
    vi.stubEnv("DEMO_RESET", "true");
    expect(isDemoResetEnabled()).toBe(true);
  });

  it("rejects other DEMO_RESET values", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_RESET", "0");
    expect(isDemoResetEnabled()).toBe(false);
    vi.stubEnv("DEMO_RESET", "yes");
    expect(isDemoResetEnabled()).toBe(false);
  });

  it("blocks production even when DEMO_RESET=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_RESET", "1");
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", undefined);
    expect(isDemoResetEnabled()).toBe(false);
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", "0");
    expect(isDemoResetEnabled()).toBe(false);
  });

  it("allows production only with explicit DEMO_RESET_ALLOW_PRODUCTION", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_RESET", "1");
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", "1");
    expect(isDemoResetEnabled()).toBe(true);
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", "true");
    expect(isDemoResetEnabled()).toBe(true);
  });

  it("production allow flag alone is not enough without DEMO_RESET", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_RESET", undefined);
    vi.stubEnv("DEMO_RESET_ALLOW_PRODUCTION", "1");
    expect(isDemoResetEnabled()).toBe(false);
  });
});
