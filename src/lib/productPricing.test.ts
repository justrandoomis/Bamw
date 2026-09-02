import { describe, expect, it } from "vitest";

import { initialOptionId, listingPrice } from "./productPricing";

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
