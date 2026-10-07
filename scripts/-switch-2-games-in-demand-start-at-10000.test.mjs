/**
 * The Switch 2 floor, held to the owner's own examples.
 *
 *   «ليس كل نسخ سويتش ٢ لكن الاسعار الغاليه والتي عليها طلب عالي تبدأ من ١٠
 *    الف للسويتش ٢ · مثلا زيلدا سويتش ٢ بسعر ١٢ الف · دونكي كونك بنانزا ب١٢ الف»
 */
import { describe, expect, it } from "vitest";

import {
  EXTRAS_STEP,
  FLAGSHIP_PRICE,
  IN_DEMAND_FLOOR,
  floorFor,
  planCorrection,
  planFloor,
} from "./lib/switch2-floor.mjs";
import { diffPaths } from "./lib/yuan-reprice.mjs";

const isOrdinaryOffline = (row) =>
  /offline|أوفلاين/i.test(`${row.id} ${row.name}`) && !/dlc|إضاف/i.test(`${row.id} ${row.name}`);
const isOfflineExtras = (row) =>
  /offline|أوفلاين/i.test(`${row.id} ${row.name}`) && /dlc|إضاف/i.test(`${row.id} ${row.name}`);
const opts = (target) => ({ target, isOrdinaryOffline, isOfflineExtras });

describe("which Switch 2 games, and at what", () => {
  it("puts the flagships — Zelda's Switch 2 editions, Donkey Kong Bananza — at 12,000", () => {
    expect(floorFor({ isSwitch2: true, tier: "flagship" })).toEqual({
      target: 12_000,
      why: "flagship",
    });
    expect(FLAGSHIP_PRICE).toBe(12_000);
  });

  it("starts the rest of what is in demand, or dear, at 10,000", () => {
    expect(floorFor({ isSwitch2: true, tier: "major" })?.target).toBe(10_000);
    expect(floorFor({ isSwitch2: true, tier: "standard", inDemand: true })?.why).toBe("orders");
    expect(floorFor({ isSwitch2: true, tier: "standard", expensive: true })?.why).toBe("cost");
    expect(IN_DEMAND_FLOOR).toBe(10_000);
  });

  it("leaves «not every Switch 2 game» alone — and every Switch 1 game", () => {
    expect(floorFor({ isSwitch2: true, tier: "standard" })).toBeNull();
    expect(floorFor({ isSwitch2: true, tier: "niche" })).toBeNull();
    expect(
      floorFor({ isSwitch2: false, tier: "flagship", inDemand: true, expensive: true }),
    ).toBeNull();
  });
});

describe("one game held to its floor", () => {
  /* Donkey Kong Bananza after the yuan rise: offline 10,000, add-ons 15,000, online 53,000. */
  const bananza = {
    id: "prd_dk",
    price: 10_000,
    types: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 10_000 },
      { id: "dlc_offline", name: "أوفلاين مع الإضافات", price: 15_000 },
      { id: "standard_online", name: "حساب أونلاين", price: 53_000 },
    ],
  };

  it("takes every copy of the offline price to 12,000, and touches nothing else", () => {
    const { next, changes, base } = planFloor(bananza, opts(12_000));
    expect(base).toBe(12_000);
    expect(next.price).toBe(12_000);
    expect(next.types[0].price).toBe(12_000);
    /* 15,000 is already a full step above 12,000; the online price is not the offline one. */
    expect(next.types[1].price).toBe(15_000);
    expect(next.types[2].price).toBe(53_000);
    expect(new Set(diffPaths(bananza, next))).toEqual(new Set(changes.map((c) => c.path)));
  });

  it("lifts an add-ons edition the new base would overtake to base + 2,000", () => {
    /* Zelda BOTW, Switch 2 Edition: offline 10,000, add-ons 13,000. */
    const zelda = {
      id: "prd_botw2",
      price: 10_000,
      types: [
        { id: "standard_offline", name: "حساب أوفلاين", price: 10_000 },
        { id: "dlc_offline", name: "أوفلاين مع الإضافات", price: 13_000 },
      ],
    };
    const { next } = planFloor(zelda, opts(12_000));
    expect(next.types[0].price).toBe(12_000);
    expect(next.types[1].price).toBe(12_000 + EXTRAS_STEP);
  });

  it("never lowers a game already dearer than its floor", () => {
    const dear = {
      id: "re",
      price: 15_000,
      types: [{ id: "standard_offline", name: "حساب أوفلاين", price: 15_000 }],
    };
    const { next, changes } = planFloor(dear, opts(10_000));
    expect(changes).toEqual([]);
    expect(next).toBe(dear);
  });

  it("does not touch the document it was given", () => {
    const before = JSON.stringify(bananza);
    planFloor(bananza, opts(12_000));
    expect(JSON.stringify(bananza)).toBe(before);
  });
});

describe("taking back a price this rule wrote", () => {
  /* Hollow Knight: Silksong, as the flagship step left it. */
  const silksong = {
    id: "prd_silk",
    price: 12_000,
    types: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 12_000 },
      { id: "standard_online", name: "حساب أونلاين", price: 33_000 },
    ],
  };
  const back = { from: 12_000, to: 10_000, isOrdinaryOffline };

  it("sets every copy of the offline price to the step it belongs on, and nothing else", () => {
    const plan = planCorrection(silksong, back);
    expect(plan.base).toBe(10_000);
    expect(plan.next.price).toBe(10_000);
    expect(plan.next.types[0].price).toBe(10_000);
    expect(plan.next.types[1].price).toBe(33_000);
    expect(new Set(diffPaths(silksong, plan.next))).toEqual(
      new Set(plan.changes.map((c) => c.path)),
    );
  });

  it("never undoes a price somebody set since", () => {
    const repriced = { ...silksong, price: 11_000 };
    expect(planCorrection(repriced, back)).toBeNull();
  });

  it("has nothing to do once the game is back on its step", () => {
    const { next } = planCorrection(silksong, back);
    const again = planCorrection(next, back);
    expect(again.changes).toEqual([]);
    expect(again.next).toBe(next);
  });

  it("leaves an add-ons edition where it stands, above the new price", () => {
    const withExtras = {
      ...silksong,
      types: [...silksong.types, { id: "dlc_offline", name: "أوفلاين مع الإضافات", price: 14_000 }],
    };
    const { next, changes } = planCorrection(withExtras, back);
    expect(next.types[2].price).toBe(14_000);
    expect(changes.map((c) => c.path).sort()).toEqual(["price", "types[0].price"]);
  });
});
