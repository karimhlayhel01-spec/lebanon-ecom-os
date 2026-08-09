/**
 * WAVE-2 §6.2 compare integrity — Gemini narrates the skills winner, and a
 * brief is only ever shown for the exact selection it was generated from.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  COMPARE_CACHE_VERSION,
  clearWhyPickCacheForTests,
} from "@/lib/discovery/explain/cache";
import {
  assertCompareAdviceAligned,
  buildCompareExplainPayload,
  COMPARE_ADVISED_NAME_MAX_MENTIONS,
  promotesProductAsAdvised,
  type CompareProductPayload,
} from "@/lib/discovery/explain/compare";
import { narrateCompareWithGemini } from "@/lib/discovery/explain/compare-llm";
import { pickCompareWinner } from "@/lib/discovery/compare/pick";
import {
  applyCompareResponse,
  beginCompareRequest,
  clearCompareBrief,
  closeCompareBrief,
  compareBriefError,
  compareBriefIsCurrent,
  compareBriefNeedsFetch,
  compareSelectionFingerprint,
  EMPTY_COMPARE_BRIEF,
  type CompareBriefState,
} from "@/lib/discovery/compare/brief-state";

afterEach(() => {
  clearWhyPickCacheForTests();
});

function estimateProduct(
  partial: Partial<CompareProductPayload> &
    Pick<CompareProductPayload, "candidateId" | "productName" | "catalogKey">,
): CompareProductPayload {
  return {
    fitScore: 90,
    strength: "Strong",
    softMarginBand: "pass",
    marginBefore: 0.72,
    marginAfter: 0.38,
    canCiteMarketSignals: false,
    evidenceSource: "heuristic_seed",
    curatedDifferentiation: "Bundle with a heat-safe stand.",
    marketEvidence: null,
    ...partial,
  };
}

const widget = estimateProduct({
  candidateId: "w",
  catalogKey: "widget",
  productName: "Widget",
  fitScore: 95,
});
const gadget = estimateProduct({
  candidateId: "g",
  catalogKey: "gadget",
  productName: "Gadget",
  fitScore: 80,
});

/** Skills advise Widget; Gadget is the rival that must never be promoted. */
const payload = buildCompareExplainPayload({
  advisedCandidateId: "w",
  products: [widget, gadget],
});

const LEGIT_BRIEF =
  "Among these marks, skills advise starting with Widget because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100. " +
  "Widget's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than proven demand. " +
  "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
  "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
  "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";

/** Reads as a comparison, but nominates the rival as the test to run. */
const RIVAL_BRIEF =
  "Compared with Widget, Gadget is the stronger choice to sample first because its operational demands look lighter on this budget. " +
  "Widget still clears the same hard planning margins near 72 percent before ads and 38 percent after, so economics are not the separator between these two marks. " +
  "Both market reads remain estimates because no citable live evidence is saved yet, so neither opportunity is proven. " +
  "Lean on the curated heat-safe stand angle and keep the first ads budget controlled whichever product you order. " +
  "The real uncertainty is paid demand rather than your ability to operate either product day to day. " +
  "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";

function geminiReturning(text: string): {
  fetchFn: typeof fetch;
  calls: () => number;
} {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
      }),
      { status: 200 },
    );
  };
  return { fetchFn, calls: () => calls };
}

describe("rival-promoting prose is a rejected body", () => {
  it("rejects advice language attached to a product the skills did not advise", () => {
    // The exact bug: the advised name merely co-occurs with "compared", while
    // the sentence nominates the rival.
    for (const body of [
      "Compared to Widget, Gadget is the one to start with among these marks.",
      "Between Widget and Gadget, test Gadget first with a small sample.",
      "Among these marks, Gadget is the stronger choice while Widget trails it.",
      "Compared with Widget, skills advise Gadget for the first sample order.",
      "Widget is listed among your marks, but start with Gadget instead.",
    ]) {
      expect(assertCompareAdviceAligned(body, payload), body).toBe(false);
    }
  });

  it("rejects the Arabic equivalents", () => {
    for (const body of [
      "مقارنةً بـWidget، فإن Gadget هو الأقوى بين وسومك.",
      "بين Widget و Gadget، اختبر Gadget أولاً بعيّنة صغيرة.",
      "ننصح بـGadget بين هذه الوسوم، أما Widget فهو أضعف.",
      "ابدأ بـGadget ثم انظر في Widget لاحقاً.",
    ]) {
      expect(assertCompareAdviceAligned(body, payload), body).toBe(false);
    }
  });

  it("rejects a rival promotion even when the advised name is also promoted", () => {
    const body =
      "Skills advise starting with Widget among these marks. However, Gadget is the better choice to test first.";
    expect(assertCompareAdviceAligned(body, payload)).toBe(false);
  });

  it("requires the advice to attach to the advised name, not merely co-occur", () => {
    // Mentions Widget and reads like a comparison, but nominates nothing.
    const body =
      "Among these marks, Widget and Gadget both clear the hard planning margins and both market reads are estimates.";
    expect(assertCompareAdviceAligned(body, payload)).toBe(false);
  });
});

describe("legitimate advised phrasing still passes", () => {
  it("accepts the shipped brief shapes", () => {
    expect(assertCompareAdviceAligned(LEGIT_BRIEF, payload)).toBe(true);
  });

  it("accepts advice that names the rival as a contrast", () => {
    for (const body of [
      "Skills advise Widget over Gadget for the first sample order.",
      "Skills advise starting a sample test on Widget rather than Gadget.",
      "Start with Widget instead of Gadget and keep the ads budget modest.",
      "Test Widget first, then revisit Gadget if the sample sells through.",
      "Widget is the stronger choice here, while Gadget stays a later option.",
      "ننصح بالبدء بـWidget لأن ملاءمته أعلى من Gadget.",
      "اختبر Widget أولاً بعيّنة صغيرة قبل النظر في Gadget.",
    ]) {
      expect(assertCompareAdviceAligned(body, payload), body).toBe(true);
    }
  });

  it("reads a neutral mention of the rival as a comparison, not a promotion", () => {
    const allNames = ["Widget", "Gadget"];
    expect(promotesProductAsAdvised(LEGIT_BRIEF, "Widget", allNames)).toBe(true);
    expect(promotesProductAsAdvised(LEGIT_BRIEF, "Gadget", allNames)).toBe(
      false,
    );
    // "advise Widget over Gadget" nominates Widget only.
    const contrast = "Skills advise Widget over Gadget for the first test.";
    expect(promotesProductAsAdvised(contrast, "Gadget", allNames)).toBe(false);
  });

  it("does not treat contrast 'is better for' as a promotion", () => {
    const allNames = ["Widget", "Gadget"];
    expect(
      promotesProductAsAdvised(
        "Gadget is better for storage than Widget on this budget.",
        "Gadget",
        allNames,
      ),
    ).toBe(false);
    expect(
      promotesProductAsAdvised(
        "Widget is the stronger choice here, while Gadget stays a later option.",
        "Widget",
        allNames,
      ),
    ).toBe(true);
  });

  it("handles multi-word product names without false rival promotion", () => {
    const nest = "Joseph Joseph Nest 9 Plus Food Preparation Set";
    const clutch = "Clutch Pro USB-C Portable Charger";
    const multiPayload = buildCompareExplainPayload({
      advisedCandidateId: "n",
      products: [
        estimateProduct({
          candidateId: "n",
          catalogKey: "nest",
          productName: nest,
          fitScore: 95,
        }),
        estimateProduct({
          candidateId: "c",
          catalogKey: "clutch",
          productName: clutch,
          fitScore: 80,
        }),
      ],
    });
    const aligned =
      `Skills advise starting with ${nest} because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than ${clutch} at Fit 80/100. ` +
      `The advised product's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than proven demand. ` +
      `${clutch} is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. ` +
      `Test ${nest} first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. ` +
      `Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.`;
    expect(assertCompareAdviceAligned(aligned, multiPayload)).toBe(true);

    const rival =
      `Compared with ${nest}, start with ${clutch} because its operational demands look lighter on this budget. ` +
      `Both market reads remain estimates because no citable live evidence is saved yet, so neither opportunity is proven. ` +
      `Lean on the curated heat-safe stand angle and keep the first ads budget controlled whichever product you order. ` +
      `The real uncertainty is paid demand rather than your ability to operate either product day to day. ` +
      `Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.`;
    expect(assertCompareAdviceAligned(rival, multiPayload)).toBe(false);
  });
});

describe("compare narrator", () => {
  it("keeps the skills winner authoritative and never parses it from prose", async () => {
    const skills = pickCompareWinner([
      {
        candidateId: "w",
        catalogKey: "widget",
        name: "Widget",
        compositeScore: 0.9,
        fitScore: 95,
        rank: 0,
        strength: "Strong",
        marginsPass: true,
      },
      {
        candidateId: "g",
        catalogKey: "gadget",
        name: "Gadget",
        compositeScore: 0.5,
        fitScore: 80,
        rank: 1,
        strength: "Okay",
        marginsPass: true,
      },
    ]);
    expect(skills.advised.candidateId).toBe("w");

    const { fetchFn } = geminiReturning(LEGIT_BRIEF);
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.advisedCandidateId).toBe(skills.advised.candidateId);
      expect(r.result.advisedName).toBe("Widget");
    }
  });

  it("fails closed on a rival-promoting brief instead of showing it", async () => {
    const { fetchFn, calls } = geminiReturning(RIVAL_BRIEF);
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("misaligned");
    // Exactly one tightened retry, shared policy with §6.1.
    expect(calls()).toBe(2);
  });

  it("retries once and keeps a recovered brief", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: calls === 1 ? RIVAL_BRIEF : LEGIT_BRIEF }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("never retries a missing key or a quota response", async () => {
    const noKey = await narrateCompareWithGemini(payload, "en", { apiKey: "" });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error).toBe("missing_key");

    let calls = 0;
    const rateLimited: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    };
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn: rateLimited,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("api_error");
    expect(calls).toBe(1);
  });

  it("reports a truncated brief as incomplete, not as bad wording", async () => {
    const { fetchFn } = geminiReturning(
      "Skills advise starting with Widget among these marks.",
    );
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("incomplete");
  });

  it("aligns the advised-name mention cap with the Gemini instruction", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/explain/compare-llm.ts"),
      "utf8",
    );
    expect(COMPARE_ADVISED_NAME_MAX_MENTIONS).toBe(3);
    // The prompt must interpolate the shared cap, never a hardcoded "twice".
    expect(src).toContain("${COMPARE_ADVISED_NAME_MAX_MENTIONS} times");
    expect(src).not.toMatch(/at most twice/i);
  });
});

describe("a compare brief belongs to one selection", () => {
  const fpAB = compareSelectionFingerprint({
    sessionId: "s1",
    candidateIds: ["a", "b"],
    locale: "en",
  });
  const fpAC = compareSelectionFingerprint({
    sessionId: "s1",
    candidateIds: ["a", "c"],
    locale: "en",
  });
  const version = COMPARE_CACHE_VERSION;

  function briefFor(fingerprint: string): CompareBriefState {
    const started = beginCompareRequest(EMPTY_COMPARE_BRIEF, {
      fingerprint,
      cacheVersion: version,
    });
    return applyCompareResponse(started, {
      fingerprint,
      response: {
        ok: true,
        body: LEGIT_BRIEF,
        cacheVersion: version,
        advisedName: "Widget",
        honestyKey: "whySuggestedHonestyEstimate",
      },
    });
  }

  it("keys a selection on session, sorted marks, and locale", () => {
    expect(
      compareSelectionFingerprint({
        sessionId: "s1",
        candidateIds: ["b", "a"],
        locale: "en",
      }),
    ).toBe(fpAB);
    expect(fpAB).not.toBe(fpAC);
    expect(
      compareSelectionFingerprint({
        sessionId: "s1",
        candidateIds: ["a", "b"],
        locale: "ar",
      }),
    ).not.toBe(fpAB);
    expect(
      compareSelectionFingerprint({
        sessionId: "s2",
        candidateIds: ["a", "b"],
        locale: "en",
      }),
    ).not.toBe(fpAB);
  });

  it("refetches after a mark change and never shows the old body", () => {
    const held = briefFor(fpAB);
    expect(compareBriefIsCurrent(held, { fingerprint: fpAB, cacheVersion: version })).toBe(true);

    // Reopening for a different selection must not reuse the held brief.
    const reopened = beginCompareRequest(held, {
      fingerprint: fpAC,
      cacheVersion: version,
    });
    expect(compareBriefNeedsFetch(reopened)).toBe(true);
    expect(reopened.body).toBeNull();
    expect(reopened.advisedName).toBeNull();
    expect(
      compareBriefIsCurrent(held, { fingerprint: fpAC, cacheVersion: version }),
    ).toBe(false);
  });

  it("reuses a still-current brief without a refetch", () => {
    const held = briefFor(fpAB);
    const reopened = beginCompareRequest(held, {
      fingerprint: fpAB,
      cacheVersion: version,
    });
    expect(compareBriefNeedsFetch(reopened)).toBe(false);
    expect(reopened.body).toBe(LEGIT_BRIEF);
    expect(reopened.open).toBe(true);
  });

  it("refetches when the cache version moved", () => {
    const held = briefFor(fpAB);
    const reopened = beginCompareRequest(held, {
      fingerprint: fpAB,
      cacheVersion: "v99-new-voice",
    });
    expect(compareBriefNeedsFetch(reopened)).toBe(true);
    expect(reopened.body).toBeNull();
  });

  it("closes the modal and clears state when a marked card is pruned", () => {
    const held = briefFor(fpAB);
    expect(held.open).toBe(true);
    // Reject / hide prunes the mark, so the brief may describe a gone product.
    const cleared = clearCompareBrief();
    expect(cleared.open).toBe(false);
    expect(cleared.body).toBeNull();
    expect(cleared.advisedName).toBeNull();
    expect(cleared.error).toBeNull();
    expect(cleared.cacheVersion).toBeNull();
    expect(cleared.fingerprint).toBeNull();
    expect(cleared.pendingFingerprint).toBeNull();
  });

  it("discards a response that lands after the selection changed", () => {
    const loading = beginCompareRequest(EMPTY_COMPARE_BRIEF, {
      fingerprint: fpAB,
      cacheVersion: version,
    });
    // Founder toggles a mark while the answer is still in flight.
    const afterToggle = clearCompareBrief();
    const landed = applyCompareResponse(afterToggle, {
      fingerprint: fpAB,
      response: {
        ok: true,
        body: LEGIT_BRIEF,
        cacheVersion: version,
        advisedName: "Widget",
        honestyKey: "whySuggestedHonestyEstimate",
      },
    });
    expect(landed.body).toBeNull();
    expect(landed.advisedName).toBeNull();

    // A slow answer for the previous selection cannot overwrite the new one.
    const pendingAC = beginCompareRequest(loading, {
      fingerprint: fpAC,
      cacheVersion: version,
    });
    const stale = applyCompareResponse(pendingAC, {
      fingerprint: fpAB,
      response: {
        ok: true,
        body: LEGIT_BRIEF,
        cacheVersion: version,
        advisedName: "Widget",
        honestyKey: "whySuggestedHonestyEstimate",
      },
    });
    expect(stale.body).toBeNull();
    expect(stale.pendingFingerprint).toBe(fpAC);
  });

  it("drops a stale body when a failure replaces it", () => {
    const held = briefFor(fpAB);
    const reopened = beginCompareRequest(held, {
      fingerprint: fpAC,
      cacheVersion: version,
    });
    const failed = applyCompareResponse(reopened, {
      fingerprint: fpAC,
      response: {
        ok: false,
        error: "could not verify",
        advisedName: "Widget",
      },
    });
    expect(failed.body).toBeNull();
    expect(failed.error).toBe("could not verify");
    expect(failed.open).toBe(true);
    // Skills pick remains visible on error — never parsed from rejected prose.
    expect(failed.advisedName).toBe("Widget");
  });

  it("keeps a pre-flight error free of any held body", () => {
    expect(compareBriefError("configure key").body).toBeNull();
    expect(compareBriefError("configure key").open).toBe(true);
    expect(closeCompareBrief(briefFor(fpAB)).open).toBe(false);
  });
});

describe("compare failure copy and board wiring", () => {
  const messages = (locale: "en" | "ar") =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"),
    ).Discovery as Record<string, string>;

  it("has distinct EN and AR copy per compare failure kind", () => {
    const keys = [
      "compareMisaligned",
      "compareUnverified",
      "compareIncomplete",
      "compareApiError",
      "compareStale",
      "compareMissingKey",
    ];
    for (const locale of ["en", "ar"] as const) {
      const m = messages(locale);
      for (const key of keys) {
        expect(m[key], `${locale}.${key}`).toBeTruthy();
      }
      expect(new Set(keys.map((k) => m[k])).size).toBe(keys.length);
    }
    for (const key of ["compareMisaligned", "compareUnverified", "compareIncomplete"]) {
      expect(messages("en")[key]).not.toBe(messages("ar")[key]);
      // No English fallback strings in AR.
      expect(messages("ar")[key]).toMatch(/[\u0600-\u06FF]/);
      expect(messages("ar")[key]).not.toMatch(/[A-Za-z]{4}/);
    }
  });

  it("maps each compare error code to its own copy and holds one selection", () => {
    const board = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    expect(board).toContain('res.error === "misaligned"');
    expect(board).toContain("compareMisaligned");
    expect(board).toContain("compareUnverified");
    expect(board).toContain("compareIncomplete");
    // The selection fingerprint gates the refetch, and every mark change clears.
    expect(board).toContain("compareSelectionFingerprint");
    expect(board).toContain("compareBriefNeedsFetch");
    expect(board).toContain("applyCompareResponse");
    expect(board).toContain("clearCompareBrief");
    // Skills advised badge renders whenever advisedName is known (incl. errors).
    expect(board).toContain("{advisedName ? (");
    expect(board).toContain("advisedName: res.advisedName ?? null");
    // No scattered compare fields that can disagree with the held brief.
    expect(board).not.toContain("setCompareBody");
    expect(board).not.toContain("setAdvisedName");
    expect(board).not.toContain("setCompareCacheVersion");
  });
});
