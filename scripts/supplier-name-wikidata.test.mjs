import { describe, expect, it } from "vitest";

import {
  baseTitle,
  chineseLabelOf,
  englishNames,
  entitiesUrl,
  isVideoGame,
  pickWikidataName,
  searchUrl,
  titleMatches,
  editionFallbacks,
} from "./lib/supplier-name-wikidata.mjs";

/** A Wikidata item, cut down to the fields this module reads. */
const item = ({ en = [], zh = {}, game = true } = {}) => ({
  labels: {
    ...(en.length ? { en: { language: "en", value: en[0] } } : {}),
    ...Object.fromEntries(
      Object.entries(zh).map(([code, value]) => [code, { language: code, value }]),
    ),
  },
  aliases: { en: en.slice(1).map((value) => ({ language: "en", value })) },
  claims: game ? { P31: [{ mainsnak: { datavalue: { value: { id: "Q7889" } } } }] } : {},
});

describe("baseTitle", () => {
  /*
    Every shape below is a real title from the catalogue, taken from the dry run
    that read production. The console tag is the shop's own, not part of the
    game's name, and Wikidata has no item for it.
  */
  it("takes the shop's platform tag off the end", () => {
    expect(baseTitle("Donkey Kong Bananza [Switch 2]")).toBe("Donkey Kong Bananza");
    expect(baseTitle("Hollow Knight switch 1")).toBe("Hollow Knight");
    expect(baseTitle("Stray switch 2")).toBe("Stray");
    expect(baseTitle("Tomb Raider: Definitive Edition switch 1&2")).toBe(
      "Tomb Raider: Definitive Edition",
    );
    expect(baseTitle("EA SPORTS FC 26 switch 1")).toBe("EA SPORTS FC 26");
  });

  it("takes the Switch 2 Edition suffix off, and whatever follows it", () => {
    expect(baseTitle("The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition")).toBe(
      "The Legend of Zelda: Breath of the Wild",
    );
    expect(baseTitle("Xenoblade Chronicles 3 – Nintendo Switch 2 Edition")).toBe(
      "Xenoblade Chronicles 3",
    );
    expect(
      baseTitle("Super Mario Party Jamboree – Nintendo Switch 2 Edition + Jamboree TV"),
    ).toBe("Super Mario Party Jamboree");
    expect(baseTitle("FINAL FANTASY TACTICS - The Ivalice Chronicles — Nintendo Switch 2 Edition")).toBe(
      "FINAL FANTASY TACTICS - The Ivalice Chronicles",
    );
  });

  it("leaves alone the games whose real names contain the console", () => {
    for (const title of [
      "Nintendo Switch Sports",
      "Nintendo Switch 2 Welcome Tour",
      "EA SPORTS FIFA 23 Nintendo Switch Legacy Edition",
      "FIFA 22 Nintendo Switch Legacy Edition",
      "1-2-Switch",
      "Everybody 1-2-Switch!",
    ]) {
      expect(baseTitle(title)).toBe(title);
    }
  });

  it("leaves an ordinary title untouched", () => {
    expect(baseTitle("Super Mario Odyssey")).toBe("Super Mario Odyssey");
    expect(baseTitle("The Legend of Zelda: Echoes of Wisdom")).toBe(
      "The Legend of Zelda: Echoes of Wisdom",
    );
  });
});

describe("editionFallbacks", () => {
  /*
    Every title here is a real one from the catalogue that the first pass came
    back empty for. These are second questions — none of them is what gets
    asked first.
  */
  const first = (title) => editionFallbacks(title)[0];

  it("cuts at the separator when the title has one", () => {
    expect(first("Cyberpunk 2077: Ultimate Edition")).toBe("Cyberpunk 2077");
    expect(first("The Witcher 3: Wild Hunt — Complete Edition")).toBe("The Witcher 3: Wild Hunt");
    expect(first("Fallout 4: Anniversary Edition")).toBe("Fallout 4");
    expect(first("Lies of P: Complete Edition")).toBe("Lies of P");
    expect(first("HITMAN World of Assassination - Signature Edition")).toBe(
      "HITMAN World of Assassination",
    );
  });

  it("cuts at the last separator, not the first", () => {
    /* `The Witcher 3:` is part of the name; the `—` is where the edition starts. */
    expect(first("The Witcher 3: Wild Hunt — Complete Edition")).not.toBe("The Witcher 3");
  });

  it("does not read a colon inside a word as a separator", () => {
    /* `NieR:Automata` is the game's name, and cutting there would ask for `NieR`. */
    expect(editionFallbacks("NieR:Automata The End of YoRHa Edition")).not.toContain("NieR");
  });

  it("offers each length when there is no punctuation to go by", () => {
    /* No rule says how much of this is the edition, so every reading is offered
       and the whole-title match decides which one is a real game. */
    const out = editionFallbacks("Star Wars Outlaws Gold Edition");
    expect(out).toContain("Star Wars Outlaws");
    expect(out[0]).toBe("Star Wars Outlaws Gold");

    expect(editionFallbacks("ELDEN RING Tarnished Edition")).toContain("ELDEN RING");
    expect(editionFallbacks("EA SPORTS FIFA 23 Nintendo Switch Legacy Edition")).toContain(
      "EA SPORTS FIFA 23",
    );
    expect(editionFallbacks("Devil May Cry 5 Devil Hunter Edition")).toContain("Devil May Cry 5");
    expect(editionFallbacks("JUST DANCE 2026 EDITION")).toContain("JUST DANCE 2026");
  });

  it("takes a trailing remaster off", () => {
    expect(editionFallbacks("The Witcher 3: Wild Hunt — Remastered")).toContain(
      "The Witcher 3: Wild Hunt",
    );
  });

  it("offers nothing when there is nothing to strip", () => {
    /* The caller uses an empty list to mean "no second attempt". */
    expect(editionFallbacks("Super Mario Odyssey")).toEqual([]);
    expect(editionFallbacks("Splatoon 3")).toEqual([]);
    expect(editionFallbacks("")).toEqual([]);
  });

  it("never offers an empty title, however short the input", () => {
    expect(editionFallbacks("Edition")).toEqual([]);
    for (const candidate of editionFallbacks("Gold Edition")) expect(candidate).not.toBe("");
  });
});

describe("the request URLs", () => {
  it("searches English items only", () => {
    const url = new URL(searchUrl("Splatoon 3"));
    expect(url.searchParams.get("action")).toBe("wbsearchentities");
    expect(url.searchParams.get("search")).toBe("Splatoon 3");
    expect(url.searchParams.get("type")).toBe("item");
    expect(url.searchParams.get("language")).toBe("en");
  });

  it("asks for both Simplified codes and the generic one", () => {
    const url = new URL(entitiesUrl(["Q1", "Q2"]));
    expect(url.searchParams.get("ids")).toBe("Q1|Q2");
    expect(url.searchParams.get("languages")).toContain("zh-hans");
    expect(url.searchParams.get("languages")).toContain("zh-cn");
    expect(url.searchParams.get("props")).toContain("aliases");
  });
});

describe("isVideoGame", () => {
  it("accepts an item that is an instance of a video game", () => {
    expect(isVideoGame(item({ en: ["Splatoon 3"] }))).toBe(true);
  });

  it("refuses an item with no such claim", () => {
    expect(isVideoGame(item({ en: ["Splatoon 3"], game: false }))).toBe(false);
    expect(isVideoGame({})).toBe(false);
  });

  it("accepts a remaster typed by its platform rather than as a video game", () => {
    /*
      Remasters and editions are routinely typed as `video game remaster` and
      not as `video game`, and those are exactly the products on this shelf.
      The platform claim never decides alone — the title must still match.
    */
    const remaster = {
      labels: { en: { value: "The Witcher 3: Wild Hunt" } },
      claims: { P400: [{ mainsnak: { datavalue: { value: { id: "Q19610114" } } } }] },
    };
    expect(isVideoGame(remaster)).toBe(true);
  });
});

describe("titleMatches", () => {
  const entity = item({ en: ["Pokémon Scarlet and Violet", "Pokemon Scarlet & Violet"] });

  it("matches the label through accents, case and punctuation", () => {
    expect(titleMatches(entity, "pokemon scarlet and violet")).toBe(true);
  });

  it("matches an English alias", () => {
    expect(titleMatches(entity, "Pokemon Scarlet & Violet")).toBe(true);
  });

  it("refuses a title that is only contained in the label", () => {
    /* Two different products; a containment test once wrote one onto the other. */
    expect(titleMatches(entity, "Pokémon Scarlet")).toBe(false);
  });

  it("refuses an empty title", () => {
    expect(titleMatches(entity, "")).toBe(false);
  });

  it("reads both the label and the aliases", () => {
    expect(englishNames(entity)).toEqual([
      "Pokémon Scarlet and Violet",
      "Pokemon Scarlet & Violet",
    ]);
  });
});

describe("chineseLabelOf", () => {
  it("prefers the code that says Simplified", () => {
    const entity = item({ zh: { "zh-hans": "斯普拉遁3", zh: "漆彈大作戰3" } });
    expect(chineseLabelOf(entity)).toEqual({ name: "斯普拉遁3", lang: "zh-hans" });
  });

  it("falls back to zh-cn, then to zh", () => {
    expect(chineseLabelOf(item({ zh: { "zh-cn": "集合啦！动物森友会" } }))?.lang).toBe("zh-cn");
    expect(chineseLabelOf(item({ zh: { zh: "薩爾達傳說" } }))?.lang).toBe("zh");
  });

  it("refuses a label that is not Chinese", () => {
    expect(chineseLabelOf(item({ zh: { "zh-hans": "Splatoon 3" } }))).toBeNull();
    expect(chineseLabelOf(item({}))).toBeNull();
  });
});

describe("pickWikidataName", () => {
  it("returns the name, the item and a URL a person can open", () => {
    const hit = pickWikidataName(
      { Q12345: item({ en: ["Splatoon 3"], zh: { "zh-hans": "斯普拉遁3" } }) },
      "Splatoon 3",
    );
    expect(hit).toEqual({
      name: "斯普拉遁3",
      lang: "zh-hans",
      itemId: "Q12345",
      sourceUrl: "https://www.wikidata.org/wiki/Q12345",
    });
  });

  it("skips an item that is not a game, however well the title matches", () => {
    const entities = {
      Q1: item({ en: ["Stray"], zh: { "zh-hans": "迷失的电影" }, game: false }),
      Q2: item({ en: ["Stray"], zh: { "zh-hans": "迷失" } }),
    };
    expect(pickWikidataName(entities, "Stray")?.itemId).toBe("Q2");
  });

  it("skips a game whose title is merely similar", () => {
    const entities = { Q1: item({ en: ["Hollow Knight: Silksong"], zh: { "zh-hans": "空洞骑士：丝之歌" } }) };
    expect(pickWikidataName(entities, "Hollow Knight")).toBeNull();
  });

  it("returns nothing rather than a guess when no item carries a Chinese label", () => {
    const entities = { Q1: item({ en: ["Rotwood"] }) };
    expect(pickWikidataName(entities, "Rotwood")).toBeNull();
  });
});
