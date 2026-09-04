/**
 * @vitest-environment node
 */
/**
 * The rules this batch is priced by, and the one that nearly slipped.
 *
 * These are commercial rules: an offline line outside the band, or an online
 * line under the profit floor, is money. They are asserted rather than trusted
 * because the first version of this module broke the floor by rounding.
 */
import { describe, expect, it } from "vitest";

import {
  OFFLINE_BAND, MIN_ONLINE_PROFIT, priceVariants, checkPricing, splitByAccount, ceil250,
} from "./batch-pricing.mjs";

const two = [
  { name: "Regular / 普通版", cost: 1496 },
  { name: "Complete / 完全版", cost: 20112 },
];
const four = [
  { name: "Regular / 普通版", cost: 2200 },
  { name: "Special / 特典版", cost: 3080 },
  { name: "Standard / 标准版", cost: 21340 },
  { name: "Deluxe / 豪华版", cost: 23540 },
];

describe("account mapping", () => {
  it("makes the cheaper of two offline and the dearer online", () => {
    const out = splitByAccount(two);
    expect(out.find((v) => v.name.startsWith("Regular")).account).toBe("offline");
    expect(out.find((v) => v.name.startsWith("Complete")).account).toBe("online");
  });

  it("makes the cheapest two of four offline and the dearest two online", () => {
    const byName = Object.fromEntries(splitByAccount(four).map((v) => [v.name.split(" ")[0], v.account]));
    expect(byName).toEqual({ Regular: "offline", Special: "offline", Standard: "online", Deluxe: "online" });
  });

  it("decides on cost, not on the order they were listed", () => {
    /* The rule is about which is cheaper, so a reordered list maps the same. */
    const shuffled = [four[3], four[0], four[2], four[1]];
    const a = splitByAccount(four).map((v) => `${v.name}:${v.account}`).sort();
    const b = splitByAccount(shuffled).map((v) => `${v.name}:${v.account}`).sort();
    expect(b).toEqual(a);
  });

  it("keeps every edition name exactly as the supplier wrote it", () => {
    expect(priceVariants(four, "standard").map((v) => v.name).sort()).toEqual(four.map((v) => v.name).sort());
  });
});

describe("the offline band", () => {
  it("keeps every offline price inside 5,000–18,000", () => {
    for (const tier of ["flagship", "major", "standard", "niche"]) {
      for (const v of priceVariants(four, tier).filter((x) => x.account === "offline")) {
        expect(v.price).toBeGreaterThanOrEqual(OFFLINE_BAND.min);
        expect(v.price).toBeLessThanOrEqual(OFFLINE_BAND.max);
      }
    }
  });

  it("prices a better-selling game higher", () => {
    const at = (tier) => priceVariants(two, tier).find((v) => v.account === "offline").price;
    expect(at("flagship")).toBeGreaterThan(at("major"));
    expect(at("major")).toBeGreaterThan(at("standard"));
    expect(at("standard")).toBeGreaterThan(at("niche"));
  });

  it("lifts an offline price clear of a cost the band would sit under", () => {
    /* A niche game whose supplier line is dearer than the bottom of the band. */
    const out = priceVariants([{ name: "Regular", cost: 10340 }, { name: "Online", cost: 30140 }], "niche");
    const offline = out.find((v) => v.account === "offline");
    expect(offline.price).toBeGreaterThan(offline.cost);
  });
});

describe("the online floor", () => {
  it("never pays less than 10,000 profit, at any tier or cost", () => {
    for (const tier of ["flagship", "major", "standard", "niche"]) {
      for (const cost of [5808, 7040, 9240, 12540, 20112, 21340, 43340, 82940]) {
        const [v] = priceVariants([{ name: "a", cost: 1 }, { name: "b", cost }], tier)
          .filter((x) => x.account === "online");
        expect(v.margin).toBeGreaterThanOrEqual(MIN_ONLINE_PROFIT);
      }
    }
  });

  it("rounds up, because rounding to the nearest broke the floor", () => {
    /*
      12,540 + 10,000 is 22,540. Rounded to the nearest 250 that is 22,500,
      which pays 9,960 — under the floor. Six of this batch's lines landed
      there before the rounding was changed.
    */
    expect(ceil250(22540)).toBe(22750);
    const [online] = priceVariants([{ name: "a", cost: 1 }, { name: "b", cost: 12540 }], "niche")
      .filter((v) => v.account === "online");
    expect(online.margin).toBeGreaterThanOrEqual(MIN_ONLINE_PROFIT);
  });

  it("is not a multiplier — the same cost pays more for a better-selling game", () => {
    const at = (tier) => priceVariants([{ name: "a", cost: 1 }, { name: "b", cost: 20000 }], tier)
      .find((v) => v.account === "online").margin;
    expect(at("flagship")).toBeGreaterThan(at("niche"));
    /* And a cheap line is not punished for being cheap, as a multiplier would. */
    const cheap = priceVariants([{ name: "a", cost: 1 }, { name: "b", cost: 5808 }], "niche")
      .find((v) => v.account === "online").margin;
    expect(cheap).toBeGreaterThanOrEqual(MIN_ONLINE_PROFIT);
  });
});

describe("checkPricing", () => {
  it("passes every entry in the real batch file", async () => {
    const { readFileSync } = await import("node:fs");
    const batch = JSON.parse(readFileSync("data/supplier-batch-2026-09.json", "utf8"));
    for (const g of batch.games) {
      expect(checkPricing(priceVariants(g.variants, g.demandTier)), `${g.n} ${g.title}`).toEqual([]);
    }
  });

  it("catches a price that does not clear its cost", () => {
    expect(checkPricing([{ name: "x", account: "offline", cost: 9000, price: 8000, margin: -1000 }]).length)
      .toBeGreaterThan(0);
  });
});
