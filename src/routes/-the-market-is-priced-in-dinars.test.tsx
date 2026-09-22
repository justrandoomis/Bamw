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
/*
  The sheet is where a price is quoted now.

  The market page used to carry the listing form, so scanning the page was
  scanning every surface that printed a banana price. The form is gone —
  «احذف مفهوم Marketplace بين المستخدمين بالكامل» — and selling moved into a
  sheet of its own, so the sheet is scanned too. A rule about where dollars may
  not appear has to follow the screens that print money.
*/
const SELL_SHEET = read("src/components/market/SellBananasSheet.tsx");
const TICKETS = read("src/components/market/TicketShop.tsx");

describe("no screen prints a banana price in dollars", () => {
  it("has no buy screen left to print one on", () => {
    /*
      This asserted that `/banana_buy` printed its prices in dinars. There are
      no prices on it any more: the member-to-member market is gone and the
      route is a redirect into `/banana_market`, kept only because the address
      exists in members' bookmarks and chat history.

      So the assertion is stronger than it was — not «the numbers are in the
      right currency» but «there are no numbers» — and it is still a real
      guard: a future restoration of a listing screen at this address would
      fail here and have to answer for itself.
    */
    expect(BUY).toContain("redirect");
    expect(BUY).toContain("/banana_market");
    expect(BUY).not.toMatch(/\$\{[a-zA-Z]+\.(total|pricePer)/);
    expect(BUY).not.toContain("$0.00");
    expect(BUY).not.toContain("pricePer");
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
    expect(MARKET).not.toMatch(/pricePer\.toFixed\(2\)/);
    expect(SELL_SHEET).not.toMatch(/\.toFixed\(2\)/);
  });

  it("has no `$` in front of a number on the sell sheet", () => {
    expect(SELL_SHEET).not.toMatch(/\$\{[a-zA-Z]+\.(total|pricePer|proceeds)/);
    expect(SELL_SHEET).not.toContain("$0.00");
    expect(TICKETS).not.toContain("$0.00");
  });

  it("uses the shop's own price formatter rather than a local one", () => {
    /*
      `dinars` and `formatPrice` both come from `@/lib/banana-price` and both
      know that a banana costs a fraction of a fils. Which of the two a screen
      uses is a layout decision — one carries the «د.ع» suffix, the other does
      not — and pinning one by name is what made this test fail on a page that
      was doing the right thing with the other. What matters is that the number
      goes through that module at all.
    */
    expect(MARKET).toContain('from "@/lib/banana-price"');
    expect(MARKET).toMatch(/dinars\(|formatPrice\(/);
  });

  it("no longer offers to sell to another member at all", () => {
    /*
      This asserted that the listing form's price label was in dinars. The form
      is gone — the market is the shop now — so the stronger statement is
      available: there is no price-per-banana field to label, in any currency.
      «أوقف endpoints/actions التي تسمح بإنشاء Listings جديدة.»
    */
    expect(MARKET).not.toContain("السعر لكل موزة");
    expect(MARKET).not.toContain("create_listing");
    expect(MARKET).not.toContain("update_listing");
    expect(MARKET).not.toContain("عروضي");
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
