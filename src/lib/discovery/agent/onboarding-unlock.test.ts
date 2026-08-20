import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import {
  ONBOARDING_UNLOCK_KNOBS,
  discoveryReturnHref,
  listAcceptReadyForUnlock,
  parseUnlockField,
  pickOnboardingUnlock,
  type UnlockProfile,
} from "@/lib/discovery/agent/onboarding-unlock";

function product(
  key: string,
  overrides: Partial<CatalogProduct> = {},
): CatalogProduct {
  return {
    key,
    category: "home_kitchen",
    en: { name: key, summary: "s", differentiation: "d" },
    ar: { name: `${key}-ar`, summary: "م", differentiation: "ف" },
    sellPrice: 40,
    productCost: 5,
    intlShip: 2,
    clearanceTaxes: 1,
    localCourier: 2,
    difficulty: 0,
    risk: 0,
    timeNeed: 4,
    workload: 0,
    storageFootprint: "small",
    oversized: false,
    tier1Marketplaces: [],
    ...overrides,
  };
}

function profile(overrides: Partial<UnlockProfile> = {}): UnlockProfile {
  return {
    maxLandedCost: 10,
    experience: "beginner",
    riskTolerance: "low",
    hoursPerWeek: 5,
    categoryLikes: ["home_kitchen"],
    monthlyFollowOnBudget: 200,
    ...overrides,
  };
}

describe("pickOnboardingUnlock", () => {
  it("names maxLandedCost when raising it unlocks an out-of-band product", () => {
    const decoy = product("decoy_oversize", { oversized: true });
    const extra = product("unlock_me", {
      en: { name: "Garlic press", summary: "s", differentiation: "d" },
      ar: { name: "عصّارة ثوم", summary: "م", differentiation: "ف" },
      sellPrice: 150,
      productCost: 20,
      intlShip: 6,
      clearanceTaxes: 2,
      localCourier: 4,
    });
    const advice = pickOnboardingUnlock({
      profile: profile({ maxLandedCost: 10 }),
      catalog: [decoy, extra],
    });
    expect(advice).not.toBeNull();
    expect(advice?.field).toBe("maxLandedCost");
    expect(Number(advice?.toValue)).toBeGreaterThan(10);
    expect(advice?.extraKeys).toContain("unlock_me");
    expect(advice?.extraNamesEn).toContain("Garlic press");
    expect(advice?.extraNamesAr).toContain("عصّارة ثوم");
  });

  it("hides the banner when no knob unlocks extra accept-ready ids", () => {
    const blocked = product("fat", { oversized: true, productCost: 5 });
    const marginFail = product("thin_margin", {
      sellPrice: 20,
      productCost: 12,
      intlShip: 3,
      clearanceTaxes: 2,
      localCourier: 2,
    });
    expect(
      pickOnboardingUnlock({
        profile: profile({ maxLandedCost: 100, hoursPerWeek: 40 }),
        catalog: [blocked, marginFail],
      }),
    ).toBeNull();
  });

  it("never recommends likes, ads budget, or storage text", () => {
    const extra = product("unlock_me", {
      sellPrice: 150,
      productCost: 20,
      intlShip: 6,
      clearanceTaxes: 2,
      localCourier: 4,
    });
    const advice = pickOnboardingUnlock({
      profile: profile({
        maxLandedCost: 10,
        categoryLikes: ["beauty_personal_care"],
        monthlyFollowOnBudget: 0,
      }),
      catalog: [product("decoy_oversize", { oversized: true }), extra],
    });
    expect(advice?.field).toBe("maxLandedCost");
    expect(ONBOARDING_UNLOCK_KNOBS).not.toContain("monthlyFollowOnBudget");
    expect(ONBOARDING_UNLOCK_KNOBS).not.toContain("storageDescription");
    expect(ONBOARDING_UNLOCK_KNOBS).not.toContain("storageLimits");
    expect(ONBOARDING_UNLOCK_KNOBS).not.toContain("categoryLikes");
  });

  it("picks hours over experience when both unlock the same extra count", () => {
    const hard = product("time_sink", {
      category: "beauty_personal_care",
      difficulty: 2,
      risk: 2,
      timeNeed: 20,
      storageFootprint: "large",
      workload: 2,
    });
    const tight = profile({
      maxLandedCost: 40,
      hoursPerWeek: 5,
      experience: "beginner",
      riskTolerance: "low",
    });
    expect(listAcceptReadyForUnlock(tight, [hard])).toEqual([]);
    const advice = pickOnboardingUnlock({
      profile: tight,
      catalog: [hard],
    });
    expect(advice?.field).toBe("hoursPerWeek");
    expect(advice?.toValue).toBe(20);
    expect(advice?.extraKeys).toEqual(["time_sink"]);
  });

  it("uses experience only as last resort", () => {
    const hard = product("needs_exp", {
      category: "beauty_personal_care",
      sellPrice: 2200,
      productCost: 600,
      intlShip: 20,
      clearanceTaxes: 15,
      localCourier: 15,
      difficulty: 2,
      risk: 0,
      timeNeed: 4,
      storageFootprint: "large",
      workload: 2,
    });
    const advice = pickOnboardingUnlock({
      profile: profile({
        maxLandedCost: 10,
        hoursPerWeek: 40,
        experience: "beginner",
        riskTolerance: "high",
      }),
      catalog: [hard],
    });
    expect(advice?.field).toBe("experience");
    expect(advice?.toValue).toBe("some");
  });

  it("does not invent SKUs or new categories", () => {
    const extra = product("unlock_me", {
      sellPrice: 150,
      productCost: 20,
      intlShip: 6,
      clearanceTaxes: 2,
      localCourier: 4,
    });
    const advice = pickOnboardingUnlock({
      profile: profile({ maxLandedCost: 10 }),
      catalog: [product("decoy_oversize", { oversized: true }), extra],
    });
    expect(advice?.extraKeys.every((k) => k === "unlock_me")).toBe(true);
  });
});

describe("discoveryReturnHref", () => {
  it("keeps first completion on dashboard; edit-from-discovery returns to #discovery", () => {
    expect(
      discoveryReturnHref({ fromDiscovery: true, isFirstCompletion: true }),
    ).toBe("/dashboard");
    expect(
      discoveryReturnHref({ fromDiscovery: false, isFirstCompletion: false }),
    ).toBe("/dashboard");
    expect(
      discoveryReturnHref({
        fromDiscovery: true,
        isFirstCompletion: false,
        unlockField: "maxLandedCost",
      }),
    ).toBe("/dashboard?unlock=maxLandedCost#discovery");
    expect(
      discoveryReturnHref({
        fromDiscovery: true,
        isFirstCompletion: false,
        unlockField: "monthlyFollowOnBudget",
      }),
    ).toBe("/dashboard#discovery");
    expect(parseUnlockField("storageDescription")).toBeNull();
  });
});

describe("§14.12 contracts", () => {
  it("does not recommend forbidden fields; Gemini is not the scorer", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/agent/onboarding-unlock.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/field:\s*"monthlyFollowOnBudget"/);
    expect(src).not.toMatch(/field:\s*"categoryLikes"/);
    expect(src).not.toMatch(/field:\s*"storageDescription"/);
    expect(src).not.toContain("gemini");
    expect(src).not.toContain("lower the margin");
  });

  it("onboarding edit from discovery does not close the session or clear the frame", () => {
    const actions = readFileSync(
      path.join(process.cwd(), "src/actions/onboarding.ts"),
      "utf8",
    );
    expect(actions).toContain("fromDiscovery");
    expect(actions).toContain("discoveryReturnHref");
    expect(actions).toContain("retrieveAfterOnboardingEdit");
    expect(actions).not.toContain("closeAndOpenScoredSession");
    expect(actions).not.toContain("agentFrameJson: null");

    const retrieve = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    const fn = retrieve.slice(
      retrieve.indexOf("export async function retrieveAfterOnboardingEdit"),
      retrieve.indexOf("export async function markDiscoveryIntroSeen"),
    );
    expect(fn).toContain("agentFrameJson");
    expect(fn).not.toContain("agentFrameJson: null");
    expect(fn).not.toContain("closeAndOpenScoredSession");
    expect(fn).not.toContain('status: "closed"');
  });

  it("Edit onboarding CTA keeps from=discovery; don’t-deal still has no CTA", () => {
    const board = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    const note = board.slice(
      board.indexOf("function EditOnboardingNote"),
      board.indexOf("function MarketDataNotReadyNote"),
    );
    expect(note).toContain("from=discovery");
    expect(note).toContain("editOnboardingUnlock");
    expect(note).not.toContain("lower the margin");
    expect(note).not.toContain("categoryLikes");
    expect(note).not.toContain("monthlyFollowOnBudget");
    expect(note).not.toContain("storageDescription");

    const wizard = readFileSync(
      path.join(process.cwd(), "src/components/onboarding/OnboardingWizard.tsx"),
      "utf8",
    );
    expect(wizard).toContain('name="from"');
    expect(wizard).toContain('value="discovery"');
    expect(wizard).toContain('name="unlockField"');

    const ask = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryAgentAsk.tsx"),
      "utf8",
    );
    const dontDeal = ask.slice(
      ask.indexOf("export function DiscoveryAgentDontDeal"),
      ask.indexOf("export function DiscoveryAgentNothingFits"),
    );
    expect(dontDeal).not.toContain("editOnboardingCta");
    expect(dontDeal).not.toContain("/onboarding");
  });

  it("getDiscoveryView only keeps the banner when dry-run unlocks extra ids", () => {
    const retrieve = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    const viewFn = retrieve.slice(
      retrieve.indexOf("export async function getDiscoveryView"),
    );
    expect(viewFn).toContain("pickOnboardingUnlock");
    expect(viewFn).toContain("editOnboardingUnlock");
    expect(viewFn).toContain("isCheapStorageDrop");
  });

  it("has EN+AR unlock templates and never tells them to lower margin gates", () => {
    const keys = [
      "editOnboardingCountZero",
      "editOnboardingCountThin",
      "editOnboardingAdvice_maxLandedCost",
      "editOnboardingAdvice_hoursPerWeek",
      "editOnboardingAdvice_riskTolerance",
      "editOnboardingAdvice_experience",
      "editOnboardingPreview",
      "editOnboardingHonesty",
      "editOnboardingUpdated",
    ] as const;
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ).Discovery as Record<string, string>;
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ).Discovery as Record<string, string>;
    for (const key of keys) {
      expect(en[key]?.length ?? 0, `en.${key}`).toBeGreaterThan(8);
      expect(ar[key]?.length ?? 0, `ar.${key}`).toBeGreaterThan(8);
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/\p{Script=Arabic}/u);
      expect(en[key].toLowerCase()).not.toContain("lower the margin");
      expect(en[key].toLowerCase()).not.toContain("category likes");
      expect(en[key].toLowerCase()).not.toContain("monthly");
    }
    expect(en.editOnboardingHonesty).toMatch(/70/);
    expect(en.editOnboardingHonesty).toMatch(/35/);
    expect(en.editOnboardingHonesty.toLowerCase()).toContain("shippable");
    expect(en.editOnboardingHonesty.toLowerCase()).toContain("sales guarantee");
  });
});
