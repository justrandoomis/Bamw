/**
 * The loop the wheel would otherwise close.
 *
 * Bananas are earned on `itemsTotal` — the price before any discount — and
 * that is the shop's rule for every coupon it has ever issued. The wheel
 * breaks it, because a prize pays the whole price: the order costs nothing
 * and the pre-discount total is still the full price of the game. At the
 * default 6.8 bananas per dinar a 5,000-dinar win pays 34,000 bananas, which
 * buys more tickets than the win cost, which wins more games.
 *
 * This asserts the rule in the source, because the arithmetic that produces
 * it sits in the middle of `createOrder` — several hundred lines of wallet,
 * referral and delivery state that no unit test can assemble honestly. What
 * must not drift is which total the rate is applied to, and that is exactly
 * what is read here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(resolve(process.cwd(), "src/lib/orders.server.ts"), "utf8")
  /*
    Comments first. The paragraph above the code explains the rule in prose
    and contains every string this file looks for.
  */
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

describe("a won game does not pay for the next ticket", () => {
  it("earns bananas on what a prize order actually cost", () => {
    expect(SOURCE).toMatch(/const bananaBase = isWheelPrize \? finalItemsTotal : itemsTotal/);
    expect(SOURCE).toMatch(/Math\.floor\(bananaBase \* rewardRate\)/);
  });

  it("recognises a prize by the code the wheel mints", () => {
    expect(SOURCE).toMatch(/startsWith\("WIN-"\)/);
  });

  it("leaves every other coupon earning on the full price", () => {
    /*
      Deliberately narrow. Changing the base for all coupons would be a
      commercial decision about what customers earn, and this is not it: it
      closes a loop the wheel opened and touches nothing else.
    */
    expect(SOURCE).toContain("isWheelPrize ? finalItemsTotal : itemsTotal");
    expect(SOURCE).not.toMatch(/const bananaReward = Math\.floor\(itemsTotal \* rewardRate\)/);
  });

  it("mints the prize code with that prefix, so the two cannot drift apart", () => {
    const prize = readFileSync(
      resolve(process.cwd(), "src/lib/wheel-prize.server.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(prize).toContain("`WIN-${code}`");
  });
});
