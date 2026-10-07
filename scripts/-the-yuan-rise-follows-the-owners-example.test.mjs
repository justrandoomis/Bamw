/**
 * The price rise for the yuan at 280, held to the owner's own example.
 *
 *   «مثلا mario kart world سعرها الحالي ٩ الف فبعد الزباده تصبح ١٢ الف
 *    وهكذا مع البقيه»
 *
 * 9,000 → 12,000 is the 25% he named, rounded UP to the next thousand. Rounded
 * to the nearest it would be 11,000, so the rounding direction is part of the
 * rule, and it is the first thing tested here.
 */
import { describe, expect, it } from "vitest";

import {
  HANDLED_PATTERNS,
  MARK_KEY,
  NOT_YUAN_PRICED,
  canonical,
  diffPaths,
  isRaised,
  markFor,
  moveCost,
  planBundle,
  planProduct,
  priceLikePatterns,
  risePrice,
  valueAt,
} from "./lib/yuan-reprice.mjs";

const RISE = 0.25;
const FACTOR = 280 / 220;
const MARK = markFor(220, 280);
const opts = { rise: RISE, factor: FACTOR, mark: MARK };

describe("the owner's example, and the ladder it implies", () => {
  it("takes Mario Kart World from 9,000 to 12,000", () => {
    expect(risePrice(9000, RISE)).toBe(12_000);
  });

  it.each([
    [5_000, 7_000],
    [7_000, 9_000],
    [8_000, 10_000],
    [10_000, 13_000],
    [45_000, 57_000],
    [36_250, 46_000],
  ])("%i → %i", (before, after) => {
    expect(risePrice(before, RISE)).toBe(after);
  });

  it("never lets floating arithmetic push an exact thousand to the next one", () => {
    /* 8,000 × 1.25 is exactly 10,000 and must stay 10,000, not become 11,000. */
    expect(risePrice(8_000, RISE)).toBe(10_000);
    expect(risePrice(16_000, RISE)).toBe(20_000);
  });

  it("leaves an unpriced row unpriced — empty means «use the price above me»", () => {
    expect(risePrice("", RISE)).toBeNull();
    expect(risePrice(0, RISE)).toBeNull();
    expect(risePrice(null, RISE)).toBeNull();
  });
});

describe("the cost moves with the yuan", () => {
  it("is the same yuan amount at 280 instead of 220", () => {
    expect(moveCost(1_496, FACTOR)).toBe(1_904); // ¥6.80
    expect(moveCost(1_711.6, FACTOR)).toBe(2_178.4); // ¥7.78
    expect(moveCost(25_000, FACTOR)).toBe(31_818.18);
  });
});

describe("one product, every copy of its price", () => {
  const product = {
    id: "prd_mkw",
    title: "Mario Kart World",
    kind: "game",
    price: 9_000,
    accountPrice: 9_000,
    accountOnlinePrice: 45_000,
    cost: 1_496,
    types: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 9_000, cost: 1_496 },
      { id: "standard_online", name: "حساب أونلاين", price: 45_000, cost: 33_000 },
      { id: "dlc_offline", name: "مع الإضافات", price: "", cost: 2_000 },
    ],
    variants: [{ id: "standard_offline", name: "حساب أوفلاين", price: 9_000, cost: 1_496 }],
    options: [{ id: "offline_account", name: "حساب أوفلاين", price: 0 }],
    gallery: ["a.jpg"],
    stock: 4,
  };

  it("raises every price and every cost, and changes nothing else", () => {
    const { next, changes, guarded } = planProduct(product, opts);
    expect(next.price).toBe(12_000);
    expect(next.accountPrice).toBe(12_000);
    expect(next.accountOnlinePrice).toBe(57_000);
    expect(next.cost).toBe(1_904);
    expect(next.types[0]).toMatchObject({ price: 12_000, cost: 1_904 });
    expect(next.types[1]).toMatchObject({ price: 57_000, cost: 42_000 });
    expect(next.types[2]).toMatchObject({ price: "", cost: 2_545.45 });
    expect(next.variants[0]).toMatchObject({ price: 12_000, cost: 1_904 });
    expect(next.options[0].price).toBe(0);
    expect(next.gallery).toBe(product.gallery);
    expect(next.stock).toBe(4);
    expect(next[MARK_KEY]).toBe(MARK);
    expect(guarded).toEqual([]);

    /* The copies that agreed before still agree after. */
    expect(next.types[0].price).toBe(next.variants[0].price);
    expect(next.types[0].price).toBe(next.price);

    /* Every change is reported with where it is and what it was. */
    for (const change of changes) {
      expect(valueAt(next, change.path)).toBe(change.after);
      expect(Number(valueAt(product, change.path))).toBe(change.before);
    }
    expect(changes.filter((c) => c.kind === "price")).toHaveLength(6);
  });

  it("does not touch the document it was given", () => {
    const before = JSON.stringify(product);
    planProduct(product, opts);
    expect(JSON.stringify(product)).toBe(before);
  });

  it("lifts a price the rise would leave under its own new cost", () => {
    const atCost = {
      id: "p",
      types: [{ id: "standard_online", name: "حساب أونلاين", price: 50_000, cost: 50_000 }],
    };
    const { next, guarded } = planProduct(atCost, opts);
    expect(next.types[0].cost).toBe(63_636.36);
    expect(next.types[0].price).toBe(65_000);
    expect(guarded).toHaveLength(1);
  });

  it("marks nothing it did not change", () => {
    const { next, changes } = planProduct({ id: "free", title: "Free", price: 0 }, opts);
    expect(changes).toEqual([]);
    expect(next[MARK_KEY]).toBeUndefined();
  });

  it("changes nothing but the paths it reports, and the mark", () => {
    const { next, changes } = planProduct(product, opts);
    expect(new Set(diffPaths(product, next))).toEqual(
      new Set([...changes.map((c) => c.path), MARK_KEY]),
    );
  });

  it("knows a product it already raised", () => {
    const { next } = planProduct(product, opts);
    expect(isRaised(product, MARK)).toBe(false);
    expect(isRaised(next, MARK)).toBe(true);
  });
});

describe("the copies of one price stay one price", () => {
  /*
    The online price lives in two places: `accountOnlinePrice`, which the offer
    card reads, and the tier row, which the buy sheet charges. Only the row
    knows its cost. Lifting the row alone would show one number and charge
    another — the fault this shop has spent weeks removing.
  */
  const thin = {
    id: "thin",
    price: 9_000,
    accountOnlinePrice: 50_000,
    types: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 9_000, cost: 1_496 },
      { id: "standard_online", name: "حساب أونلاين", price: 50_000, cost: 50_000 },
    ],
    variants: [{ id: "standard_online", name: "حساب أونلاين", price: 50_000, cost: 50_000 }],
  };

  it("lifts every copy of a guarded price, not only the row that carried the cost", () => {
    const { next, guarded } = planProduct(thin, opts);
    expect(next.types[1].price).toBe(65_000);
    expect(next.variants[0].price).toBe(65_000);
    expect(next.accountOnlinePrice).toBe(65_000);
    expect(next.price).toBe(12_000);
    expect(guarded.map((g) => [g.path, g.why]).sort()).toEqual(
      [
        ["accountOnlinePrice", "copy"],
        ["types[1].price", "own-cost"],
        ["variants[0].price", "own-cost"],
      ].sort(),
    );
  });

  it("never lifts a compare-at price, which is shown and never charged", () => {
    const { next } = planProduct({ ...thin, originalPrice: 50_000 }, opts);
    expect(next.originalPrice).toBe(63_000);
  });

  it("raises a stored base price with the rest", () => {
    expect(planProduct({ id: "b", basePrice: 9_000 }, opts).next.basePrice).toBe(12_000);
  });
});

describe("a price is written back in the type it was read in", () => {
  it("keeps a price stored as text as text", () => {
    const { next, changes } = planProduct(
      { id: "t", price: "9000", types: [{ id: "standard_offline", price: "9000", cost: "1496" }] },
      opts,
    );
    expect(next.price).toBe("12000");
    expect(next.types[0].price).toBe("12000");
    expect(next.types[0].cost).toBe("1904");
    for (const change of changes) expect(Number(valueAt(next, change.path))).toBe(change.after);
  });
});

describe("the fields the catalogue keeps a price in", () => {
  it("finds every price-like field, nested ones included", () => {
    const found = priceLikePatterns({
      price: 9_000,
      lendPrice: 3_000,
      types: [
        { price: 9_000, cost: 1_496 },
        { price: "", cost: 2_000 },
      ],
      regions: [{ offer: { price: 5_000 } }],
      title: "Mario",
    });
    expect(Object.fromEntries(found)).toEqual({
      price: 1,
      lendPrice: 1,
      "types[].price": 1,
      "types[].cost": 2,
      "regions[].offer.price": 1,
    });
  });

  it("names the ones the rise moves, and the ones it leaves on purpose", () => {
    expect(HANDLED_PATTERNS.has("types[].price")).toBe(true);
    expect(HANDLED_PATTERNS.has("dlcs[].cost")).toBe(true);
    expect(HANDLED_PATTERNS.has("accountOnlinePrice")).toBe(true);
    expect(HANDLED_PATTERNS.has("lendPrice")).toBe(false);
    expect(NOT_YUAN_PRICED.has("discPrice")).toBe(true);
    /* Found by the first live dry run: reference prices, not prices the shop sells. */
    for (const key of ["price_usd", "store_offer_bonus_iqd", "switch2UpgradePrice"]) {
      expect(HANDLED_PATTERNS.has(key)).toBe(false);
      expect(NOT_YUAN_PRICED.get(key)).toMatch(/ليس/);
    }
  });

  it("compares two documents by content, whatever order their keys are in", () => {
    expect(canonical({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(canonical({ b: [{ x: 1, y: 2 }], a: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: "1" }));
  });
});

describe("a bundle of games", () => {
  it("rises with its games, add-on options included", () => {
    const { next, changes } = planBundle(
      {
        id: "bnd_1",
        price: 20_000,
        originalPrice: 26_000,
        accountOptions: [
          { id: "a", kind: "offline", extraPrice: 0 },
          { id: "b", kind: "online", extraPrice: 15_000 },
        ],
      },
      opts,
    );
    expect(next.price).toBe(25_000);
    expect(next.originalPrice).toBe(33_000);
    expect(next.accountOptions[0].extraPrice).toBe(0);
    expect(next.accountOptions[1].extraPrice).toBe(19_000);
    expect(changes).toHaveLength(3);
    expect(next[MARK_KEY]).toBe(MARK);
  });

  it("leaves a bundle with no price alone and unmarked", () => {
    const { next, changes } = planBundle({ id: "bnd_free", price: 0, accountOptions: [] }, opts);
    expect(changes).toEqual([]);
    expect(next[MARK_KEY]).toBeUndefined();
  });
});
