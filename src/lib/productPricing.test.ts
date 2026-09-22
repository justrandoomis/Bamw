import { describe, expect, it } from "vitest";

import {
  initialOptionId,
  initialVariantName,
  listingPrice,
  listingPricing,
  normalizeProductCompareAtPrices,
} from "./productPricing";

describe("listingPrice", () => {
  it("keeps the base price when the product has no priced options", () => {
    expect(listingPrice({ price: 25000 })).toBe(25000);
    expect(listingPrice({ price: 25000, options: [{ id: "a", name: "A" }] })).toBe(25000);
  });

  it("leads with the cheapest option even when one is priced at the base", () => {
    /*
      «السعر الذي اريده ان يظهر على البطاقه يجب ان يكون سعر ارخص خيار في المنتج»

      This asserted 38,000, because the $20 denomination carried exactly the
      base price. A gift card's card should read from its cheapest
      denomination, which is also a price the customer can really pay, and the
      details page opens on that same $10.
    */
    const product = {
      price: 38000,
      options: [
        { id: "usd10", name: "$10", price: 20000 },
        { id: "usd20", name: "$20", price: 38000 },
      ],
    };
    expect(listingPrice(product)).toBe(20000);
  });

  it("leads with the cheapest priced option when the base price is not one of them", () => {
    const product = {
      price: 0,
      options: [
        { id: "usd20", name: "$20", price: 38000 },
        { id: "usd10", name: "$10", price: 20000 },
      ],
    };
    expect(listingPrice(product)).toBe(20000);
  });

  it("falls back to variants when no option carries a price", () => {
    const product = {
      price: 0,
      options: [{ id: "digital", name: "Digital" }],
      variants: [
        { name: "3 Months", price: 15000 },
        { name: "12 Months", price: 45000 },
      ],
    };
    expect(listingPrice(product)).toBe(15000);
  });

  it("survives malformed rows and string prices", () => {
    const product = {
      price: "12500",
      options: [null, "junk", { id: "x", name: "X", price: "not-a-number" }],
    };
    expect(listingPrice(product as never)).toBe(12500);
  });

  it("returns the before/after pair belonging to the listed type", () => {
    const product = {
      price: 9000,
      originalPrice: 14000,
      options: [{ id: "offline", name: "Offline" }],
      types: [
        {
          id: "offline_base",
          optionId: "offline",
          name: "Offline Standard",
          price: 9000,
          originalPrice: 14000,
        },
        {
          id: "offline_dlc",
          optionId: "offline",
          name: "Offline + DLC",
          price: 12500,
          originalPrice: 18000,
        },
      ],
    };

    expect(listingPricing(product)).toMatchObject({ unitPrice: 9000, originalUnitPrice: 14000 });
  });

  it("never presents a compare-at price that is not above the sale price", () => {
    expect(listingPricing({ price: 12000, originalPrice: 10000 })).toMatchObject({
      unitPrice: 12000,
      originalUnitPrice: 12000,
    });
  });
});

describe("persisted compare-at prices", () => {
  it("turns admin strings into finite numeric values and rejects invalid amounts", () => {
    expect(
      normalizeProductCompareAtPrices({
        originalPrice: "15000",
        options: [
          { id: "offline", originalPrice: "18000" },
          { id: "online", originalPrice: -1 },
        ],
        types: [{ id: "extras", original_price: "not-a-number" }],
      }),
    ).toMatchObject({
      originalPrice: 15_000,
      options: [
        { id: "offline", originalPrice: 18_000 },
        { id: "online", originalPrice: 0 },
      ],
      types: [{ id: "extras", originalPrice: 0 }],
    });
  });
});

describe("initialOptionId", () => {
  it("returns empty for no options", () => {
    expect(initialOptionId([], 1000)).toBe("");
  });

  it("keeps the first option when none carry prices (legacy behaviour)", () => {
    expect(
      initialOptionId(
        [
          { id: "offline", price: undefined },
          { id: "online", price: undefined },
        ],
        25000,
      ),
    ).toBe("offline");
  });

  it("opens on the option priced at the base price", () => {
    expect(
      initialOptionId(
        [
          { id: "usd10", price: 20000 },
          { id: "usd20", price: 38000 },
        ],
        38000,
      ),
    ).toBe("usd20");
  });

  it("opens on the cheapest priced option otherwise", () => {
    expect(
      initialOptionId(
        [
          { id: "usd50", price: 90000 },
          { id: "usd10", price: 20000 },
        ],
        0,
      ),
    ).toBe("usd10");
  });
});

/**
 * A gift card prices its denominations on `variants`, and the import schema
 * gives an option no price field at all. So `initialOptionId` — which looks
 * only at options — had nothing to select, the details header fell through to
 * the record's base price, and the card beside it printed the cheapest
 * denomination. The module's contract says both surfaces agree on one number;
 * for any product priced on its variants, it could not.
 */
describe("initialVariantName", () => {
  const denominations = [
    { name: "5 USD", price: 7000 },
    { name: "10 USD", price: 13500 },
    { name: "20 USD", price: 26000 },
  ];

  it("opens on the denomination the card prints", () => {
    // listingPrice picks the cheapest when no denomination matches the base.
    expect(initialVariantName(denominations, 7500)).toBe("5 USD");
    expect(listingPrice({ price: 7500, variants: denominations })).toBe(7000);
  });

  it("opens on the cheapest denomination, not the one priced at the base", () => {
    // Same sentence, same reason: «ارخص خيار في المنتج». The page and the card
    // still agree — they just agree on the cheaper one now.
    const opened = initialVariantName(denominations, 13500);
    const cheapest = denominations
      .filter((v) => typeof v.price === "number" && v.price > 0)
      .reduce((min, v) => (v.price! < min.price! ? v : min));
    expect(opened).toBe(cheapest.name);
    expect(listingPrice({ price: 13500, variants: denominations })).toBe(cheapest.price);
  });

  it("selects nothing when the options carry the prices", () => {
    /*
      Then the options lead, `initialOptionId` has already chosen, and
      preselecting a denomination would move the price off it.
    */
    expect(initialVariantName(denominations, 7500, [{ price: 9000 }])).toBe("");
  });

  it("selects nothing when no denomination is priced", () => {
    expect(initialVariantName([{ name: "Standard" }, { name: "Deluxe" }], 7500)).toBe("");
  });

  it("ignores a nameless row, which cannot be selected by name", () => {
    expect(
      initialVariantName(
        [
          { name: "", price: 100 },
          { name: "5 USD", price: 7000 },
        ],
        0,
      ),
    ).toBe("5 USD");
  });
});

describe("the two surfaces agree", () => {
  it("card price and opening details price are the same number", () => {
    const product = {
      price: 7500,
      variants: [
        { name: "5 USD", price: 7000 },
        { name: "10 USD", price: 13500 },
      ],
    };
    const opened = initialVariantName(product.variants, product.price, []);
    const shownOnPage = product.variants.find((v) => v.name === opened)?.price ?? product.price;
    expect(shownOnPage).toBe(listingPrice(product));
  });
});
