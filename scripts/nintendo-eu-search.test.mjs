/**
 * The second source's refusals, which are the whole of its safety.
 *
 * A url key either resolves or does not. A search always returns something,
 * ranked by relevance — which is precisely how a game ends up wearing another
 * game's artwork. Everything asserted here is a case where the right answer is
 * "nothing".
 */
import { describe, expect, it } from "vitest";

import { searchEuropeSquare } from "./lib/nintendo-eu-search.mjs";

const answer = (docs) => async () => ({ ok: true, json: { response: { docs } } });
const row = (title, square, systems = ["Nintendo Switch"]) => ({
  title,
  image_url_sq_s: square,
  system_names_txt: systems,
});

describe("what it accepts", () => {
  it("takes the square art of a row whose title matches exactly", async () => {
    const found = await searchEuropeSquare(
      "Above Snakes",
      false,
      answer([row("Above Snakes", "//img.nintendo.eu/above-snakes-sq.jpg")]),
    );
    expect(found.ok).toBe(true);
    expect(found.url).toBe("https://img.nintendo.eu/above-snakes-sq.jpg");
    expect(found.provenance).toContain("Nintendo of Europe");
  });

  it("ignores this shop's own platform bracket, as the url-key path does", async () => {
    const found = await searchEuropeSquare(
      "Above Snakes [Switch]",
      false,
      answer([row("Above Snakes", "https://img.nintendo.eu/x.jpg")]),
    );
    expect(found.ok).toBe(true);
  });
});

describe("what it refuses", () => {
  it("refuses a near miss, however well it ranks", async () => {
    /*
      The failure this exists to prevent. A relevance search for "Trine 5"
      returns Trine 4 and Trine 2 happily, and a containment test would take
      one of them.
    */
    const found = await searchEuropeSquare(
      "Trine 5: A Clockwork Conspiracy",
      false,
      answer([
        row("Trine 4: The Nightmare Prince", "https://img/4.jpg"),
        row("Trine 2: Complete Story", "https://img/2.jpg"),
      ]),
    );
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/exact title/);
  });

  /*
    REVERSED, DELIBERATELY, AND KEPT HERE WITH ITS REASON.

    This used to assert the opposite: that a Switch 1 listing is refused to a
    line this shop calls a Switch 2 edition. It was a reasonable rule and the
    catalogue measured it. Of forty games re-asked about, ten were FOUND and
    then refused at exactly this branch, and eighteen of the six hundred
    without a picture have no Switch 2 row in EITHER Nintendo store — while
    this shop calls them Switch 2 editions. All of them were left with no
    image at all.

    A generation is not an edition. «Standard» and «Deluxe» are two different
    products and the test below still refuses to choose between them; the
    Switch 1 and Switch 2 listings of one game are one game, and Nintendo
    ships the same square key art for both. Taking it is not a guess, and an
    empty card is not the safer answer — it is only the emptier one.
  */
  it("takes the Switch 1 key art for a Switch 2 line when that is the only listing", async () => {
    const found = await searchEuropeSquare(
      "Some Game",
      true,
      answer([row("Some Game", "https://img/x.jpg", ["Nintendo Switch"])]),
    );
    expect(found.ok).toBe(true);
    expect(found.url).toBe("https://img/x.jpg");
    // And it says so, so nothing pretends the listing was the other one.
    expect(found.provenance).toMatch(/same game, same key art/);
  });

  it("still prefers the row of the generation actually asked for", async () => {
    const found = await searchEuropeSquare(
      "Some Game",
      true,
      answer([
        row("Some Game", "https://img/one.jpg", ["Nintendo Switch"]),
        row("Some Game", "https://img/two.jpg", ["Nintendo Switch 2"]),
      ]),
    );
    expect(found.ok).toBe(true);
    expect(found.url).toBe("https://img/two.jpg");
    expect(found.provenance).not.toMatch(/same game, same key art/);
  });

  it("refuses when the other generation itself has two editions", async () => {
    /*
      The crossing is allowed; the guessing is not. Two Switch 1 rows for a
      Switch 2 line is still a standard and a deluxe with nothing to tell them
      apart.
    */
    const found = await searchEuropeSquare(
      "Some Game",
      true,
      answer([
        row("Some Game", "https://img/a.jpg", ["Nintendo Switch"]),
        row("Some Game", "https://img/b.jpg", ["Nintendo Switch"]),
      ]),
    );
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/share this exact title/);
  });

  it("refuses when two rows share the title, because it cannot tell them apart", async () => {
    /*
      A standard and a deluxe, or a regional re-release. Picking either is
      guessing, and guessing is how the wrong box art gets stored.
    */
    const found = await searchEuropeSquare(
      "Double Dragon",
      false,
      answer([row("Double Dragon", "https://img/a.jpg"), row("Double Dragon", "https://img/b.jpg")]),
    );
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/share this exact title/);
  });

  it("refuses a matching row that carries no square image", async () => {
    const found = await searchEuropeSquare("Above Snakes", false, answer([row("Above Snakes", "")]));
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/no square image/);
  });

  it("reports a failed search as a failure, not as an absence", async () => {
    const found = await searchEuropeSquare("Above Snakes", false, async () => ({
      ok: false,
      status: 503,
    }));
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/search HTTP 503/);
  });

  it("does not let a title's punctuation become Solr syntax", async () => {
    /*
      `9 R.I.P. [Switch]` and `Sakura Wars: ~In Hot Blood~` carry characters
      Solr reads as operators. Sent raw they make the query a syntax error,
      and a 400 reads as "this game does not exist".
    */
    let asked = "";
    await searchEuropeSquare("Pokémon: Let's Go! (Eevee) ~special~", false, async (url) => {
      asked = url;
      return { ok: true, json: { response: { docs: [] } } };
    });
    const q = decodeURIComponent(asked.split("q=")[1].split("&")[0]);
    for (const ch of ["(", ")", "[", "]", "!", ":", "~", "*", "?", "^"]) {
      expect(q).not.toContain(ch);
    }
  });
});
