import { describe, expect, it } from "vitest";

import {
  candidateKeys,
  familyFacts,
  htmlToText,
  galleryFrom,
  identityMatch,
  metadataFrom,
  slugifyTitle,
} from "./lib/nintendo-store.mjs";

describe("slugifyTitle", () => {
  it("drops the trademark marks Nintendo leaves out of its own url keys", () => {
    expect(slugifyTitle("Pikmin™ 4")).toBe("pikmin-4");
    expect(slugifyTitle("The Legend of Zelda™: Tears of the Kingdom")).toBe(
      "the-legend-of-zelda-tears-of-the-kingdom",
    );
    expect(slugifyTitle("Bayonetta 3 — Trinity Masquerade")).toBe("bayonetta-3-trinity-masquerade");
  });

  it("spells out the plus sign the way Nintendo's url keys do", () => {
    expect(slugifyTitle("Mario + Rabbids Sparks of Hope")).toBe("mario-plus-rabbids-sparks-of-hope");
  });
});

describe("candidateKeys", () => {
  it("prefers a url key the product already stores", () => {
    const keys = candidateKeys({
      title: "Pikmin 4",
      platform: "Nintendo Switch",
      nintendoEshopUrl: "https://www.nintendo.com/us/store/products/pikmin-4-switch/",
    });
    expect(keys[0]).toBe("pikmin-4-switch");
  });

  it("asks for the Switch 2 keys first when the product is a Switch 2 edition", () => {
    const keys = candidateKeys({
      title: "Metroid Prime 4: Beyond – Nintendo Switch 2 Edition",
      platform: "Nintendo Switch 2",
      slug: "metroid-prime-4-beyond-switch-2",
    });
    expect(keys[0]).toContain("switch-2");
    expect(keys).toContain("metroid-prime-4-beyond-nintendo-switch-2-edition-switch-2");
  });

  it("keeps the console words when they are part of the game's name", () => {
    expect(candidateKeys({ title: "Nintendo Switch Sports", platform: "Nintendo Switch" })).toContain(
      "nintendo-switch-sports-switch",
    );
    expect(candidateKeys({ title: "Everybody 1-2-Switch!", platform: "Nintendo Switch" })).toContain(
      "everybody-1-2-switch-switch",
    );
  });

  it("drops the edition suffix rather than folding it into the name", () => {
    const keys = candidateKeys({
      title: "The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition",
      platform: "Nintendo Switch 2",
    });
    expect(keys).toContain(
      "the-legend-of-zelda-breath-of-the-wild-nintendo-switch-2-edition-switch-2",
    );
    expect(keys.some((k) => k.includes("wild-edition"))).toBe(false);
  });

  it("stops before turning one missing game into a dozen requests", () => {
    const keys = candidateKeys({
      title: "Mario + Rabbids Sparks of Hope – Nintendo Switch 2 Edition",
      platform: "Nintendo Switch 2",
      slug: "mario-rabbids-sparks-of-hope-switch-2",
    });
    expect(keys.length).toBeLessThanOrEqual(10);
  });

  it("tries the plus both spelled out and dropped", () => {
    const keys = candidateKeys({ title: "Mario + Rabbids Sparks of Hope", platform: "Nintendo Switch" });
    expect(keys).toContain("mario-plus-rabbids-sparks-of-hope-switch");
    expect(keys).toContain("mario-rabbids-sparks-of-hope-switch");
  });

  it("reports a stored nsuid that disagrees with the page instead of refusing it", () => {
    const verdict = identityMatch(
      { title: "Persona 4 Golden", platform: "Nintendo Switch", nsuid: "70010000060999" },
      { platform: { label: "Nintendo Switch" }, name: "Persona 4 Golden", nsuid: "70010000060320" },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.nsuidConflict).toBe(true);
    expect(verdict.pageNsuid).toBe("70010000060320");
  });

  it("still refuses a conflicting nsuid when the console generation differs", () => {
    const verdict = identityMatch(
      { title: "Metroid Prime 4: Beyond", platform: "Nintendo Switch 2", nsuid: "70010000104849" },
      { platform: { label: "Nintendo Switch" }, name: "Metroid Prime™ 4: Beyond", nsuid: "70010000084766" },
    );
    expect(verdict.ok).toBe(false);
  });

  it("treats a note stored in the nsuid field as no nsuid at all", () => {
    const verdict = identityMatch(
      { title: "Mario Tennis Fever", platform: "Nintendo Switch 2", nsuid: "See regional Nintendo eShop listing" },
      { platform: { label: "Nintendo Switch 2" }, name: "Mario Tennis™ Fever", nsuid: "70010000105869" },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.nsuidConflict).toBeUndefined();
  });

  it("matches a title whose trademark mark sits inside the platform words", () => {
    const verdict = identityMatch(
      { title: "Nintendo Switch 2 Welcome Tour", platform: "Nintendo Switch 2" },
      { platform: { label: "Nintendo Switch 2" }, name: "Nintendo Switch™ 2 Welcome Tour" },
    );
    expect(verdict.ok).toBe(true);
  });

  it("asks for the Switch 1 key first for a Switch 1 product", () => {
    const keys = candidateKeys({ title: "Pikmin 4", platform: "Nintendo Switch" });
    expect(keys[0]).toBe("pikmin-4-switch");
  });
});

describe("identityMatch", () => {
  const switch1 = { platform: { label: "Nintendo Switch" } };
  const switch2 = { platform: { label: "Nintendo Switch 2" } };

  it("accepts a page whose nsuid matches, whatever the titles say", () => {
    const verdict = identityMatch(
      { title: "Pikmin 4", nsuid: "70010000005308" },
      { ...switch1, name: "Pikmin™ 4 (Digital)", nsuid: "70010000005308" },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.confidence).toBe("nsuid");
  });

  it("flags a conflicting nsuid rather than refusing a page the title and console both fit", () => {
    const verdict = identityMatch(
      { title: "Pikmin 4", platform: "Nintendo Switch", nsuid: "70010000005308" },
      { ...switch1, name: "Pikmin™ 4", nsuid: "70010000005302" },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.nsuidConflict).toBe(true);
  });

  it("refuses a conflicting nsuid when the title does not fit either", () => {
    const verdict = identityMatch(
      { title: "Pikmin 4", platform: "Nintendo Switch", nsuid: "70010000005308" },
      { ...switch1, name: "Pikmin™ 3 Deluxe", nsuid: "70010000005302" },
    );
    expect(verdict.ok).toBe(false);
  });

  it("accepts a title match once the platform generation agrees", () => {
    expect(identityMatch({ title: "Pikmin 4", platform: "Nintendo Switch" }, { ...switch1, name: "Pikmin™ 4" }).ok).toBe(
      true,
    );
  });

  it("keeps the Switch 2 edition off the Switch 1 page", () => {
    const verdict = identityMatch(
      { title: "Metroid Prime 4: Beyond – Nintendo Switch 2 Edition", platform: "Nintendo Switch 2" },
      { ...switch1, name: "Metroid Prime™ 4: Beyond" },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/platform generation/);
  });

  it("matches the Switch 2 edition against its own page", () => {
    const verdict = identityMatch(
      { title: "Metroid Prime 4: Beyond – Nintendo Switch 2 Edition", platform: "Nintendo Switch 2" },
      { ...switch2, name: "Metroid Prime™ 4: Beyond – Nintendo Switch™ 2 Edition" },
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a predecessor whose name its sequel contains", () => {
    const verdict = identityMatch(
      { title: "Xenoblade Chronicles 2", platform: "Nintendo Switch", nsuid: "70010000000707" },
      { ...switch1, name: "Xenoblade Chronicles™: Definitive Edition", nsuid: "70010000029711" },
    );
    expect(verdict.ok).toBe(false);
  });

  it("refuses a sequel when the product is the original", () => {
    expect(
      identityMatch({ title: "Pikmin", platform: "Nintendo Switch" }, { ...switch1, name: "Pikmin™ 4" }).ok,
    ).toBe(false);
    expect(
      identityMatch({ title: "Persona 5", platform: "Nintendo Switch" }, { ...switch1, name: "Persona 5 Royal" }).ok,
    ).toBe(false);
  });

  it("still matches the same game written with different decoration", () => {
    expect(
      identityMatch(
        { title: "Dragon Ball: Sparking! ZERO [Switch 2]", platform: "Nintendo Switch 2" },
        { platform: { label: "Nintendo Switch 2" }, name: "DRAGON BALL: Sparking! ZERO" },
      ).ok,
    ).toBe(true);
  });

  it("refuses a different game with a similar name", () => {
    expect(
      identityMatch({ title: "Pikmin 4", platform: "Nintendo Switch" }, { ...switch1, name: "Pikmin™ 3 Deluxe" }).ok,
    ).toBe(false);
  });
});

describe("galleryFrom", () => {
  const product = {
    productImage: { publicId: "store/software/switch/700100/cover" },
    productGallery: [
      { publicId: "/store/software/switch/700100/Video/trailer", resourceType: "video" },
      { publicId: "store/software/switch/700100/cover", resourceType: "image" },
      { publicId: "store/software/switch/700100/shot-a", resourceType: "image" },
      { publicId: "store/software/switch/700100/shot-a", resourceType: "image" },
      { publicId: "store/software/switch/700100/shot-b", resourceType: "image" },
    ],
  };

  it("returns screenshots only — no trailers, no box art, no repeats", () => {
    const shots = galleryFrom(product);
    expect(shots.map((s) => s.publicId)).toEqual([
      "store/software/switch/700100/shot-a",
      "store/software/switch/700100/shot-b",
    ]);
    expect(shots[0].url).toContain("https://assets.nintendo.com/image/upload/");
  });

  it("does not impose a count of its own", () => {
    const many = {
      productImage: {},
      productGallery: Array.from({ length: 14 }, (_, i) => ({
        publicId: `store/software/switch/700100/s${i}`,
        resourceType: "image",
      })),
    };
    expect(galleryFrom(many)).toHaveLength(14);
  });
});

describe("metadataFrom", () => {
  it("states only what the page states, and leaves the rest absent", () => {
    const md = metadataFrom({
      nsuid: "70010000005308",
      softwarePublisher: "Nintendo",
      softwareDeveloper: null,
      releaseDate: "2023-07-21T00:00:00.000Z",
      supportedLanguages: ["American English", "French"],
      numberOfPlayers: { system: { min: 1, max: 2 } },
      playModes: [{ code: "TV_MODE", label: "TV mode" }],
      nsoFeatures: [{ code: "SAVE_DATA_CLOUD" }],
      softwareDetails: { romSizes: [{ totalRomSize: "12086935552" }] },
      tags: { genres: [{ label: "Action" }] },
      contentRating: { label: "Everyone 10+" },
      downloadableContents: [],
    });

    expect(md.publisher).toBe("Nintendo");
    expect(md.releaseDate).toBe("2023-07-21");
    expect(md.numberOfPlayers).toBe("1-2");
    expect(md.downloadSizeGb).toBe(11.26);
    expect(md.size).toBe("11.26 GB");
    expect(md.ageRating).toBe("Everyone 10+");
    expect(md.genres).toEqual(["Action"]);
    expect(md.tvMode).toBe(true);
    expect(md.handheldMode).toBe(false);
    expect(md.nintendoCloudSaves).toBe(true);
    expect(md.arabicSupport).toBe(false);

    // Absent on the page means absent here — never an empty string or a guess.
    expect("developer" in md).toBe(false);
    expect("dlc" in md).toBe(false);
    expect("tagline" in md).toBe(false);
  });

  it("puts the Switch 2 compatibility caption in the Nintendo notes, not the device list", () => {
    const md = metadataFrom({
      compatibility: { status: "PLAYABLE", caption: "Supported – Game behavior is consistent with Nintendo Switch." },
    });
    expect(md.nintendoNotes).toMatch(/^Supported/);
    expect("compatibility" in md).toBe(false);
  });

  it("records local and online player counts separately when the page has them", () => {
    const md = metadataFrom({
      numberOfPlayers: { system: { min: 1, max: 4 }, local: { max: 4 }, online: { max: 8 } },
    });
    expect(md.numberOfPlayers).toBe("1-4");
    expect(md.mpLocalPlayers).toBe(4);
    expect(md.mpOnlinePlayers).toBe(8);
  });

  it("reports Arabic support when the page lists it", () => {
    const md = metadataFrom({ supportedLanguages: ["American English", "Arabic"] });
    expect(md.arabicSupport).toBe(true);
  });

  it("takes the download size for the console the product is sold on", () => {
    const romSizes = [
      { totalRomSize: "28292677632", platform: "HAC" },
      { totalRomSize: "29696720896", platform: "BEE" },
    ];
    const one = metadataFrom({ platform: { code: "NINTENDO_SWITCH" }, softwareDetails: { romSizes } });
    const two = metadataFrom({ platform: { code: "NINTENDO_SWITCH_2" }, softwareDetails: { romSizes } });
    expect(one.downloadSizeGb).toBe(26.35);
    expect(two.downloadSizeGb).toBe(27.66);
  });

  it("falls back to the one rom size a single-console title has", () => {
    const md = metadataFrom({
      platform: { code: "NINTENDO_SWITCH_2" },
      softwareDetails: { romSizes: [{ totalRomSize: "12086935552", platform: "HAC" }] },
    });
    expect(md.downloadSizeGb).toBe(11.26);
  });

  it("gives a single-player game a plain player count", () => {
    const md = metadataFrom({ numberOfPlayers: { system: { min: 1, max: 1 } } });
    expect(md.numberOfPlayers).toBe("1");
  });
});

describe("htmlToText", () => {
  it("turns the store's markup into the plain text the storefront renders", () => {
    expect(htmlToText("<p>Meet Pikmin, small &amp; plantlike.<br><br>Grow them.</p>")).toBe(
      "Meet Pikmin, small & plantlike.\n\nGrow them.",
    );
  });

  it("keeps every word", () => {
    const text = htmlToText("<p>One</p><p>Two</p><ul><li>Three</li><li>Four</li></ul>");
    for (const word of ["One", "Two", "Three", "Four"]) expect(text).toContain(word);
  });

  it("leaves plain text alone", () => {
    expect(htmlToText("Just a sentence.")).toBe("Just a sentence.");
  });
});

describe("familyFacts", () => {
  const product = { name: "Metroid Prime™ 4: Beyond – Nintendo Switch™ 2 Edition" };

  it("reads the upgrade price off the upgrade pack's own listing", () => {
    const facts = familyFacts(product, [
      {
        name: "Metroid Prime™ 4: Beyond – Nintendo Switch™ 2 Edition Upgrade Pack",
        'prices({"personalized":false})': { regularPrice: 9.99, finalPrice: 9.99 },
      },
    ]);
    expect(facts.switch2UpgradePrice).toBe(9.99);
    expect(facts.switch2Enhanced).toBe(true);
    expect(facts.switch2Exclusive).toBe(false);
  });

  it("does not call a game exclusive just because no upgrade pack is listed", () => {
    const facts = familyFacts({ name: "Donkey Kong™ Bananza" }, [{ name: "Donkey Kong™ Bananza - Digital Deluxe" }]);
    expect("switch2Exclusive" in facts).toBe(false);
    expect("switch2Enhanced" in facts).toBe(false);
    expect("switch2UpgradePrice" in facts).toBe(false);
  });

  it("takes a Switch 2 Edition as enhanced even with no upgrade pack on the page", () => {
    const facts = familyFacts(product, []);
    expect(facts.switch2Enhanced).toBe(true);
    expect(facts.switch2Exclusive).toBe(false);
    expect("switch2UpgradePrice" in facts).toBe(false);
  });

  it("ignores an upgrade pack belonging to a different game", () => {
    const facts = familyFacts({ name: "Pikmin™ 4" }, [
      {
        name: "Metroid Prime™ 4: Beyond – Nintendo Switch™ 2 Edition Upgrade Pack",
        'prices({"personalized":false})': { finalPrice: 9.99 },
      },
    ]);
    expect(facts).toEqual({});
  });
});

describe("this shop's own platform bracket", () => {
  it("does not end up in the slug twice", () => {
    /*
      Measured against production: plain `9 R.I.P.` resolved and both
      `9 R.I.P. [Switch]` and `9 R.I.P. [Switch 2]` did not. The bracket came
      from the supplier's sheet, became part of the slug, and the key shapes
      then appended the console again — `9-r-i-p-switch-switch`, which is not
      a page Nintendo serves.
    */
    for (const title of ["9 R.I.P. [Switch]", "9 R.I.P."]) {
      expect(candidateKeys({ title })).toContain("9-r-i-p-switch");
    }
    expect(candidateKeys({ title: "9 R.I.P. [Switch]" })).not.toContain("9-r-i-p-switch-switch");
  });

  it("reads the generation out of the bracket before removing it", () => {
    const keys = candidateKeys({ title: "Resident Evil Requiem [Switch 2]" });
    expect(keys[0]).toBe("resident-evil-requiem-switch-2");
  });

  it("leaves a parenthetical that is part of the name alone", () => {
    /*
      `Absolute Fear -AOONI- (最恐 -青鬼-)` resolved in the same run. Only a
      bracket naming a console comes off; a title's own parenthetical is the
      title.
    */
    const keys = candidateKeys({ title: "Absolute Fear -AOONI- (最恐 -青鬼-)" });
    expect(keys.some((k) => k.startsWith("absolute-fear-aooni"))).toBe(true);
  });
});

describe("the bracket comes off the title that is compared, too", () => {
  const page = { name: "9 R.I.P.", platform: { label: "Nintendo Switch" } };

  it("accepts the page the url key already found", () => {
    /*
      The first apply run is what exposed this. `candidateKeys` dropped the
      bracket and reached `/us/store/products/9-r-i-p-switch/` — the same page
      the unbracketed row matched — and `identityMatch` then refused it,
      because its own rules strip "nintendo switch" and "switch 2" but not a
      bare "[Switch]". "9ripswitch" is not "9rip". Half the fix read exactly
      like none of it.
    */
    expect(identityMatch({ title: "9 R.I.P. [Switch]" }, page).ok).toBe(true);
    expect(identityMatch({ title: "9 R.I.P." }, page).ok).toBe(true);
  });

  it("still refuses the Switch 2 edition a Switch 1 page", () => {
    // Not a miss to be fixed: they are different editions with different SKUs.
    const verdict = identityMatch({ title: "9 R.I.P. [Switch 2]" }, page);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/platform generation differs/);
  });

  it("leaves a title whose own name contains the word alone", () => {
    /*
      Only a bracketed console at the end is removed. `1-2-Switch` and
      `Nintendo Switch Sports` are real names, and stripping the word from
      them would point each at some other game's page.
    */
    for (const title of ["1-2-Switch", "Nintendo Switch Sports"]) {
      const self = { name: title, platform: { label: "Nintendo Switch" } };
      expect(identityMatch({ title }, self).ok).toBe(true);
      expect(identityMatch({ title }, page).ok).toBe(false);
    }
  });
});
