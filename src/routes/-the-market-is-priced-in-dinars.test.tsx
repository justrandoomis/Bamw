/**
 * «في السوق يظهر العملة بالدولار بالرغم من أن العملة الافتراضية والعملة التي
 *  وضعها الزبون في الإعدادات هي العملة العراقية.»
 *
 * The market has never been in dollars. The columns are `price_iqd` and
 * `min_price_iqd`, the wallet is in dinars, the shop's default currency is
 * IQD — and six places printed a `$` in front of the number anyway. Two of
 * them also ran `.toFixed(2)`, which is how a real price of 0.0004 د.ع
 * reached the owner's screen as «$0.00 / موزة»: wrong currency and no price.
 *
 * The screens are read as source. Rendering them needs a router, a query
 * client and a live market; what must not drift is that no customer-facing
 * banana amount is printed with a dollar sign or through a formatter that
 * rounds a sub-fils price away.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dinars } from "@/lib/banana-price";

const read = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const BUY = read("src/routes/banana_buy.tsx");
const MARKET = read("src/routes/banana_market.tsx");

describe("no screen prints a banana price in dollars", () => {
  it("has no `$` in front of a number on the buy screen", () => {
    // `${` inside a template literal is legitimate; a `$` before a value is not.
    expect(BUY).not.toMatch(/\$\{[a-zA-Z]+\.(total|pricePer)/);
    expect(BUY).not.toContain("$0.00");
  });

  it("has no `$` in front of a number on the market screen", () => {
    expect(MARKET).not.toMatch(/\$\{[a-zA-Z]+\.(total|pricePer)/);
  });

  it("never rounds a banana price to two decimals", () => {
    /*
      `toFixed(2)` on 0.0004 is "0.00". It is the second half of the reported
      fault and the more damaging one: a wrong currency is a label, a rounded
      price is a lie about the number.
    */
    expect(BUY).not.toMatch(/pricePer\.toFixed\(2\)/);
    expect(MARKET).not.toMatch(/pricePer\.toFixed\(2\)/);
  });

  it("uses the shared dinar formatter on both screens", () => {
    expect(BUY).toContain('from "@/lib/banana-price"');
    expect(BUY).toMatch(/dinars\(/);
    expect(MARKET).toMatch(/dinars\(/);
  });

  it("no longer offers to label the sell price in dollars", () => {
    expect(MARKET).not.toContain("السعر لكل موزة (دولار)");
    expect(MARKET).toContain('tr("السعر لكل موزة")');
  });

  it("does not suggest a price from when a banana was worth a quarter dinar", () => {
    // The base is 0.0004 today; "0.25" in the box invites listing at 600x market.
    expect(MARKET).not.toContain('placeholder="0.25"');
  });
});

describe("what the formatter actually prints", () => {
  it("shows production's real price rather than rounding it away", () => {
    expect(dinars(0.000387)).toBe("0.000387 د.ع");
    expect(dinars(0.0004)).toBe("0.0004 د.ع");
  });

  it("shows a bot's total the way the owner's screenshot should have", () => {
    // 19,500 bananas at 0.0004 is 7.8 — the screen said «$7.8».
    expect(dinars(19_500 * 0.0004)).toBe("7.80 د.ع");
    expect(dinars(12_000 * 0.0004)).toBe("4.80 د.ع");
  });

  it("never prints a dollar sign", () => {
    for (const value of [0, 0.0004, 1, 7.8, 375_215]) {
      expect(dinars(value)).not.toContain("$");
      expect(dinars(value)).toContain("د.ع");
    }
  });
});
