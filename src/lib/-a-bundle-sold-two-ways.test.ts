/**
 * A bundle sold as more than one kind of account.
 *
 * The shop sells one bundle several ways — an offline account at the listed
 * price, an online one for a few thousand more — and the money question is the
 * one this file is about: the customer must be charged the number they were
 * shown, and the surcharge must come off the bundle record rather than out of
 * the request.
 *
 * That is the same lesson `resolveUnitPrice` already carries for products. Its
 * docstring records what happened when the storefront and the till each had
 * their own copy of the rule: a customer who chose a differently-priced option
 * was shown one number and charged another. Bundles now have one rule too.
 */
import { describe, expect, it } from "vitest";

import {
  bundleAccountLabel,
  bundleAccountOptions,
  resolveBundleUnitPrice,
  sumBundleGamePrices,
  UNPRICED_GAME_VALUE,
} from "@/lib/bundles";
import { cartLinePrice } from "@/lib/productPricing";
import type { AccountBundle, Product } from "@/lib/types";

const OFFLINE = { id: "opt_offline", kind: "offline" as const, extraPrice: 0 };
const ONLINE = { id: "opt_online", kind: "online" as const, extraPrice: 5000 };

const bundle = (overrides: Partial<AccountBundle> = {}): AccountBundle =>
  ({
    id: "bnd_1",
    title: "بندل مغامرات",
    price: 35000,
    gameIds: [],
    isActive: true,
    accountOptions: [OFFLINE, ONLINE],
    ...overrides,
  }) as AccountBundle;

describe("what one copy costs", () => {
  it("adds the option's cost to the bundle price", () => {
    expect(resolveBundleUnitPrice(bundle(), { optionId: "opt_online" }).unitPrice).toBe(40000);
  });

  it("charges the listed price for an option that adds nothing", () => {
    expect(resolveBundleUnitPrice(bundle(), { optionId: "opt_offline" }).unitPrice).toBe(35000);
  });

  it("charges the listed price when no option was named", () => {
    expect(resolveBundleUnitPrice(bundle(), {}).unitPrice).toBe(35000);
  });

  it("ignores an id that names nothing on the record", () => {
    /*
      The point of the whole design. A request naming an option the bundle does
      not have prices as the bundle's own price — never as whatever arrived
      beside the id.
    */
    expect(resolveBundleUnitPrice(bundle(), { optionId: "opt_free_please" }).unitPrice).toBe(35000);
  });

  it("refuses a negative surcharge — a discount nobody typed", () => {
    const sneaky = bundle({
      accountOptions: [{ id: "opt_x", kind: "online", extraPrice: -30000 }],
    });
    expect(resolveBundleUnitPrice(sneaky, { optionId: "opt_x" }).unitPrice).toBe(35000);
  });

  it("names the option it priced, so the order can say which account was sold", () => {
    const { option } = resolveBundleUnitPrice(bundle(), { optionId: "opt_online" });
    expect(option?.id).toBe("opt_online");
    expect(bundleAccountLabel(option!)).toContain("Online");
  });
});

describe("a bundle saved before options existed", () => {
  it("is still buyable, at exactly the price it always had", () => {
    const old = bundle({ accountOptions: undefined, accountType: "primary" });
    expect(resolveBundleUnitPrice(old, {}).unitPrice).toBe(35000);
  });

  it("reads as the one option it has, so nothing has to handle an empty list", () => {
    const old = bundle({ accountOptions: undefined, accountType: "offline" });
    const options = bundleAccountOptions(old);
    expect(options).toHaveLength(1);
    expect(options[0]!.kind).toBe("offline");
    expect(options[0]!.extraPrice).toBe(0);
  });
});

describe("the screen and the till read the same rule", () => {
  it("prices a cart line by the bundle rule, not the product one", () => {
    /*
      `resolveUnitPrice` treats a priced option as a *replacement* for the
      record's price. Running a bundle through it would have charged the 5000
      surcharge as the entire price of a 35000 bundle.
    */
    const line = { price: 1, meta: { optionId: "opt_online" } };
    expect(cartLinePrice(bundle() as unknown as Record<string, unknown>, line)).toBe(40000);
  });

  it("does not let a stale stored price win over the catalogue", () => {
    /* The cart line was added when the bundle cost less. The record wins. */
    const line = { price: 9999, meta: { optionId: "opt_offline" } };
    expect(cartLinePrice(bundle() as unknown as Record<string, unknown>, line)).toBe(35000);
  });
});

describe("the sum of the individual prices", () => {
  const products = [
    { id: "g1", price: 12000 },
    { id: "g2", price: 8000 },
    /* A placeholder: created by the description reader, priced by nobody yet. */
    { id: "g3", price: 0 },
  ] as unknown as Product[];

  it("counts a game the shop has not priced at five thousand", () => {
    const b = bundle({ gameIds: ["g1", "g2", "g3"] });
    expect(sumBundleGamePrices(b, products)).toBe(12000 + 8000 + UNPRICED_GAME_VALUE);
  });

  it("counts a game missing from this catalogue the same way", () => {
    /*
      Placeholders are hidden, and the public catalogue drops hidden rows — so
      the storefront cannot resolve one at all. Same case, same value: without
      this the strike-through total differed between the shop and the admin
      panel for the very same bundle.
    */
    const b = bundle({ gameIds: ["g1", "not_in_this_catalogue"] });
    expect(sumBundleGamePrices(b, products)).toBe(12000 + UNPRICED_GAME_VALUE);
  });

  it("counts a game listed twice once", () => {
    const b = bundle({ gameIds: ["g1", "g1"] });
    expect(sumBundleGamePrices(b, products)).toBe(12000);
  });

  it("stops counting a placeholder at five thousand once it is priced", () => {
    /* The admin fills the record in; the sum follows with no second edit. */
    const filled = [
      { id: "g1", price: 12000 },
      { id: "g2", price: 8000 },
      { id: "g3", price: 30000 },
    ] as unknown as Product[];
    const b = bundle({ gameIds: ["g3"] });
    expect(sumBundleGamePrices(b, products)).toBe(UNPRICED_GAME_VALUE);
    expect(sumBundleGamePrices(b, filled)).toBe(30000);
  });

  it("is zero for a bundle with no games, rather than a number nobody meant", () => {
    expect(sumBundleGamePrices(bundle({ gameIds: [] }), products)).toBe(0);
  });
});
