/**
 * Eight Nintendo titles and two shop products, written into a real SQLite with
 * the games database loader's own statements — the fixture both the search
 * test and the API test read back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  insertGenresStatement,
  migrationStatements,
  pruneGenresStatement,
  rowsFor,
  upsertTitlesStatement,
} from "../../scripts/lib/games-db-rows.mjs";

export const GAMES_DB_MIGRATION = readFileSync(
  path.resolve("migrations/20261105_nintendo_titles.sql"),
  "utf8",
);

/** The migration as single statements, the way the loader runs it. */
export const GAMES_DB_SCHEMA: string[] = migrationStatements(GAMES_DB_MIGRATION);

/** A title as `toFacts` (scripts/lib/nintendo-eu-index.mjs) hands it to the loader. */
export function facts(over: Record<string, unknown> = {}) {
  return {
    euId: "1",
    euUrl: "https://www.nintendo.com/en-gb/Games/x-1.html",
    title: "Game",
    platform: "switch1",
    nsuid: "",
    productCode: "",
    releaseDate: "2020-01-01",
    publisher: "Nintendo",
    developer: "",
    description: "A game.",
    genres: ["Action"],
    ageRating: "PEGI 7",
    numberOfPlayers: "1-4",
    supportedLanguages: "English, Japanese",
    size: "5.0 GB",
    physical: true,
    digital: true,
    delisted: false,
    series: [],
    images: {
      frontBox: "https://www.nintendo.com/eu/media/images/05_packshots/box.jpg",
      square: "https://www.nintendo.com/eu/media/images/sq.jpg",
      wide: "https://www.nintendo.com/eu/media/images/wide.jpg",
    },
    ...over,
  };
}

export const GAMES_DB_FIXTURE = [
  facts({
    euId: "101",
    title: "The Legend of Zelda: Tears of the Kingdom",
    releaseDate: "2023-05-12",
    genres: ["Action", "Adventure"],
  }),
  facts({
    euId: "102",
    title: "The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition",
    platform: "switch2",
    releaseDate: "2025-06-05",
    genres: ["Action", "Adventure"],
  }),
  facts({ euId: "103", title: "Mario Kart World", platform: "switch2", releaseDate: "2025-06-05", genres: ["Racing"] }),
  facts({ euId: "104", title: "Mario Kart™ 8 Deluxe", releaseDate: "2017-04-28", genres: ["Racing", "Party"] }),
  facts({ euId: "105", title: "Pokémon™ Legends: Z-A", platform: "both", releaseDate: "2025-10-16", genres: ["RPG"] }),
  // A made-up game, dated far enough ahead to stay «upcoming» for as long as these tests run.
  facts({ euId: "106", title: "Lumen Drift: Origins", releaseDate: "2044-06-01", genres: ["Action", "Platformer"] }),
  facts({ euId: "107", title: "An Unannounced Puzzle", releaseDate: "2050-12-31", genres: ["Puzzle"] }),
  facts({ euId: "108", title: "Super Mario Odyssey", releaseDate: "2017-10-27", genres: ["Platformer"] }),
];

/** The shop sells TOTK (still live) and Mario Kart World (hidden since the load). */
export const GAMES_DB_LINKS = new Map([
  ["101", { productId: "prd_totk", how: "store-link" }],
  ["103", { productId: "prd_mkw", how: "nsuid" }],
]);

/** Run after PRODUCT_INDEX_SCHEMA (src/test/sqlite-d1.ts). */
export const GAMES_DB_PRODUCTS = [
  `INSERT INTO product_index (id, slug, title, price, hidden, status) VALUES ('prd_totk', 'zelda-totk', 'TOTK', 50000, 0, '')`,
  `INSERT INTO product_index (id, slug, title, price, hidden, status) VALUES ('prd_mkw', 'mario-kart-world', 'MKW', 60000, 1, '')`,
];

/** The loader's three statements for one batch, in the loader's order. */
export function writeGamesDbFixture(run: (sql: string, params: unknown[]) => unknown) {
  const rows = rowsFor(GAMES_DB_FIXTURE, GAMES_DB_LINKS, "2026-11-05T00:00:00.000Z");
  for (const statement of [insertGenresStatement(rows), pruneGenresStatement(rows), upsertTitlesStatement(rows)]) {
    run(statement.sql, statement.params);
  }
}
