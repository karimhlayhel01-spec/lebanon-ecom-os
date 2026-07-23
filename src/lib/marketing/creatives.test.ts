import { describe, expect, it } from "vitest";
import {
  buildCreatives,
  calendarDisplayIndexes,
  compareCreativesByCalendar,
  creativeCountFor,
  creativesContentKey,
  creativesHaveCodPitch,
  dayRank,
  LAUNCH_PLAN_WEEKS,
  normalizeCreative,
  preLaunchHasForbiddenPitch,
  scheduleSlotsForWeek,
  seriesNumberFromLabel,
  timeBandRank,
  weekPhase,
} from "@/lib/marketing/creatives";
import { CATEGORY_NICHES } from "@/lib/marketing/brief";

function scheduleKey(c: { suggestedDay: string; suggestedTimeBand: string }) {
  return dayRank(c.suggestedDay) * 10 + timeBandRank(c.suggestedTimeBand);
}

const base = {
  name: "Desk Cable Dock",
  hooks: ["Cable chaos ends here"],
  capacityTier: 10 as const,
};

describe("creativeCountFor", () => {
  it("maps capacity tiers to lighter pre_launch and full launch counts", () => {
    expect(creativeCountFor("pre_launch", 6)).toBe(4);
    expect(creativeCountFor("pre_launch", 10)).toBe(6);
    expect(creativeCountFor("pre_launch", 14)).toBe(8);
    expect(creativeCountFor("launch", 6)).toBe(6);
    expect(creativeCountFor("launch", 10)).toBe(10);
    expect(creativeCountFor("launch", 14)).toBe(14);
    expect(creativeCountFor("monthly_refresh", 10)).toBe(10);
  });

  it("pre_launch length is less than launch for the same tier", () => {
    for (const tier of [6, 10, 14] as const) {
      expect(creativeCountFor("pre_launch", tier)).toBeLessThan(
        creativeCountFor("launch", tier),
      );
    }
  });
});

describe("weekPhase", () => {
  it("splits early warm vs later teaser across ETA", () => {
    expect(weekPhase(1, 2)).toBe("warm");
    expect(weekPhase(2, 2)).toBe("teaser");
    expect(weekPhase(1, 4)).toBe("warm");
    expect(weekPhase(2, 4)).toBe("warm");
    expect(weekPhase(3, 4)).toBe("teaser");
    expect(weekPhase(4, 4)).toBe("teaser");
  });
});

describe("buildCreatives", () => {
  it("uses different niche language for desk vs kitchen", () => {
    const desk = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "launch",
      varianceSeed: 42,
    });
    const kitchen = buildCreatives({
      ...base,
      name: "Collapsible Containers",
      category: "home_kitchen",
      stage: "launch",
      varianceSeed: 42,
    });

    const deskBlob = desk
      .map((c) => `${c.angleEn}\n${c.captionEn}\n${c.seriesLabelEn}`)
      .join("\n");
    const kitchenBlob = kitchen
      .map((c) => `${c.angleEn}\n${c.captionEn}\n${c.seriesLabelEn}`)
      .join("\n");
    expect(deskBlob).not.toBe(kitchenBlob);
    expect(deskBlob.toLowerCase()).toMatch(/desk/);
    expect(kitchenBlob.toLowerCase()).toMatch(/kitchen/);
    expect(desk.some((c) => /desk fix/i.test(c.seriesLabelEn))).toBe(true);
    expect(kitchen.some((c) => /kitchen fix/i.test(c.seriesLabelEn))).toBe(
      true,
    );
  });

  it("falls back to default niche for unknown category", () => {
    const kit = buildCreatives({
      ...base,
      category: "",
      stage: "pre_launch",
      varianceSeed: 7,
      weekCount: 4,
    });
    expect(kit).toHaveLength(6); // capacity 10 → pre_launch 6
    expect(kit[0]!.seriesLabelEn).toMatch(/Quick fix/i);
    expect(kit.every((c) => c.hookEn.length > 0)).toBe(true);
  });

  it("never pitches COD as a marketing wow", () => {
    const stages = ["pre_launch", "launch", "monthly_refresh"] as const;
    const categories = [
      "office_desk_gadgets",
      "home_kitchen",
      "beauty_personal_care",
      "",
    ];
    for (const stage of stages) {
      for (const category of categories) {
        const kit = buildCreatives({
          ...base,
          category,
          stage,
          varianceSeed: 99,
          weekCount: stage === "pre_launch" ? 4 : undefined,
        });
        expect(creativesHaveCodPitch(kit)).toBe(false);
      }
    }
  });

  it("pre_launch has no gift / buyer-UGC / hard-order pitch", () => {
    for (const weekCount of [2, 4, 8] as const) {
      const kit = buildCreatives({
        ...base,
        category: "beauty_personal_care",
        name: "Gua Sha Facial Set",
        stage: "pre_launch",
        weekCount,
        varianceSeed: 17,
      });
      expect(preLaunchHasForbiddenPitch(kit)).toBe(false);
      expect(kit.every((c) => c.format !== "ugc" && c.format !== "testimonial")).toBe(
        true,
      );
    }
  });

  it("pre_launch vs launch content fingerprints differ (not just length)", () => {
    const pre = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "pre_launch",
      weekCount: 4,
      varianceSeed: 50,
    });
    const launch = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "launch",
      varianceSeed: 50,
    });
    expect(creativesContentKey(pre)).not.toBe(creativesContentKey(launch));
    const preBlob = pre.map((c) => c.captionEn).join("\n").toLowerCase();
    const launchBlob = launch.map((c) => c.captionEn).join("\n").toLowerCase();
    expect(preBlob).toMatch(/follow|save|poll|stock lands|waitlist|not selling|transit|almost/i);
    expect(launchBlob).toMatch(/whatsapp|order/i);
    expect(preLaunchHasForbiddenPitch(pre)).toBe(false);
    // Launch is allowed hard order — helper would flag it if applied
    expect(preLaunchHasForbiddenPitch(launch)).toBe(true);
  });

  it("is hook-first: shot 1 leads with problem/result hook", () => {
    const kit = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "launch",
      varianceSeed: 3,
    });
    for (const c of kit) {
      expect(c.shots[0]).toMatch(/0–3s hook/i);
      expect(c.hookEn.length).toBeGreaterThan(0);
      // SKU-pinned angles may leave hookAr empty — never duplicate EN into AR.
      expect(c.hookAr).not.toBe(c.hookEn);
    }
  });

  it("sizes pre_launch lighter than launch for the same tier", () => {
    const pre = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "pre_launch",
      varianceSeed: 1,
      weekCount: 2, // keep below capacity so base count (6) wins
    });
    const launch = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "launch",
      varianceSeed: 1,
    });
    expect(pre.length).toBe(6);
    expect(launch.length).toBe(10);
    expect(pre.length).toBeLessThan(launch.length);
  });

  it("phases pre_launch creatives across ETA weeks (Week 1…N)", () => {
    const kit = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      capacityTier: 6,
      weekCount: 4,
      varianceSeed: 5,
    });
    const weeks = new Set(kit.map((c) => c.weekIndex));
    expect(weeks).toEqual(new Set([1, 2, 3, 4]));
    expect(kit.every((c) => c.weekLabelEn.startsWith("Week "))).toBe(true);
    expect(kit.every((c) => c.weekLabelAr.startsWith("الأسبوع "))).toBe(true);
    for (let i = 1; i < kit.length; i++) {
      expect(kit[i]!.weekIndex).toBeGreaterThanOrEqual(kit[i - 1]!.weekIndex);
    }
  });

  it("rebuilds week plan when ETA weekCount changes", () => {
    const two = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 2,
      varianceSeed: 9,
    });
    const eight = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 8,
      varianceSeed: 9,
    });
    expect(new Set(two.map((c) => c.weekIndex)).size).toBe(2);
    expect(new Set(eight.map((c) => c.weekIndex)).size).toBe(8);
    expect(eight.length).toBeGreaterThan(two.length);
    // Later weeks should use transit/launch teaser language
    const late = eight.filter((c) => c.weekIndex >= 5);
    const lateBlob = late.map((c) => c.angleEn + c.captionEn).join("\n");
    expect(lateBlob.toLowerCase()).toMatch(
      /transit|almost|lands|countdown|waitlist|warm-up|peek/i,
    );
  });

  it("ensures every ETA week appears when weekCount exceeds base count", () => {
    const kit = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "pre_launch",
      capacityTier: 6,
      weekCount: 8,
      varianceSeed: 3,
    });
    expect(kit.length).toBe(8);
    expect(new Set(kit.map((c) => c.weekIndex)).size).toBe(8);
  });

  it("launch is a fixed 2-week plan (ignores ETA weekCount)", () => {
    const kit = buildCreatives({
      ...base,
      category: "home_kitchen",
      stage: "launch",
      weekCount: 8,
      varianceSeed: 1,
    });
    expect(LAUNCH_PLAN_WEEKS).toBe(2);
    const weeks = [...new Set(kit.map((c) => c.weekIndex))].sort(
      (a, b) => a - b,
    );
    expect(weeks).toEqual([1, 2]);
    expect(kit.every((c) => c.weekIndex === 1 || c.weekIndex === 2)).toBe(
      true,
    );
    expect(kit.some((c) => c.weekLabelEn.includes("1"))).toBe(true);
    expect(kit.some((c) => c.weekLabelEn.includes("2"))).toBe(true);
  });

  it("regenerate with different seeds yields non-deep-equal content", () => {
    const a = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "launch",
      varianceSeed: 1001,
    });
    const b = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "launch",
      varianceSeed: 2002,
    });
    expect(creativesContentKey(a)).not.toBe(creativesContentKey(b));
    expect(a.some((c) => /desk/i.test(c.angleEn + c.seriesLabelEn))).toBe(
      true,
    );
    expect(b.some((c) => /desk/i.test(c.angleEn + c.seriesLabelEn))).toBe(
      true,
    );
  });

  it("tailors with SKU name + marketing hooks when present", () => {
    const kit = buildCreatives({
      name: "LED Facial Wand",
      category: "beauty_personal_care",
      hooks: ["Glow in 5 seconds"],
      stage: "launch",
      capacityTier: 6,
      varianceSeed: 11,
    });
    const blob = kit
      .map((c) => `${c.angleEn}\n${c.captionEn}\n${c.hookEn}`)
      .join("\n");
    expect(blob).toContain("LED Facial Wand");
    expect(blob).toMatch(/Glow in 5 seconds/i);
  });

  it("Arabic series labels avoid calques like انتصار روتين", () => {
    const kit = buildCreatives({
      name: "Gua Sha Facial Set",
      category: "beauty_personal_care",
      stage: "pre_launch",
      weekCount: 4,
      capacityTier: 10,
      varianceSeed: 3,
    });
    const ar = kit.map((c) => c.seriesLabelAr).join("\n");
    expect(ar).not.toContain("انتصار روتين");
    expect(ar).toMatch(/خطوة روتينية/);
    expect(CATEGORY_NICHES.beauty_personal_care!.seriesShortAr).toBe(
      "خطوة روتينية",
    );
  });
  it("attaches schedule on pre_launch + launch + monthly_refresh", () => {
    const pre = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 4,
      varianceSeed: 12,
    });
    expect(
      pre.every(
        (c) =>
          c.suggestedDay &&
          c.suggestedTimeBand &&
          c.whyEn &&
          c.whyAr &&
          c.scheduleIgnored === false,
      ),
    ).toBe(true);

    // Date.now()|0-style negative seeds must still yield day/band (JSON keeps them).
    const neg = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 4,
      varianceSeed: -1_900_000_000,
    });
    expect(
      neg.every((c) => Boolean(c.suggestedDay && c.suggestedTimeBand)),
    ).toBe(true);
    const roundTrip = JSON.parse(JSON.stringify(neg)) as typeof neg;
    expect(roundTrip[0]?.suggestedDay).toBeTruthy();
    expect(roundTrip[0]?.suggestedTimeBand).toBeTruthy();

    const launch = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "launch",
      varianceSeed: 12,
    });
    expect(
      launch.every(
        (c) =>
          c.suggestedDay &&
          c.suggestedTimeBand &&
          c.whyEn &&
          c.whyAr &&
          c.scheduleIgnored === false,
      ),
    ).toBe(true);
    expect(launch.every((c) => /whatsapp|order/i.test(c.captionEn))).toBe(
      true,
    );
    expect(launch.some((c) => /Launch week/i.test(c.whyEn))).toBe(true);
    expect(launch.some((c) => /warm-up before stock/i.test(c.whyEn))).toBe(
      false,
    );

    const monthly = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "monthly_refresh",
      varianceSeed: 12,
    });
    expect(monthly).toHaveLength(10);
    expect(
      monthly.every(
        (c) =>
          c.weekIndex === 1 &&
          c.suggestedDay &&
          c.suggestedTimeBand &&
          c.whyEn &&
          c.whyAr &&
          c.scheduleIgnored === false,
      ),
    ).toBe(true);
    expect(monthly.every((c) => /whatsapp|order/i.test(c.captionEn))).toBe(
      true,
    );
    expect(monthly.some((c) => /This week/i.test(c.whyEn))).toBe(true);
  });

  it("orders monthly_refresh schedules within a single Week 1", () => {
    for (const seed of [12, 42, 99]) {
      const kit = buildCreatives({
        ...base,
        category: "office_desk_gadgets",
        stage: "monthly_refresh",
        varianceSeed: seed,
      });
      expect([...new Set(kit.map((c) => c.weekIndex))]).toEqual([1]);
      expect(kit.length).toBe(10);
      for (let i = 1; i < kit.length; i++) {
        expect(scheduleKey(kit[i]!)).toBeGreaterThanOrEqual(
          scheduleKey(kit[i - 1]!),
        );
      }
    }
  });

  it("orders launch schedules within Week 1 and Week 2", () => {
    for (const seed of [12, 42, 99]) {
      const kit = buildCreatives({
        ...base,
        category: "office_desk_gadgets",
        stage: "launch",
        varianceSeed: seed,
      });
      expect([...new Set(kit.map((c) => c.weekIndex))].sort()).toEqual([
        1, 2,
      ]);
      for (const w of [1, 2]) {
        const items = kit.filter((c) => c.weekIndex === w);
        expect(items.length).toBeGreaterThanOrEqual(1);
        for (let i = 1; i < items.length; i++) {
          expect(scheduleKey(items[i]!)).toBeGreaterThanOrEqual(
            scheduleKey(items[i - 1]!),
          );
          expect(
            seriesNumberFromLabel(items[i]!.seriesLabelEn),
          ).toBeGreaterThanOrEqual(
            seriesNumberFromLabel(items[i - 1]!.seriesLabelEn),
          );
        }
      }
    }
  });

  it("orders pre_launch schedules Mon→Sun then morning→evening within each week", () => {
    for (const seed of [12, 42, 99, -1_900_000_000]) {
      const kit = buildCreatives({
        ...base,
        category: "office_desk_gadgets",
        stage: "pre_launch",
        weekCount: 2,
        varianceSeed: seed,
      });
      const weeks = [...new Set(kit.map((c) => c.weekIndex))].sort(
        (a, b) => a - b,
      );
      for (const w of weeks) {
        const items = kit.filter((c) => c.weekIndex === w);
        for (let i = 1; i < items.length; i++) {
          expect(scheduleKey(items[i]!)).toBeGreaterThanOrEqual(
            scheduleKey(items[i - 1]!),
          );
          // Series # ascends with calendar order (no tip #5 before #1).
          expect(
            seriesNumberFromLabel(items[i]!.seriesLabelEn),
          ).toBeGreaterThanOrEqual(
            seriesNumberFromLabel(items[i - 1]!.seriesLabelEn),
          );
        }
        // Kit list itself is calendar-sorted for this week block.
        const fromKit = kit.filter((c) => c.weekIndex === w);
        expect(fromKit.map((c) => c.id)).toEqual(
          [...fromKit].sort(compareCreativesByCalendar).map((c) => c.id),
        );
      }
    }
  });

  it("calendarDisplayIndexes matches kit list order (badge 1 above badge 2)", () => {
    const kit = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 2,
      varianceSeed: 42,
    });
    const badges = calendarDisplayIndexes(kit);
    kit.forEach((c, i) => {
      expect(badges[c.id]).toBe(i + 1);
    });
    // First week cards are badges 1…N contiguous at the top.
    const week1 = kit.filter((c) => c.weekIndex === 1);
    expect(week1.map((c) => badges[c.id])).toEqual(
      week1.map((_, i) => i + 1),
    );
  });

  it("regenerate seeds vary slots but stay chronologically ordered", () => {
    const a = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 2,
      varianceSeed: 42,
    });
    const b = buildCreatives({
      ...base,
      category: "office_desk_gadgets",
      stage: "pre_launch",
      weekCount: 2,
      varianceSeed: 99,
    });
    const seq = (kit: typeof a) =>
      kit.map((c) => `${c.weekIndex}:${c.suggestedDay}/${c.suggestedTimeBand}`);
    expect(seq(a)).not.toEqual(seq(b));
    expect(creativesContentKey(a)).not.toEqual(creativesContentKey(b));
  });

  it("scheduleSlotsForWeek spreads and stays non-decreasing", () => {
    const slots = scheduleSlotsForWeek({ count: 3, seed: 42, weekIndex: 1 });
    expect(slots).toHaveLength(3);
    for (let i = 1; i < slots.length; i++) {
      const prev =
        dayRank(slots[i - 1]!.day) * 10 + timeBandRank(slots[i - 1]!.band);
      const next = dayRank(slots[i]!.day) * 10 + timeBandRank(slots[i]!.band);
      expect(next).toBeGreaterThanOrEqual(prev);
    }
    // Prefer distinct when timeline has room.
    const keys = slots.map((s) => `${s.day}/${s.band}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("normalizeCreative defaults missing schedule fields", () => {
    const c = normalizeCreative({
      id: "x1",
      format: "reel",
      angleEn: "A",
      angleAr: "ب",
      captionEn: "c",
      captionAr: "د",
      shots: [],
    });
    expect(c?.suggestedDay).toBe("");
    expect(c?.scheduleIgnored).toBe(false);
  });
});

describe("normalizeCreative", () => {
  it("fills empty defaults for old kits missing new fields", () => {
    const c = normalizeCreative({
      id: "x1",
      format: "reel",
      angleEn: "Old angle",
      angleAr: "زاوية قديمة",
      captionEn: "Old caption",
      captionAr: "تعليق قديم",
      shots: ["Shot A"],
    });
    expect(c).toMatchObject({
      id: "x1",
      format: "reel",
      angleEn: "Old angle",
      seriesLabelEn: "",
      seriesLabelAr: "",
      hookEn: "",
      hookAr: "",
      shots: ["Shot A"],
      suggestedDay: "",
      scheduleIgnored: false,
    });
  });
});
