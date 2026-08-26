import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeSkillRecipe,
  CLAUDE_CUSTOMIZE_SKILLS_URL,
  serializeKitForExternalDesk,
} from "@/lib/marketing/ai-desk";
import type { Creative } from "@/lib/marketing/creatives";

function card(partial: Partial<Creative> & { id: string }): Creative {
  return {
    format: "reel",
    angleEn: "angle",
    angleAr: "زاوية",
    captionEn: "caption en",
    captionAr: "تعليق",
    shots: ["Wide product on desk"],
    howToShootEn: "Phone, window light, 8s",
    howToShootAr: "هاتف، ضوء نافذة",
    seriesLabelEn: "",
    seriesLabelAr: "",
    hookEn: "hook en",
    hookAr: "خطاف",
    weekIndex: 1,
    weekLabelEn: "Week 1",
    weekLabelAr: "الأسبوع 1",
    suggestedDay: "mon",
    suggestedTimeBand: "morning",
    whyEn: "why",
    whyAr: "لماذا",
    scheduleIgnored: false,
    ...partial,
  };
}

describe("serializeKitForExternalDesk", () => {
  it("includes all non-ignored cards (format, hooks, captions, shots, how-to)", () => {
    const paste = serializeKitForExternalDesk({
      productName: "GlowLamp Pro",
      stage: "launch",
      cards: [
        card({
          id: "a",
          format: "reel",
          hookEn: "Hook A EN",
          hookAr: "خطاف أ",
          captionEn: "Caption A EN",
          captionAr: "تعليق أ",
          shots: ["Shot A1", "Shot A2"],
          howToShootEn: "How A EN",
          howToShootAr: "كيف أ",
          weekIndex: 1,
          weekLabelEn: "Week 1 open",
          weekLabelAr: "الأسبوع 1",
        }),
        card({
          id: "b",
          format: "story",
          hookEn: "Hook B EN",
          hookAr: "خطاف ب",
          captionEn: "Caption B EN",
          captionAr: "تعليق ب",
          shots: ["Shot B1"],
          howToShootEn: "How B EN",
          howToShootAr: "كيف ب",
          weekIndex: 2,
          weekLabelEn: "Week 2 convert",
          weekLabelAr: "الأسبوع 2",
          suggestedDay: "tue",
        }),
      ],
    });
    expect(paste).toBeTruthy();
    expect(paste).toContain("Product: GlowLamp Pro");
    expect(paste).toMatch(/launch/i);
    expect(paste).toContain("weekIndex 1");
    expect(paste).toContain("Week 1 open");
    expect(paste).toContain("الأسبوع 1");
    expect(paste).toContain("Format: reel");
    expect(paste).toContain("Hook (EN): Hook A EN");
    expect(paste).toContain("Hook (AR): خطاف أ");
    expect(paste).toContain("Caption (EN): Caption A EN");
    expect(paste).toContain("Caption (AR): تعليق أ");
    expect(paste).toContain("- Shot A1");
    expect(paste).toContain("- Shot A2");
    expect(paste).toContain("How to shoot (EN): How A EN");
    expect(paste).toContain("How to shoot (AR): كيف أ");
    expect(paste).toContain("Format: story");
    expect(paste).toContain("Hook (EN): Hook B EN");
    expect(paste).toContain("- Shot B1");
    expect(paste).not.toContain("templateIds");
    expect(paste).not.toContain("source:");
    expect(paste).not.toMatch(/https?:\/\/.+\.(png|jpg|mp4)/i);
    expect(paste).not.toContain("MARKETING_GEMINI_MONTHLY_CAP");
  });

  it("skips ignored cards and is honest when empty", () => {
    expect(
      serializeKitForExternalDesk({
        productName: "GlowLamp Pro",
        stage: "pre_launch",
        cards: [],
      }),
    ).toBeNull();
    expect(
      serializeKitForExternalDesk({
        productName: "GlowLamp Pro",
        stage: "weekly_refresh",
        cards: [card({ id: "x", scheduleIgnored: true })],
      }),
    ).toBeNull();
  });
});

describe("buildClaudeSkillRecipe", () => {
  it("has shop-wide guardrails and no product name", () => {
    const recipe = buildClaudeSkillRecipe();
    expect(recipe.toLowerCase()).toContain("lebanon");
    expect(recipe.toLowerCase()).toContain("whatsapp");
    expect(recipe.toLowerCase()).toMatch(/cod|cash-on-delivery/);
    expect(recipe.toLowerCase()).toMatch(/roas|margin/);
    expect(recipe.toLowerCase()).toMatch(/stage/);
    expect(recipe.toLowerCase()).toMatch(/do not invent a full/);
    expect(recipe.toLowerCase()).toMatch(/tighten one post|angles/);
    expect(recipe).not.toContain("GlowLamp");
    expect(recipe).not.toMatch(/Product:/);
    expect(CLAUDE_CUSTOMIZE_SKILLS_URL).toBe(
      "https://claude.ai/customize/skills",
    );
  });
});

describe("More help UI (desk copy)", () => {
  it("does not keep old rewrite-helper role novels in the panel", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).not.toContain("You are a rewrite helper");
    expect(panel).not.toContain("buildExternalAiDeskPrompts");
    expect(panel).toContain("serializeKitForExternalDesk");
    expect(panel).toContain("buildClaudeSkillRecipe");
    expect(panel).toContain("CLAUDE_CUSTOMIZE_SKILLS_URL");
    expect(panel).toContain('rel="noopener noreferrer"');
    expect(panel).toContain("deskOpen");
    expect(panel).toMatch(/useState\(false\)/);
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    expect(en.Marketing.deskIntro.toLowerCase()).toContain("copy whole kit");
    expect(en.Marketing.deskIntro.toLowerCase()).toContain("create skill");
    expect(en.Marketing.deskIntro.toLowerCase()).not.toContain(
      "copy a prompt, paste it",
    );
    expect(en.Marketing.deskCopyKitForClaude.toLowerCase()).toContain("claude");
    expect(en.Marketing.deskCopyKitForClaude.toLowerCase()).toContain("chat");
    expect(en.Marketing.deskCopySkillForClaude.toLowerCase()).toContain(
      "skills",
    );
    expect(en.Marketing.deskMoreHelp.toLowerCase()).toContain("claude");
    expect(en.Marketing.deskMoreHelp).not.toBe("More help · copy kit");
    expect(JSON.stringify(en.Marketing)).not.toContain("More help · copy kit");
    expect(en.Marketing.deskWholeKitTitle.toLowerCase()).toContain("claude");
    expect(panel).toContain("deskCopyKitForClaude");
    expect(panel).toContain("deskCopySkillForClaude");
    expect(panel).toContain("deskCopied");
  });
});
