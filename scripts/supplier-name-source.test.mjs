import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  candidateTitles,
  chineseNameOf,
  hkNameIndex,
  matchSupplierName,
} from "./lib/supplier-name-source.mjs";

const HAN = /[一-鿿㐀-䶿豈-﫿]/;

const catalogue = JSON.parse(
  readFileSync(path.resolve("data/nintendo-hong-kong-languages.json"), "utf8"),
);
const index = hkNameIndex(catalogue.titles);

describe("the Hong Kong name index", () => {
  it("is built from the committed catalogue", () => {
    expect(catalogue.titles.length).toBeGreaterThan(100);
    /* Every row contributes at least its own name, and most contribute two. */
    expect(index.size).toBeGreaterThanOrEqual(catalogue.titles.length);
  });

  it("reports how much of the catalogue carries a Chinese name", () => {
    let withChinese = 0;
    for (const row of catalogue.titles) if (chineseNameOf(row)) withChinese += 1;
    /*
      Printed rather than asserted at a threshold: this is Nintendo's catalogue,
      not ours, and a run that fails because Hong Kong renamed some games would
      be a test reporting somebody else's editorial decision as our bug.
    */
    console.log(
      `Hong Kong rows: ${catalogue.titles.length} · carrying a Chinese name: ${withChinese}`,
    );
    expect(withChinese).toBeGreaterThan(0);
  });

  it("reports how many Chinese-named rows an English title could reach", () => {
    /*
      The number that decides whether this source is usable at all. Our
      catalogue is titled in English and Arabic; a Hong Kong row whose only
      names are Chinese cannot be reached from either, however good the name on
      it is. What makes one reachable is a Latin form somewhere on the row — a
      Latin `storeName` beside a Chinese `catalogueTitle`, or the Latin name a
      Chinese title carries in brackets.
    */
    let reachable = 0;
    for (const row of catalogue.titles) {
      if (!chineseNameOf(row)) continue;
      const local = hkNameIndex([row]);
      const latinKeys = [...local.keys()].filter((key) => /^[a-z0-9]+$/.test(key));
      if (latinKeys.length) reachable += 1;
    }
    const withChinese = catalogue.titles.filter((row) => chineseNameOf(row)).length;
    console.log(
      `Chinese-named rows: ${withChinese} · reachable from a Latin title: ${reachable}`,
    );
    expect(reachable).toBeGreaterThan(0);
  });
});

describe("chineseNameOf", () => {
  it("returns the Chinese name when the row has one", () => {
    const row = { storeName: "莎莉之定律", catalogueTitle: "莎莉之定律" };
    expect(chineseNameOf(row)).toBe("莎莉之定律");
  });

  it("returns nothing for a row sold under a Latin name", () => {
    expect(chineseNameOf({ storeName: "DARK SOULS: Remastered" })).toBe("");
  });

  it("prefers the Chinese half when only one of the two names has it", () => {
    expect(chineseNameOf({ storeName: "Brawlhalla", catalogueTitle: "英靈神殿大亂鬥" })).toBe(
      "英靈神殿大亂鬥",
    );
  });

  it("never returns a Latin string, whatever the row holds", () => {
    for (const row of catalogue.titles) {
      const name = chineseNameOf(row);
      if (name) expect(HAN.test(name)).toBe(true);
    }
  });
});

describe("candidateTitles", () => {
  it("offers the English title, the display title and the slug", () => {
    const out = candidateTitles({
      titleEn: "Super Mario Odyssey",
      title: "سوبر ماريو أوديسي",
      slug: "super-mario-odyssey",
    });
    expect(out).toContain("Super Mario Odyssey");
    expect(out).toContain("سوبر ماريو أوديسي");
    expect(out).toContain("super mario odyssey");
  });

  it("skips the fields a product has not filled in", () => {
    expect(candidateTitles({ titleEn: "", title: "Zelda", slug: undefined })).toEqual(["Zelda"]);
  });
});

describe("matchSupplierName", () => {
  it("finds the Chinese name a game is sold under", () => {
    const row = { nsuid: "70010000000000", storeName: "薩爾達傳說 王國之淚 (Tears of the Kingdom)" };
    const local = hkNameIndex([row]);
    const hit = matchSupplierName({ titleEn: "Tears of the Kingdom" }, local);
    expect(hit.outcome).toBe("found");
    expect(HAN.test(hit.name)).toBe(true);
    expect(hit.sourceUrl).toBe("https://ec.nintendo.com/HK/zh/titles/70010000000000");
  });

  it("says so rather than returning the English title when Hong Kong sells it in Latin", () => {
    const local = hkNameIndex([{ nsuid: "70010000008802", storeName: "DARK SOULS: Remastered" }]);
    const hit = matchSupplierName({ titleEn: "DARK SOULS: Remastered" }, local);
    expect(hit.outcome).toBe("latin_name");
    expect(hit.name).toBeUndefined();
  });

  it("reports a game Nintendo Hong Kong does not list", () => {
    const hit = matchSupplierName({ titleEn: "A Game That Does Not Exist Anywhere" }, index);
    expect(hit.outcome).toBe("not_in_catalogue");
    expect(hit.name).toBeUndefined();
  });

  it("matches through punctuation, case and trademark signs", () => {
    const local = hkNameIndex([{ nsuid: "70010000000001", storeName: "斯普拉遁3 (Splatoon™ 3)" }]);
    expect(matchSupplierName({ titleEn: "splatoon 3" }, local).outcome).toBe("found");
    expect(matchSupplierName({ titleEn: "Splatoon® 3" }, local).outcome).toBe("found");
  });

  it("never returns a name for a game it did not match", () => {
    for (const outcome of ["not_in_catalogue", "latin_name"]) {
      const game =
        outcome === "latin_name"
          ? { titleEn: "DARK SOULS: Remastered" }
          : { titleEn: "Nothing Named This" };
      const local = hkNameIndex([{ nsuid: "1", storeName: "DARK SOULS: Remastered" }]);
      const hit = matchSupplierName(game, local);
      expect(hit.outcome).toBe(outcome);
      expect(hit.name ?? "").toBe("");
    }
  });
});
