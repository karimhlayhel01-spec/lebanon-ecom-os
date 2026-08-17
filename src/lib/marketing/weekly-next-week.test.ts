import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildCreatives } from "@/lib/marketing/creatives";
import {
  buildCreativesFactsPack,
  parseCreativesKitItems,
  resolveNextWeeklyWeek,
  resolveWeeklyKitWeek,
  serializeCreativesKit,
  weeklyRefreshGenerateArgs,
} from "@/lib/marketing/creatives-ai";
import { fillCreativesKitWithGemini } from "@/lib/marketing/creatives-llm";

const base = {
  name: "GlowLamp",
  category: "home_kitchen",
  hooks: ["warm light"],
  capacityTier: 6 as const,
  varianceSeed: 21,
};

describe("weekly refresh — two-mode generate", () => {
  it("weeklyAdvance false keeps week; true increments; legacy missing weeklyWeek is 1", () => {
    expect(
      resolveNextWeeklyWeek({
        hasExistingKit: false,
        weeklyAdvance: true,
        creatives: [],
      }),
    ).toBe(1);
    expect(
      resolveNextWeeklyWeek({
        hasExistingKit: true,
        weeklyAdvance: false,
        weeklyWeek: 2,
        creatives: [{ weekIndex: 2 }],
      }),
    ).toBe(2);
    expect(
      resolveNextWeeklyWeek({
        hasExistingKit: true,
        weeklyAdvance: true,
        weeklyWeek: 2,
        creatives: [{ weekIndex: 2 }],
      }),
    ).toBe(3);

    const legacy = parseCreativesKitItems({
      kind: "creatives",
      source: "gemini",
      creatives: buildCreatives({
        ...base,
        stage: "weekly_refresh",
        varianceSeed: 1,
      }),
    });
    expect(legacy?.weeklyWeek).toBe(0);
    expect(
      resolveWeeklyKitWeek({
        weeklyWeek: legacy?.weeklyWeek,
        creatives: legacy?.creatives ?? [],
      }),
    ).toBe(1);

    const wrapped = parseCreativesKitItems(
      JSON.parse(
        serializeCreativesKit({
          kind: "creatives",
          source: "gemini",
          creatives: legacy?.creatives ?? [],
          weeklyWeek: 2,
        }),
      ),
    );
    expect(wrapped?.weeklyWeek).toBe(2);
  });

  it("StageCard regenerateRefresh; moveToNextWeek passes weeklyAdvance true", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    const stageCard = panel.slice(
      panel.indexOf("function StageCard("),
      panel.indexOf("function IntroLessonBlock("),
    );
    expect(stageCard).toMatch(/t\("regenerateRefresh"\)/);
    expect(stageCard).not.toMatch(/weeklyAdvance:\s*true/);
    expect(stageCard).not.toMatch(/generateKitAction\([^)]*true\s*,\s*[^)]*true/);

    const kitBlock = panel.slice(
      panel.indexOf("function CreativeKitBlock("),
      panel.indexOf("function groupCreativesByWeek("),
    );
    expect(kitBlock).toMatch(
      /generateKitAction\(kit\.stage, true, skuId, true\)/,
    );
    expect(kitBlock).toMatch(/t\("moveToNextWeek"\)/);

    const service = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/service.ts"),
      "utf8",
    );
    expect(service).toMatch(/weeklyAdvance/);
    expect(service).toMatch(/weeklyRefreshGenerateArgs/);
    expect(service).toMatch(/previousWeekHooks/);
    expect(service).toMatch(/replace, never stack/);

    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.regenerateRefresh).toBe("Regenerate week");
    expect(en.Marketing.moveToNextWeek).toBe("Move to next week");
    expect(en.Marketing.weeklyPlanNote).toMatch(/Week 2, 3/);
    expect(en.Marketing.weeklyPlanNote).toMatch(/does not repeat last week/);
  });

  it("Regenerate does not increment week and does not pass previousWeekHooks", () => {
    const existing = buildCreatives({
      ...base,
      stage: "weekly_refresh",
      weeklyWeek: 1,
      varianceSeed: 3,
    });
    const regen = weeklyRefreshGenerateArgs({
      weeklyAdvance: false,
      existingWeeklyWeek: 1,
      existingCreatives: existing,
    });
    expect(regen.weeklyWeek).toBe(1);
    expect(regen.previousWeekHooks).toBeUndefined();

    const move = weeklyRefreshGenerateArgs({
      weeklyAdvance: true,
      existingWeeklyWeek: 1,
      existingCreatives: existing,
    });
    expect(move.weeklyWeek).toBe(2);
    expect(move.previousWeekHooks?.length).toBeGreaterThan(0);
    expect(move.previousWeekHooks).toContain(existing[0]!.hookEn);
  });

  it("facts pack on Move includes previousWeekHooks", () => {
    const move = buildCreativesFactsPack({
      ...base,
      stage: "weekly_refresh",
      weeklyWeek: 2,
      previousWeekHooks: ["Hook A"],
    });
    expect(move.weeklyWeek).toBe(2);
    expect(move.weekPhase).toBe("convert");
    expect(move.previousWeekHooks).toEqual(["Hook A"]);

    const regen = buildCreativesFactsPack({
      ...base,
      stage: "weekly_refresh",
      weeklyWeek: 1,
    });
    expect(regen.weeklyWeek).toBe(1);
    expect(regen.weekPhase).toBe("open");
    expect(regen.previousWeekHooks).toBeUndefined();
  });

  it("leftover and first-pass Gemini facts include previousWeekHooks on Move", async () => {
    const input = {
      ...base,
      stage: "weekly_refresh" as const,
      weeklyWeek: 2,
      previousWeekHooks: ["Last week hook"],
      varianceSeed: 4,
    };
    const kit = buildCreatives(input);
    const firstPassSkeleton = kit.slice(0, 2);
    const leftoverSkeleton = kit.slice(0, 1);
    const emptyJson = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{}" }] } }],
    });

    let firstPass = "";
    await fillCreativesKitWithGemini(input, firstPassSkeleton, {
      fetchFn: async (_url, init) => {
        firstPass = String(init?.body ?? "");
        return new Response(emptyJson);
      },
      env: { GEMINI_API_KEY: "test" },
    });
    const firstFacts = JSON.parse(
      JSON.parse(firstPass).contents[0].parts[0].text,
    ).facts;
    expect(firstFacts.weeklyWeek).toBe(2);
    expect(firstFacts.weekPhase).toBe("convert");
    expect(firstFacts.previousWeekHooks).toEqual(["Last week hook"]);
    expect(firstPass).toMatch(/do not repeat/i);

    let leftover = "";
    await fillCreativesKitWithGemini(input, leftoverSkeleton, {
      fetchFn: async (_url, init) => {
        leftover = String(init?.body ?? "");
        return new Response(emptyJson);
      },
      env: { GEMINI_API_KEY: "test" },
      retryNote: "RETRY leftover cards only.",
    });
    const leftoverFacts = JSON.parse(
      JSON.parse(leftover).contents[0].parts[0].text,
    ).facts;
    expect(leftoverFacts.weeklyWeek).toBe(2);
    expect(leftoverFacts.weekPhase).toBe("convert");
    expect(leftoverFacts.previousWeekHooks).toEqual(["Last week hook"]);
    expect(leftover).toMatch(/do not repeat/i);
  });
});
