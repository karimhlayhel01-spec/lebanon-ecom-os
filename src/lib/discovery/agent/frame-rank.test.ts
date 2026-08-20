import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CATALOG, getCatalogProduct } from "@/lib/discovery/catalog";
import { classifyOtherIndustry } from "@/lib/discovery/agent/other-industry";
import {
  applyAgentFrameRank,
  isCheapStorageDrop,
} from "@/lib/discovery/agent/frame-rank";
import {
  EMPTY_AGENT_FRAME,
  resolveAgentRetrievePlan,
  type AgentFrame,
} from "@/lib/discovery/agent/frame";

function wrap(keys: readonly string[]) {
  return keys.map((key) => {
    const p = getCatalogProduct(key);
    if (!p) throw new Error(`missing catalog ${key}`);
    return { p };
  });
}

function ids(rows: readonly { p: { key: string } }[]): string[] {
  return rows.map((r) => r.p.key);
}

const giftsFrame: AgentFrame = {
  ...EMPTY_AGENT_FRAME,
  industryIds: ["home_kitchen"],
  audience: "gifts",
};

describe("cheap_storage drop", () => {
  it("drops collapsible containers / cable organizer; does not drop gua sha", () => {
    expect(isCheapStorageDrop(getCatalogProduct("collapsible_containers")!)).toBe(
      true,
    );
    expect(isCheapStorageDrop(getCatalogProduct("cable_organizer")!)).toBe(true);
    expect(isCheapStorageDrop(getCatalogProduct("gua_sha_set")!)).toBe(false);
  });

  it("does not drop all home_kitchen — a small non-storage kitchen row stays", () => {
    const keep = {
      ...getCatalogProduct("silicone_kitchen_set")!,
      key: "tea_towel",
      storageFootprint: "small" as const,
      en: {
        name: "Tea towel",
        summary: "Cotton kitchen towel.",
        differentiation: "Local print.",
      },
      ar: {
        name: "منشفة شاي",
        summary: "منشفة مطبخ قطنية.",
        differentiation: "طباعة محلية.",
      },
    };
    expect(keep.category).toBe("home_kitchen");
    expect(isCheapStorageDrop(keep)).toBe(false);
    expect(isCheapStorageDrop(getCatalogProduct("silicone_kitchen_set")!)).toBe(
      true,
    );
  });

  it("cheap_storage emptying a kitchen-only accept-ready set leaves no ids", () => {
    const kitchenReady = CATALOG.filter(
      (p) => p.category === "home_kitchen" && !p.oversized,
    );
    const ranked = applyAgentFrameRank(
      kitchenReady.map((p) => ({ p })),
      { ...EMPTY_AGENT_FRAME, skipRefuse: "cheap_storage" },
    );
    expect(ids(ranked)).toEqual([]);
  });

  it("does not drop by wiping the home_kitchen category", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/agent/frame-rank.ts"),
      "utf8",
    );
    const dropFn = src.slice(
      src.indexOf("export function isCheapStorageDrop"),
      src.indexOf("function keywordNeedles"),
    );
    expect(dropFn).not.toContain("home_kitchen");
  });
});

describe("audience / differ / Other boost", () => {
  it("gifts boosts gift-packaging rows but does not drop the rest", () => {
    const scored = wrap([
      "magnetic_charger",
      "gua_sha_set",
      "collapsible_containers",
      "minimalist_wallet",
    ]);
    const ranked = applyAgentFrameRank(scored, giftsFrame);
    expect(ids(ranked)).toContain("magnetic_charger");
    expect(ids(ranked)).toContain("collapsible_containers");
    expect(ranked).toHaveLength(scored.length);
    expect(ids(ranked).indexOf("gua_sha_set")).toBeLessThan(
      ids(ranked).indexOf("magnetic_charger"),
    );
    expect(ids(ranked).indexOf("minimalist_wallet")).toBeLessThan(
      ids(ranked).indexOf("collapsible_containers"),
    );
  });

  it("boost never removes an id that passed industry + gates + cheap-storage", () => {
    const scored = wrap([
      "gua_sha_set",
      "ice_roller",
      "led_facial_wand",
      "phone_tripod",
    ]);
    const ranked = applyAgentFrameRank(scored, {
      ...EMPTY_AGENT_FRAME,
      skipRefuse: "cheap_storage",
      audience: "gifts",
      differ: "bundle",
      otherText: "garlic",
    });
    expect(ids(ranked).sort()).toEqual(ids(scored).sort());
  });

  it("unmapped Other garlic does not change the industry filter", () => {
    const frame: AgentFrame = {
      ...EMPTY_AGENT_FRAME,
      industryIds: ["home_kitchen"],
      otherText: "garlic",
    };
    expect(classifyOtherIndustry("garlic").kind).toBe("unmapped");
    expect(resolveAgentRetrievePlan(frame).industryIds).toEqual([
      "home_kitchen",
    ]);
    const scored = wrap(["collapsible_containers", "gua_sha_set"]);
    const ranked = applyAgentFrameRank(scored, frame);
    expect(ids(ranked)).toEqual(ids(scored));
    expect(ranked.every((r) => r.p.key !== "invented_garlic")).toBe(true);
  });

  it("skipped audience / skip refuse add no extra rule; unmatched differ keeps skill order", () => {
    const scored = wrap(["led_facial_wand", "phone_tripod", "gua_sha_set"]);
    expect(
      ids(
        applyAgentFrameRank(scored, {
          ...EMPTY_AGENT_FRAME,
          skipRefuse: "skipped",
          audience: "skipped",
        }),
      ),
    ).toEqual(ids(scored));
    const plain = {
      ...getCatalogProduct("led_facial_wand")!,
      key: "plain_clip",
      en: {
        name: "Plain clip",
        summary: "A small clip.",
        differentiation: "Ship with a card.",
      },
      ar: {
        name: "مشبك",
        summary: "مشبك صغير.",
        differentiation: "يُشحن مع بطاقة.",
      },
    };
    const other = {
      ...plain,
      key: "plain_hook",
      en: {
        name: "Plain hook",
        summary: "A small hook.",
        differentiation: "Ship with a card.",
      },
    };
    const ranked = applyAgentFrameRank([{ p: plain }, { p: other }], {
      ...EMPTY_AGENT_FRAME,
      differ: "niche",
    });
    expect(ids(ranked)).toEqual(["plain_clip", "plain_hook"]);
  });

  it("bundle boosts kit/set/pack rows first while keeping relative skill order", () => {
    const scored = wrap([
      "magnetic_charger",
      "beard_kit",
      "phone_tripod",
      "gua_sha_set",
    ]);
    const ranked = applyAgentFrameRank(scored, {
      ...EMPTY_AGENT_FRAME,
      differ: "bundle",
    });
    expect(ids(ranked)[0]).toBe("beard_kit");
    expect(ids(ranked).indexOf("gua_sha_set")).toBeLessThan(
      ids(ranked).indexOf("phone_tripod"),
    );
  });
});
