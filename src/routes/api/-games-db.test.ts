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
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GamesDbListResponse, GamesDbTitleResponse } from "@/lib/games-db";
import {
  GAMES_DB_PRODUCTS,
  GAMES_DB_SCHEMA,
  writeGamesDbFixture,
} from "@/test/games-db-fixtures";
import { createSqliteD1, PRODUCT_INDEX_SCHEMA, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1(PRODUCT_INDEX_SCHEMA);
(globalThis as Record<string, unknown>)["__TEST_GAMES_DB__"] = db;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_GAMES_DB__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

const { resetGamesDbMemo } = await import("@/lib/games-db.server");
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
    expect(body.items[0]?.title).toBe("Hollow Knight: Silksong");
    expect(body.genres.find((g) => g.id === "racing")).toEqual({ id: "racing", label: "سباق", count: 2 });
    // One page, the genre counts and nothing else: two statements.
    expect(db.log).toHaveLength(2);
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
