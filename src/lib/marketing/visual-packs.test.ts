import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  isBlankPhotoPackName,
  newPackIsDefault,
  nextAutoPhotoPackName,
  packDefaultFlagsAfterSet,
  packIdForCreative,
  packIdToPromoteAfterDelete,
  parsePhotoPackSkuId,
  productPhotosPath,
  resolveMotionMime,
  resolvePhotoMime,
  resolveSelectedPackId,
  sanitizePhotoPackName,
  showPhotoPackDefaultControls,
  visualToolUsesPhotoPack,
} from "@/lib/marketing/visual-packs";

describe("parsePhotoPackSkuId — refuse shop", () => {
  it("refuses null / blank skuId (whole-shop packs are not this slice)", () => {
    expect(parsePhotoPackSkuId(null)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(parsePhotoPackSkuId(undefined).ok).toBe(false);
    expect(parsePhotoPackSkuId("").ok).toBe(false);
    expect(parsePhotoPackSkuId("  ").ok).toBe(false);
  });
});

describe("default pack", () => {
  it("first pack is default; later packs are not until setDefault", () => {
    expect(newPackIsDefault(0)).toBe(true);
    expect(newPackIsDefault(1)).toBe(false);
    expect(newPackIsDefault(4)).toBe(false);
  });

  it("setDefault leaves exactly one default", () => {
    const flags = packDefaultFlagsAfterSet(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      "b",
    );
    expect(flags.filter((p) => p.isDefault).map((p) => p.id)).toEqual(["b"]);
    expect(flags.find((p) => p.id === "a")?.isDefault).toBe(false);
    expect(flags.find((p) => p.id === "c")?.isDefault).toBe(false);
  });
});

describe("packIdToPromoteAfterDelete", () => {
  const remaining = [
    { id: "newer", createdAt: "2026-08-17T12:00:00.000Z" },
    { id: "oldest", createdAt: "2026-08-17T10:00:00.000Z" },
  ];

  it("promotes the oldest remaining pack when the default is deleted", () => {
    expect(
      packIdToPromoteAfterDelete({
        deletedWasDefault: true,
        remaining,
      }),
    ).toBe("oldest");
  });

  it("leaves no default when the last pack is deleted", () => {
    expect(
      packIdToPromoteAfterDelete({
        deletedWasDefault: true,
        remaining: [],
      }),
    ).toBeNull();
  });

  it("does not steal default when a non-default pack is deleted", () => {
    expect(
      packIdToPromoteAfterDelete({
        deletedWasDefault: false,
        remaining,
      }),
    ).toBeNull();
  });
});

describe("resolveSelectedPackId", () => {
  const packs = [
    { id: "look-a", isDefault: false },
    { id: "look-b", isDefault: true },
  ];

  it("uses the saved choice when it still exists", () => {
    expect(
      resolveSelectedPackId({ chosenPackId: "look-a", packs }),
    ).toBe("look-a");
  });

  it("falls back to the default pack when unset or stale", () => {
    expect(resolveSelectedPackId({ chosenPackId: null, packs })).toBe("look-b");
    expect(
      resolveSelectedPackId({ chosenPackId: "gone", packs }),
    ).toBe("look-b");
    expect(resolveSelectedPackId({ chosenPackId: null, packs: [] })).toBeNull();
  });
});

describe("sanitizePhotoPackName", () => {
  it("trims and does not invent the name folder", () => {
    expect(sanitizePhotoPackName("  Gift box  ")).toBe("Gift box");
    expect(sanitizePhotoPackName("")).toBeNull();
    expect(sanitizePhotoPackName("   ")).toBeNull();
    expect(sanitizePhotoPackName(null)).toBeNull();
  });
});

describe("nextAutoPhotoPackName", () => {
  it("assigns Pack 1, then the next free Pack N", () => {
    expect(nextAutoPhotoPackName([])).toBe("Pack 1");
    expect(nextAutoPhotoPackName(["Pack 1"])).toBe("Pack 2");
    expect(nextAutoPhotoPackName(["Pack 1", "Pack 2"])).toBe("Pack 3");
    expect(nextAutoPhotoPackName(["Pack 1", "Pack 3"])).toBe("Pack 2");
    expect(nextAutoPhotoPackName(["Gift box"])).toBe("Pack 1");
  });

  it("treats blank create as auto-name, typed override as sanitize", () => {
    expect(isBlankPhotoPackName("")).toBe(true);
    expect(isBlankPhotoPackName("   ")).toBe(true);
    expect(isBlankPhotoPackName(null)).toBe(true);
    expect(isBlankPhotoPackName("Gift box")).toBe(false);
    expect(showPhotoPackDefaultControls(0)).toBe(false);
    expect(showPhotoPackDefaultControls(1)).toBe(false);
    expect(showPhotoPackDefaultControls(2)).toBe(true);
  });
});

describe("visualToolUsesPhotoPack", () => {
  it("Nano/Seedance yes; phone film no", () => {
    expect(visualToolUsesPhotoPack("nano_banana")).toBe(true);
    expect(visualToolUsesPhotoPack("seedance")).toBe(true);
    expect(visualToolUsesPhotoPack("phone_film")).toBe(false);
  });
});

describe("pack media MIME", () => {
  it("accepts jpeg/png/webp photos and mp4/webm clips", () => {
    expect(resolvePhotoMime("image/jpeg", "x.jpg")).toBe("image/jpeg");
    expect(resolvePhotoMime("", "shot.PNG")).toBe("image/png");
    expect(resolvePhotoMime("image/gif", "x.gif")).toBeNull();
    expect(resolveMotionMime("video/mp4", "x.mp4")).toBe("video/mp4");
    expect(resolveMotionMime("", "pour.MOV")).toBe("video/quicktime");
    expect(resolveMotionMime("video/avi", "x.avi")).toBeNull();
  });
});

describe("packIdForCreative", () => {
  it("matches kit + creative", () => {
    expect(
      packIdForCreative(
        [{ kitId: "k1", creativeId: "c1", packId: "p1" }],
        "k1",
        "c1",
      ),
    ).toBe("p1");
    expect(
      packIdForCreative(
        [{ kitId: "k1", creativeId: "c1", packId: "p1" }],
        "k1",
        "c2",
      ),
    ).toBeNull();
  });
});

describe("Phase 6b UI source", () => {
  const root = process.cwd();

  it("upload is a SKU page with bold how-to; packs refuse shop skuId", () => {
    expect(productPhotosPath("sku_1")).toBe("/sku/sku_1/product-photos");
    const page = readFileSync(
      path.join(root, "src/app/[locale]/sku/[id]/product-photos/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/requireOnboardedContext/);
    expect(page).toMatch(/assertSkuOwned/);
    expect(page).toMatch(/photoPacksTitle/);
    expect(page).toMatch(/photoPacksHowToTitle/);
    expect(page).toMatch(/font-bold/);
    expect(page).not.toMatch(/Higgsfield|HF_API|generateVisual/);

    const client = readFileSync(
      path.join(root, "src/components/marketing/ProductPhotosClient.tsx"),
      "utf8",
    );
    expect(client).toMatch(/createPhotoPackAction/);
    expect(client).toMatch(/deletePhotoPackAction/);
    expect(client).toMatch(/type="file"/);
    expect(client).toMatch(/className="sr-only"/);
    expect(client).toMatch(/inputRef\.current\?\.click\(\)/);
    expect(client).toMatch(/window\.confirm/);
    expect(client).toMatch(/photoPacksDeleteConfirm/);
    expect(client).not.toMatch(/Choose File/);
    expect(client).toMatch(/showPhotoPackDefaultControls/);
    const createForm = client.slice(
      client.indexOf("photoPacksNewName"),
      client.indexOf("photoPacksCreate"),
    );
    expect(createForm).not.toMatch(/required/);
    expect(client).toMatch(/from "@\/lib\/marketing\/visual-pack-ui"/);
    expect(client).not.toMatch(/from "@\/lib\/marketing\/visual-packs"/);
    expect(client).not.toMatch(/Higgsfield|generateVisual/);
  });

  it("client MarketingPanel does not import the server visual-packs module", () => {
    const panel = readFileSync(
      path.join(root, "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/from "@\/lib\/marketing\/visual-pack-ui"/);
    expect(panel).not.toMatch(/from "@\/lib\/marketing\/visual-packs"/);
    expect(panel).toMatch(/setCreativePackChoiceAction/);
    const pickAt = panel.lastIndexOf("setCreativePackChoiceAction(");
    expect(pickAt).toBeGreaterThan(0);
    expect(panel.slice(Math.max(0, pickAt - 500), pickAt)).toMatch(
      /stayOnMarketingForKitWrite/,
    );

    const ui = readFileSync(
      path.join(root, "src/lib/marketing/visual-pack-ui.ts"),
      "utf8",
    );
    expect(ui).not.toMatch(/from ["']@\/db["']/);
    expect(ui).not.toMatch(/from ["']drizzle-orm["']/);
    expect(ui).not.toMatch(/visual-storage/);
    expect(ui).not.toMatch(/from ["']fs["']/);
    expect(ui).not.toMatch(/from ["']postgres["']/);
    expect(ui).not.toMatch(/assertSkuOwned|requirePhotoPackSku/);
  });

  it("Nano/Seedance cards pick a pack; phone film and shop kit do not", () => {
    const panel = readFileSync(
      path.join(root, "src/components/marketing/MarketingPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/photoPacksAdd/);
    expect(panel).toMatch(/visualToolUsesPhotoPack/);
    expect(panel).toMatch(/photoPacksSeedanceChoice/);
    expect(panel).toMatch(/photoPacksNanoChoice/);
    expect(panel).toMatch(/visual\?\.tool === "seedance"/);
    expect(panel).toMatch(/visual\?\.tool === "nano_banana"/);
    expect(panel).toMatch(/photoPacksEmptyPointer/);
    expect(panel).toMatch(/view\.isShopKit \? null/);
    expect(panel).toMatch(/view\.isShopKit \? \[\]/);
    const picker = panel.slice(
      panel.indexOf("photoPacksPickerLabel"),
      panel.indexOf("visualToolPromptLabel"),
    );
    expect(picker).toMatch(/stayOnMarketingForKitWrite/);
    expect(picker).not.toMatch(/scrollIntoView/);
    expect(picker).not.toMatch(/photoPacksSeedanceChoice/);
    expect(picker).not.toMatch(/photoPacksNanoChoice/);
    expect(panel).toMatch(/generateVisualAction/);
    expect(panel).toMatch(/regenerateVisualAction/);
    expect(panel).toMatch(/discardVisualAction/);
    expect(panel).toMatch(/VisualResultDialog/);
    expect(panel).not.toMatch(/Higgsfield/);
    expect(panel).not.toMatch(/from ["']@\/db["']/);
    expect(panel).not.toMatch(/visual-storage/);
    expect(panel).not.toMatch(/HF_API_KEY/);
    const genAt = panel.indexOf("generateVisualAction(");
    expect(genAt).toBeGreaterThan(0);
    expect(panel.slice(Math.max(0, genAt - 400), genAt)).toMatch(
      /stayOnMarketingForKitWrite/,
    );
    const regenAt = panel.indexOf("regenerateVisualAction(");
    expect(regenAt).toBeGreaterThan(0);
    expect(panel.slice(Math.max(0, regenAt - 400), regenAt)).toMatch(
      /stayOnMarketingForKitWrite/,
    );
    const discardAt = panel.indexOf("discardVisualAction(");
    expect(discardAt).toBeGreaterThan(0);
    expect(panel.slice(Math.max(0, discardAt - 500), discardAt)).toMatch(
      /stayOnMarketingForKitWrite/,
    );
    const visualBox = panel.slice(
      panel.indexOf("visualToolTitle"),
      panel.lastIndexOf("visualToolHintInApp"),
    );
    expect(visualBox).not.toMatch(/photoPacksSeedanceChoice/);
    expect(visualBox).not.toMatch(/photoPacksNanoChoice/);
    expect(panel).toMatch(/visualToolHintInApp/);
    expect(panel).toMatch(/visualToolHintPhoneFilm/);
    expect(panel).not.toMatch(/visualToolHint"/);
    expect(panel.slice(panel.lastIndexOf("visualToolHintInApp"))).toMatch(
      /generateVisualAction/,
    );

    const svc = readFileSync(
      path.join(root, "src/lib/marketing/service.ts"),
      "utf8",
    );
    expect(svc).toMatch(/if \(!isShopKit && selectedSkuId\)/);
    expect(svc).toMatch(/photoPacks/);

    const actions = readFileSync(
      path.join(root, "src/actions/photo-packs.ts"),
      "utf8",
    );
    expect(actions).toMatch(/requireOnboardedWorkspace/);
    expect(actions).toMatch(/deletePhotoPackAction/);
    expect(actions).not.toMatch(/Higgsfield|HF_API/);

    const packsSrc = readFileSync(
      path.join(root, "src/lib/marketing/visual-packs.ts"),
      "utf8",
    );
    expect(packsSrc).toMatch(/export async function deletePhotoPack/);
    expect(packsSrc).toMatch(/requireOwnedPack/);
    expect(packsSrc).toMatch(/requirePhotoPackSku/);
    expect(packsSrc).toMatch(/nextAutoPhotoPackName/);
  });

  it("EN/AR pack + how-to strings exist", () => {
    const en = JSON.parse(
      readFileSync(path.join(root, "messages/en.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(root, "messages/ar.json"), "utf8"),
    ) as { Marketing: Record<string, string> };
    const keys = [
      "photoPacksAdd",
      "photoPacksTitle",
      "photoPacksHowToTitle",
      "photoPacksHowToLight",
      "photoPacksHowToFrame",
      "photoPacksHowToAngles",
      "photoPacksHowToClutter",
      "photoPacksHowToMotion",
      "photoPacksHowToQuality",
      "photoPacksPickerLabel",
      "photoPacksEmptyPointer",
      "photoPacksSeedanceChoice",
      "photoPacksNanoChoice",
      "photoPacksDelete",
      "photoPacksDeleteConfirm",
      "visualGenGenerate",
      "visualGenView",
      "visualGenSave",
      "visualGenRegenerate",
      "visualGenDiscard",
      "visualGenClose",
      "visualToolHintInApp",
      "visualToolHintPhoneFilm",
    ];
    for (const key of keys) {
      expect(en.Marketing[key]?.trim().length).toBeGreaterThan(0);
      expect(ar.Marketing[key]?.trim().length).toBeGreaterThan(0);
    }
    expect(en.Marketing.photoPacksTitle).toBe("Add product photos");
    expect(en.Marketing.photoPacksSeedanceChoice).toMatch(/AI clip/i);
    expect(en.Marketing.photoPacksNanoChoice).toMatch(/AI still/i);
    expect(en.Marketing.photoPacksNanoChoice).not.toMatch(/timed shot/i);
    expect(ar.Marketing.photoPacksNanoChoice).toMatch(/صورة/);
    expect(ar.Marketing.photoPacksNanoChoice).not.toMatch(/مقطع الذكاء/);
    expect(en.Marketing.photoPacksHowToTitle).toMatch(/HOW TO PHOTOGRAPH/i);
    expect(en.Marketing.photoPacksNewName).toMatch(/optional/i);
    expect(en.Marketing.photoPacksNewNamePlaceholder).toMatch(/Pack 1/);
    expect(ar.Marketing.photoPacksNewNamePlaceholder).toMatch(/Pack 1/);
    expect(en.Marketing.visualGenHonestyCap).toMatch(
      /MARKETING_VISUAL_MONTHLY_CAP/,
    );
    expect(en.Marketing.visualGenHonestyCap).not.toMatch(
      /MARKETING_GEMINI_MONTHLY_CAP/,
    );
    expect(en.Marketing.visualGenGenerate).not.toMatch(/Higgsfield/i);
    expect(en.Marketing.visualToolHint).toBeUndefined();
    expect(en.Marketing.visualToolHintInApp).toMatch(/stays on the card/i);
    expect(en.Marketing.visualToolHintInApp).not.toMatch(/stay outside/i);
    expect(ar.Marketing.visualToolHintInApp).not.toMatch(/خارج هذا التطبيق/);
    expect(en.Marketing.visualToolHintPhoneFilm).toMatch(/no AI generate/i);
    expect(en.Marketing.visualToolHintPhoneFilm).not.toMatch(/stay outside/i);
  });
});
