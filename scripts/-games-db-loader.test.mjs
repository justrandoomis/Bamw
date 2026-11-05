/**
 * The games database loader, run against a real SQLite.
 *
 * The rows reach production as one JSON parameter per batch, unpacked by
 * `json_each` — a shape nothing else in this repository writes — so these
 * tests execute the very statements the loader sends and read back what SQLite
 * stored, rather than asserting on strings. `node:sqlite` is what the rest of
 * the suite uses for the same reason (see `src/test/sqlite-d1.ts`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  BATCH_ROWS,
  COLUMNS,
  chunk,
  contentHash,
  genrePairs,
  insertGenresStatement,
  linkShopProducts,
  migrationStatements,
  planWrites,
  pruneGenresStatement,
  rowsFor,
  stampRevisionStatement,
  toRow,
  upsertTitlesStatement,
} from "./lib/games-db-rows.mjs";
import { toFacts } from "./lib/nintendo-eu-index.mjs";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../migrations/20261105_nintendo_titles.sql", import.meta.url)),
  "utf8",
);
const LOADED_AT = "2026-11-05T00:00:00.000Z";

/** A Nintendo Europe index document, shaped like the live API's. */
const doc = (over = {}) => ({
  fs_id: "2895344",
  url: "/en-gb/Games/Nintendo-Switch-download-software/Decluttering-Journey-2895344.html",
  title: "Decluttering Journey™",
  dates_released_dts: ["2025-08-14T00:00:00Z"],
  publisher: "Lunaria Games",
  product_catalog_description_s: "Let go of what you don’t need.",
  nsuid_txt: ["70010000102274"],
  language_availability: ["japanese, english"],
  players_to: 1,
  playable_on_txt: ["HAC"],
  pretty_game_categories_txt: ["Education", "Lifestyle"],
  pretty_agerating_s: "PEGI 3",
  datasize_readable_txt: ["220.0 MB"],
  image_url_sq_s: "https://www.nintendo.com/eu/media/images/assets/sq.jpg",
  image_url_h2x1_s: "https://www.nintendo.com/eu/media/images/assets/wide.jpg",
  image_url: "https://www.nintendo.com/eu/media/images/05_packshots/box.jpg",
  physical_version_b: false,
  digital_version_b: true,
  eshop_removed_b: false,
  ...over,
});

function database() {
  const db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements(MIGRATION)) db.exec(statement);
  return db;
}

/** Runs one loader statement the way D1 would: SQL plus positional params. */
const run = (db, { sql, params }) => {
  // D1 refuses more than 100 bound parameters; a batch must never come close.
  expect(params.length).toBeLessThanOrEqual(2);
  return db.prepare(sql).run(...params);
};

/** One batch, in the loader's order: genres in, stale genres out, titles last. */
const writeBatch = (db, rows) => {
  run(db, insertGenresStatement(rows));
  run(db, pruneGenresStatement(rows));
  run(db, upsertTitlesStatement(rows));
};

describe("the migration", () => {
  it("splits into the table, its indexes, the genre table and the stamp table, with every comment gone", () => {
    const statements = migrationStatements(MIGRATION);
    expect(statements).toHaveLength(7);
    expect(statements.every((s) => /IF NOT EXISTS/.test(s))).toBe(true);
    expect(statements.some((s) => s.includes("--"))).toBe(false);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS nintendo_titles/);
  });

  it("runs twice without complaint, because the loader runs it before every write", () => {
    const db = database();
    for (const statement of migrationStatements(MIGRATION)) db.exec(statement);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(["nintendo_title_genres", "nintendo_titles", "nintendo_titles_meta"]);
  });

  it("names every column the loader writes", () => {
    const db = database();
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('nintendo_titles')")
      .all()
      .map((r) => r.name);
    expect(columns).toEqual(COLUMNS);
  });
});

describe("a Nintendo title as a row", () => {
  it("keeps Nintendo's facts, each picture in its own role, and an address that ends in the id", () => {
    const row = toRow(toFacts(doc()), undefined, LOADED_AT);
    expect(row.eu_id).toBe("2895344");
    expect(row.slug).toBe("decluttering-journey-2895344");
    expect(row.norm_title).toBe("decluttering journey");
    expect(row.platform).toBe("switch1");
    expect(row.release_date).toBe("2025-08-14");
    expect(JSON.parse(row.genres)).toEqual(["Education", "Lifestyle"]);
    expect(row.image_box).toContain("/05_packshots/");
    expect(row.image_square).toContain("sq.jpg");
    expect(row.image_wide).toContain("wide.jpg");
    expect(row.languages).toBe("Japanese, English");
    expect(row.shop_product_id).toBe("");
    // Never a null: the JSON round trip must give back exactly what was sent.
    expect(COLUMNS.every((c) => row[c] !== null && row[c] !== undefined)).toBe(true);
  });

  it("stores Nintendo's 2050-12-31 «not announced» as no date, and keeps a real upcoming one", () => {
    const at = (date) => toRow(toFacts(doc({ dates_released_dts: [date] })), undefined, LOADED_AT);
    expect(at("2050-12-31T00:00:00Z").release_date).toBe("");
    expect(at("2027-03-01T00:00:00Z").release_date).toBe("2027-03-01");
  });

  it("reads Switch 2 and both-console titles from Nintendo's console codes", () => {
    expect(toRow(toFacts(doc({ playable_on_txt: ["BEE"] })), undefined, LOADED_AT).platform).toBe("switch2");
    expect(toRow(toFacts(doc({ playable_on_txt: ["HAC", "BEE"] })), undefined, LOADED_AT).platform).toBe("both");
  });

  it("drops a title it cannot key, and keeps the later copy of a title listed twice", () => {
    const rows = rowsFor(
      [
        toFacts(doc({ fs_id: "", title: "No id" })),
        toFacts(doc({ title: "" })),
        toFacts(doc({ publisher: "First" })),
        toFacts(doc({ publisher: "Second" })),
      ],
      new Map(),
      LOADED_AT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].publisher).toBe("Second");
  });

  it("changes its digest when a fact changes, and not when only the load time does", () => {
    const a = toRow(toFacts(doc()), undefined, LOADED_AT);
    const b = toRow(toFacts(doc()), undefined, "2027-01-01T00:00:00.000Z");
    const c = toRow(toFacts(doc({ publisher: "Someone else" })), undefined, LOADED_AT);
    const linked = toRow(toFacts(doc()), { productId: "prd_1", how: "nsuid" }, LOADED_AT);
    expect(a.content_hash).toBe(b.content_hash);
    expect(a.content_hash).not.toBe(c.content_hash);
    // A new link to the shop is a change worth writing.
    expect(a.content_hash).not.toBe(linked.content_hash);
    expect(contentHash(a)).toBe(a.content_hash);
  });
});

describe("which product a title links to", () => {
  const index = [
    toFacts(doc()),
    toFacts(doc({ fs_id: "111", title: "Twin Game", url: "/en-gb/Games/a-111.html", nsuid_txt: ["1"] })),
    toFacts(doc({ fs_id: "222", title: "Twin Game", url: "/en-gb/Games/b-222.html", nsuid_txt: ["2"] })),
  ];

  it("prefers the product's own store link, then its nsuid, then a title only one game has", () => {
    const links = linkShopProducts(index, [
      { id: "by-title", title: "Decluttering Journey", platform: "switch1" },
      { id: "by-link", title: "x", officialStoreUrl: `https://www.nintendo.com${doc().url}` },
      { id: "by-nsuid", title: "y", nsuid: "70010000102274" },
    ]);
    expect(links.get("2895344")).toEqual({ productId: "by-link", how: "store-link" });
  });

  it("links nothing on a title two games share, and nothing the shop cannot sell", () => {
    const links = linkShopProducts(
      index,
      [
        { id: "ambiguous", title: "Twin Game", platform: "switch1" },
        { id: "hidden", title: "Decluttering Journey", platform: "switch1", hidden: true },
      ],
      { isSellable: (p) => !p.hidden },
    );
    expect(links.size).toBe(0);
  });
});

describe("writing the rows", () => {
  const rows = rowsFor(
    Array.from({ length: 250 }, (_, i) =>
      toFacts(
        doc({
          fs_id: String(1000 + i),
          title: `Game ${i}`,
          pretty_game_categories_txt: i % 2 ? ["Action", "Puzzle"] : ["Role-Playing"],
        }),
      ),
    ),
    new Map(),
    LOADED_AT,
  );

  it("writes a batch of a hundred titles as one parameter, and reads back what it sent", () => {
    const db = database();
    expect(BATCH_ROWS).toBe(100);
    for (const batch of chunk(rows)) writeBatch(db, batch);
    expect(db.prepare("SELECT COUNT(*) AS n FROM nintendo_titles").get().n).toBe(250);
    const stored = db.prepare("SELECT * FROM nintendo_titles WHERE eu_id = '1001'").get();
    const sent = rows.find((r) => r.eu_id === "1001");
    for (const column of COLUMNS) expect(stored[column]).toBe(sent[column]);
    expect(
      db
        .prepare("SELECT genre, COUNT(*) AS n FROM nintendo_title_genres GROUP BY genre ORDER BY genre")
        .all()
        .map((r) => [r.genre, r.n]),
    ).toEqual([
      ["action", 125],
      ["puzzle", 125],
      ["role-playing", 125],
    ]);
  });

  it("can be run again: nothing doubles, and a title's dropped genre is removed", () => {
    const db = database();
    for (const batch of chunk(rows)) writeBatch(db, batch);
    const changed = rows.map((row) =>
      row.eu_id === "1001" ? { ...row, genres: JSON.stringify(["Action"]) } : row,
    );
    for (const batch of chunk(changed)) writeBatch(db, batch);
    expect(db.prepare("SELECT COUNT(*) AS n FROM nintendo_titles").get().n).toBe(250);
    expect(
      db
        .prepare("SELECT genre FROM nintendo_title_genres WHERE eu_id = '1001'")
        .all()
        .map((r) => r.genre),
    ).toEqual(["action"]);
  });

  it("writes on the second load only what changed, and never deletes a title Nintendo dropped", () => {
    const existing = new Map(rows.map((row) => [row.eu_id, row.content_hash]));
    existing.set("999999", "gone-from-nintendo");
    const next = rows.map((row, i) => (i < 3 ? { ...row, content_hash: `new-${i}` } : row));
    next.push({ ...rows[0], eu_id: "5000", content_hash: "fresh" });
    const plan = planWrites(next, existing);
    expect(plan.toWrite).toHaveLength(4);
    expect([plan.fresh, plan.changed, plan.unchanged, plan.notInIndex]).toEqual([1, 3, 247, 1]);
  });

  it("names each genre once per title", () => {
    const row = toRow(
      toFacts(doc({ pretty_game_categories_txt: ["Action", "action", "ACTION", "Board game"] })),
      undefined,
      LOADED_AT,
    );
    expect(genrePairs([row])).toEqual([
      ["action", "2895344"],
      ["board-game", "2895344"],
    ]);
  });
});

describe("the load's stamp", () => {
  it("is one row, which every finished load replaces with its own time", () => {
    const db = database();
    run(db, stampRevisionStatement(LOADED_AT));
    run(db, stampRevisionStatement("2026-11-06T01:00:00.000Z"));
    expect(db.prepare("SELECT key, value FROM nintendo_titles_meta").all()).toEqual([
      { key: "revision", value: "2026-11-06T01:00:00.000Z" },
    ]);
  });
});
