/**
 * «اجعلها في النهاية، لا تجعلها تظهر في واجهه الموقع».
 *
 * Fifteen hundred games arrived from the supplier's sheet in one import, most
 * with no artwork, and the home page's newest-first strip put all of them in
 * front of the whole shop at once.
 */
import { describe, expect, it } from "vitest";

import { hasListingPicture, onlyPictured, picturedFirst } from "./listingOrder";

const withCover = (id: string) => ({
  id,
  price: 10000,
  coverImage: "https://cdn.example/covers/" + id + ".jpg",
});
const bare = (id: string) => ({ id, price: 10000 });

describe("a listing with no picture", () => {
  it("is recognised whichever image field the record uses", () => {
    expect(hasListingPicture({ coverImage: "https://cdn/x.jpg" })).toBe(true);
    expect(hasListingPicture({ image: "https://cdn/x.jpg" })).toBe(true);
    expect(hasListingPicture(bare("a"))).toBe(false);
    expect(hasListingPicture({ coverImage: "   " })).toBe(false);
    expect(hasListingPicture(null)).toBe(false);
    expect(hasListingPicture(undefined)).toBe(false);
  });

  it("goes to the end of a shelf, not off it", () => {
    const shelf = [bare("a"), withCover("b"), bare("c"), withCover("d")];
    expect(picturedFirst(shelf).map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps whatever order the caller had, inside each group", () => {
    /*
      The caller has already sorted — newest first, cheapest first, the admin's
      own arrangement. A partition preserves it; a sort on a boolean would not.
    */
    const shelf = [withCover("1"), withCover("2"), bare("x"), withCover("3"), bare("y")];
    expect(picturedFirst(shelf).map((p) => p.id)).toEqual(["1", "2", "3", "x", "y"]);
  });

  it("leaves a shelf that is all pictured exactly as it was", () => {
    const shelf = [withCover("1"), withCover("2"), withCover("3")];
    expect(picturedFirst(shelf).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("is kept off the front page entirely", () => {
    const shelf = [bare("a"), withCover("b"), bare("c")];
    expect(onlyPictured(shelf).map((p) => p.id)).toEqual(["b"]);
  });

  it("is never dropped from a shelf a member went looking at", () => {
    /*
      The whole point of last rather than gone: these are real products at real
      prices, and a category page that hides them is a category page missing a
      thousand games.
    */
    const shelf = [bare("a"), withCover("b"), bare("c")];
    expect(picturedFirst(shelf)).toHaveLength(shelf.length);
  });
});
