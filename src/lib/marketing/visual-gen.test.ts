import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  HIGGSFIELD_API_BASE,
  HIGGSFIELD_NANO_I2I_PATH,
  HIGGSFIELD_NANO_T2I_PATH,
  HIGGSFIELD_SEEDANCE_I2V_PATH,
  HIGGSFIELD_SEEDANCE_T2V_PATH,
  higgsfieldSubmitPath,
} from "@/lib/marketing/visual-higgsfield";
import {
  VISUAL_GEN_MAX_REGENERATES,
  canRegenerateVisual,
  evaluateVisualGenGate,
  nextRegenerateCount,
  regenCountAfterDiscard,
} from "@/lib/marketing/visual-pack-ui";

const skuId = "sku_live_1";

function gate(
  patch: Partial<Parameters<typeof evaluateVisualGenGate>[0]> = {},
) {
  return evaluateVisualGenGate({
    flagOn: true,
    keysPresent: true,
    monthlyCap: 80,
    used: 0,
    skuId,
    tool: "nano_banana",
    mode: "generate",
    regenerateCount: 0,
    hasFile: false,
    ...patch,
  });
}

describe("evaluateVisualGenGate", () => {
  it("allows a first Generate when the flag, keys, and cap are open", () => {
    expect(gate()).toEqual({ ok: true });
    expect(gate({ tool: "nano_banana" })).toEqual({ ok: true });
  });

  it("hides Generate when the flag is off", () => {
    expect(gate({ flagOn: false })).toEqual({
      ok: false,
      error: "flag_off",
    });
  });

  it("fails closed when Higgsfield keys are missing", () => {
    expect(gate({ keysPresent: false })).toEqual({
      ok: false,
      error: "no_keys",
    });
  });

  it("fails closed when the monthly visual cap is 0 or spent", () => {
    expect(gate({ monthlyCap: 0, used: 0 })).toEqual({
      ok: false,
      error: "monthly_cap",
    });
    expect(gate({ monthlyCap: 80, used: 80 })).toEqual({
      ok: false,
      error: "monthly_cap",
    });
  });

  it("skips phone film and Seedance even when Generate is otherwise ready", () => {
    expect(gate({ tool: "phone_film" })).toEqual({
      ok: false,
      error: "skipped",
    });
    expect(gate({ tool: "seedance" })).toEqual({
      ok: false,
      error: "skipped",
    });
  });

  it("refuses whole-shop / null skuId", () => {
    expect(gate({ skuId: null })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("caps Regenerates at 3 after the first Generate", () => {
    expect(VISUAL_GEN_MAX_REGENERATES).toBe(3);
    expect(canRegenerateVisual(0)).toBe(true);
    expect(canRegenerateVisual(2)).toBe(true);
    expect(canRegenerateVisual(3)).toBe(false);
    expect(nextRegenerateCount(0)).toBe(1);
    expect(nextRegenerateCount(2)).toBe(3);
    expect(
      gate({
        mode: "regenerate",
        hasFile: true,
        regenerateCount: 2,
      }),
    ).toEqual({ ok: true });
    expect(
      gate({
        mode: "regenerate",
        hasFile: true,
        regenerateCount: 3,
      }),
    ).toEqual({ ok: false, error: "regen_cap" });
  });

  it("refuses Regenerates when there is no file; Discard resets the count", () => {
    expect(
      gate({ mode: "regenerate", hasFile: false, regenerateCount: 1 }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(regenCountAfterDiscard()).toBe(0);
    expect(
      gate({
        mode: "generate",
        hasFile: false,
        regenerateCount: regenCountAfterDiscard(),
      }),
    ).toEqual({ ok: true });
  });
});

describe("higgsfieldSubmitPath", () => {
  it("routes stills to Nano Banana 2 and motion to Seedance (not footage-fix)", () => {
    expect(HIGGSFIELD_API_BASE).toBe("https://api.higgsfield.ai");
    expect(higgsfieldSubmitPath("nano_banana", 0)).toBe(HIGGSFIELD_NANO_T2I_PATH);
    expect(higgsfieldSubmitPath("nano_banana", 3)).toBe(HIGGSFIELD_NANO_I2I_PATH);
    expect(HIGGSFIELD_NANO_T2I_PATH).toBe("/nano-banana-2/text-to-image");
    expect(HIGGSFIELD_NANO_I2I_PATH).toBe("/nano-banana-2/image-to-image");
    expect(higgsfieldSubmitPath("seedance", 2)).toBe(
      HIGGSFIELD_SEEDANCE_I2V_PATH,
    );
    expect(higgsfieldSubmitPath("seedance", 0)).toBe(
      HIGGSFIELD_SEEDANCE_T2V_PATH,
    );
    expect(HIGGSFIELD_SEEDANCE_I2V_PATH).toMatch(/image-to-video/);
    expect(HIGGSFIELD_SEEDANCE_I2V_PATH).not.toMatch(/footage/);
  });
});

describe("Phase 6c source locks", () => {
  const root = process.cwd();

  it("does not import Gemini usage or MCP; persists our copy", () => {
    const gen = readFileSync(
      path.join(root, "src/lib/marketing/visual-gen.ts"),
      "utf8",
    );
    expect(gen).toMatch(/recordMarketingVisualCalls/);
    expect(gen).toMatch(/writeOwnedFile/);
    expect(gen).toMatch(/resolveNanoHiggsfieldPrompt/);
    expect(gen).toMatch(/resolveSeedanceHiggsfieldPrompt/);
    expect(gen).toMatch(/tool === "nano_banana"/);
    expect(gen).not.toMatch(/recordMarketingGeminiCalls/);
    expect(gen).not.toMatch(/marketingGeminiUsage/);
    expect(gen).not.toMatch(/MARKETING_GEMINI_MONTHLY_CAP/);

    const hf = readFileSync(
      path.join(root, "src/lib/marketing/visual-higgsfield.ts"),
      "utf8",
    );
    expect(hf).toMatch(/https:\/\/api\.higgsfield\.ai/);
    expect(hf).toMatch(/api\.higgsfield\.ai/);
    expect(hf).toMatch(/platform\.higgsfield\.ai/);
    expect(hf).toMatch(/nano-banana-2\/text-to-image/);
    expect(hf).toMatch(/nano-banana-2\/image-to-image/);
    expect(hf).toMatch(/HIGGSFIELD_NANO_RESOLUTION = "4k"/);
    expect(hf).toMatch(/HIGGSFIELD_SEEDANCE_RESOLUTION = "1080"/);
    expect(hf).toMatch(/seedance\/v1\/pro\/fast/);
    expect(hf).toMatch(/seedance\/v1\/lite/);
    expect(hf).not.toMatch(/["']\/nano-banana["']/);
    expect(hf).not.toMatch(/nano-banana-2\/lite/);
    expect(hf).not.toMatch(/resolution: "1k"/);
    expect(hf).toMatch(/Authorization: authHeader/);
    expect(hf).not.toMatch(/mcp\.higgsfield/);
    expect(hf).not.toMatch(/@higgsfield\/client/);
    expect(hf).not.toMatch(/MARKETING_GEMINI_MONTHLY_CAP/);
    expect(hf).not.toMatch(/marketingGeminiUsage/);
  });

  it("client surfaces stay off visual-packs.ts / db / storage", () => {
    for (const rel of [
      "src/components/marketing/MarketingPanel.tsx",
      "src/components/marketing/VisualResultDialog.tsx",
    ]) {
      const src = readFileSync(path.join(root, rel), "utf8");
      expect(src).not.toMatch(/from ["']@\/lib\/marketing\/visual-packs["']/);
      expect(src).not.toMatch(/from ["']@\/db["']/);
      expect(src).not.toMatch(/visual-storage/);
      expect(src).not.toMatch(/from ["']postgres["']/);
      expect(src).not.toMatch(/HF_API_KEY/);
    }
    const actions = readFileSync(
      path.join(root, "src/actions/visual-gen.ts"),
      "utf8",
    );
    expect(actions).toMatch(/requireOnboardedWorkspace/);
    expect(actions).toMatch(/export async function generateVisualAction/);
    expect(actions).toMatch(/export async function regenerateVisualAction/);
    expect(actions).toMatch(/export async function discardVisualAction/);
    expect(actions).toMatch(/export async function copyNanoVisualPromptAction/);
    expect(actions).not.toMatch(/maxDuration/);
  });
});
