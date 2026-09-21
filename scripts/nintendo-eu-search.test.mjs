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

  it("refuses a Switch 1 listing to a Switch 2 line", async () => {
    const found = await searchEuropeSquare(
      "Some Game",
      true,
      answer([row("Some Game", "https://img/x.jpg", ["Nintendo Switch"])]),
    );
    expect(found.ok).toBe(false);
    expect(found.reason).toMatch(/Switch 2 row/);
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
