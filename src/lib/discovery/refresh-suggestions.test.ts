import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  vi.restoreAllMocks();
});

describe("refreshDiscoverySuggestions", () => {
  it("returns pool_v2_off when DISCOVERY_POOL_V2 is off", async () => {
    process.env.DISCOVERY_POOL_V2 = "0";
    const { refreshDiscoverySuggestions } = await import(
      "@/lib/discovery/service"
    );
    const result = await refreshDiscoverySuggestions("ws-any", {
      workspaceId: "ws-any",
    } as never);
    expect(result).toEqual({ ok: false, error: "pool_v2_off" });
  });

  it("documents resync rules: close session, exclude seen, empty accept-ready opens empty session", async () => {
    // Source contract — keep in sync with WAVE-2 §10.3 / README Session resync.
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(
      join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    const refreshFn = src.slice(
      src.indexOf("export async function refreshDiscoverySuggestions"),
      src.indexOf("async function closeAndOpenScoredSession"),
    );
    expect(refreshFn).toContain("isDiscoveryPoolV2Enabled");
    expect(refreshFn).toContain('error: "pool_v2_off"');
    expect(refreshFn).toContain("closeAndOpenScoredSession");
    // Must not call exhaustion counter (unlike continue).
    expect(refreshFn).not.toContain("maybeCountExhaustion");

    const shared = src.slice(
      src.indexOf("async function closeAndOpenScoredSession"),
      src.indexOf("export async function submitDiscoveryPassFeedback"),
    );
    expect(shared).toContain("getSeenCatalogKeys");
    expect(shared).toContain("scoreRankForDiscovery");
    expect(shared).toContain('status: "closed"');
    expect(shared).toContain("insertSessionPool");
    // Empty accept-ready still opens a session (Edit onboarding) — no early catalog_exhausted.
    expect(shared).not.toMatch(
      /if \(scored\.length === 0\) return \{ ok: false, error: "catalog_exhausted" \}/,
    );
  });
});
