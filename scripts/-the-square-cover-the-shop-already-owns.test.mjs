/**
 * «أي مصدر آخر يجلب الصورة للعبة الصحيحة» — and the first one is this shop.
 *
 * The owner asked for more sources for the square covers. Before reaching for
 * Wikipedia or a search engine, the supplier sheet was counted, and it already
 * holds the answer for most of them. `import-sources/catalogue.csv`, 1,530
 * rows, `Cover URL` present on 607 of them, sorted by Nintendo's OWN directory
 * names:
 *
 *   11_square_images            396   square key art
 *   05_packshots                172   the portrait box, not a card
 *   migration                    23   unclassified
 *   03_teaser_module_1_square    15   square
 *
 * Four hundred and eleven square covers, on Nintendo's own host, for the exact
 * row the importer matched — stored on every product as `coverImage` since the
 * import, and never once looked at by the filler, which was busy asking
 * Nintendo's US store and then Europe and often getting nothing.
 *
 * This is the strongest identity available anywhere. A url key can resolve to
 * a sequel; a title search can rank the wrong game first; this is the record's
 * own field for the record's own product. It is also free: no request is made
 * to decide it, and when it works no request is made at all.
 */
import { describe, expect, it } from "vitest";

import { sheetSquareCover } from "./lib/nintendo-sheet-cover.mjs";

/* Real URLs, copied from the committed sheet, with the shelf title beside each. */
const SQUARE = [
  [
    "Pokémon Scarlet / Violet",
    "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/1x1_NSwitch_PokemonScarletViolet_Scarlet_enGB_image500w.jpg",
  ],
  [
    "Kirby and the Forgotten Land",
    "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/SQ_NSwitch_KirbyAndTheForgottenLand_image500w.jpg",
  ],
  [
    "Ninja Gaiden: Master Collection",
    "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_download_software/SQ_NSwitch_NinjaGaidenMasterCollection.jpg",
  ],
];
const PACKSHOTS = [
  "https://www.nintendo.com/eu/media/images/05_packshots/games_13/nintendo_switch_8/PS_NSwitch_FireEmblemThreeHouses.jpg",
  "https://www.nintendo.com/eu/media/images/05_packshots/games_13/nintendo_switch_8/PS_NSwitch_PokemonShield_PEGI.jpg",
  "https://www.nintendo.com/eu/media/images/05_packshots/games_13/virtual_console_wii_3/PS_WiiVC_KingOfFighters98.jpg",
];

describe("the square covers the sheet already holds", () => {
  it("accepts Nintendo's own square directories when the asset names the game", () => {
    for (const [title, url] of SQUARE) {
      const found = sheetSquareCover(url, title);
      expect(found, url).not.toBeNull();
      expect(found.url).toBe(url);
      expect(found.provenance).toContain("Nintendo");
    }
  });

  it("accepts the teaser square directory too", () => {
    expect(
      sheetSquareCover(
        "https://www.nintendo.com/eu/media/images/03_teaser_module_1_square/SQ_KirbyAndTheForgottenLand.jpg",
        "Kirby and the Forgotten Land",
      ),
    ).not.toBeNull();
  });
});

describe("THE GUARD: the asset must be named after THIS game", () => {
  /*
    Real rows from the committed sheet, every one of them a square Nintendo
    asset belonging to a DIFFERENT game. The importer matched them fuzzily and
    nothing downstream questioned it. Without this guard the shop would have
    put a marathon game's key art on a train simulator.
  */
  const WRONG = [
    [
      "Railway Nippon! Real Pro",
      "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_download_software/SQ_NSwitchDS_NipponMarathon_image500w.jpg",
    ],
    [
      "Attack on Titan 2",
      "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_3ds_download_software/TM_3DSDS_TitanAttacks_image500w.jpg",
    ],
    [
      "PriPara: All Idol Perfect Stage!",
      "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/SQ_NSwitch_PerfectDark_image500w.jpg",
    ],
    [
      "JUMP FORCE – Deluxe Edition",
      "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_download_software/SQ_NSwitchDS_DistraintDeluxeEdition_image500w.jpg",
    ],
    [
      "LoveR Kiss",
      "https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/SQ_NSwitch_OfficeLovers_image500w.jpg",
    ],
  ];

  it("refuses every wrong match the sheet actually contains", () => {
    for (const [title, url] of WRONG) {
      expect(sheetSquareCover(url, title), title).toBeNull();
    }
  });

  it("refuses a short title rather than letting it match half the catalogue", () => {
    /*
      «Toki» is a substring of «Harukanaru Toki no Naka de 7» and they are not
      the same game — that exact pair is one of the sheet's wrong matches. A
      title under six characters cannot carry this check, so it is refused.
    */
    expect(
      sheetSquareCover(
        "https://www.nintendo.com/eu/media/images/11_square_images/x/SQ_NSwitch_Toki_image500w.jpg",
        "Toki",
      ),
    ).toBeNull();
  });

  it("refuses when no title is given at all", () => {
    expect(sheetSquareCover(SQUARE[1][1], "")).toBeNull();
    expect(sheetSquareCover(SQUARE[1][1], null)).toBeNull();
  });
});

describe("what it refuses, and why each refusal matters", () => {
  it("refuses a packshot — real art for the real game, but portrait", () => {
    /*
      Not a card. `validateCandidate` would measure it and refuse it anyway, so
      refusing here only saves a download — but role is decided by provenance
      in this pipeline, not by a lucky aspect ratio, and that is the point.
    */
    for (const url of PACKSHOTS) expect(sheetSquareCover(url, "Fire Emblem: Three Houses"), url).toBeNull();
  });

  it("refuses this shop's own R2 reference", () => {
    /*
      After a media run `coverImage` may hold the HERO this very pipeline
      stored. Feeding that back would copy one of our own images into a second
      role and call it Nintendo's square key art.
    */
    expect(sheetSquareCover("/api/img/prd_a/coverImage-1.webp", "Kirby and the Forgotten Land")).toBeNull();
    expect(sheetSquareCover("/api/media/whatever.webp", "Kirby and the Forgotten Land")).toBeNull();
  });

  it("refuses a host that is not Nintendo's, however square the path looks", () => {
    expect(
      sheetSquareCover(
        "https://example.com/media/images/11_square_images/1x1_KirbyAndTheForgottenLand.jpg",
        "Kirby and the Forgotten Land",
      ),
    ).toBeNull();
    expect(
      sheetSquareCover(
        "https://nintendo.com.evil.test/media/images/11_square_images/1x1_KirbyAndTheForgottenLand.jpg",
        "Kirby and the Forgotten Land",
      ),
    ).toBeNull();
  });

  it("refuses a Nintendo URL that is neither square nor marked square", () => {
    expect(
      sheetSquareCover(
        "https://www.nintendo.com/eu/media/images/migration/KirbyAndTheForgottenLand.jpg",
        "Kirby and the Forgotten Land",
      ),
    ).toBeNull();
  });

  it("refuses nothing at all, rather than throwing", () => {
    for (const value of [null, undefined, "", "   ", 42, {}, "not a url"]) {
      expect(sheetSquareCover(value, "Kirby and the Forgotten Land"), String(value)).toBeNull();
    }
  });
});

describe("the sheet's own rows, counted", () => {
  it("classifies every real cover URL in the committed sheet", async () => {
    /*
      The denominator, from the sheet itself rather than from a claim. If a
      future import changes Nintendo's directory names this test says so by
      moving, instead of the filler quietly finding nothing.
    */
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const csv = readFileSync(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "../import-sources/catalogue.csv"),
      "utf8",
    );
    const header = csv.slice(0, csv.indexOf("\n")).split(",");
    const col = header.indexOf("Cover URL");
    expect(col).toBeGreaterThan(-1);

    const rows = [];
    for (const line of csv.split("\n").slice(1)) {
      const found = line.match(/https:\/\/[^,"\s]+/);
      const title = line.split(",")[1] ?? "";
      if (found && line.includes("media/images")) rows.push([title, found[0]]);
    }
    expect(rows.length).toBeGreaterThan(500);

    const square = rows.filter(([title, url]) => sheetSquareCover(url, title));
    /*
      The guard costs real coverage and that is the point: 411 of the sheet's
      covers are square and roughly three quarters of them survive the check.
      The quarter refused are rows the importer matched to another game.
    */
    expect(square.length).toBeGreaterThan(200);
    expect(square.length).toBeLessThan(411);
    expect(square.filter(([, url]) => url.includes("05_packshots"))).toHaveLength(0);
  });
});
