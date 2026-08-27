import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CLAUDE_APP_URL, XPOZ_MCP_CONNECTOR_URL } from "@/lib/marketing/ai-desk";

describe("CLAUDE_APP_URL", () => {
  it("is claude.ai for Seedance Open Claude (not Skills)", () => {
    expect(CLAUDE_APP_URL).toBe("https://claude.ai");
  });
});

describe("XPOZ_MCP_CONNECTOR_URL", () => {
  it("is the Xpoz MCP connector (not Higgsfield)", () => {
    expect(XPOZ_MCP_CONNECTOR_URL).toBe("https://mcp.xpoz.ai/mcp");
    expect(XPOZ_MCP_CONNECTOR_URL).not.toMatch(/higgsfield/i);
  });
});

describe("More help · Claude desk removed", () => {
  it("kit panel has no whole-kit paste / Skill recipe; Seedance Open Claude stays", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).not.toContain("You are a rewrite helper");
    expect(panel).not.toContain("buildExternalAiDeskPrompts");
    expect(panel).not.toContain("serializeKitForExternalDesk");
    expect(panel).not.toContain("buildClaudeSkillRecipe");
    expect(panel).not.toContain("CLAUDE_CUSTOMIZE_SKILLS_URL");
    expect(panel).not.toContain("deskOpen");
    expect(panel).not.toContain("deskMoreHelp");
    expect(panel).not.toContain("deskCopyKitForClaude");
    expect(panel).not.toContain("deskCopySkillForClaude");
    expect(panel).toContain("CLAUDE_APP_URL");
    expect(panel).toContain("deskCopied");
    expect(panel).toContain("visualSeedanceOpenClaude");

    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string | undefined> };
    expect(en.Marketing.deskCopied).toMatch(/Copied/i);
    expect(en.Marketing.deskMoreHelp).toBeUndefined();
    expect(en.Marketing.deskIntro).toBeUndefined();
    expect(en.Marketing.deskCopyKitForClaude).toBeUndefined();
    expect(JSON.stringify(en.Marketing)).not.toContain("More help · Claude");
    expect(JSON.stringify(en.Marketing)).not.toContain("More help · copy kit");
  });
});
