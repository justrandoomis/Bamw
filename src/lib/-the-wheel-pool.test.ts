/**
 * What may and may not be won.
 *
 * The wheel's candidate pool is the one place in the shop where getting a
 * classification wrong costs money rather than tidiness: everything in it is
 * given away for a ticket. Two of its gates were found by an adversarial
 * review of the feature and both were reproduced before being believed.
 *
 * These used to read the route's source and assert the gates were still
 * written there, because `candidates()` was a closure inside a TanStack route
 * module that needed a D1 binding and a store document to run at all. A source
 * assertion passes for a gate that is present and broken, and fails for one
 * that is correct and reformatted — it tests the file, not the shop. The pool
 * now lives in `wheel-pool.server`, so these hand it products and read what
 * comes back.
 */
import { describe, expect, it } from "vitest";

import { getProductCategory, isGameProduct } from "@/lib/productSection";
import { NOT_A_GAME, wheelCandidatesFrom } from "@/lib/wheel-pool.server";

/** A plain, winnable game — the baseline every case below varies from. */
function game(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prd_game",
    title: "لعبة",
    price: 5_000,
    kind: "game",
    status: "active",
    ...over,
  };
}

const ids = (products: Record<string, unknown>[]) =>
  wheelCandidatesFrom(products).map((candidate) => candidate.id);

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
  it("keeps a plain game", () => {
    expect(ids([game()])).toEqual(["prd_game"]);
  });

  it("refuses the kinds that are not a game whatever their category says", () => {
    for (const kind of NOT_A_GAME) {
      const product = game({
        id: `prd_${kind}`,
        kind,
        category: "1758294003123",
        categoryId: "1758294003123",
        price: 749_000,
      });
      // The classifier says yes; the pool must still say no.
      expect(isGameProduct(product)).toBe(true);
      expect(ids([product])).toEqual([]);
    }
  });

  it("names every kind the console fault was found through", () => {
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
      expect(NOT_A_GAME.has(kind)).toBe(true);
    }
  });

  it("reads the kind whatever case and spacing it is stored in", () => {
    expect(ids([game({ kind: "  HARDWARE " })])).toEqual([]);
  });

  it("will not hand out a game that has not come out yet", () => {
    /*
      `filterPurchasable` deliberately lets a pre-order through — it is a real
      listing a member may register interest in — and checkout is where the
      release gate lives. So the wheel could spend a ticket, mint a coupon and
      record a spin on a game the till then refuses, with a prize that expires
      in fourteen days and no path anywhere that returns the ticket.
    */
    const unreleased = game({ id: "prd_soon", releaseDate: "2099-01-01", isPreOrder: true });
    expect(ids([unreleased])).toEqual([]);
  });

  it("will not hand out a game the shop has run out of", () => {
    /*
      The same shape as the pre-order: the storefront refuses a sold-out line
      at the cart, so the prize would be a code that cannot be spent.
    */
    expect(ids([game({ stock: 0 })])).toEqual([]);
  });

  it("does not read unknown stock as sold out", () => {
    /*
      Most of the imported catalogue carries no stock field at all. Treating
      absence as zero would empty the wheel — `Number(undefined)` is NaN, and
      the finite check is what keeps those games in.
    */
    expect(ids([game({ id: "prd_nostock" })])).toEqual(["prd_nostock"]);
    expect(ids([game({ id: "prd_infinite", stock: 0, isInfiniteStock: true })])).toEqual([
      "prd_infinite",
    ]);
    expect(ids([game({ id: "prd_negative", stock: -1 })])).toEqual(["prd_negative"]);
  });

  it("still requires a price, so nothing unvalued is given away", () => {
    expect(ids([game({ price: 0 })])).toEqual([]);
    expect(ids([game({ price: undefined })])).toEqual([]);
    expect(ids([game({ price: "غير محدد" })])).toEqual([]);
  });

  it("drops a product with no id rather than putting an empty face on the wheel", () => {
    expect(ids([game({ id: "" })])).toEqual([]);
  });

  it("keeps the 5,000-dinar games that arrived with no cover", () => {
    /*
      Nine hundred and ninety-four of them, and they are the bucket the owner
      asked to come up most often. Requiring artwork would have quietly removed
      the common prize from a wheel designed around it.
    */
    const bare = game({ id: "prd_bare", images: [], image: "" });
    expect(ids([bare])).toEqual(["prd_bare"]);
  });

  it("does not hand back a hidden product", () => {
    expect(ids([game({ id: "prd_hidden", isHidden: true })])).toEqual([]);
  });
});

describe("the redemption reads a field, not the row", () => {
  it("cannot mistake a missing database for a real reward", async () => {
    /*
      `d1First` answers with a truthy empty object when there is no D1
      binding, so `if (!reward)` was true of "the reward exists" and of "there
      is no database" alike — and the second then read `banana_price` as
      undefined and handed NaN to the debit. It is the documented trap in this
      codebase and it had caught this line.
    */
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const banana = readFileSync(resolve(process.cwd(), "src/lib/banana.server.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    expect(banana).toMatch(/if \(!reward\?\.id\) throw new BananaError\("reward_not_found"\)/);
  });
});
