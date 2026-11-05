/**
 * @vitest-environment node
 */
/**
 * The games database's search, against a real SQLite holding rows the loader
 * itself wrote.
 *
 * The loader folds a title once, when it writes it; the API folds the query on
 * every request. If the two ever disagreed, every search would quietly find
 * nothing — so these tests write rows with the loader's own statements
 * (`scripts/lib/games-db-rows.mjs`) and search them with the API's own
 * statements (`games-db.sql.ts`), and nothing in between is a stand-in.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  GAMES_DB_MAX_TOKENS,
  GAMES_DB_PAGE_SIZE,
  euIdFromSlug,
  foldTitle,
  gamesDbSearchString,
  parseGamesDbQuery,
  queryTokens,
  slugFor,
  type GamesDbQuery,
} from "./games-db";
import {
  countStatement,
  facetsStatement,
  listStatement,
  titleStatement,
  toFacets,
  toListItem,
  toTitle,
  type GamesDbStatement,
} from "./games-db.sql";
import {
  GAMES_DB_FIXTURE,
  GAMES_DB_PRODUCTS,
  GAMES_DB_SCHEMA,
  writeGamesDbFixture,
} from "@/test/games-db-fixtures";
import { PRODUCT_INDEX_SCHEMA } from "@/test/sqlite-d1";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const statement of [...PRODUCT_INDEX_SCHEMA, ...GAMES_DB_SCHEMA, ...GAMES_DB_PRODUCTS]) {
    db.exec(statement);
  }
  writeGamesDbFixture((sql, params) => db.prepare(sql).run(...(params as never[])));
  return db;
}

const query = (over: Partial<GamesDbQuery> = {}): GamesDbQuery => ({
  ...parseGamesDbQuery({}),
  ...over,
  tokens: queryTokens(over.q ?? ""),
});

function rows(db: DatabaseSync, statement: GamesDbStatement) {
  // What D1 would refuse, refused here too.
  expect(statement.binds.length).toBeLessThanOrEqual(100);
  return db.prepare(statement.sql).all(...(statement.binds as never[])) as Record<string, unknown>[];
}

/** A fixed day, so «released» and «upcoming» do not move as the calendar does. */
const TODAY = "2026-11-05";

const titles = (db: DatabaseSync, q: GamesDbQuery) =>
  rows(db, listStatement(q, TODAY)).map((r) => String(r["title"]));

describe("a query, as the words every result must contain", () => {
  it("turns the Arabic names people type into Nintendo's English ones", () => {
    expect(queryTokens("زيلدا")).toEqual(["zelda"]);
    expect(queryTokens("ماريو كارت")).toEqual(["mario", "kart"]);
    expect(queryTokens("ماين كرافت")).toEqual(["minecraft"]);
  });

  it("drops the console and the word «game», and an unknown Arabic word beside a known one", () => {
    expect(queryTokens("لعبة زيلدا الجديدة")).toEqual(["zelda"]);
    expect(queryTokens("the legend of zelda")).toEqual(["legend", "zelda"]);
    expect(queryTokens("سويتش ماريو")).toEqual(["mario"]);
  });

  it("keeps an Arabic word it cannot translate when it is all there is, so it finds nothing", () => {
    expect(queryTokens("غسالة")).toEqual(["غساله"]);
  });

  it("folds accents, trademark signs and apostrophes the way the stored title was folded", () => {
    expect(queryTokens("Pokémon™ Legends")).toEqual(["pokemon", "legends"]);
    expect(queryTokens("luigi's mansion")).toEqual(["luigi", "mansion"]);
    expect(queryTokens("mario kart 8")).toEqual(["mario", "kart", "8"]);
    expect(foldTitle("Pokémon™ Legends: Z-A")).toBe("pokemon legends z a");
  });

  it("caps the words, so the parameter count is fixed in the source", () => {
    expect(queryTokens("one two three four five six seven eight nine")).toHaveLength(GAMES_DB_MAX_TOKENS);
  });
});

describe("a request's filters", () => {
  it("falls back to the default for anything it does not recognise", () => {
    const parsed = parseGamesDbQuery(new URLSearchParams("platform=wii&page=-3&sort=price&genre=Board%20game"));
    expect(parsed).toMatchObject({ platform: "", page: 1, sort: "new", genre: "board-game" });
    expect(parseGamesDbQuery({ sort: "soon" }).sort).toBe("soon");
    expect(parseGamesDbQuery({ page: "99999" }).page).toBe(1000);
    expect(parseGamesDbQuery({ q: `  ${"z".repeat(200)}  ` }).q).toHaveLength(80);
  });

  it("spells one question one way, which is what the edge cache is keyed on", () => {
    expect(
      gamesDbSearchString(parseGamesDbQuery({ sort: "az", q: "zelda", platform: "switch2", page: "2", genre: "action" })),
    ).toBe("genre=action&page=2&platform=switch2&q=zelda&sort=az");
    expect(gamesDbSearchString(parseGamesDbQuery({ page: "1", sort: "new" }))).toBe("");
    expect(
      gamesDbSearchString(parseGamesDbQuery({ sort: "popular", shopGenre: "RPG", shop: "exclude", platform: "switch1" })),
    ).toBe("platform=switch1&shop=exclude&shopGenre=rpg&sort=popular");
    // Only the one value «shop» has, and only a genre id's shape.
    expect(parseGamesDbQuery({ shop: "include", shopGenre: "rpg' OR 1=1" })).toMatchObject({ shop: "", shopGenre: "" });
  });

  it("gives every title an address ending in its id, which survives a rename", () => {
    expect(slugFor("Pokémon™ Legends: Z-A", "105")).toBe("pokemon-legends-z-a-105");
    expect(slugFor("ゼルダ", "9")).toBe("game-9");
    expect(euIdFromSlug("pokemon-legends-z-a-105")).toBe("105");
  });
});

describe("the list", () => {
  it("opens on the newest game already out, with the ones still to come after, and no date last", () => {
    const db = database();
    const all = titles(db, query());
    expect(all[0]).toBe("Pokémon™ Legends: Z-A");
    expect(all.at(-2)).toBe("Lumen Drift: Origins");
    expect(all.at(-1)).toBe("An Unannounced Puzzle");
  });

  it("lists under «soon» only the games still to come — not the ones with no date", () => {
    const db = database();
    expect(titles(db, query({ sort: "soon" }))).toEqual(["Lumen Drift: Origins"]);
    expect(rows(db, countStatement(query({ sort: "soon", page: 2 }), TODAY))[0]?.["n"]).toBe(1);
  });

  it("counts the whole filtered set on the page's own rows", () => {
    const db = database();
    const page = rows(db, listStatement(query({ genre: "racing" }), TODAY));
    expect(page.map((r) => r["title"])).toEqual(["Mario Kart World", "Mario Kart™ 8 Deluxe"]);
    expect(page.every((r) => r["total_rows"] === 2)).toBe(true);
  });

  it("shows under «Switch 2» what runs on Switch 2, both-console titles included", () => {
    const db = database();
    expect(titles(db, query({ platform: "switch2" })).sort()).toEqual([
      "Mario Kart World",
      "Pokémon™ Legends: Z-A",
      "The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition",
    ]);
  });

  it("finds a game by its English name, its Arabic name, or a word inside it", () => {
    const db = database();
    expect(titles(db, query({ q: "zelda" }))).toHaveLength(2);
    expect(titles(db, query({ q: "زيلدا" }))).toHaveLength(2);
    expect(titles(db, query({ q: "lumen" }))).toEqual(["Lumen Drift: Origins"]);
    expect(titles(db, query({ q: "غسالة" }))).toEqual([]);
  });

  it("puts a title that starts with the query before one that merely contains it", () => {
    const db = database();
    expect(titles(db, query({ q: "mario" }))).toEqual([
      "Mario Kart World",
      "Mario Golf: Super Rush",
      "Mario Kart™ 8 Deluxe",
      "Super Mario Odyssey",
    ]);
  });

  it("goes A to Z when asked", () => {
    const db = database();
    expect(titles(db, query({ sort: "az" })).slice(0, 2)).toEqual(["An Unannounced Puzzle", "Lumen Drift: Origins"]);
  });

  it("links a title to the shop only while its product is live", () => {
    const db = database();
    const items = rows(db, listStatement(query({ q: "zelda tears" }), TODAY))
      .concat(rows(db, listStatement(query({ q: "mario kart world" }), TODAY)))
      .map(toListItem);
    const byTitle = Object.fromEntries(items.map((item) => [item.title, item.shopPath]));
    expect(byTitle["The Legend of Zelda: Tears of the Kingdom"]).toBe("/product/zelda-totk");
    // The Switch 2 Edition is a different game, and the shop does not sell it.
    expect(byTitle["The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition"]).toBeNull();
    // Mario Kart World's product was hidden after the load: no link to a page that cannot sell it.
    expect(byTitle["Mario Kart World"]).toBeNull();
  });

  it("answers a page past the end with nothing, and the count from its own statement", () => {
    const db = database();
    expect(rows(db, listStatement(query({ page: 2 }), TODAY))).toEqual([]);
    expect(rows(db, countStatement(query({ page: 2 }), TODAY))[0]?.["n"]).toBe(GAMES_DB_FIXTURE.length);
    expect(GAMES_DB_PAGE_SIZE).toBe(24);
  });

  it("stays far inside D1's parameter limit with every filter at once", () => {
    for (const sort of ["new", "soon", "az"] as const) {
      const busiest = listStatement(
        query({ platform: "switch2", genre: "action", q: "a b c d e f g h i j k l", page: 3, sort }),
        TODAY,
      );
      // Console 2, genre 1, «soon» 1, words, relevance 3, release order 1, page 2.
      expect(busiest.binds.length).toBeLessThanOrEqual(2 + 1 + 1 + GAMES_DB_MAX_TOKENS + 3 + 1 + 2);
    }
  });

  it("leaves out, for the games shelf, every title the shop sells live", () => {
    const db = database();
    const rest = titles(db, query({ shop: "exclude", q: "zelda tears" }));
    // TOTK is the shop's (live product): it is on the shelf above, not here.
    expect(rest).toEqual(["The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition"]);
    // Mario Kart World's product is hidden, so the title is not «the shop's» and stays.
    expect(titles(db, query({ shop: "exclude", q: "mario kart world" }))).toEqual(["Mario Kart World"]);
    expect(rows(db, countStatement(query({ shop: "exclude", page: 9 }), TODAY))[0]?.["n"]).toBe(
      GAMES_DB_FIXTURE.length - 1,
    );
  });

  it("filters by the Nintendo genres a shop genre gathers, and by none when it gathers none", () => {
    const db = database();
    const sports = rows(db, listStatement(query(), TODAY, { genreIds: ["sports", "golf"] })).map((r) => r["title"]);
    expect(sports).toEqual(["Mario Golf: Super Rush"]);
    expect(rows(db, listStatement(query(), TODAY, { genreIds: [] }))).toEqual([]);
    const count = rows(db, countStatement(query({ page: 5 }), TODAY, { genreIds: ["racing", "party"] }))[0]?.["n"];
    expect(count).toBe(2);
  });

  it("orders «popular» by Nintendo's downloads rank, then the unranked by «new»", () => {
    const db = database();
    const popular = titles(db, query({ sort: "popular" }));
    expect(popular.slice(0, 3)).toEqual(["Mario Kart™ 8 Deluxe", "Super Mario Odyssey", "Mario Kart World"]);
    // The unranked follow in the «new» order: Pokémon (2025-10-16) first.
    expect(popular[3]).toBe("Pokémon™ Legends: Z-A");
    // Without the details table (before the first load that writes it), «popular» is «new».
    const statement = listStatement(query({ sort: "popular" }), TODAY, { details: false });
    expect(statement.sql).not.toContain("nintendo_title_details");
    expect(rows(db, statement).map((r) => r["title"])).toEqual(titles(db, query()));
  });

  it("names the genres in Arabic, largest first", () => {
    const db = database();
    const facets = toFacets(rows(db, facetsStatement()));
    expect(facets[0]).toEqual({ id: "action", label: "أكشن", count: 3 });
    expect(facets.find((f) => f.id === "rpg")?.label).toBe("آر بي جي");
  });
});

describe("one title", () => {
  it("comes back with every fact, by its address or by the id an old address ends in", () => {
    const db = database();
    const [row] = rows(db, titleStatement("pokemon-legends-z-a-105"));
    const title = toTitle(row!);
    expect(title).toMatchObject({
      euId: "105",
      platform: "both",
      genres: ["RPG"],
      languages: ["English", "Japanese"],
      physical: true,
    });
    expect(title.images.box).toContain("/05_packshots/");
    const [renamed] = rows(db, titleStatement("pokemon-legends-old-name-105"));
    expect(renamed?.["eu_id"]).toBe("105");
    expect(rows(db, titleStatement("no-such-game-999"))).toEqual([]);
  });

  it("carries no date for Nintendo's «not announced» placeholder", () => {
    const db = database();
    const [row] = rows(db, titleStatement(slugFor("An Unannounced Puzzle", "107")));
    expect(toTitle(row!).releaseDate).toBe("");
  });

  it("carries the rest of Nintendo's facts — and only the ones Nintendo states", () => {
    const db = database();
    const mkw = toTitle(rows(db, titleStatement(slugFor("Mario Kart World", "103")))[0]!);
    expect(mkw.downloadsRank).toBe(3);
    expect(mkw.details).toMatchObject({
      modes: ["tv", "tabletop", "handheld"],
      localPlayers: "2-8",
      onlinePlayers: "2-24",
      nintendoSwitchOnline: true,
      cloudSaves: true,
      // Stated false by Nintendo, and false here: a flag is only ever «said».
      internetRequired: false,
      image16x9: "https://www.nintendo.com/eu/media/images/16x9.png",
    });
    const plain = toTitle(rows(db, titleStatement(slugFor("Super Mario Odyssey", "108")))[0]!);
    expect(plain.details).toMatchObject({ modes: [], localPlayers: "", nintendoSwitchOnline: false });
    // Read without the details table, a title is still whole.
    const bare = toTitle(rows(db, titleStatement(slugFor("Super Mario Odyssey", "108"), { details: false }))[0]!);
    expect(bare).toMatchObject({ title: "Super Mario Odyssey", downloadsRank: 0 });
  });
});
