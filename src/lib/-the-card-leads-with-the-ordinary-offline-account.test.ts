/**
 * The price on the card is the ordinary offline account's.
 *
 * The owner, about /category/nintendo_games:
 *
 *   «اجعل السعر الارخص يعرض افتراضيا في البطاقه ( حساب اوفلاين عادي )
 *    المشكله يعرض سعر حساب الاونلاين»
 *
 * MEASURED ON THE LIVE CATALOGUE, because the first guess was wrong. Of 1,711
 * games, 104 carry more than one price and every one of those cards was already
 * leading with the right tier. The fault is in the other 1,607: **65 of them
 * carry exactly ONE priced row and it is an ONLINE account**, while the ordinary
 * offline account's price sits in `price` / `accountPrice`.
 *
 * Zelda: Tears of the Kingdom (Switch 2 Edition): `price` 12,000, one row at
 * 42,000, card printed 42,000. Kirby Air Riders, Splatoon Raiders, Pikmin 4 and
 * Luigi's Mansion 2 HD are the same shape.
 *
 * The old selection was pure arithmetic — the row priced at the base, else the
 * cheapest row — and it never considered anything that was not a row. With one
 * online row, "cheapest row" has only the wrong answer to choose from.
 *
 * AND IT IS ONLY HONEST BECAUSE THE ACCOUNT IS FOR SALE. `readOffers` was asked
 * about all 65 on production: every one offers the «حساب أوفلاين» account,
 * cheaper than the row, and available to buy right now. Zero without one. A
 * card advertising a price the page did not sell would be worse than the fault.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listingPricing, ordinaryOfflineRow, resolveUnitPrice } from "./productPricing";

const dialogs = readFileSync(path.resolve(__dirname, "../hub/gamehub/Dialogs.tsx"), "utf8");
const gameCard = readFileSync(path.resolve(__dirname, "../components/cards/GameCard.tsx"), "utf8");

/** The shape the 65 actually have: one online row, the account in `price`. */
const onlineOnly = {
  id: "prd_totk_s2",
  title: "The Legend of Zelda: Tears of the Kingdom — Nintendo Switch 2 Edition",
  price: 12000,
  types: [{ id: "t_online", name: "حساب أونلاين", price: 42000, cost: 26000 }],
};

const bothTiers = {
  id: "prd_both",
  title: "A game sold two ways",
  price: 42000,
  types: [
    { id: "t_online", name: "حساب أونلاين", price: 42000, cost: 26000 },
    { id: "t_offline", name: "حساب أوفلاين", price: 12000, cost: 2000 },
  ],
};

describe("the tier the shop leads with", () => {
  it("finds the ordinary offline row wherever it sits in the array", () => {
    expect(ordinaryOfflineRow(bothTiers.types)?.["id"]).toBe("t_offline");
    expect(ordinaryOfflineRow([...bothTiers.types].reverse())?.["id"]).toBe("t_offline");
  });

  it("is not fooled by an add-ons edition of the offline account", () => {
    const rows = [
      { id: "t_dlc", name: "حساب أوفلاين مع الاضافات", price: 20000 },
      { id: "t_plain", name: "حساب أوفلاين", price: 12000 },
    ];
    expect(ordinaryOfflineRow(rows)?.["id"]).toBe("t_plain");
  });

  it("ignores an unpriced row, which means «use whatever is above me»", () => {
    expect(
      ordinaryOfflineRow([{ id: "t_offline", name: "حساب أوفلاين", price: 0 }]),
    ).toBeUndefined();
  });

  it("answers nothing for a product with no rows at all", () => {
    expect(ordinaryOfflineRow(undefined)).toBeUndefined();
    expect(ordinaryOfflineRow([])).toBeUndefined();
    expect(ordinaryOfflineRow("not an array")).toBeUndefined();
  });
});

describe("what the card prints", () => {
  /* The measured fault, and the fix, on the real shape. */
  it("leads with the offline account when the only row is online", () => {
    expect(listingPricing(onlineOnly).unitPrice).toBe(12000);
  });

  it("leads with the offline row when the product has one", () => {
    expect(listingPricing(bothTiers).unitPrice).toBe(12000);
  });

  /*
    The old rule preferred the row priced exactly at the base. `bothTiers` has
    its base at the ONLINE row's 42,000 — which is how a card came to print the
    online price even on a product that had an offline row.
  */
  it("no longer prefers a row merely because it matches the base price", () => {
    expect(listingPricing(bothTiers).unitPrice).not.toBe(42000);
  });

  /*
    DELIBERATELY `price`, NOT `accountPrice`.

    `readOffers` prices the «حساب أوفلاين» offer as `accountPrice || price`, and
    copying that here was the first attempt at this test. It is wrong in exactly
    the way the whole change exists to fix: `resolveUnitPrice` with no tier
    selected charges `price`, so a card printing `accountPrice` would be a third
    number in a story that already had two too many. Where the two fields
    disagree it is the OFFER that is out of step, and that is a separate fault.
  */
  it("prints the number the till charges, even when `accountPrice` differs", () => {
    expect(listingPricing({ ...onlineOnly, accountPrice: 9000 }).unitPrice).toBe(12000);
    expect(resolveUnitPrice({ ...onlineOnly, accountPrice: 9000 }).unitPrice).toBe(12000);
  });

  it("does not drop to the base when the base is dearer than the rows", () => {
    const dearBase = {
      id: "prd_dear_base",
      price: 50000,
      types: [{ id: "t_online", name: "حساب أونلاين", price: 30000 }],
    };
    expect(listingPricing(dearBase).unitPrice).toBe(30000);
  });

  it("still prices a product with no rows from its own price", () => {
    expect(listingPricing({ id: "p", price: 8000 }).unitPrice).toBe(8000);
  });

  it("leaves option-priced products to the option rules", () => {
    const withOptions = {
      id: "prd_opt",
      price: 25000,
      options: [
        { id: "o_small", name: "10$", price: 15000 },
        { id: "o_big", name: "20$", price: 25000 },
      ],
    };
    expect(listingPricing(withOptions).unitPrice).toBe(25000);
  });
});

describe("the card and the till agree", () => {
  /*
    The module's whole contract: a card that prints one number while the page
    opens on another reads as the shop changing its price between two clicks.
  */
  it("the number on the card is what the same selection charges", () => {
    const row = ordinaryOfflineRow(bothTiers.types);
    expect(resolveUnitPrice(bothTiers, { typeId: String(row?.["id"]) }).unitPrice).toBe(
      listingPricing(bothTiers).unitPrice,
    );
  });

  it("with no offline row, no selection charges the same base the card showed", () => {
    expect(resolveUnitPrice(onlineOnly).unitPrice).toBe(listingPricing(onlineOnly).unitPrice);
  });

  it("the buy sheet opens on the same tier, not on array order", () => {
    expect(dialogs).toContain(
      'import { ordinaryOfflineRow, resolveUnitPrice } from "@/lib/productPricing";',
    );
    expect(dialogs).toContain("const offlineRow = ordinaryOfflineRow(initialTypes);");
    expect(dialogs).toContain(
      'setSelectedTypeId(String(offlineRow?.["id"] ?? initialTypes[0]?.id ?? ""));',
    );
    expect(dialogs).not.toContain('setSelectedTypeId(initialTypes[0]?.id ?? "");');
  });

  it("the other card reads the same rule instead of the raw base price", () => {
    expect(gameCard).toContain('import { listingPricing } from "@/lib/productPricing";');
    expect(gameCard).toContain("const { unitPrice: price } = listingPricing(product);");
    expect(gameCard).not.toContain("const price = Number(product.price) || 0;");
  });
});
