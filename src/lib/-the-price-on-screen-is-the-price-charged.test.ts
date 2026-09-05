/**
 * The price a customer reads must be the price the shop charges.
 *
 * ## What went wrong
 *
 * `types` and `variants` are two names for one list — `types` is the current
 * one, `variants` the name it had before. Every reader in the app prefers
 * `types` and falls back to `variants`:
 *
 *   - `normalizeProductRow` in `db.server.ts`, reading a document;
 *   - `resolveUnitPrice` in `productPricing.ts`, which is what the server
 *     actually charges the line at;
 *   - `buildEditions` in `fromProduct.ts`.
 *
 * `buildProductView` — the one the product page renders from — had them the
 * other way round. So a record carrying both lists displayed one price and
 * charged another.
 *
 * The live $5 Nintendo eShop card is the case that surfaced it:
 * `variants[0].price = 7000` left over from an old import, a `types` row with
 * no price of its own, and a record priced at 7,500. The page printed 7,000.
 * The server charged 7,500. And no edit in the admin moved it, because nothing
 * the admin writes touches `variants`.
 *
 * These tests hold the two readers to the same answer, which is the property
 * that was actually broken — not the precedence in either one alone.
 */
import { describe, expect, it } from "vitest";

import { buildProductView } from "./productImport/productView";
import { listingPrice, resolveUnitPrice } from "./productPricing";

/** The live card, reduced to the fields that decide its price. */
const GIFT_CARD = {
  id: "prd_4c4c65ffbb01489c",
  title: "Nintendo eShop Gift Card $5 — USA",
  price: 7500,
  kind: "digital_code",
  options: [{ id: "opt_usa", name: "USA Digital Code" }],
  types: [{ id: "typ_usa5", name: "5 USD — USA", optionId: "opt_usa" }],
  // The stale list, from an import that predates the rename.
  variants: [{ id: "typ_usa5", name: "5 USD — USA", optionId: "opt_usa", price: 7000 }],
} as Record<string, unknown>;

function displayedPrice(product: Record<string, unknown>): number | undefined {
  const view = buildProductView(product as never, "ar");
  if (!view) throw new Error("the product view did not build");
  // The chain `ProductDetails` uses for its header price.
  return view.variants[0]?.price ?? view.options[0]?.price ?? view.price;
}

function chargedPrice(product: Record<string, unknown>): number {
  // What the server bills the line at, for the same selection the page has
  // preselected.
  return resolveUnitPrice(product as never, { optionId: "opt_usa", typeId: "typ_usa5" }).unitPrice;
}

describe("a card whose old and new lists disagree", () => {
  it("shows the customer what the shop will charge", () => {
    expect(displayedPrice(GIFT_CARD)).toBe(chargedPrice(GIFT_CARD));
  });

  it("agrees with the listing card the customer tapped to get here", () => {
    /*
      The storefront card printed 7,500 and the page it opened printed 7,000.
      Two screens, one product, two prices — the first thing the owner saw.
    */
    expect(displayedPrice(GIFT_CARD)).toBe(listingPrice(GIFT_CARD as never));
  });

  it("prices it from the list the admin can actually edit", () => {
    /*
      `types` has no price of its own, so the row inherits the record's 7,500.
      7,000 is the number nothing in the admin can reach.
    */
    expect(displayedPrice(GIFT_CARD)).not.toBe(7000);
    expect(chargedPrice(GIFT_CARD)).toBe(7500);
  });
});

describe("a record that only has the old list", () => {
  /*
    Products written before the rename carry `variants` and no `types`, and
    must keep pricing exactly as they did — the fallback is what protects them.
  */
  const legacy = {
    ...GIFT_CARD,
    types: undefined,
    variants: [{ id: "typ_usa5", name: "5 USD — USA", optionId: "opt_usa", price: 7000 }],
  } as Record<string, unknown>;

  it("still reads its prices", () => {
    expect(displayedPrice(legacy)).toBe(7000);
  });

  it("and still agrees with the till", () => {
    expect(displayedPrice(legacy)).toBe(chargedPrice(legacy));
  });
});

describe("a record with a real price on the current list", () => {
  const priced = {
    ...GIFT_CARD,
    types: [{ id: "typ_usa5", name: "5 USD — USA", optionId: "opt_usa", price: 9000 }],
  } as Record<string, unknown>;

  it("uses it, over both the base price and the old list", () => {
    expect(displayedPrice(priced)).toBe(9000);
    expect(displayedPrice(priced)).toBe(chargedPrice(priced));
  });
});
