import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  formatCardNumberList,
  leftoverShowTargets,
} from "@/lib/marketing/leftover-cards";

const badgeById = {
  a: 1,
  b: 4,
  c: 7,
  d: 9,
};

describe("leftoverShowTargets", () => {
  it("partial kit with two templateIds lists both badge numbers for Show", () => {
    const targets = leftoverShowTargets({
      source: "partial",
      templateIds: ["d", "b"],
      badgeById,
      geminiConfigured: true,
      geminiCapReached: false,
    });
    expect(targets.map((t) => t.badge)).toEqual([4, 9]);
    expect(formatCardNumberList(targets.map((t) => t.badge), "en")).toBe(
      "4 and 9",
    );
    expect(targets).toHaveLength(2);
  });

  it("empty templateIds yields no Show targets (do not guess leftovers)", () => {
    expect(
      leftoverShowTargets({
        source: "partial",
        templateIds: [],
        badgeById,
        geminiConfigured: true,
        geminiCapReached: false,
      }),
    ).toEqual([]);
  });

  it("complete template fail and cap / no key hide Show targets", () => {
    const base = {
      templateIds: ["b", "d"],
      badgeById,
      geminiConfigured: true,
      geminiCapReached: false,
    };
    expect(leftoverShowTargets({ ...base, source: "template" })).toEqual([]);
    expect(
      leftoverShowTargets({
        ...base,
        source: "partial",
        geminiCapReached: true,
      }),
    ).toEqual([]);
    expect(
      leftoverShowTargets({
        ...base,
        source: "partial",
        geminiConfigured: false,
      }),
    ).toEqual([]);
  });
});

describe("formatCardNumberList", () => {
  it("joins three badges with Oxford and / Arabic و", () => {
    expect(formatCardNumberList([4, 7, 9], "en")).toBe("4, 7, and 9");
    expect(formatCardNumberList([4, 7, 9], "ar")).toBe("4، 7، و 9");
  });
});

describe("Marketing leftover amber (source)", () => {
  it("names leftover badges, scrolls in-page, and does not set location.hash", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/id=\{`creative-\$\{c\.id\}`\}/);
    expect(panel).toMatch(/leftoverShowTargets/);
    expect(panel).toMatch(/kitAiMissedCard/);
    expect(panel).toMatch(/kitAiMissedCards/);
    expect(panel).toMatch(/showCard/);
    expect(panel).toMatch(/scrollIntoView/);
    expect(panel).not.toMatch(/location\.hash\s*=/);
    expect(panel).not.toMatch(/#creative-/);

    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.kitAiMissedCard).toMatch(/\{n\}/);
    expect(en.Marketing.kitAiMissedCards).toMatch(/\{list\}/);
    expect(en.Marketing.showCard).toMatch(/\{n\}/);
    expect(en.Marketing.leftoverDraftChip).toMatch(/Built-in draft/i);
    expect(ar.Marketing.kitAiMissedCard).toMatch(/\{n\}/);
    expect(ar.Marketing.kitAiMissedCards).toMatch(/\{list\}/);
    expect(ar.Marketing.showCard).toMatch(/أظهر البطاقة \{n\}/);
    expect(ar.Marketing.leftoverDraftChip).toBeTruthy();
  });
});
