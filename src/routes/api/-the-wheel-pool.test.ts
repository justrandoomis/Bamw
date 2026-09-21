/**
 * What may and may not be won.
 *
 * The wheel's candidate pool is the one place in the shop where getting a
 * classification wrong costs money rather than tidiness: everything in it is
 * given away for a ticket. Two of its gates were found by an adversarial
 * review of the feature and both were reproduced before being believed.
 *
 * These read the route's source rather than calling it, because `candidates()`
 * is a closure inside a TanStack route module that needs a D1 binding and a
 * store document to run at all. What must not drift is which gates are there,
 * and that is a question the source answers exactly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getProductCategory, isGameProduct } from "@/lib/productSection";

const SOURCE = readFileSync(resolve(process.cwd(), "src/routes/api/wheel.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

describe("the classifier really does default to game", () => {
  it("calls a console filed under an admin category a game", () => {
    /*
      This is the defect, stated as a fact about the shop's own code rather
      than as an argument. The admin's الأقسام tab makes category ids out of
      `Date.now()`, so they match no alias — and `getProductCategory` decides
      from the category id alone once one is present.

      It is not a bug to fix there. The imported catalogue files its games
      under Arabic category titles that match no alias either, and they are
      games; changing the default would move every shelf in the shop.
    */
    const console = {
      id: "prd_console",
      category: "1758294003123",
      categoryId: "1758294003123",
      kind: "hardware",
      price: 749_000,
    };
    expect(getProductCategory(console)).toBe("game");
    expect(isGameProduct(console)).toBe(true);
  });
});

describe("so the wheel asks a second question", () => {
  it("refuses the kinds that are not a game whatever their category says", () => {
    expect(SOURCE).toContain("NOT_A_GAME");
    expect(SOURCE).toMatch(/NOT_A_GAME\.has\(String\(product\["kind"\]/);
    for (const kind of [
      "hardware",
      "device",
      "accessory",
      "amiibo",
      "collectible",
      "bundle",
      "gift_card",
      "digital_code",
      "used",
    ]) {
      expect(SOURCE).toContain(`"${kind}"`);
    }
  });

  it("keeps the classifier as well, rather than replacing it", () => {
    // They answer different questions; a prize has to pass both.
    expect(SOURCE).toMatch(/if \(!isGameProduct\(product\)\) continue;/);
  });

  it("will not hand out a game that has not come out yet", () => {
    /*
      `filterPurchasable` deliberately lets a pre-order through — it is a real
      listing a member may register interest in — and checkout is where the
      release gate lives. So the wheel could spend a ticket, mint a coupon and
      record a spin on a game the till then refuses, with a prize that expires
      in fourteen days and no path anywhere that returns the ticket.
    */
    expect(SOURCE).toMatch(/if \(isAwaitingRelease\(product\)\) continue;/);
  });

  it("still requires a price, so nothing unvalued is given away", () => {
    expect(SOURCE).toMatch(/if \(!Number\.isFinite\(price\) \|\| price <= 0\) continue;/);
  });
});
