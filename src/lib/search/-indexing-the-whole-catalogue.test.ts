import { describe, expect, it } from "vitest";

import { buildProductIndex, searchProducts } from "./products";

/**
 * What the search costs once the supplier catalogue is in the shop.
 *
 * The index used to be built over about a hundred and fifty products, and its
 * own comment said folding and stemming them cost roughly twice what answering
 * a query does. The catalogue is now an order of magnitude larger and every
 * token is transliterated as well, so "roughly twice" is not a safe assumption
 * any more — and this index is built in a customer's browser, on a phone, on
 * every page.
 *
 * These are not tight budgets. They are the ceiling above which the search box
 * would be visibly janky, measured so that a change which crosses it fails
 * here rather than on someone's phone.
 */

const NAMES = [
  "The Legend of Zelda",
  "Super Mario Odyssey",
  "Metroid Dread",
  "Splatoon",
  "Fire Emblem",
  "Xenoblade Chronicles",
  "Kirby and the Forgotten Land",
  "Pokemon Scarlet",
  "Animal Crossing New Horizons",
  "Bayonetta",
];

/** A catalogue the size of the real one, with names that do not all collide. */
function catalogue(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    titleEn: `${NAMES[i % NAMES.length]} ${i}`,
    price: 9000 + (i % 40) * 250,
    isActive: true,
  }));
}

describe("indexing seventeen hundred products", () => {
  it("builds the index in well under a second", () => {
    const products = catalogue(1710);
    const started = performance.now();
    const index = buildProductIndex(products);
    const elapsed = performance.now() - started;
    expect(index.length).toBe(1710);
    // A phone is several times slower than CI, so the headroom here is the
    // point. Crossing 400ms means the first keystroke stutters.
    expect(elapsed).toBeLessThan(400);
  });

  it("answers a query over them in a few milliseconds", () => {
    const index = buildProductIndex(catalogue(1710));
    // A one-letter query is the worst case: it reaches the widest rung and
    // cannot exit early on an exact hit.
    for (const query of ["z", "ma", "zelda", "زيلدا", "سوبر ماريو"]) {
      const started = performance.now();
      searchProducts(index, query, { limit: 6 });
      expect(performance.now() - started).toBeLessThan(150);
    }
  });

  it("still answers the worst case — one letter — with a ranked list", () => {
    const index = buildProductIndex(catalogue(1710));
    const hits = searchProducts(index, "z", { limit: 6 });
    expect(hits.length).toBe(6);
    // Every hit is a Zelda, not six arbitrary products that contain a z.
    for (const hit of hits) {
      expect(String(hit.product["titleEn"]).toLowerCase()).toContain("zelda");
    }
  });
});
