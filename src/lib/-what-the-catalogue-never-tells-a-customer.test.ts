import { describe, expect, it } from "vitest";

import { buildListing, parseCatalogueCsv } from "./catalogueImport";
import { toPublicProduct } from "./public-product.server";
import { toIndexRow } from "./product-index.server";
import { buildProductIndex, searchProducts } from "./search/products";

/**
 * The two columns of the supplier sheet that are nobody's business but the
 * shop's, checked on every path a product takes to a customer.
 *
 * Fifteen hundred products carrying a cost and a supplier's Chinese name were
 * added to a catalogue in one action. The rules about those two are absolute —
 * «لا تظهر التكلفة للعميل», and the Chinese name must not appear in the public
 * API, the product page, public HTML, any cache or the search — and an import
 * is exactly the kind of change that satisfies every rule in the code it
 * touches while breaking one in code it does not.
 *
 * So this walks the record out through each exit rather than trusting the one
 * that was edited: the public serialiser, the admin listing projection, and the
 * search index the browser holds.
 */

const SHEET = [
  "English Name,Cost IQD,Chinese Name,Platform,Offline Price IQD,English Support",
  "Kirby and the Forgotten Land,1711.6,星之卡比 探索发现,Nintendo Switch,9000,نعم",
].join("\n");

const row = parseCatalogueCsv(SHEET).rows[0]!;
const outcome = buildListing(row, {
  categoryId: "nintendo-switch-games",
  categoryTitle: "ألعاب نينتندو سويتش",
});
if (outcome.action === "skip") throw new Error("a new row must not be skipped");
const product = outcome.product;

describe("the supplier's Chinese name", () => {
  it("is not on the product at all, so nothing downstream can leak it", () => {
    /*
      Stronger than "stripped on the way out". It is returned beside the
      product for the caller to write to `product_admin_metadata`, which
      `getStore()` never loads — so there is no path by which a public
      serialiser could reach it, whatever it is later asked to serialise.
    */
    expect(JSON.stringify(product)).not.toContain("星之卡比");
    expect(outcome.chineseName).toBe("星之卡比 探索发现");
  });

  it("is not reachable through the public product payload", () => {
    expect(JSON.stringify(toPublicProduct(product))).not.toContain("星之卡比");
  });

  it("is not in the search index the browser holds", () => {
    const index = buildProductIndex([product]);
    expect(JSON.stringify(index)).not.toContain("星之卡比");
    // And searching for it finds nothing, which is the same claim from outside.
    expect(searchProducts(index, "星之卡比", { limit: 5 })).toEqual([]);
  });
});

describe("the cost", () => {
  it("is on the record, because the shop needs it", () => {
    expect(product["cost"]).toBe(1711.6);
  });

  it("is gone from the public payload", () => {
    const serialised = JSON.stringify(toPublicProduct(product));
    expect(serialised).not.toContain("1711.6");
    expect(serialised).not.toContain('"cost"');
  });

  it("is gone from the search index, which is public by construction", () => {
    // Whatever the browser holds is readable by whoever holds it.
    expect(JSON.stringify(buildProductIndex([toPublicProduct(product)]))).not.toContain("1711.6");
  });

  it("survives into the admin listing projection, which is admin-only", () => {
    // The other half of the rule: the admin must still see what it cost.
    expect(toIndexRow(product).cost).toBe(1711.6);
  });
});

describe("what the customer does get", () => {
  it("the English name and the offline price, and that is the point", () => {
    const publicView = toPublicProduct(product) as Record<string, unknown>;
    expect(publicView["titleEn"]).toBe("Kirby and the Forgotten Land");
    expect(publicView["price"]).toBe(9000);
  });

  it("the English-support flag, because seventeen of these have no English", () => {
    expect((toPublicProduct(product) as Record<string, unknown>)["englishSupport"]).toBe(true);
  });
});
