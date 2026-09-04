import { describe, expect, it } from "vitest";

import { initialOptionId, initialVariantName, listingPrice } from "./productPricing";

describe("listingPrice", () => {
  it("keeps the base price when the product has no priced options", () => {
    expect(listingPrice({ price: 25000 })).toBe(25000);
    expect(listingPrice({ price: 25000, options: [{ id: "a", name: "A" }] })).toBe(25000);
  });

  it("keeps the base price when a priced option carries the same amount", () => {
    const product = {
      price: 38000,
      options: [
        { id: "usd10", name: "$10", price: 20000 },
        { id: "usd20", name: "$20", price: 38000 },
      ],
    };
    expect(listingPrice(product)).toBe(38000);
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
    expect(
      listingPrice({ price: 7500, variants: denominations }),
    ).toBe(7000);
  });

  it("prefers the denomination priced exactly at the base price", () => {
    expect(initialVariantName(denominations, 13500)).toBe("10 USD");
    expect(listingPrice({ price: 13500, variants: denominations })).toBe(13500);
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
    expect(initialVariantName([{ name: "", price: 100 }, { name: "5 USD", price: 7000 }], 0)).toBe(
      "5 USD",
    );
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
