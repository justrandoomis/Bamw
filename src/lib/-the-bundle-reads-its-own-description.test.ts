/**
 * The game list was always in the description; now it is read.
 *
 * An admin writing a bundle types the titles out — «1. Mario Kart 8 Deluxe»,
 * «2. Xenoblade Chronicles 2» — and then searched the catalogue for each of
 * them by hand and ticked it, one at a time, for a bundle of a dozen games.
 *
 * The interesting cases are not the ones it finds. They are the ones it
 * refuses to guess at, because an almost-match quietly added to a bundle is a
 * game somebody paid for and will not receive.
 */

import { describe, expect, it } from "vitest";

import {
  extractBundleGames,
  matchBundleGames,
  parseBundleGameLines,
} from "./bundleGameExtraction";

/* Real titles; prices and ids are fixture values. */
const CATALOGUE = [
  { id: "p1", titleEn: "Mario Kart 8 Deluxe", titleAr: "ماريو كارت ٨ ديلوكس", price: 12000 },
  {
    id: "p2",
    titleEn: "Ultra Street Fighter II: The Final Challengers",
    titleAr: "ألترا ستريت فايتر ٢",
    price: 9000,
  },
  { id: "p3", titleEn: "Xenoblade Chronicles 2", titleAr: "زينوبليد كرونيكلز ٢", price: 15000 },
  { id: "p4", titleEn: "Fire Emblem Warriors", titleAr: "فاير إمبلم واريورز", price: 8000 },
  { id: "p5", titleEn: "Mario Kart World", titleAr: "ماريو كارت وورلد", price: 20000 },
];

const ids = (matches: ReturnType<typeof matchBundleGames>) =>
  matches.map((m) => (m.product ? String(m.product["id"]) : null));

describe("reading the list", () => {
  it("strips the numbering the admin typed", () => {
    expect(
      parseBundleGameLines("1. Mario Kart 8 Deluxe\n2. Xenoblade Chronicles 2"),
    ).toEqual(["Mario Kart 8 Deluxe", "Xenoblade Chronicles 2"]);
  });

  it("reads Arabic-Indic numbering and bullets too", () => {
    expect(parseBundleGameLines("١. ماريو كارت\n- زيلدا\n• سماش")).toEqual([
      "ماريو كارت",
      "زيلدا",
      "سماش",
    ]);
  });

  it("drops the heading above the list", () => {
    expect(parseBundleGameLines("الألعاب المتضمنة:\n1. Mario Kart 8 Deluxe")).toEqual([
      "Mario Kart 8 Deluxe",
    ]);
  });

  it("drops blank lines and repeats", () => {
    expect(parseBundleGameLines("1. Mario Kart 8 Deluxe\n\n2. Mario Kart 8 Deluxe")).toEqual([
      "Mario Kart 8 Deluxe",
    ]);
  });

  it("leaves a sentence about delivery out of the game list", () => {
    const lines = parseBundleGameLines(
      "1. Mario Kart 8 Deluxe\nتسليم فوري وتلقائي في محادثة الطلب خلال دقائق من إتمام الدفع بحساب رسمي مضمون مدى الحياة",
    );
    expect(lines).toEqual(["Mario Kart 8 Deluxe"]);
  });

  it("is empty for an empty description", () => {
    expect(parseBundleGameLines("")).toEqual([]);
    expect(parseBundleGameLines("   \n  ")).toEqual([]);
  });
});

describe("matching the catalogue", () => {
  it("finds every game in a real description, in order", () => {
    const matches = extractBundleGames(
      [
        "1. Mario Kart 8 Deluxe",
        "2. Ultra Street Fighter II: The Final Challengers",
        "3. Xenoblade Chronicles 2",
        "4. Fire Emblem Warriors",
      ].join("\n"),
      CATALOGUE,
    );
    expect(ids(matches)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(matches.every((m) => m.status === "matched")).toBe(true);
  });

  it("matches a title written in Arabic", () => {
    const matches = extractBundleGames("1. ماريو كارت ٨ ديلوكس", CATALOGUE);
    expect(ids(matches)).toEqual(["p1"]);
    expect(matches[0]!.score).toBe(1);
  });

  it("does not collapse two games of one series onto the same record", () => {
    const matches = extractBundleGames("1. Mario Kart 8 Deluxe\n2. Mario Kart World", CATALOGUE);
    expect(ids(matches)).toEqual(["p1", "p5"]);
  });

  it("marks a game the shop does not carry as missing, not as a near-miss", () => {
    const matches = extractBundleGames(
      "1. Mario Kart 8 Deluxe\n2. Hollow Knight: Silksong",
      CATALOGUE,
    );
    expect(matches[0]!.status).toBe("matched");
    expect(matches[1]!.status).toBe("missing");
    expect(matches[1]!.product).toBeUndefined();
    expect(matches[1]!.line).toBe("Hollow Knight: Silksong");
  });

  it("refuses to guess when the catalogue is empty", () => {
    const matches = extractBundleGames("1. Mario Kart 8 Deluxe", []);
    expect(matches[0]!.status).toBe("missing");
  });

  it("keeps a line it could not place, so nothing is silently skipped", () => {
    const matches = extractBundleGames("1. Some Game That Does Not Exist Anywhere", CATALOGUE);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.line).toBe("Some Game That Does Not Exist Anywhere");
  });

  it("holds the line against a loose match", () => {
    // "Warriors" alone is not Fire Emblem Warriors, and must not be sold as it.
    const matches = matchBundleGames(["Warriors"], CATALOGUE, { threshold: 0.82 });
    expect(matches[0]!.status).toBe("missing");
  });
});

describe("a game the shop does not carry yet", () => {
  /*
    The lifecycle the owner asked for: a title in the description that the shop
    lacks is created hidden with only its name, listed in the bundle by that
    name, and becomes a real clickable game the moment the admin publishes it —
    with no second edit to the bundle.
  */
  const pendingRow = { id: "prd_new", name: "Hollow Knight: Silksong" };

  /** What the bundle page shows as "not on the shelf yet". */
  const notYetListed = (
    pendingGames: { id: string; name: string }[],
    resolvedGameIds: string[],
  ) => {
    const resolved = new Set(resolvedGameIds.map(String));
    return pendingGames.filter((p) => !resolved.has(String(p.id)));
  };

  it("is listed by name while its record is still hidden", () => {
    expect(notYetListed([pendingRow], ["p1", "p3"])).toEqual([pendingRow]);
  });

  it("stops being listed by name the moment it is published", () => {
    // Publishing makes it resolve through the public catalogue like any game.
    expect(notYetListed([pendingRow], ["p1", "prd_new"])).toEqual([]);
  });

  it("counts toward the bundle's game count either way", () => {
    const resolved = ["p1"];
    const pending = notYetListed([pendingRow], resolved);
    expect(resolved.length + pending.length).toBe(2);
  });
});
