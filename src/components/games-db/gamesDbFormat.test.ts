/**
 * @vitest-environment node
 */
/**
 * How the games database says a fact in Arabic. Each line here is one a
 * visitor reads on a title page or the list's count.
 */
import { describe, expect, it } from "vitest";

import { seriesLabel } from "@/lib/games-db";
import {
  ageRatingLabel,
  formatReleaseDate,
  gamesCountLabel,
  isUpcoming,
  playersLabel,
  productIdFromPath,
} from "./gamesDbFormat";

describe("the facts, in Arabic", () => {
  it("counts games with the noun Arabic gives each number", () => {
    expect(gamesCountLabel(1)).toBe("لعبة واحدة");
    expect(gamesCountLabel(2)).toBe("لعبتان");
    expect(gamesCountLabel(9)).toBe("9 ألعاب");
    expect(gamesCountLabel(24)).toBe("24 لعبة");
    expect(gamesCountLabel(103)).toBe("103 ألعاب");
    expect(gamesCountLabel(20065)).toBe("20,065 لعبة");
    expect(gamesCountLabel(0)).toBe("لا توجد ألعاب");
  });

  it("writes a release date with the Iraqi month names, and nothing for no date", () => {
    expect(formatReleaseDate("2024-09-26")).toBe("26 أيلول 2024");
    expect(formatReleaseDate("")).toBe("");
    expect(isUpcoming("2027-03-01", new Date("2026-11-05T12:00:00Z"))).toBe(true);
    expect(isUpcoming("2026-11-05", new Date("2026-11-05T12:00:00Z"))).toBe(false);
  });

  it("says players and ratings the way a buyer reads them, and drops Nintendo's «Unknown»", () => {
    expect(playersLabel("1-4")).toBe("1–4 لاعبين");
    expect(playersLabel("1")).toBe("لاعب واحد");
    expect(ageRatingLabel("PEGI 12")).toBe("PEGI 12");
    expect(ageRatingLabel("Unknown")).toBe("");
    expect(ageRatingLabel("TBD")).toBe("");
  });

  it("names a series, not Nintendo's internal key for it", () => {
    expect(seriesLabel("the_legend_of_zelda")).toBe("The Legend of Zelda");
    expect(seriesLabel("lego")).toBe("LEGO");
    expect(seriesLabel("some_new_series")).toBe("Some New Series");
  });

  it("reads the product id out of the shop link the API answers with", () => {
    expect(productIdFromPath("/product/zelda-totk")).toBe("zelda-totk");
    expect(productIdFromPath("/product/prd%20x")).toBe("prd x");
    expect(productIdFromPath(null)).toBeNull();
    expect(productIdFromPath("/games-db/x-1")).toBeNull();
  });
});
