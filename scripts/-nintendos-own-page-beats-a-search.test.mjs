/**
 * The widest key this shop actually holds, measured rather than assumed.
 *
 * The owner asked for more sources. Five were investigated and each was put
 * through three adversarial reviews, and then the live catalogue was asked the
 * question none of the reviews could answer: of the games STILL without a
 * square card, how many carry the key each source needs?
 *
 *   officialStoreUrl   346 of 372     Nintendo's own page for this row
 *   a square cover     71             already in the record, now read
 *   nsuid              3
 *   productCode        0
 *
 * That killed two candidates outright. Nintendo of Japan is reached by product
 * code or nsuid and NO game that needs it carries either — and its search rows
 * return `iurl` as a bare hash, not a URL, so even the three would have needed
 * a template nobody here knows. A source that cannot be handed a key is worth
 * nothing however good it is.
 *
 * What survives is the store link. It is not a search term; it is Nintendo's
 * own URL for the exact row the importer matched, ending in Nintendo's own
 * product id. A European row whose `url` carries that id IS this game, so the
 * three refusals the title route needs — exact title, one row only, matching
 * generation — do not apply: they exist to survive a relevance ranking, and
 * here there is no ranking to survive.
 */
import { describe, expect, it } from "vitest";

import { europeIdFromStoreUrl, europeRowByStoreUrl, searchEuropeSquare } from "./lib/nintendo-eu-search.mjs";

const SCARLET = "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Pokemon-Scarlet-2179556.html";

describe("Nintendo's own product id, out of the sheet's store link", () => {
  it("reads the id off a real store link", () => {
    expect(europeIdFromStoreUrl(SCARLET)).toBe("2179556");
    expect(
      europeIdFromStoreUrl(
        "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-2-Edition/Kirby-and-the-Forgotten-Land-Nintendo-Switch-2-Edition-Star-Crossed-World-2787773.html",
      ),
    ).toBe("2787773");
  });

  it("refuses a link that is not Nintendo's", () => {
    expect(europeIdFromStoreUrl("https://example.com/Game-2179556.html")).toBe("");
  });

  it("refuses a Nintendo link with no id, rather than inventing one", () => {
    expect(europeIdFromStoreUrl("https://www.nintendo.com/en-gb/Games/index.html")).toBe("");
    expect(europeIdFromStoreUrl("")).toBe("");
    expect(europeIdFromStoreUrl(null)).toBe("");
  });

  it("does not mistake the Hong Kong store's own links for European ids", () => {
    expect(europeIdFromStoreUrl("https://store.nintendo.com.hk/70010000012345")).toBe("");
  });
});

/** The European index, as a handful of rows with their real `url` shape. */
const index = [
  {
    title: "Pokémon Scarlet",
    url: "/Games/Nintendo-Switch-games/Pokemon-Scarlet-2179556.html",
    image_url_sq_s: "//assets/1x1_scarlet.jpg",
    system_names_txt: ["Nintendo Switch"],
  },
  {
    title: "Pokémon Violet",
    url: "/Games/Nintendo-Switch-games/Pokemon-Violet-2180576.html",
    image_url_sq_s: "//assets/1x1_violet.jpg",
    system_names_txt: ["Nintendo Switch"],
  },
];
/** Answers every query with the whole index, as a relevance ranking would. */
const fetchJson = async () => ({ ok: true, status: 200, json: { response: { docs: index } } });

describe("the row is accepted for its own url, not for ranking first", () => {
  it("finds the row the store link points at", async () => {
    const found = await europeRowByStoreUrl(SCARLET, fetchJson);
    expect(found.ok).toBe(true);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].title).toBe("Pokémon Scarlet");
  });

  it("takes the right half when the index returns both, and the query ranked the other first", async () => {
    /*
      THE GUARD, RUN. This stub returns Violet's row alongside Scarlet's for
      every query — exactly what a relevance ranking does. The acceptance test
      is on the ROW's own url, so the ranking cannot decide anything.
    */
    const violet = await europeRowByStoreUrl(
      "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Pokemon-Violet-2180576.html",
      fetchJson,
    );
    expect(violet.rows[0].title).toBe("Pokémon Violet");
  });

  it("refuses when no row carries that id, rather than taking the first", async () => {
    const found = await europeRowByStoreUrl(
      "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Some-Other-Game-9999999.html",
      fetchJson,
    );
    expect(found.ok).toBe(false);
    expect(found.reason).toBeTruthy();
  });

  it("refuses a link with no id at all", async () => {
    expect((await europeRowByStoreUrl("", fetchJson)).ok).toBe(false);
  });
});

describe("the store link goes ahead of the title search", () => {
  it("answers from Nintendo's own page, with provenance that says so", async () => {
    const hit = await searchEuropeSquare("Pokémon Scarlet", false, fetchJson, SCARLET);
    expect(hit.ok).toBe(true);
    expect(hit.url).toBe("https://assets/1x1_scarlet.jpg");
    expect(hit.provenance).toContain("store page");
  });

  it("does not need the generation to agree, because nothing was ranked", async () => {
    // The title route refuses a Switch 1 row for a Switch 2 line unless it is
    // the only one. An exact page id is not a guess, so that rule is not needed.
    const hit = await searchEuropeSquare("Pokémon Scarlet", true, fetchJson, SCARLET);
    expect(hit.ok).toBe(true);
    expect(hit.matchedTitle).toBe("Pokémon Scarlet");
  });

  it("REFUSES the linked page when it is a different game", async () => {
    /*
      The store link comes from the same sheet, matched by the same importer,
      as the nsuid an adversarial review destroyed — and the sheet really does
      point «Railway Nippon! Real Pro» at «Nippon Marathon» and «Fate/EXTELLA»
      at «Fate/EXTELLA LINK». The id removes the ranking; it does not make the
      importer right, so Nintendo's own row title must still agree with ours.
    */
    const hit = await searchEuropeSquare("Railway Nippon! Real Pro", false, fetchJson, SCARLET);
    expect(hit.ok).toBe(false);
  });

  it("falls back to the title search when there is no store link", async () => {
    const hit = await searchEuropeSquare("Pokémon Scarlet", false, fetchJson, "");
    expect(hit.ok).toBe(true);
    expect(hit.provenance).toContain("Nintendo of Europe catalogue");
  });

  it("falls back to the title search when the link names a page the index lacks", async () => {
    const hit = await searchEuropeSquare(
      "Pokémon Violet",
      false,
      fetchJson,
      "https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Nothing-9999999.html",
    );
    expect(hit.ok).toBe(true);
    expect(hit.matchedTitle).toBe("Pokémon Violet");
  });
});

describe("the filler hands both new keys down", () => {
  it("passes the store link and the sheet cover into the pipeline", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const here = path.dirname(new URL(import.meta.url).pathname);
    const fill = readFileSync(path.resolve(here, "square-card-fill.mjs"), "utf8");
    const pipeline = readFileSync(path.resolve(here, "lib/media-pipeline.mjs"), "utf8");
    expect(fill).toContain("sheetCover: product.coverImage");
    expect(fill).toContain("officialStoreUrl: product.officialStoreUrl");
    expect(pipeline).toContain("identity.officialStoreUrl");
    expect(pipeline).toContain("sheetSquareCover(identity.sheetCover, identity.title)");
  });
});
