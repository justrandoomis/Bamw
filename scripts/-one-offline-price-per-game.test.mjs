/**
 * One ordinary offline price per game, the highest of its copies.
 *
 *   «هنالك العاب لم تتأثر بالصعود او صعودها قليل حل المشكلة … مثل zelda و
 *    lego batman و بعض اجزاء ماريو»
 *
 * The rise moved every copy by the same rule, so copies that disagreed before
 * still disagreed after, and the card printed the stale low one. These tests
 * hold the repair to the two shapes the owner's own examples had.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SPREAD,
  OFFLINE_CEILING,
  offlineCopies,
  planOfflineSync,
} from "./lib/offline-price-copies.mjs";
import { diffPaths } from "./lib/yuan-reprice.mjs";

/* The shop's own vocabulary, reduced to what these fixtures need. */
const isOrdinaryOffline = (row) =>
  /offline|أوفلاين/i.test(`${row.id} ${row.name}`) && !/dlc|إضاف/i.test(`${row.id} ${row.name}`);

describe("a base price left behind by its own offline row", () => {
  /* Mario Tennis Aces after the rise: base 5,000 → 7,000, offline row 7,000 → 9,000. */
  const aces = {
    id: "prd_aces",
    title: "Mario Tennis Aces",
    price: 7_000,
    types: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 9_000, cost: 1_904 },
      { id: "standard_online", name: "حساب أونلاين", price: 32_000, cost: 25_000 },
    ],
    variants: [
      { id: "standard_offline", name: "حساب أوفلاين", price: 9_000 },
      { id: "standard_online", name: "حساب أونلاين", price: 32_000 },
    ],
  };

  it("lifts the base to the offline row, and touches nothing else", () => {
    const { next, changes, held, target } = planOfflineSync(aces, isOrdinaryOffline);
    expect(held).toBeNull();
    expect(target).toBe(9_000);
    expect(next.price).toBe(9_000);
    expect(changes).toEqual([{ path: "price", before: 7_000, after: 9_000 }]);
    expect(diffPaths(aces, next)).toEqual(["price"]);
    /* The online account is a different price and is never in the set. */
    expect(next.types[1].price).toBe(32_000);
  });

  it("does not touch the document it was given", () => {
    const before = JSON.stringify(aces);
    planOfflineSync(aces, isOrdinaryOffline);
    expect(JSON.stringify(aces)).toBe(before);
  });
});

describe("an account price behind its own base", () => {
  /* LEGO Batman after the rise: base 16,000 → 20,000, account price 12,000 → 15,000. */
  it("lifts the account price to the base", () => {
    const lego = { id: "prd_lego", price: 20_000, accountPrice: 15_000 };
    const { next, changes } = planOfflineSync(lego, isOrdinaryOffline);
    expect(next.accountPrice).toBe(20_000);
    expect(changes).toEqual([{ path: "accountPrice", before: 15_000, after: 20_000 }]);
  });

  it("keeps a price stored as text as text", () => {
    const { next } = planOfflineSync(
      { id: "t", price: "9000", accountPrice: "7000" },
      isOrdinaryOffline,
    );
    expect(next.accountPrice).toBe("9000");
  });
});

describe("what it leaves alone", () => {
  it("a game whose copies already agree", () => {
    const agreed = {
      id: "a",
      price: 9_000,
      accountPrice: 9_000,
      types: [{ id: "standard_offline", name: "حساب أوفلاين", price: 9_000 }],
    };
    const { next, changes } = planOfflineSync(agreed, isOrdinaryOffline);
    expect(changes).toEqual([]);
    expect(next).toBe(agreed);
  });

  it("copies too far apart to be one price — two prices filed in one place", () => {
    const apart = { id: "b", price: 9_000, accountPrice: 9_000 * MAX_SPREAD + 1_000 };
    const plan = planOfflineSync(apart, isOrdinaryOffline);
    expect(plan.changes).toEqual([]);
    expect(plan.held).toMatch(/متباعدتان/);
  });

  it("a top copy above any offline account's price", () => {
    const online = { id: "c", price: OFFLINE_CEILING, accountPrice: OFFLINE_CEILING + 1_000 };
    const plan = planOfflineSync(online, isOrdinaryOffline);
    expect(plan.changes).toEqual([]);
    expect(plan.held).toMatch(/سقف/);
  });

  it("never counts an online row, an add-ons row or an unpriced row as a copy", () => {
    const copies = offlineCopies(
      {
        price: 7_000,
        types: [
          { id: "standard_online", name: "حساب أونلاين", price: 32_000 },
          { id: "dlc_offline", name: "أوفلاين مع الإضافات", price: 12_000 },
          { id: "standard_offline", name: "حساب أوفلاين", price: "" },
        ],
        options: [{ id: "offline_account", name: "حساب أوفلاين", price: 0 }],
      },
      isOrdinaryOffline,
    );
    expect(copies.map((c) => c.path)).toEqual(["price"]);
  });
});
