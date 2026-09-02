/**
 * @vitest-environment node
 */
/**
 * One price, resolved one way.
 *
 * The storefront and checkout each used to price a line with their own copy of
 * the rule, and the copies disagreed: the page priced
 * `type → option → edition → base`, checkout priced `edition → base` and never
 * looked at the option or the type at all. So a buyer who chose a
 * differently-priced option was shown one number and charged another.
 *
 * These pin the precedence itself, because both sides now call this function
 * and a change to it changes what customers are charged.
 */

import { describe, expect, it } from "vitest";

import { cartLinePrice, resolveUnitPrice } from "./productPricing";

/** A game sold as an offline or an online account, each priced its own way. */
const GAME = {
  id: "prd_1",
  title: "لعبة",
  price: 10_000,
  options: [
    { id: "offline_account", name: "حساب أوفلاين", price: 10_000 },
    { id: "online_account", name: "حساب أونلاين", price: 14_000 },
  ],
  types: [
    { id: "standard_offline", name: "أوفلاين عادي", optionId: "offline_account" },
    { id: "dlc_offline", name: "أوفلاين مع الإضافات", optionId: "offline_account", price: 12_500 },
  ],
  editions: [{ id: "ed_deluxe", name: "Deluxe", price: 18_000 }],
  dlcs: [{ id: "dlc_pass", name: "Expansion Pass", price: 6_000 }],
};

describe("what one copy costs", () => {
  it("is the record's price when nothing is selected", () => {
    const { unitPrice, source } = resolveUnitPrice(GAME, {});
    expect(unitPrice).toBe(10_000);
    expect(source).toBe("base");
  });

  it("is the option's price when an option is chosen", () => {
    // The bug: this used to charge 10,000 for a 14,000 option.
    const { unitPrice, source, optionName } = resolveUnitPrice(GAME, {
      optionId: "online_account",
    });
    expect(unitPrice).toBe(14_000);
    expect(source).toBe("option");
    expect(optionName).toBe("حساب أونلاين");
  });

  it("is the type's price when a priced type is chosen, over its option", () => {
    const { unitPrice, source } = resolveUnitPrice(GAME, {
      optionId: "offline_account",
      typeId: "dlc_offline",
    });
    expect(unitPrice).toBe(12_500);
    expect(source).toBe("type");
  });

  it("falls back to the option when the chosen type carries no price", () => {
    /*
      An unpriced row is not a price of zero — it means "use whatever is above
      me". A type with no price under a 14,000 option costs 14,000.
    */
    const { unitPrice, source } = resolveUnitPrice(GAME, {
      optionId: "online_account",
      typeId: "standard_offline",
    });
    expect(unitPrice).toBe(14_000);
    expect(source).toBe("option");
  });

  it("uses the edition when one is chosen and no option is", () => {
    const { unitPrice, source, editionName } = resolveUnitPrice(GAME, {
      editionId: "ed_deluxe",
    });
    expect(unitPrice).toBe(18_000);
    expect(source).toBe("edition");
    expect(editionName).toBe("Deluxe");
  });

  it("lets an option override an edition, as the storefront does", () => {
    const { unitPrice, source } = resolveUnitPrice(GAME, {
      editionId: "ed_deluxe",
      optionId: "online_account",
    });
    expect(unitPrice).toBe(14_000);
    expect(source).toBe("option");
  });

  it("adds add-ons on top of whichever price won", () => {
    const { unitPrice, dlcNames } = resolveUnitPrice(GAME, {
      optionId: "online_account",
      dlcIds: ["dlc_pass"],
    });
    expect(unitPrice).toBe(20_000);
    expect(dlcNames).toEqual(["Expansion Pass"]);
  });

  it("reads `variants` too, which is what older records call `types`", () => {
    const legacy = {
      price: 10_000,
      variants: [{ id: "v1", name: "نسخة", price: 11_500 }],
    };
    expect(resolveUnitPrice(legacy, { typeId: "v1" }).unitPrice).toBe(11_500);
  });

  it("ignores an id the record does not have, rather than trusting it", () => {
    const { unitPrice, source, optionName } = resolveUnitPrice(GAME, {
      optionId: "does_not_exist",
      typeId: "nor_this",
    });
    expect(unitPrice).toBe(10_000);
    expect(source).toBe("base");
    expect(optionName).toBeNull();
  });

  it("answers zero for a product it was given nothing of", () => {
    expect(resolveUnitPrice(undefined, {}).unitPrice).toBe(0);
    expect(resolveUnitPrice(null, { optionId: "x" }).unitPrice).toBe(0);
    expect(resolveUnitPrice({}, {}).unitPrice).toBe(0);
  });

  it("reads a price written as text, the way the catalogue sometimes stores it", () => {
    const written = { price: "12,500", options: [{ id: "o1", name: "خيار", price: "٠" }] };
    expect(resolveUnitPrice(written, {}).unitPrice).toBe(12_500);
    // An unparseable option price leaves the base price standing.
    expect(resolveUnitPrice(written, { optionId: "o1" }).unitPrice).toBe(12_500);
  });
});

describe("what a cart line is worth now", () => {
  const stored = { price: 10_000, optionId: "online_account" };

  it("takes the catalogue's price over the one the line remembers", () => {
    // The reported bug: the cart went on showing 10,000 after a rise to 12,000.
    const raised = { ...GAME, options: [{ id: "online_account", name: "أونلاين", price: 12_000 }] };
    expect(cartLinePrice(raised, stored)).toBe(12_000);
  });

  it("follows a price down as readily as up", () => {
    const cut = { ...GAME, options: [{ id: "online_account", name: "أونلاين", price: 8_000 }] };
    expect(cartLinePrice(cut, stored)).toBe(8_000);
  });

  it("reads the selection out of `meta` when the line keeps it there", () => {
    expect(cartLinePrice(GAME, { price: 1, meta: { optionId: "online_account" } })).toBe(14_000);
    expect(cartLinePrice(GAME, { price: 1, meta: { typeId: "dlc_offline" } })).toBe(12_500);
  });

  it("prefers the line's own field over `meta` when both are present", () => {
    expect(
      cartLinePrice(GAME, {
        price: 1,
        optionId: "offline_account",
        meta: { optionId: "online_account" },
      }),
    ).toBe(10_000);
  });

  it("keeps the remembered price only when the product is gone", () => {
    // Checkout refuses such a line anyway; showing 0 would say less.
    expect(cartLinePrice(undefined, { price: 9_500 })).toBe(9_500);
    expect(cartLinePrice(null, { price: 9_500 })).toBe(9_500);
  });

  it("keeps the remembered price when the record has no usable price", () => {
    expect(cartLinePrice({ id: "prd_x", price: 0 }, { price: 7_000 })).toBe(7_000);
  });

  it("answers zero when there is neither a product nor a remembered price", () => {
    expect(cartLinePrice(undefined, {})).toBe(0);
  });
});
