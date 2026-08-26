import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  HIGGSFIELD_API_BASE,
  HIGGSFIELD_NANO_I2I_PATH,
  HIGGSFIELD_NANO_RESOLUTION,
  HIGGSFIELD_NANO_T2I_PATH,
  HIGGSFIELD_SEEDANCE_RESOLUTION,
  higgsfieldSubmitPath,
  isHiggsfieldStatusUrl,
} from "@/lib/marketing/visual-higgsfield";

describe("Higgsfield Cloud API targeting", () => {
  it("submits to api.higgsfield.ai Nano Banana 2 (t2i / i2i)", () => {
    expect(HIGGSFIELD_API_BASE).toBe("https://api.higgsfield.ai");
    expect(HIGGSFIELD_NANO_T2I_PATH).toBe("/nano-banana-2/text-to-image");
    expect(HIGGSFIELD_NANO_I2I_PATH).toBe("/nano-banana-2/image-to-image");
    expect(higgsfieldSubmitPath("nano_banana", 0)).toBe(
      HIGGSFIELD_NANO_T2I_PATH,
    );
    expect(higgsfieldSubmitPath("nano_banana", 1)).toBe(
      HIGGSFIELD_NANO_I2I_PATH,
    );
    expect(HIGGSFIELD_NANO_RESOLUTION).toBe("4k");
    expect(HIGGSFIELD_SEEDANCE_RESOLUTION).toBe("1080");
    expect(higgsfieldSubmitPath("seedance", 0)).toBe(
      "/bytedance/seedance/v1/lite/text-to-video",
    );
    expect(higgsfieldSubmitPath("seedance", 1)).toBe(
      "/bytedance/seedance/v1/lite/image-to-video",
    );
  });

  it("allows status URLs on api and platform hosts", () => {
    const id = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
    expect(
      isHiggsfieldStatusUrl(`https://api.higgsfield.ai/requests/${id}/status`),
    ).toBe(true);
    expect(
      isHiggsfieldStatusUrl(
        `https://platform.higgsfield.ai/requests/${id}/status`,
      ),
    ).toBe(true);
    expect(
      isHiggsfieldStatusUrl(`https://cdn.higgsfield.ai/requests/${id}/status`),
    ).toBe(false);
    expect(
      isHiggsfieldStatusUrl(`http://api.higgsfield.ai/requests/${id}/status`),
    ).toBe(false);
  });

  it("does not use MCP, persist Higgsfield URLs, or mix Gemini ledger", () => {
    const hf = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/visual-higgsfield.ts"),
      "utf8",
    );
    expect(hf).not.toMatch(/mcp\.higgsfield/);
    expect(hf).not.toMatch(/@higgsfield\/client/);
    expect(hf).toMatch(/never persist HF URLs/i);
    expect(hf).toMatch(/downloadOutput/);
    expect(hf).not.toMatch(/marketingGeminiUsage/);
    expect(hf).not.toMatch(/MARKETING_GEMINI_MONTHLY_CAP/);
    expect(hf).not.toMatch(/["']\/nano-banana["']/);
    expect(hf).toMatch(/HIGGSFIELD_NANO_RESOLUTION = "4k"/);
    expect(hf).toMatch(/HIGGSFIELD_SEEDANCE_RESOLUTION = "1080"/);
    expect(hf).not.toMatch(/nano-banana-2\/lite/);
    expect(hf).toMatch(/resolution: HIGGSFIELD_NANO_RESOLUTION/);
    expect(hf).toMatch(/resolution: HIGGSFIELD_SEEDANCE_RESOLUTION/);
    expect(hf).not.toMatch(/resolution: "1k"/);
    expect(hf).not.toMatch(/resolution: "720"/);
  });
});
