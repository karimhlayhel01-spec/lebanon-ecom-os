import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoUngroundedMarketClaims,
  buildDeterministicWhyPick,
  canCiteMarketFromPayload,
  skillPayloadFromCandidateMeta,
} from "@/lib/discovery/explain/why-pick";
import {
  checkWhyPickRateLimit,
  clearWhyPickCacheForTests,
  getCachedWhyPick,
  recordWhyPickRateHit,
  setCachedWhyPick,
  WHY_PICK_RATE_LIMIT,
  whyPickCacheKey,
} from "@/lib/discovery/explain/cache";
import {
  isWhyPickFeatureEnabled,
  narrateWhyPickWithLlm,
  resolveExplainLlmApiKey,
} from "@/lib/discovery/explain/llm";
import { evaluateDualAcceptGate } from "@/lib/discovery/dual-gate";
import { readFileSync } from "fs";
import path from "path";

afterEach(() => {
  clearWhyPickCacheForTests();
  delete process.env.DISCOVERY_WHY_PICK;
  delete process.env.DISCOVERY_EXPLAIN_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("Why this pick? grounding", () => {
  it("Fit/margin-only when market cite disallowed — no fake US/Lebanon gap", () => {
    const result = buildDeterministicWhyPick({
      productName: "LED Wand",
      fitScore: 78,
      strength: "Strong",
      softMarginBand: "pass",
      canCiteMarketSignals: false,
      demandPath: "whitespace",
      competitionLevel: "low",
      evidenceSource: "heuristic_seed",
    });
    expect(result.marketSignalsOmitted).toBe(true);
    expect(result.body.toLowerCase()).not.toMatch(/abroad traction|lebanon gap|whitespace|us traction/);
    expect(result.body).toContain("78");
    expect(assertNoUngroundedMarketClaims(result.body, false)).toBe(true);
  });

  it("may cite whitespace only when live evidence allows", () => {
    expect(
      canCiteMarketFromPayload({
        canCiteMarketSignals: true,
        evidenceSource: "live_search",
        demandPath: "whitespace",
      }),
    ).toBe(true);

    const result = buildDeterministicWhyPick({
      productName: "Widget",
      fitScore: 70,
      strength: "Okay",
      softMarginBand: "soft_ok",
      canCiteMarketSignals: true,
      demandPath: "whitespace",
      competitionLevel: "medium",
      evidenceSource: "live_search",
    });
    expect(result.marketSignalsOmitted).toBe(false);
    expect(result.body.toLowerCase()).toContain("abroad traction");
  });

  it("skillPayloadFromCandidateMeta refuses heuristic as market cite", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "X",
      fitScore: 60,
      strength: "Okay",
      fitBreakdownJson: JSON.stringify({
        catalogKey: "x",
        wave2: {
          explain: {
            softMarginBand: "pass",
            demandPath: "whitespace",
            competitionLevel: "high",
            evidenceSource: "score_cache",
          },
        },
      }),
      scoreEvidenceSource: "heuristic_seed",
    });
    expect(payload.canCiteMarketSignals).toBe(false);
    expect(payload.evidenceSource).toBe("heuristic_seed");
  });

  it("live_search evidence enables market cite", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "Y",
      fitScore: 80,
      strength: "Strong",
      fitBreakdownJson: JSON.stringify({
        wave2: {
          explain: {
            softMarginBand: "pass",
            demandPath: "local_proven",
            competitionLevel: "low",
            evidenceSource: "score_cache",
          },
        },
      }),
      scoreEvidenceSource: "live_search",
    });
    expect(payload.canCiteMarketSignals).toBe(true);
  });
});

describe("Why this pick? does not change accept gates", () => {
  it("explain modules do not mutate dual-gate outcomes", () => {
    const before = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        lastScoreStatus: "ok",
      },
      dualEnabled: true,
    });
    buildDeterministicWhyPick({
      productName: "Z",
      fitScore: 90,
      strength: "Strong",
      softMarginBand: "pass",
      canCiteMarketSignals: false,
    });
    const after = evaluateDualAcceptGate({
      pasteConfirmed: true,
      system: {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        lastScoreStatus: "ok",
      },
      dualEnabled: true,
    });
    expect(after).toEqual(before);
    expect(after.ok).toBe(true);
  });

  it("explain service is read-only vs acceptProduct / score writers", () => {
    const root = path.join(process.cwd(), "src/lib/discovery/explain");
    for (const file of ["service.ts", "why-pick.ts", "llm.ts", "cache.ts"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).not.toContain("acceptProduct");
      expect(src).not.toContain("applySuccessfulScoreRefresh");
      expect(src).not.toContain("update(schema.productCandidates)");
    }
  });
});

describe("Why this pick? cache + rate limit + flags", () => {
  it("caches per session/candidate/locale", () => {
    const key = whyPickCacheKey("s1", "c1", "en");
    const value = buildDeterministicWhyPick({
      productName: "A",
      fitScore: 50,
      strength: "Okay",
      canCiteMarketSignals: false,
    });
    setCachedWhyPick(key, value);
    expect(getCachedWhyPick(key)?.body).toBe(value.body);
  });

  it("rate-limits spam after WHY_PICK_RATE_LIMIT hits", () => {
    for (let i = 0; i < WHY_PICK_RATE_LIMIT; i++) {
      expect(checkWhyPickRateLimit("ws").allowed).toBe(true);
      recordWhyPickRateHit("ws");
    }
    expect(checkWhyPickRateLimit("ws").allowed).toBe(false);
  });

  it("feature flag defaults off; LLM key optional", () => {
    expect(isWhyPickFeatureEnabled()).toBe(false);
    process.env.DISCOVERY_WHY_PICK = "1";
    expect(isWhyPickFeatureEnabled()).toBe(true);
    expect(resolveExplainLlmApiKey({})).toBeUndefined();
    expect(resolveExplainLlmApiKey({ OPENAI_API_KEY: "k" })).toBe("k");
  });

  it("LLM path falls back to template when ungrounded or fetch fails", async () => {
    const payload = {
      productName: "Safe",
      fitScore: 70,
      strength: "Okay" as const,
      softMarginBand: "pass" as const,
      canCiteMarketSignals: false,
      evidenceSource: "neutral" as const,
    };
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Great US traction and Lebanon gap with Ishtari competition.",
              },
            },
          ],
        }),
        { status: 200 },
      );
    const result = await narrateWhyPickWithLlm(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(result.source).toBe("template");
    expect(assertNoUngroundedMarketClaims(result.body, false)).toBe(true);
  });
});
