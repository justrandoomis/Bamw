import { describe, expect, it } from "vitest";

import { isAwaitingRelease, isReleased, releaseDayISO, releaseMoment } from "./release";

/**
 * The rule that decides whether a customer may buy or may only register.
 *
 * Its most important property is what it does with a date it cannot read.
 * Every one of the 145 products in this catalogue is on sale today; a parser
 * that treated "TBA" or a bare year as "not out yet" would silently take
 * working products off sale, which is a far worse failure than letting one
 * ambiguous pre-order through.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");

describe("reading a release date", () => {
  it("reads the plain dates the catalogue actually stores", () => {
    // The real shapes, from the production export: every date is YYYY-MM-DD.
    expect(releaseDayISO({ releaseDate: "2026-12-03" })).toBe("2026-12-03");
    expect(releaseDayISO({ release_date: "2017-03-03" })).toBe("2017-03-03");
    expect(releaseDayISO({ releaseDate: "2026-12-03T09:00:00.000Z" })).toBe("2026-12-03");
  });

  it("prefers the camelCase field but accepts either spelling", () => {
    expect(releaseDayISO({ releaseDate: "2026-12-03", release_date: "2020-01-01" })).toBe(
      "2026-12-03",
    );
    expect(releaseDayISO({ release_date: "2020-01-01" })).toBe("2020-01-01");
  });

  it("refuses to guess at anything that is not a date", () => {
    for (const value of ["", "   ", "TBA", "2026", "Q1 2026", "قريباً", "coming soon", "n/a"]) {
      expect(releaseMoment({ releaseDate: value }), value).toBeNull();
    }
    expect(releaseMoment({})).toBeNull();
    expect(releaseMoment(null)).toBeNull();
    expect(releaseMoment("2026-12-03")).toBeNull();
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // `Date.UTC(2026, 12, 45)` is a real moment in 2027; reading it as one
    // would hide a product for a year.
    expect(releaseMoment({ releaseDate: "2026-13-45" })).toBeNull();
    expect(releaseMoment({ releaseDate: "2026-02-30" })).toBeNull();
    expect(releaseMoment({ releaseDate: "2026-00-10" })).toBeNull();
  });

  it("falls through to the next field when the first is unreadable", () => {
    expect(releaseDayISO({ releaseDate: "TBA", release_date: "2026-12-03" })).toBe("2026-12-03");
  });
});

describe("who may be bought", () => {
  it("holds back a product whose date is still ahead", () => {
    // Xenoblade Chronicles 3 – Nintendo Switch 2 Edition, the visible product
    // this was reported for.
    const product = { title: "Xenoblade Chronicles 3", releaseDate: "2026-12-03", price: 12500 };
    expect(isAwaitingRelease(product, NOW)).toBe(true);
    expect(isReleased(product, NOW)).toBe(false);
  });

  it("sells everything already out", () => {
    expect(isReleased({ releaseDate: "2017-03-03" }, NOW)).toBe(true);
    expect(isReleased({ releaseDate: "2026-07-23" }, NOW)).toBe(true);
  });

  it("treats an unreadable or missing date as released", () => {
    // The whole catalogue must keep selling. This is the safe direction.
    expect(isReleased({}, NOW)).toBe(true);
    expect(isReleased({ releaseDate: "TBA" }, NOW)).toBe(true);
    expect(isReleased({ releaseDate: "2026" }, NOW)).toBe(true);
    expect(isReleased({ price: 25000, title: "Mario" }, NOW)).toBe(true);
  });

  it("flips on its own the moment the date arrives", () => {
    const product = { releaseDate: "2026-12-03" };
    expect(isReleased(product, new Date("2026-12-02T23:59:59.000Z"))).toBe(false);
    expect(isReleased(product, new Date("2026-12-03T00:00:00.000Z"))).toBe(true);
    expect(isReleased(product, new Date("2026-12-03T00:00:01.000Z"))).toBe(true);
  });

  it("opens after local midnight in Baghdad, never before", () => {
    // A date with no time is midnight UTC — 03:00 in Baghdad, three hours
    // after the local day begins. Selling late is safe; selling early is not.
    const product = { releaseDate: "2026-12-03" };
    const baghdadMidnight = new Date("2026-12-02T21:00:00.000Z");
    expect(isReleased(product, baghdadMidnight)).toBe(false);
  });

  it("honours a time when the date carries one", () => {
    const product = { releaseDate: "2026-12-03T15:00:00.000Z" };
    expect(isReleased(product, new Date("2026-12-03T14:59:00.000Z"))).toBe(false);
    expect(isReleased(product, new Date("2026-12-03T15:00:00.000Z"))).toBe(true);
  });
});
