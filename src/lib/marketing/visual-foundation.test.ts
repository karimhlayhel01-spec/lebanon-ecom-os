import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MARKETING_VISUAL_MONTHLY_CAP_DEFAULT } from "@/lib/constants";
import {
  isHiggsfieldConfigured,
  isMarketingVisualGenEnabled,
  isMarketingVisualGenReady,
} from "@/lib/marketing/visual-flags";
import { parsePhotoPackSkuId } from "@/lib/marketing/visual-packs";
import {
  canSpendMarketingVisualCall,
  remainingMarketingVisualAllowance,
  resolveMarketingVisualMonthlyCap,
} from "@/lib/marketing/marketing-visual-usage";
import {
  MARKETING_VISUAL_STORAGE_ROOT,
  creativeVisualRelPath,
  photoPackAssetRelPath,
  resolveOwnedStorageAbs,
} from "@/lib/marketing/visual-storage";

describe("isMarketingVisualGenEnabled", () => {
  it("is off by default and only 1|true enable it", () => {
    expect(isMarketingVisualGenEnabled({})).toBe(false);
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: undefined })).toBe(
      false,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "" })).toBe(
      false,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "0" })).toBe(
      false,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "false" })).toBe(
      false,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "yes" })).toBe(
      false,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "1" })).toBe(
      true,
    );
    expect(isMarketingVisualGenEnabled({ MARKETING_VISUAL_GEN: "true" })).toBe(
      true,
    );
  });

  it("Generate is ready only when the flag is on AND Higgsfield keys exist", () => {
    expect(isHiggsfieldConfigured({})).toBe(false);
    expect(
      isMarketingVisualGenReady({
        MARKETING_VISUAL_GEN: "1",
      }),
    ).toBe(false);
    expect(
      isMarketingVisualGenReady({
        MARKETING_VISUAL_GEN: "1",
        HF_API_KEY_ID: "id",
        HF_API_KEY_SECRET: "secret",
      }),
    ).toBe(true);
    expect(
      isMarketingVisualGenReady({
        MARKETING_VISUAL_GEN: "0",
        HF_API_KEY_ID: "id",
        HF_API_KEY_SECRET: "secret",
      }),
    ).toBe(false);
  });
});

describe("resolveMarketingVisualMonthlyCap", () => {
  it("defaults to 80; explicit 0; garbage/negative → 80; does not read Gemini cap", () => {
    expect(MARKETING_VISUAL_MONTHLY_CAP_DEFAULT).toBe(80);
    expect(resolveMarketingVisualMonthlyCap({})).toBe(80);
    expect(
      resolveMarketingVisualMonthlyCap({ MARKETING_VISUAL_MONTHLY_CAP: "" }),
    ).toBe(80);
    expect(
      resolveMarketingVisualMonthlyCap({
        MARKETING_VISUAL_MONTHLY_CAP: "unlimited",
      }),
    ).toBe(80);
    expect(
      resolveMarketingVisualMonthlyCap({ MARKETING_VISUAL_MONTHLY_CAP: "-3" }),
    ).toBe(80);
    expect(
      resolveMarketingVisualMonthlyCap({ MARKETING_VISUAL_MONTHLY_CAP: "80" }),
    ).toBe(80);
    expect(
      resolveMarketingVisualMonthlyCap({ MARKETING_VISUAL_MONTHLY_CAP: "0" }),
    ).toBe(0);
    expect(
      resolveMarketingVisualMonthlyCap({
        MARKETING_GEMINI_MONTHLY_CAP: "1",
        MARKETING_VISUAL_MONTHLY_CAP: undefined,
      }),
    ).toBe(80);
  });

  it("gates spend at the cap (fail-closed)", () => {
    expect(canSpendMarketingVisualCall(80, 0)).toBe(true);
    expect(canSpendMarketingVisualCall(80, 79)).toBe(true);
    expect(canSpendMarketingVisualCall(80, 80)).toBe(false);
    expect(canSpendMarketingVisualCall(0, 0)).toBe(false);
    expect(remainingMarketingVisualAllowance(80, 90)).toBe(0);
  });
});

describe("parsePhotoPackSkuId", () => {
  it("refuses skuId null / blank (whole-shop packs are not this slice)", () => {
    expect(parsePhotoPackSkuId(null)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(parsePhotoPackSkuId(undefined).ok).toBe(false);
    expect(parsePhotoPackSkuId("").ok).toBe(false);
    expect(parsePhotoPackSkuId("sku_1")).toEqual({
      ok: true,
      skuId: "sku_1",
    });
  });
});

describe("visual storage paths", () => {
  it("stays under data/marketing-visuals, never /public", () => {
    expect(MARKETING_VISUAL_STORAGE_ROOT).toBe("data/marketing-visuals");
    const photo = photoPackAssetRelPath({
      workspaceId: "ws",
      skuId: "sku",
      packId: "pack",
      assetId: "a1",
    });
    expect(photo.startsWith("data/marketing-visuals/")).toBe(true);
    expect(photo).not.toMatch(/\/public\//);
    const gen = creativeVisualRelPath({
      workspaceId: "ws",
      skuId: "sku",
      kitId: "kit",
      creativeId: "c1",
    });
    expect(gen.startsWith("data/marketing-visuals/")).toBe(true);
  });

  it("rejects path traversal and paths outside the owned root", () => {
    expect(resolveOwnedStorageAbs("data/marketing-visuals/ws/sku/a")).toMatch(
      /marketing-visuals/,
    );
    expect(
      resolveOwnedStorageAbs("data/marketing-visuals/../.env"),
    ).toBeNull();
    expect(
      resolveOwnedStorageAbs("data/marketing-visuals/ws/../../.env"),
    ).toBeNull();
    expect(resolveOwnedStorageAbs("/etc/passwd")).toBeNull();
    expect(resolveOwnedStorageAbs("public/uploads/x")).toBeNull();
  });
});

describe("Gemini usage module untouched", () => {
  it("visual ledger does not import or increment Gemini usage", () => {
    const visual = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/marketing-visual-usage.ts"),
      "utf8",
    );
    expect(visual).not.toMatch(/marketingGeminiUsage/);
    expect(visual).not.toMatch(/MARKETING_GEMINI_MONTHLY_CAP/);
    expect(visual).toMatch(/schema\.marketingVisualUsage/);

    const gemini = readFileSync(
      path.join(process.cwd(), "src/lib/marketing/marketing-gemini-usage.ts"),
      "utf8",
    );
    expect(gemini).not.toMatch(/MARKETING_VISUAL/);
    expect(gemini).not.toMatch(/marketingVisualUsage/);

    for (const rel of [
      "src/lib/marketing/visual-gen.ts",
      "src/lib/marketing/visual-higgsfield.ts",
    ]) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/marketingGeminiUsage/);
      expect(src).not.toMatch(/MARKETING_GEMINI_MONTHLY_CAP/);
    }
  });
});
