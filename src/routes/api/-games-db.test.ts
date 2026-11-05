/**
 * @vitest-environment node
 */
/**
 * /api/games-db and /api/games-db/<slug>, through their real handlers, over a
 * real SQLite behind the D1 binding.
 *
 * The first thing production will see is the page before the loader has run:
 * no table at all. That has to be an honest «not ready yet» that nothing
 * caches — not a 500, and not a cached «no results» that outlives the load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GamesDbListResponse, GamesDbTitleResponse } from "@/lib/games-db";
import {
  GAMES_DB_PRODUCTS,
  GAMES_DB_SCHEMA,
  writeGamesDbFixture,
} from "@/test/games-db-fixtures";
import { createSqliteD1, PRODUCT_INDEX_SCHEMA, type FakeD1 } from "@/test/sqlite-d1";
import { stampRevisionStatement } from "../../../scripts/lib/games-db-rows.mjs";

const db: FakeD1 = createSqliteD1(PRODUCT_INDEX_SCHEMA);
(globalThis as Record<string, unknown>)["__TEST_GAMES_DB__"] = db;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_GAMES_DB__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

const { edgeCacheUrl, resetGamesDbMemo } = await import("@/lib/games-db.server");
const list = (await import("./games-db")).Route.options.server!.handlers as unknown as {
  GET: (ctx: { request: Request }) => Promise<Response>;
};
const detail = (await import("./games-db.$slug")).Route.options.server!.handlers as unknown as {
  GET: (ctx: { request: Request; params: { slug: string } }) => Promise<Response>;
};

const getList = async (search = "") => {
  const response = await list.GET({ request: new Request(`https://banan.to/api/games-db${search}`) });
  return { response, body: (await response.json()) as GamesDbListResponse };
};
const getTitle = async (slug: string) => {
  const response = await detail.GET({
    request: new Request(`https://banan.to/api/games-db/${slug}`),
    params: { slug },
  });
  return { response, body: (await response.json()) as GamesDbTitleResponse };
};

let loaded = false;
function load() {
  if (loaded) return;
  for (const statement of [...GAMES_DB_SCHEMA, ...GAMES_DB_PRODUCTS]) db.raw.exec(statement);
  writeGamesDbFixture((sql, params) => db.raw.prepare(sql).run(...(params as never[])));
  loaded = true;
}

beforeEach(() => {
  resetGamesDbMemo();
  db.reset();
});

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
  vi.useRealTimers();
});

/**
 * Cloudflare's `caches.default` for one test, as a Map from key URL to what
 * the Worker stored. Node has no `caches`, so every other test builds every
 * answer, as before.
 */
function installEdgeCache() {
  const stored = new Map<string, { body: string; status: number; headers: [string, string][] }>();
  (globalThis as { caches?: unknown }).caches = {
    default: {
      match: async (request: Request) => {
        const hit = stored.get(request.url);
        return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined;
      },
      put: async (request: Request, response: Response) => {
        stored.set(request.url, {
          body: await response.text(),
          status: response.status,
          headers: [...response.headers],
        });
      },
    },
  };
  return stored;
}

/** The loader's own stamp statement, as the end of a load sends it. */
function stamp(revision: string) {
  const { sql, params } = stampRevisionStatement(revision);
  db.raw.prepare(sql).run(...(params as never[]));
}

const META_TABLE = GAMES_DB_SCHEMA.find((statement) => statement.includes("nintendo_titles_meta"))!;

describe("before the loader has run", () => {
  it("says the database is not ready, and lets nothing cache that", async () => {
    const { response, body } = await getList("?q=zelda");
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ready: false, items: [], total: 0 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a title with a 404 that is not cached either", async () => {
    const { response, body } = await getTitle("pokemon-legends-z-a-105");
    expect(response.status).toBe(404);
    expect(body.ready).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("after the load", () => {
  it("serves a page of titles with the genre counts, cacheable at the edge", async () => {
    load();
    const { response, body } = await getList();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    expect(body.ready).toBe(true);
    expect(body.total).toBe(8);
    expect(body.pages).toBe(1);
    // Newest game already out first; the fixture's upcoming one (2044) comes after.
    expect(body.items[0]?.title).toBe("Pokémon™ Legends: Z-A");
    expect(body.genres.find((g) => g.id === "racing")).toEqual({ id: "racing", label: "سباق", count: 2 });
    // One page, the genre counts and the load's revision: three statements.
    expect(db.log).toHaveLength(3);
    // Inside the minute, the next page reads its page and nothing else.
    db.reset();
    await getList("?sort=az");
    expect(db.log).toHaveLength(1);
  });

  it("filters by console, genre and words together", async () => {
    load();
    const { body } = await getList("?platform=switch2&genre=action&q=زيلدا");
    expect(body.items.map((i) => i.title)).toEqual([
      "The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition",
    ]);
    expect(body.total).toBe(1);
  });

  it("is a real, empty answer — not «not ready» — when a search finds nothing", async () => {
    load();
    const { response, body } = await getList("?q=غسالة");
    expect(body).toMatchObject({ ready: true, total: 0, items: [] });
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("links a title the shop sells to its product page, and no other", async () => {
    load();
    const { body } = await getList("?q=zelda");
    const links = Object.fromEntries(body.items.map((i) => [i.title, i.shopPath]));
    expect(links["The Legend of Zelda: Tears of the Kingdom"]).toBe("/product/zelda-totk");
    expect(links["The Legend of Zelda: Tears of the Kingdom – Nintendo Switch™ 2 Edition"]).toBeNull();
  });

  it("returns every fact of one title, and the shop link when there is one", async () => {
    load();
    const totk = await getTitle("the-legend-of-zelda-tears-of-the-kingdom-101");
    expect(totk.response.status).toBe(200);
    expect(totk.body.shopPath).toBe("/product/zelda-totk");
    expect(totk.body.title).toMatchObject({ title: "The Legend of Zelda: Tears of the Kingdom", platform: "switch1" });

    const pokemon = await getTitle("pokemon-legends-z-a-105");
    expect(pokemon.body.shopPath).toBeNull();
    expect(pokemon.body.title?.genres).toEqual(["RPG"]);
  });

  it("answers a missing or malformed address with a 404", async () => {
    load();
    expect((await getTitle("no-such-game-999")).response.status).toBe(404);
    expect((await getTitle("<script>")).response.status).toBe(404);
  });
});

/*
  On 2026-11-05 the first load took six minutes, and the front page cached
  during it (8,800 titles of 20,065) was served for the cache's full hour
  after. The cache is now keyed on the stamp the loader writes when it ends.
*/
describe("the edge cache across a load", () => {
  it("files an answer under the load's revision, and under 0 before any stamp", () => {
    expect(edgeCacheUrl("https://banan.to/api/games-db?q=Zelda", "2026-11-05T03:39:30.000Z", "list?q=zelda")).toBe(
      "https://banan.to/__edge/games-db/v1/2026-11-05T03%3A39%3A30.000Z/list?q=zelda",
    );
    expect(edgeCacheUrl("https://banan.to/api/games-db/x-1", "", "title/x-1")).toBe(
      "https://banan.to/__edge/games-db/v1/0/title/x-1",
    );
  });

  it("never serves what it cached during a load once the load has stamped its revision", async () => {
    load();
    const stored = installEdgeCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T04:00:00Z"));
    stamp("2026-11-05T03:00:00.000Z");
    try {
      const before = await getList();
      expect(before.response.headers.get("x-cache-status")).toBe("fresh");
      expect(before.body.total).toBe(8);

      // A load is under way: a title has landed, the stamp has not.
      db.raw.exec(
        "INSERT INTO nintendo_titles (eu_id, slug, title, norm_title, platform, release_date) " +
          "VALUES ('9001', 'speed-test-9001', 'Speed Test', 'speed test', 'switch1', '2020-01-01')",
      );
      db.raw.exec("INSERT INTO nintendo_title_genres (genre, eu_id) VALUES ('racing', '9001')");
      const during = await getList();
      expect(during.response.headers.get("x-cache-status")).toBe("edge-hit");
      expect(during.body.total).toBe(8);

      // The load ends with its stamp; within the minute every isolate has read it.
      stamp("2026-11-05T04:00:30.000Z");
      vi.setSystemTime(new Date("2026-11-05T04:01:01Z"));
      const after = await getList();
      expect(after.response.headers.get("x-cache-status")).toBe("fresh");
      expect(after.body.total).toBe(9);
      // The genre counts are read again too, not kept for their quarter hour.
      expect(after.body.genres.find((g) => g.id === "racing")?.count).toBe(3);
      expect(stored.size).toBe(2);
    } finally {
      db.raw.exec("DELETE FROM nintendo_titles WHERE eu_id = '9001'");
      db.raw.exec("DELETE FROM nintendo_title_genres WHERE eu_id = '9001'");
      db.raw.exec("DELETE FROM nintendo_titles_meta");
    }
  });

  it("still caches a database loaded before the stamp existed, under revision 0", async () => {
    load();
    const stored = installEdgeCache();
    db.raw.exec("DROP TABLE nintendo_titles_meta");
    try {
      expect((await getList()).response.headers.get("x-cache-status")).toBe("fresh");
      expect((await getList()).response.headers.get("x-cache-status")).toBe("edge-hit");
      expect([...stored.keys()]).toEqual([edgeCacheUrl("https://banan.to/api/games-db", "", "list?")]);
    } finally {
      db.raw.exec(META_TABLE);
    }
  });

  it("answers without the edge cache, rather than under a guessed key, when the stamp cannot be read", async () => {
    load();
    const stored = installEdgeCache();
    db.raw.exec("DROP TABLE nintendo_titles_meta");
    db.raw.exec("CREATE TABLE nintendo_titles_meta (unexpected TEXT)");
    try {
      const { response, body } = await getList();
      expect(response.status).toBe(200);
      expect(body.total).toBe(8);
      expect(response.headers.get("x-cache-status")).toBe("fresh");
      expect(stored.size).toBe(0);
    } finally {
      db.raw.exec("DROP TABLE nintendo_titles_meta");
      db.raw.exec(META_TABLE);
    }
  });
});
