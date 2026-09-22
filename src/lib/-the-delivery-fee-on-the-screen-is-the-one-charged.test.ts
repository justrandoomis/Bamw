/**
 * The courier's fee is one number, read from one place.
 *
 * The shop keeps a base fee and a list of cities that cost something else.
 * The checkout applied that list. The cart did not — it showed `deliveryBase`
 * for every address — so a member ordering to a city the owner had priced
 * differently was shown one number and charged another. The same fault as a
 * product advertising one price and charging another, hidden in the one line
 * of the bill nobody thinks to check.
 *
 * And it is not a rounding difference: an exception can be any figure the
 * owner types, above the base or below it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DELIVERY_BASE, resolveDeliveryPrice } from "./delivery-fee";

const orders = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
const cart = readFileSync(path.resolve(__dirname, "../routes/cart.tsx"), "utf8");

const settings = {
  deliveryBase: 5000,
  deliveryExceptions: [
    { city: "أربيل", price: 10000 },
    { city: "بغداد", price: 3000 },
  ],
};

describe("the fee for one address", () => {
  it("charges the base where the owner has priced nothing else", () => {
    expect(resolveDeliveryPrice(settings, "البصرة")).toBe(5000);
    expect(resolveDeliveryPrice(settings, "")).toBe(5000);
    expect(resolveDeliveryPrice(settings, null)).toBe(5000);
    expect(resolveDeliveryPrice(settings, undefined)).toBe(5000);
  });

  it("charges the exception where there is one, above the base or below it", () => {
    expect(resolveDeliveryPrice(settings, "أربيل")).toBe(10000);
    expect(resolveDeliveryPrice(settings, "بغداد")).toBe(3000);
  });

  it("ignores the spaces around a typed city", () => {
    expect(resolveDeliveryPrice(settings, "  أربيل  ")).toBe(10000);
  });

  it("falls back to the default when the shop has set nothing", () => {
    expect(resolveDeliveryPrice({}, "أربيل")).toBe(DEFAULT_DELIVERY_BASE);
    expect(resolveDeliveryPrice(null, "أربيل")).toBe(DEFAULT_DELIVERY_BASE);
    expect(resolveDeliveryPrice(undefined, undefined)).toBe(DEFAULT_DELIVERY_BASE);
  });

  it("survives a list that is not a list, or rows that are not rows", () => {
    expect(resolveDeliveryPrice({ deliveryBase: 4000, deliveryExceptions: "no" }, "أربيل")).toBe(
      4000,
    );
    expect(
      resolveDeliveryPrice({ deliveryBase: 4000, deliveryExceptions: [null, 7] }, "أربيل"),
    ).toBe(4000);
  });

  it("reads a price that arrived as a string, and refuses one that is not a number", () => {
    expect(
      resolveDeliveryPrice({ deliveryExceptions: [{ city: "أربيل", price: "10000" }] }, "أربيل"),
    ).toBe(10000);
    expect(
      resolveDeliveryPrice({ deliveryExceptions: [{ city: "أربيل", price: "free" }] }, "أربيل"),
    ).toBe(0);
  });
});

describe("both sides read it", () => {
  it("the checkout no longer walks the list itself", () => {
    expect(orders).toContain(
      "const deliveryPrice = resolveDeliveryPrice(store.settings, address?.city);",
    );
    expect(orders).not.toContain("deliveryExceptions.find((e) => e.city === address.city)");
  });

  it("the cart no longer shows the base fee for every address", () => {
    expect(cart).toContain('import { resolveDeliveryPrice } from "@/lib/delivery-fee";');
    expect(cart).toContain("resolveDeliveryPrice(");
    expect(cart).not.toContain(
      'const deliveryBase = Number(storeData?.settings?.["deliveryBase"] || 5000);',
    );
  });

  it("the cart prices it against the city on the address it will send", () => {
    const at = cart.indexOf("const deliveryPrice = needsAddress");
    expect(at).toBeGreaterThan(-1);
    expect(cart.slice(at, at + 260)).toContain("address.city");
  });
});
