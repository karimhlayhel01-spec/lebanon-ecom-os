import { describe, expect, it } from "vitest";
import { buildCreatives, type Creative } from "@/lib/marketing/creatives";
import {
  acceptCreativeFillsPerCard,
  applyCreativeTextFills,
  chunkCreativesForGemini,
  creativesFillReasonI18nKey,
  creativesKitPayloadFromFill,
  CREATIVES_GEMINI_CHUNK_MAX,
  continueFillStillLeftover,
  leftoverRetryChunks,
  mergeCreativeChunk,
  mergeLeftoverFills,
  parseCreativeTextFills,
  parseCreativeTextFillsLenient,
  parseCreativesKitItems,
  resolveContinueFillAllowList,
  resolveCreativesKitFillSource,
  serializeCreativesKit,
  shouldChunkCreativesKit,
  validateFilledCreatives,
  type CreativeTextFill,
} from "@/lib/marketing/creatives-ai";
import {
  buildLeftoverRetryNote,
  CREATIVES_GEMINI_MAX_OUTPUT_TOKENS,
  CREATIVES_SHOTS_RETRY_NOTE,
  fillCreativesKitWithGemini,
  leftoverSkeletonPayload,
} from "@/lib/marketing/creatives-llm";
import { readFileSync } from "fs";
import path from "path";
import { buildExternalAiDeskPrompts, PASTE_CREATIVE_MARKER } from "@/lib/marketing/ai-desk";
import {
  createGeminiMarketingLlmProvider,
  getMarketingLlmProvider,
} from "@/lib/marketing/intro-llm";

const base = {
  name: "GlowLamp",
  category: "home_kitchen",
  hooks: ["warm light"],
  capacityTier: 6 as const,
};

function fillFromSkeleton(c: Creative, productName: string): CreativeTextFill {
  return {
    id: c.id,
    hookEn: `Open on ${productName} in 2 seconds`,
    hookAr: `افتح على ${productName} في ثانيتين`,
    angleEn: `${productName} desk tip for busy mornings`,
    angleAr: `نصيحة مكتب من ${productName} للصباحات المزدحمة`,
    captionEn: `Why ${productName} belongs on your desk — soft waitlist CTA.`,
    captionAr: `لماذا ${productName} يستحق مكتبك — دعوة هادئة للقائمة.`,
    shots: [
      `0–3s | Phone vertical close-up of ${productName} — hold steady, window light.`,
      `3–8s | Mid shot: hands place ${productName} on the desk — slow pan, natural light.`,
      `8–12s | Wide desk scene with ${productName} in frame — hold end card 2s, soft soft CTA.`,
    ],
    howToShootEn:
      "Phone vertical. Window light. Film shots in order. Hold steady ~15s total.",
    howToShootAr:
      "الهاتف عمودي. ضوء نافذة. صوّر اللقطات بالترتيب. ثبّت نحو ١٥ ثانية إجمالاً.",
    seriesLabelEn: "Desk fix #1",
    seriesLabelAr: "إصلاح المكتب #١",
    whyEn: "Niche-consistent soft teaser without hard order pitch.",
    whyAr: "تشويقة ناعمة متسقة مع النيش دون طلب شراء قاسٍ.",
  };
}

describe("validateFilledCreatives", () => {
  it("rejects COD pitch", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 11,
    });
    const creatives = skeleton.map((c) => ({
      ...c,
      captionEn: `${c.captionEn} Pay with COD cash on delivery.`,
    }));
    const r = validateFilledCreatives(creatives, "launch", "GlowLamp");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("cod_pitch");
  });

  it("rejects pre_launch hard/WhatsApp order pitch", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "pre_launch",
      varianceSeed: 12,
      weekCount: 4,
    });
    const creatives = skeleton.map((c) => ({ ...c }));
    creatives[0] = {
      ...creatives[0]!,
      captionEn: "Message us on WhatsApp to order GlowLamp today.",
      hookEn: "Hard sell GlowLamp — WhatsApp to buy now.",
    };
    const r = validateFilledCreatives(creatives, "pre_launch", "GlowLamp");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("pre_launch_forbidden");
  });

  it("accepts valid soft pre_launch fills with product name", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "pre_launch",
      varianceSeed: 13,
      weekCount: 2,
    });
    const fills = skeleton.map((c) => fillFromSkeleton(c, "GlowLamp"));
    const merged = applyCreativeTextFills(skeleton, fills);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const r = validateFilledCreatives(
      merged.creatives,
      "pre_launch",
      "GlowLamp",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects thin one-liner shots", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 16,
    });
    const fills = skeleton.map((c) => ({
      ...fillFromSkeleton(c, "GlowLamp"),
      shots: ["Close-up", "Mid shot", "End card"],
    }));
    const merged = applyCreativeTextFills(skeleton, fills);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.error).toBe("shots_too_thin");
  });

  it("rejects missing how-to as too_short", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 17,
    });
    const fills = skeleton.map((c) => ({
      ...fillFromSkeleton(c, "GlowLamp"),
      howToShootEn: "Short",
      howToShootAr: "قصير",
    }));
    const merged = applyCreativeTextFills(skeleton, fills);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.error).toBe("too_short");
  });
});

describe("fillCreativesKitWithGemini / provider", () => {
  it("falls back with missing_key when Gemini env is empty", async () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 14,
    });
    const provider = createGeminiMarketingLlmProvider();
    const r = await provider.improveCreativesKit(
      {
        ...base,
        stage: "launch",
        varianceSeed: 14,
      },
      skeleton,
      { env: {} },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing_key");
  });

  it("exposes improveCreativesKit on the active provider seam", () => {
    expect(typeof getMarketingLlmProvider().improveCreativesKit).toBe(
      "function",
    );
  });
});

describe("buildExternalAiDeskPrompts", () => {
  it("includes product name and stage in both role prompts", () => {
    const prompts = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "pre_launch",
    });
    expect(prompts).toHaveLength(2);
    for (const p of prompts) {
      expect(p.body).toContain("GlowLamp Pro");
      expect(p.body.toLowerCase()).toMatch(/pre-launch|pre_launch/);
    }
  });

  it("rewrite tightens one pasted creative — not a new kit", () => {
    const rewrite = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "launch",
    }).find((p) => p.id === "rewrite")!;
    expect(rewrite.body).toContain(PASTE_CREATIVE_MARKER);
    expect(rewrite.body.toLowerCase()).toMatch(/do not invent a full/);
    expect(rewrite.body.toLowerCase()).toMatch(/2–3|2-3/);
    expect(rewrite.body.toLowerCase()).not.toMatch(
      /rewrite 3 short creative variants/,
    );
  });

  it("strategy forbids full captions / kit-like posts", () => {
    const strategy = buildExternalAiDeskPrompts({
      productName: "GlowLamp Pro",
      category: "home_kitchen",
      stage: "weekly_refresh",
    }).find((p) => p.id === "strategy")!;
    expect(strategy.body.toLowerCase()).toMatch(/full caption/);
    expect(strategy.body.toLowerCase()).toMatch(
      /complete posts like a creative kit|not a second creative kit/,
    );
    expect(strategy.body.toLowerCase()).toMatch(/shot list/);
  });

  it("keeps paste-out prompts free of OS product meta", () => {
    const stages = ["pre_launch", "launch", "weekly_refresh"] as const;
    for (const stage of stages) {
      const prompts = buildExternalAiDeskPrompts({
        productName: "GlowLamp Pro",
        category: "home_kitchen",
        stage,
      });
      for (const p of prompts) {
        expect(p.body).not.toContain("Lebanon Ecom OS");
        expect(p.body).not.toContain("Topic A");
        expect(p.body.toLowerCase()).not.toContain("capacity tier");
        expect(p.body.toLowerCase()).not.toContain("stage unlock");
        expect(p.body).not.toMatch(/OS Marketing kit/i);
        expect(p.body).not.toMatch(/source of truth/i);
      }
    }
  });
});

describe("chunked Gemini fill helpers", () => {
  it("chunks launch / weekly always; pre_launch only when count > 6", () => {
    expect(shouldChunkCreativesKit("launch", 6)).toBe(true);
    expect(shouldChunkCreativesKit("weekly_refresh", 10)).toBe(true);
    expect(shouldChunkCreativesKit("pre_launch", 6)).toBe(false);
    expect(shouldChunkCreativesKit("pre_launch", 8)).toBe(true);
  });

  it("prefers weekIndex groups and splits groups larger than 4", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      capacityTier: 14,
      varianceSeed: 21,
    });
    expect(skeleton.length).toBe(14);
    const chunks = chunkCreativesForGemini(skeleton);
    expect(chunks.every((c) => c.length <= CREATIVES_GEMINI_CHUNK_MAX)).toBe(
      true,
    );
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(skeleton.length);
    const weeks = new Set(skeleton.map((c) => c.weekIndex));
    expect(weeks.size).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const w = new Set(chunk.map((c) => c.weekIndex));
      expect(w.size).toBe(1);
    }
  });

  it("failed chunk does not overwrite other cards", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 22,
    });
    const [a, b] = skeleton;
    const improved = { ...a!, hookEn: `AI ${a!.hookEn}` };
    const merged = mergeCreativeChunk(skeleton, [improved]);
    expect(merged[0]?.hookEn).toBe(improved.hookEn);
    expect(merged[1]?.hookEn).toBe(b!.hookEn);
  });

  it("resolves gemini / template / partial from counts", () => {
    expect(resolveCreativesKitFillSource(6, 6)).toBe("gemini");
    expect(resolveCreativesKitFillSource(0, 6)).toBe("template");
    expect(resolveCreativesKitFillSource(4, 6)).toBe("partial");
  });

  it("maps fill errors to founder i18n keys — not raw enums as the only text", () => {
    expect(creativesFillReasonI18nKey("shots_too_thin")).toBe("kitAiReasonShots");
    expect(creativesFillReasonI18nKey("cod_pitch")).toBe("kitAiReasonCod");
    expect(creativesFillReasonI18nKey("monthly_cap")).toBeNull();
    expect(creativesFillReasonI18nKey("missing_key")).toBeNull();
  });

  it("round-trips partial source + templateCount + templateIds", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 23,
    });
    const leftover = [skeleton[0]!.id, skeleton[1]!.id];
    const json = serializeCreativesKit({
      kind: "creatives",
      source: "partial",
      creatives: skeleton,
      fillError: "shots_too_thin",
      templateCount: 2,
      templateIds: leftover,
    });
    const parsed = parseCreativesKitItems(JSON.parse(json));
    expect(parsed?.source).toBe("partial");
    expect(parsed?.fillError).toBe("shots_too_thin");
    expect(parsed?.templateCount).toBe(2);
    expect(parsed?.templateIds).toEqual(leftover);
  });
});

describe("per-card accept + leftover retry", () => {
  it("keeps 3 Gemini cards when one shot list in a 4-card chunk is thin", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 31,
    }).slice(0, 4);
    expect(skeleton).toHaveLength(4);
    const thinId = skeleton[1]!.id;
    const fills = skeleton.map((c) =>
      c.id === thinId
        ? {
            ...fillFromSkeleton(c, "GlowLamp"),
            shots: ["Close-up", "Mid shot", "End card"],
          }
        : fillFromSkeleton(c, "GlowLamp"),
    );
    const accepted = acceptCreativeFillsPerCard(
      skeleton,
      fills,
      "launch",
      "GlowLamp",
    );
    expect(accepted.accepted).toHaveLength(3);
    expect(accepted.rejectedIds).toEqual([thinId]);
    expect(accepted.lastError).toBe("shots_too_thin");

    const merged = mergeCreativeChunk(skeleton, accepted.accepted);
    expect(merged[0]?.hookEn).toBe(accepted.accepted[0]?.hookEn);
    expect(merged[1]?.hookEn).toBe(skeleton[1]!.hookEn);
    expect(merged[2]?.hookEn).toBe(accepted.accepted[1]?.hookEn);

    const payload = creativesKitPayloadFromFill({
      creatives: merged,
      geminiIds: new Set(accepted.accepted.map((c) => c.id)),
      lastError: accepted.lastError ?? undefined,
    });
    expect(payload.source).toBe("partial");
    expect(payload.templateCount).toBe(1);
    expect(payload.templateIds).toEqual([thinId]);
    expect(payload.fillError).toBe("shots_too_thin");
  });

  it("Try again merges leftovers only — does not rebuild the 3 Gemini cards", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 32,
    }).slice(0, 4);
    const fills = skeleton.map((c, i) =>
      i === 1
        ? {
            ...fillFromSkeleton(c, "GlowLamp"),
            shots: ["Close-up", "Mid shot", "End card"],
          }
        : fillFromSkeleton(c, "GlowLamp"),
    );
    const first = acceptCreativeFillsPerCard(
      skeleton,
      fills,
      "launch",
      "GlowLamp",
    );
    const existing = mergeCreativeChunk(skeleton, first.accepted);
    const leftover = existing[1]!;
    const keepHooks = [existing[0]!.hookEn, existing[2]!.hookEn, existing[3]!.hookEn];

    const retry = acceptCreativeFillsPerCard(
      [leftover],
      [fillFromSkeleton(leftover, "GlowLamp")],
      "launch",
      "GlowLamp",
    );
    expect(retry.accepted).toHaveLength(1);
    const continued = mergeLeftoverFills(
      existing,
      retry.accepted,
      [leftover.id],
    );
    expect(continued[0]?.hookEn).toBe(keepHooks[0]);
    expect(continued[2]?.hookEn).toBe(keepHooks[1]);
    expect(continued[3]?.hookEn).toBe(keepHooks[2]);
    expect(continued[1]?.hookEn).toBe(retry.accepted[0]!.hookEn);
    expect(continued[1]?.id).toBe(leftover.id);

    const promoted = creativesKitPayloadFromFill({
      creatives: continued,
      geminiIds: new Set(continued.map((c) => c.id)),
    });
    expect(promoted.source).toBe("gemini");
    expect(promoted.templateIds).toBeUndefined();
    expect(promoted.templateCount).toBeUndefined();
  });

  it("leftover retry still rejects thin shots on the miss", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 33,
    }).slice(0, 4);
    const leftover = skeleton[1]!;
    const stillThin = acceptCreativeFillsPerCard(
      [leftover],
      [
        {
          ...fillFromSkeleton(leftover, "GlowLamp"),
          shots: ["Close-up", "Mid shot", "End card"],
        },
      ],
      "launch",
      "GlowLamp",
    );
    expect(stillThin.accepted).toHaveLength(0);
    expect(stillThin.rejectedIds).toEqual([leftover.id]);
    expect(stillThin.lastError).toBe("shots_too_thin");
  });

  it("leftover retry chunks are one card each", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 34,
    }).slice(0, 5);
    expect(leftoverRetryChunks(skeleton).map((c) => c.length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(leftoverRetryChunks(skeleton).map((c) => c[0]!.id)).toEqual(
      skeleton.map((c) => c.id),
    );
  });

  it("Gemini parse success accepts per card — does not drop the whole chunk", async () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 35,
    }).slice(0, 4);
    const fills = skeleton.map((c, i) =>
      i === 3
        ? {
            ...fillFromSkeleton(c, "GlowLamp"),
            shots: ["Close-up", "Mid shot", "End card"],
          }
        : fillFromSkeleton(c, "GlowLamp"),
    );
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ creatives: fills }) }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await fillCreativesKitWithGemini(
      { ...base, stage: "launch", varianceSeed: 35 },
      skeleton,
      { fetchFn, env: { GEMINI_API_KEY: "test" } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.creatives).toHaveLength(3);
    expect(r.rejectedIds).toEqual([skeleton[3]!.id]);
    expect(r.lastError).toBe("shots_too_thin");
  });

  it("leftover retry note is one-card rewrite + copy draft shots", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 38,
    }).slice(0, 1);
    const note = buildLeftoverRetryNote({
      cards: skeleton,
      lastError: "parse_error",
    });
    expect(note).toContain(skeleton[0]!.id);
    expect(note).toMatch(/Rewrite hookEn/);
    expect(note).toMatch(/patternShots/);
    expect(note).toMatch(/Valid JSON only/);
  });

  it("leftover payload includes patternShots; first-pass chunk payload does not", async () => {
    const leftover = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 39,
    }).slice(0, 1);
    const payload = leftoverSkeletonPayload(leftover);
    expect(payload[0]?.patternShots).toEqual(leftover[0]!.shots);
    expect(payload[0]?.patternHowToEn).toBe(leftover[0]!.howToShootEn);
    expect(payload[0]?.exampleCreative?.id).toBe(leftover[0]!.id);
    expect(payload[0]?.exampleCreative?.hookEn).toBe(leftover[0]!.hookEn);
    expect(payload[0]?.exampleCreative?.shots).toEqual(leftover[0]!.shots);
    expect(payload[0]?.exampleCreative?.howToShootEn).toBe(
      leftover[0]!.howToShootEn,
    );
    expect(payload[0]?.exampleCreative?.seriesLabelEn).toBe(
      leftover[0]!.seriesLabelEn,
    );
    expect(payload[0]?.exampleCreative?.whyEn).toBe(leftover[0]!.whyEn);

    const chunk = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 40,
    }).slice(0, 4);
    let firstPassBody = "";
    const fetchFn: typeof fetch = async (_url, init) => {
      firstPassBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      creatives: chunk.map((c) => fillFromSkeleton(c, "GlowLamp")),
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    await fillCreativesKitWithGemini(
      { ...base, stage: "launch", varianceSeed: 40 },
      chunk,
      { fetchFn, env: { GEMINI_API_KEY: "test" } },
    );
    expect(firstPassBody).not.toMatch(/patternShots/);

    let leftoverBody = "";
    const leftoverFetch: typeof fetch = async (_url, init) => {
      leftoverBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      creatives: leftover.map((c) =>
                        fillFromSkeleton(c, "GlowLamp"),
                      ),
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    await fillCreativesKitWithGemini(
      { ...base, stage: "launch", varianceSeed: 39 },
      leftover,
      {
        fetchFn: leftoverFetch,
        env: { GEMINI_API_KEY: "test" },
      },
    );
    expect(leftoverBody).not.toMatch(/patternShots/);
    expect(leftoverBody).not.toMatch(/exampleCreative/);
    expect(leftoverBody).not.toMatch(/leftoverRules/);
    expect(leftoverBody).toMatch(/templateHintEn/);
    expect(leftoverBody).toMatch(/HARD RULES/);
  });

  it("continue / onlyIds uses generate request without leftoverMode", async () => {
    const leftover = buildCreatives({
      ...base,
      stage: "weekly_refresh",
      weeklyWeek: 2,
      varianceSeed: 42,
    }).slice(0, 1);
    let body = "";
    const fetchFn: typeof fetch = async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      creatives: leftover.map((c) =>
                        fillFromSkeleton(c, "GlowLamp"),
                      ),
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    await fillCreativesKitWithGemini(
      {
        ...base,
        stage: "weekly_refresh",
        weeklyWeek: 2,
        varianceSeed: 42,
      },
      leftover,
      { fetchFn, env: { GEMINI_API_KEY: "test" } },
    );
    expect(body).not.toMatch(/patternShots/);
    expect(body).not.toMatch(/exampleCreative/);
    expect(body).not.toMatch(/leftoverRules/);
    expect(body).not.toMatch(/leftoverFillInstruction|Rewrite hookEn/);
    expect(body).toMatch(/templateHintEn/);
    expect(body).toMatch(/HARD RULES/);
    const facts = JSON.parse(JSON.parse(body).contents[0].parts[0].text).facts;
    expect(facts.weeklyWeek).toBe(2);
  });

  it("one-card lenient parse keeps a usable reply; 4-card strict parse unchanged", () => {
    const one = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 41,
    }).slice(0, 1);
    const good = fillFromSkeleton(one[0]!, "GlowLamp");
    const { whyAr: _whyAr, seriesLabelEn: _s, ...noWhy } = good;
    const missingWhy = parseCreativeTextFillsLenient(
      { creatives: [{ ...noWhy, id: "wrong-id" }] },
      one,
    );
    expect(missingWhy).not.toBeNull();
    expect(missingWhy?.[0]?.id).toBe(one[0]!.id);
    expect(missingWhy?.[0]?.whyAr).toBe(one[0]!.whyAr);
    const accepted = acceptCreativeFillsPerCard(
      one,
      missingWhy!,
      "launch",
      "GlowLamp",
    );
    expect(accepted.accepted).toHaveLength(1);

    const bare = parseCreativeTextFillsLenient(
      {
        hookEn: good.hookEn,
        hookAr: good.hookAr,
        angleEn: good.angleEn,
        angleAr: good.angleAr,
        captionEn: good.captionEn,
        captionAr: good.captionAr,
        shots: good.shots.join("\n"),
      },
      one,
    );
    expect(bare?.[0]?.id).toBe(one[0]!.id);
    expect(bare?.[0]?.shots.length).toBe(3);

    const four = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 42,
    }).slice(0, 4);
    const strict = parseCreativeTextFills({
      creatives: four.map((c) => {
        const f = fillFromSkeleton(c, "GlowLamp");
        const { whyAr: _w, ...rest } = f;
        return rest;
      }),
    });
    expect(strict).toBeNull();
  });

  it("continue reports still leftover when geminiIds misses the target", () => {
    expect(continueFillStillLeftover(["card-4"], new Set(["a", "b"]))).toBe(
      true,
    );
    expect(continueFillStillLeftover(["card-4"], new Set(["card-4"]))).toBe(
      false,
    );
  });

  it("one leftover id allow-list leaves other cards unchanged; template source allows one id", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 37,
    }).slice(0, 3);
    const ids = skeleton.map((c) => c.id);
    const partialAllowed = resolveContinueFillAllowList({
      source: "partial",
      templateIds: [ids[1]!],
      creativeIds: ids,
    });
    expect(partialAllowed).toEqual([ids[1]]);
    const filledOne = {
      ...skeleton[1]!,
      hookEn: "AI leftover only",
    };
    const merged = mergeLeftoverFills(skeleton, [filledOne], [ids[1]!]);
    expect(merged[0]?.hookEn).toBe(skeleton[0]!.hookEn);
    expect(merged[2]?.hookEn).toBe(skeleton[2]!.hookEn);
    expect(merged[1]?.hookEn).toBe("AI leftover only");

    const templateAllowed = resolveContinueFillAllowList({
      source: "template",
      templateIds: [],
      creativeIds: ids,
    });
    expect(templateAllowed).toEqual(ids);
    expect(templateAllowed?.includes(ids[0]!)).toBe(true);
    const afterOne = creativesKitPayloadFromFill({
      creatives: skeleton,
      geminiIds: new Set([ids[0]!]),
    });
    expect(afterOne.source).toBe("partial");
    expect(afterOne.templateIds).toEqual([ids[1], ids[2]]);

    expect(
      resolveContinueFillAllowList({
        source: null,
        templateIds: [],
        creativeIds: ids,
      }),
    ).toBeNull();
  });
});

describe("creatives Gemini token cap (source)", () => {
  it("raises creatives maxOutputTokens only — Intro stays 8192", () => {
    expect(CREATIVES_GEMINI_MAX_OUTPUT_TOKENS).toBe(16384);
    const creativesLlm = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/creatives-llm.ts"),
      "utf8",
    );
    expect(creativesLlm).toMatch(/CREATIVES_GEMINI_MAX_OUTPUT_TOKENS/);
    expect(creativesLlm).not.toMatch(/maxOutputTokens:\s*8192/);
    const intro = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/intro-llm.ts"),
      "utf8",
    );
    expect(intro).toMatch(/maxOutputTokens:\s*8192/);
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/service.ts"),
      "utf8",
    );
    expect(service).toMatch(/chunkCreativesForGemini/);
    expect(service).toMatch(/leftoverRetryChunks/);
    expect(service).not.toMatch(/buildLeftoverRetryNote/);
    expect(service).toMatch(/retryNote:\s*undefined/);
    expect(service).not.toMatch(/seedError/);
    expect(service).not.toMatch(/shotsRetry/);
    expect(service).toMatch(/continueCreativesKitFill/);
    expect(service).toMatch(/recordMarketingGeminiCalls/);
    expect(service).toMatch(/checkMarketingGeminiAllowance/);
    expect(CREATIVES_SHOTS_RETRY_NOTE).toMatch(/patternShots/);
    const continueFn = service.slice(
      service.indexOf("export async function continueCreativesKitFill"),
      service.indexOf("export async function saveKitCreatives"),
    );
    expect(continueFn).toContain("onlyIds");
    expect(continueFn).toContain("leftoverIds: allowed");
    expect(continueFn).toContain("resolveContinueFillAllowList");
    expect(continueFn).toContain("still_leftover");
    expect(continueFn).toContain("weeklyWeek");
    expect(continueFn).toContain("resolveWeeklyKitWeek");
    expect(continueFn).toMatch(/creativeInput[\s\S]*weeklyWeek/);
    expect(continueFn).not.toMatch(/previousWeekHooks/);
    expect(continueFn).not.toMatch(/buildCreatives\(/);
    expect(continueFn).not.toMatch(/seedError/);
    expect(continueFn).not.toMatch(/buildLeftoverRetryNote/);
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/kit\.source === "partial"/);
    expect(panel).toMatch(/continueCreativesKitFillAction/);
    expect(panel).toMatch(
      /continueCreativesKitFillAction\(kit\.id, \[id\], skuId\)/,
    );
    expect(panel).toMatch(/tryAiFillCardFailed/);
    expect(panel).toMatch(/tryAiFillAgainFailed/);
    expect(panel).toMatch(/still_leftover/);
    const tryAiAgainFn = panel.slice(
      panel.indexOf("function tryAiAgain("),
      panel.indexOf("const fieldClass"),
    );
    expect(tryAiAgainFn).toMatch(/still_leftover/);
    expect(tryAiAgainFn).toMatch(/setKitFillFailed\(true\)/);
    expect(tryAiAgainFn).toMatch(/router\.refresh\(\)/);
    const enFailed = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(enFailed.Marketing.tryAiFillCardFailed).toMatch(/could not fill/i);
    expect(enFailed.Marketing.tryAiFillAgainFailed).toBe(
      "AI still could not fill the leftover cards.",
    );
    expect(panel).toMatch(/generateKitAction\(kit\.stage/);
    expect(panel).not.toMatch(
      /onTryAiFill[\s\S]{0,200}generateKitAction/,
    );
    const en = readFileSync(
      path.join(process.cwd(), "messages/en.json"),
      "utf8",
    );
    expect(en).toMatch(/fills only the leftover cards/);
  });
});

describe("serialize / parse creatives kit wrap", () => {
  it("round-trips wrapped kits and keeps legacy arrays", () => {
    const skeleton = buildCreatives({
      ...base,
      stage: "launch",
      varianceSeed: 15,
    });
    const json = serializeCreativesKit({
      kind: "creatives",
      source: "template",
      creatives: skeleton,
    });
    const wrapped = parseCreativesKitItems(JSON.parse(json));
    expect(wrapped?.source).toBe("template");
    expect(wrapped?.creatives).toHaveLength(skeleton.length);

    const legacy = parseCreativesKitItems(skeleton);
    expect(legacy?.source).toBeNull();
    expect(legacy?.creatives.length).toBe(skeleton.length);
  });
});
