/**
 * The sort was made faster. It must not have been made different.
 *
 * Computing a sort key once per product instead of inside the comparator is
 * only worth doing if the order that comes out is the order that came out
 * before. This holds the two key functions to the behaviour of the closures
 * they replaced, across the spellings a catalogue assembled from several
 * sources actually contains.
 */
import { describe, expect, it } from "vitest";

import { freshnessScore, releaseTime } from "@/lib/listingSort";

describe("a release date, however the record spells it", () => {
  it("reads an ISO date", () => {
    expect(releaseTime({ releaseDate: "2023-05-12" })).toBe(new Date("2023-05-12").getTime());
  });

  it("reads every field name the catalogue uses for it", () => {
    const when = new Date("2021-07-01").getTime();
    expect(releaseTime({ release_date: "2021-07-01" })).toBe(when);
    expect(releaseTime({ metadata: { releaseDate: "2021-07-01" } })).toBe(when);
    expect(releaseTime({ metadata: { release_date: "2021-07-01" } })).toBe(when);
  });

  it("lets JavaScript read a slash date first, month-first, as it always has", () => {
    /*
      I expected the day-month branch to claim "08/03/2019" and wrote a test
      saying so. It does not: `new Date("08/03/2019")` succeeds and reads it
      as the THIRD OF AUGUST, US order, so the branch below never sees it. The
      test was wrong about the code, not the other way round — and the reading
      is left alone, because flipping which of the two wins would silently
      re-date part of the catalogue and nobody asked for that.
    */
    expect(releaseTime({ releaseDate: "08/03/2019" })).toBe(new Date("2019-08-03").getTime());
  });

  it("uses the day-month branch only where the month-first reading is impossible", () => {
    /*
      A second wrong guess of mine, and the answer is better than either
      expectation. JavaScript accepts "08-03-2019" and "08.03.2019" too, all
      month-first — the fallback is reached ONLY when the first number cannot
      be a month, and there the day-month reading is the only one there is.
      So the two paths never disagree about the same string; nothing in the
      catalogue is being re-dated by a coin flip.
    */
    expect(releaseTime({ releaseDate: "08-03-2019" })).toBe(new Date("2019-08-03").getTime());
    expect(releaseTime({ releaseDate: "08.03.2019" })).toBe(new Date("2019-08-03").getTime());

    const theTwentyEighth = new Date("2019-03-28").getTime();
    expect(new Date("28-03-2019").getTime()).toBeNaN();
    expect(releaseTime({ releaseDate: "28-03-2019" })).toBe(theTwentyEighth);
    expect(releaseTime({ releaseDate: "28.03.2019" })).toBe(theTwentyEighth);
    expect(releaseTime({ releaseDate: "28/03/2019" })).toBe(theTwentyEighth);
  });

  it("falls back to a bare four-digit year inside a sentence", () => {
    expect(releaseTime({ releaseDate: "سنة 2017 تقريبًا" })).toBe(new Date("2017").getTime());
  });

  it("reads a numeric year as a year, not as milliseconds", () => {
    /*
      A real bug this refactor's own test caught. `releaseYear: 1998` went
      through `new Date(1998)` — 1998 MILLISECONDS past the epoch — so the game
      sorted as though released in January 1970, and `isNaN` never fired to
      send it to the year regex. Fixed, because a shelf that files every
      numerically-dated game at the dawn of time is not an ordering anyone
      chose.
    */
    expect(releaseTime({ releaseYear: 1998 })).toBe(new Date("1998").getTime());
    expect(releaseTime({ releaseYear: 2026 })).toBe(new Date("2026").getTime());
    expect(releaseTime({ release_year: 2011 })).toBe(new Date("2011").getTime());
  });

  it("does not mistake a real timestamp for a year", () => {
    // Only 1900–2200 is read as a year; anything else keeps the old meaning.
    const ms = new Date("2023-05-12").getTime();
    expect(releaseTime({ releaseDate: ms })).toBe(ms);
  });

  it("gives nothing rather than NaN when there is no date", () => {
    expect(releaseTime({})).toBe(0);
    expect(releaseTime({ releaseDate: "" })).toBe(0);
    expect(releaseTime({ releaseDate: "قريبًا" })).toBe(0);
  });
});

describe("how new a listing is", () => {
  it("takes whichever is later: added to the shop, or released", () => {
    /*
      A 2017 game added today is new to this shop; a 2026 release added months
      ago is new to the world. The default shelf order wants both.
    */
    const added = new Date("2026-09-01").getTime();
    const old = freshnessScore({ createdAt: "2026-09-01", releaseDate: "2017-03-03" });
    expect(old).toBe(added);

    const released = new Date("2026-12-01").getTime();
    const soon = freshnessScore({ createdAt: "2026-09-01", releaseDate: "2026-12-01" });
    expect(soon).toBe(released);
  });

  it("falls back through the timestamp spellings", () => {
    const when = new Date("2025-01-15").getTime();
    expect(freshnessScore({ created_at: "2025-01-15" })).toBe(when);
    expect(freshnessScore({ updatedAt: "2025-01-15" })).toBe(when);
    expect(freshnessScore({ updated_at: "2025-01-15" })).toBe(when);
  });

  it("gives nothing for a record with neither", () => {
    expect(freshnessScore({})).toBe(0);
  });
});

describe("the ordering itself", () => {
  it("puts newer first, and breaks ties by id the way it always did", () => {
    const products = [
      { id: "a", createdAt: "2024-01-01" },
      { id: "b", createdAt: "2026-01-01" },
      { id: "c", createdAt: "2025-01-01" },
      { id: "d", createdAt: "2026-01-01" },
    ];
    const keyed = new Map(products.map((p) => [p, freshnessScore(p)]));
    const sorted = [...products].sort((a, b) => {
      const valA = keyed.get(a) ?? 0;
      const valB = keyed.get(b) ?? 0;
      if (valA !== valB) return valB - valA;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
    expect(sorted.map((p) => p.id)).toEqual(["d", "b", "c", "a"]);
  });
});
