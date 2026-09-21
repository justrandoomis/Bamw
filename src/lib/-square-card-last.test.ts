/**
 * @vitest-environment node
 */
/**
 * «في منصة الكارتلج الألعاب التي ليس لها صورة مربعة تكون في الأخير» — and the
 * catalogue says «لم يتم إضافة الصورة بعد» rather than showing a blank square.
 *
 * The trap this file exists to catch: the repo already had a "has a picture"
 * partition, and reusing it here would have looked like the feature working
 * while doing nothing at all for the games the owner is pointing at. A retail
 * box cover IS a picture, so such a game sorts first under the old predicate —
 * and then draws a placeholder anyway, because the cartridge label window is
 * square and the media layer refuses to squeeze a tall box into it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { picturedFirst, squareCardFirst } from "./listingOrder";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const square = (id: string) => ({ id, nintendoCardImage: `https://cdn/${id}-square.jpg` });
const boxOnly = (id: string) => ({ id, coverImage: `https://cdn/${id}-box.jpg` });
const nothing = (id: string) => ({ id });

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("the cartridge platform puts square art first", () => {
  it("keeps a box-cover-only game behind one with square art", () => {
    /*
      This is the whole point. Both of these have "a picture"; only one of
      them has a picture this surface can draw.
    */
    expect(ids(squareCardFirst([boxOnly("box"), square("sq")]))).toEqual(["sq", "box"]);
  });

  it("is the question `picturedFirst` does not ask", () => {
    const shelf = [boxOnly("box"), square("sq")];
    // The old predicate sees two pictured games and changes nothing...
    expect(ids(picturedFirst(shelf))).toEqual(["box", "sq"]);
    // ...which is exactly why a second, stricter partition was needed.
    expect(ids(squareCardFirst(shelf))).not.toEqual(ids(picturedFirst(shelf)));
  });

  it("composes to square, then other pictures, then nothing", () => {
    const shelf = [nothing("none"), boxOnly("box"), square("sq")];
    expect(ids(squareCardFirst(picturedFirst(shelf)))).toEqual(["sq", "box", "none"]);
  });

  it("is a stable partition, so the caller's own order survives inside a group", () => {
    const shelf = [square("a"), square("b"), boxOnly("x"), square("c"), boxOnly("y")];
    expect(ids(squareCardFirst(shelf))).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("returns the list untouched when every game has square art", () => {
    const shelf = [square("a"), square("b")];
    expect(ids(squareCardFirst(shelf))).toEqual(["a", "b"]);
  });

  it("treats the placeholder URL as missing, not as artwork", () => {
    const pretender = { id: "fake", nintendoCardImage: "/illustrations/cover-placeholder.svg" };
    expect(ids(squareCardFirst([pretender, square("real")]))).toEqual(["real", "fake"]);
  });

  it("survives a list with nothing in it, and rows that are not objects", () => {
    expect(squareCardFirst([])).toEqual([]);
    expect(squareCardFirst([null, square("a")] as unknown[])).toEqual([square("a"), null]);
  });
});

describe("both cartridge feeds got it, not just one", () => {
  it("the games page and the home strip both partition", () => {
    /*
      The cartridge platform has two independent feeds that each build their
      own card list. Fixing one leaves half the shop unsorted.
    */
    expect(read("src/routes/games.tsx")).toContain("squareCardFirst(products.filter");
    expect(read("src/components/HomeView.tsx")).toContain("squareCardFirst(adminProducts.filter");
  });

  it("the home page still shows nothing artwork-less at all", () => {
    // A sort is not a substitute for the front page's stricter rule.
    expect(read("src/components/HomeView.tsx")).toContain("onlyPictured(filterPurchasable");
  });
});

describe("a missing picture says so", () => {
  const cover = read("src/components/NintendoCover.tsx");

  it("writes the words instead of leaving a blank square", () => {
    expect(cover).toContain("لم يتم إضافة الصورة بعد");
  });

  it("keys off the same flag that drew the placeholder", () => {
    /*
      Not a fresh predicate over the product: an image URL that exists but
      404s also lands on the placeholder, and it deserves the same sentence
      rather than an unexplained grey box.
    */
    expect(cover).toContain("{showPlaceholder && (");
  });

  it("hides the caption in a frame too small to read it", () => {
    // The same component draws a 40px avatar and a full-width hero.
    expect(cover).toContain("@container");
    expect(cover).toContain("@[6rem]:block");
  });
});
