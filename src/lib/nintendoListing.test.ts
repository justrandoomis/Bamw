import { describe, expect, it } from "vitest";

import {
  hasNintendoSquareCard,
  isNintendoSwitch2Product,
  matchesNintendoPlatformFilter,
  sortNintendoGamesForHome,
} from "@/lib/nintendoListing";

const image = (name: string) => `https://cdn.example/${name}.webp`;

describe("Nintendo home listing order", () => {
  it("puts real square artwork first and sorts both groups by real sales", () => {
    const products = [
      { id: "missing-popular", sales: 500 },
      { id: "image-low", sales: 2, nintendoCardImage: image("low") },
      { id: "missing-low", sales: 1 },
      { id: "image-popular", sales: 80, square_card_image: image("popular") },
    ];

    expect(sortNintendoGamesForHome(products).map((product) => product.id)).toEqual([
      "image-popular",
      "image-low",
      "missing-popular",
      "missing-low",
    ]);
  });

  it("keeps ties stable, does not mutate input, and never duplicates a game", () => {
    const products = [
      { id: "first", sales: 7, nintendoCardImage: image("first") },
      { id: "second", sales: 7, nintendoCardImage: image("second") },
      { id: "third", sales: 7 },
      { id: "second", sales: 999, nintendoCardImage: image("duplicate") },
    ];
    const original = [...products];
    const sorted = sortNintendoGamesForHome(products);

    expect(products).toEqual(original);
    expect(sorted.map((product) => product.id)).toEqual(["first", "second", "third"]);
    expect(new Set(sorted.map((product) => product.id)).size).toBe(sorted.length);
  });

  it("treats malformed image values as missing while accepting legacy square fields", () => {
    expect(hasNintendoSquareCard({ nintendoCardImage: "[object Object]" })).toBe(false);
    expect(
      hasNintendoSquareCard({ nintendoCardImage: "/illustrations/cover-placeholder.svg" }),
    ).toBe(false);
    expect(
      hasNintendoSquareCard({
        nintendoCardImage: "/illustrations/cover-placeholder.svg",
        squareImage: image("valid-fallback"),
      }),
    ).toBe(true);
    expect(hasNintendoSquareCard({ nintendo_card_image: image("legacy") })).toBe(true);
    expect(hasNintendoSquareCard({ squareGameImage: image("legacy-2") })).toBe(true);
  });
});

describe("Nintendo Switch 2 labelling", () => {
  it.each([
    { platform: "switch2" },
    { platform: "Nintendo Switch 2" },
    { platform: "switch-2" },
    { platform: "nintendo-switch-2" },
    { platform: "ns2" },
    { platform: "both" },
    { platform: "switch1", tags: ["Nintendo Switch 2 Edition"] },
    { platform: "switch1", switch2: { isSwitch2Edition: true } },
    { platform: "switch1", switch2Enhanced: true },
  ])("labels Switch 2 records", (product) => {
    expect(isNintendoSwitch2Product(product)).toBe(true);
  });

  it("does not label an ordinary Switch 1 game", () => {
    expect(isNintendoSwitch2Product({ platform: "switch1", tags: ["adventure"] })).toBe(false);
  });

  it("does not label a Switch 1 game merely because a tag mentions compatibility", () => {
    expect(
      isNintendoSwitch2Product({
        platform: "switch1",
        tags: ["Compatible with Nintendo Switch 2"],
      }),
    ).toBe(false);
  });

  it.each([
    [{ platform: "switch1" }, true, false],
    [{ platform: "switch2" }, false, true],
    [{ platform: "switch-2" }, false, true],
    [{ platform: "both" }, true, true],
    [{ platform: "switch1", switch2Enhanced: true }, true, true],
    [{ platform: "switch1", switch2: { isSwitch2Edition: true } }, false, true],
    [{ platform: "switch1", tags: ["Nintendo Switch 2 Edition"] }, false, true],
    [{ switch2: { isSwitch2Edition: true } }, false, true],
  ] as const)(
    "keeps the device filters aligned with the card badge",
    (product, switch1, switch2) => {
      expect(matchesNintendoPlatformFilter(product, "switch1")).toBe(switch1);
      expect(matchesNintendoPlatformFilter(product, "switch2")).toBe(switch2);
    },
  );
});
