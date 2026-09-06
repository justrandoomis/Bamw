/**
 * The searches a customer types a product name into, wherever they are.
 *
 * The storefront's was fixed first, and it was never the only one. The chat's
 * «البحث بالموقع» tab filtered with
 *
 *     String(titleEn || english_name || title).includes(searchQuery)
 *
 * — no `toLowerCase` anywhere, so «zelda» found nothing while «Zelda» found
 * the game, and no `titleAr`, so an Arabic query found nothing at all. This
 * pins the behaviour the shared engine gives all of them.
 */

import { describe, expect, it } from "vitest";

import { searchCatalogue } from "./products";

/* Titles are real games; prices are fixture values. */
const CATALOGUE = [
  {
    id: "p1",
    title: "The Legend of Zelda: Tears of the Kingdom",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    price: 65000,
  },
  {
    id: "p2",
    title: "Mario Kart 8 Deluxe",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت ٨ ديلوكس",
    price: 55000,
  },
];

/** Exactly what the chat used to do. */
const theOldWay = (query: string) =>
  CATALOGUE.filter((p) =>
    String((p.titleEn || p.title) ?? "").includes(query),
  ).map((p) => p.id);

const find = (query: string) =>
  searchCatalogue(CATALOGUE, query).map((row) => String(row.product["id"]));

describe("what the chat's product search used to do", () => {
  it("found the game only if the customer capitalised it correctly", () => {
    expect(theOldWay("Zelda")).toEqual(["p1"]);
    expect(theOldWay("zelda")).toEqual([]);
  });

  it("found nothing for an Arabic name", () => {
    expect(theOldWay("زيلدا")).toEqual([]);
    expect(theOldWay("ماريو كارت")).toEqual([]);
  });
});

describe("what every product search does now", () => {
  it("does not care how the customer capitalised it", () => {
    expect(find("Zelda")).toEqual(["p1"]);
    expect(find("zelda")).toEqual(["p1"]);
    expect(find("ZELDA")).toEqual(["p1"]);
  });

  it("answers the Arabic name", () => {
    expect(find("زيلدا")).toEqual(["p1"]);
    expect(find("ماريو كارت")).toEqual(["p2"]);
  });

  it("forgives a typo", () => {
    expect(find("zolda")).toEqual(["p1"]);
  });

  it("still refuses a word the shop does not have", () => {
    expect(find("غسالة")).toEqual([]);
  });
});
