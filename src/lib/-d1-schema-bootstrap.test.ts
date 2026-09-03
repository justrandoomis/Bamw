/**
 * @vitest-environment node
 */
/**
 * What a schema bump costs, and when it is written down.
 *
 * Every D1-backed request in the app waits on `ensureSchema`, so a bump that
 * takes thirty seconds is not a slow boot — it is the shop down for as long as
 * the stamp goes unwritten. Bumping to 24 did exactly that: the site answered
 * DEGRADED, the catalogue read timed out, and it did not recover on its own,
 * because the stamp was the last line of a list nothing lived long enough to
 * finish.
 *
 * These tests are about round trips and ordering, which is what that failure
 * was made of. A round trip to D1 measures around 150 ms, so the count here is
 * a stand-in for wall-clock time.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Trip {
  kind: "batch" | "single";
  sql: string[];
}

/**
 * A D1 that records every round trip and can be told which statements fail.
 *
 * A batch fails as a whole if any statement in it fails — that is what makes
 * the difference between bisecting and serialising visible.
 */
function fakeD1(failing: (sql: string) => boolean = () => false) {
  const trips: Trip[] = [];
  const columnsOf = new Map<string, string[]>();

  const answer = (sql: string) => {
    if (/FROM app_schema_meta/i.test(sql)) return { results: [], first: undefined };
    if (/pragma_table_info/i.test(sql)) {
      const rows: Record<string, string>[] = [];
      for (const [tbl, cols] of columnsOf) for (const col of cols) rows.push({ tbl, col });
      return { results: rows };
    }
    if (/^PRAGMA table_info\((\w+)\)/i.test(sql)) {
      const table = /^PRAGMA table_info\((\w+)\)/i.exec(sql)![1]!;
      return { results: (columnsOf.get(table) ?? []).map((name) => ({ name })) };
    }
    return { results: [] };
  };

  /* `CREATE TABLE name (a TEXT, b INTEGER, ...)` — enough to answer the
     column questions the bootstrap asks about what it has just made. */
  const record = (sql: string) => {
    const m = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)/i.exec(sql);
    if (!m) return;
    const cols = m[2]!
      .split(",")
      .map((part) => /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1] ?? "")
      .filter((name) => name && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(name));
    columnsOf.set(m[1]!, [...new Set([...(columnsOf.get(m[1]!) ?? []), ...cols])]);
  };

  const prepare = (sql: string) => ({
    sql,
    bind: () => prepare(sql),
    run: async () => {
      trips.push({ kind: "single", sql: [sql] });
      if (failing(sql)) throw new Error(`no such column (${sql.slice(0, 40)})`);
      record(sql);
      return { meta: { changes: 0 } };
    },
    all: async () => {
      trips.push({ kind: "single", sql: [sql] });
      return answer(sql);
    },
    first: async () => {
      trips.push({ kind: "single", sql: [sql] });
      return undefined;
    },
  });

  return {
    trips,
    columnsOf,
    db: {
      prepare,
      batch: async (statements: { sql: string }[]) => {
        const sql = statements.map((s) => s.sql);
        trips.push({ kind: "batch", sql });
        const bad = sql.find((s) => failing(s));
        /* A batch is all or nothing: nothing in a failed one took effect. */
        if (bad) throw new Error(`batch failed on ${bad.slice(0, 40)}`);
        for (const one of sql) record(one);
        return sql.map(() => ({ meta: { changes: 0 } }));
      },
    },
  };
}

async function loadWith(db: unknown) {
  vi.resetModules();
  vi.doMock("./env.server", () => ({
    env: () => "",
    getEnv: () => ({ bananto: db }),
    getBinding: () => undefined,
    publishEnv: () => undefined,
    isProductionEnvironment: () => false,
  }));
  return import("./d1.server");
}

beforeEach(() => vi.resetModules());

describe("the bootstrap a schema bump runs", () => {
  it("writes the version stamp before the housekeeping, not after", async () => {
    /*
      The ordering IS the fix. Between "the schema is correct" and "the
      database says so" there used to sit three best-effort maintenance
      queries, a full scan of `orders` among them. An isolate that did not
      survive them left the stamp unwritten, so the next request ran the whole
      bootstrap again — and so did every request after it, for ever.
    */
    const { trips, db } = fakeD1();
    const mod = await loadWith(db);
    await mod.ensureSchema();

    const flat = trips.flatMap((t) => t.sql);
    const stamp = flat.findIndex((s) => /runtime_schema_version/.test(s) && /INSERT/i.test(s));
    const ordersScan = flat.findIndex((s) => /FROM orders/i.test(s) && /LIKE/i.test(s));
    const queueSweep = flat.findIndex((s) => /UPDATE order_queue/i.test(s));

    expect(stamp).toBeGreaterThan(-1);
    expect(ordersScan).toBeGreaterThan(-1);
    expect(queueSweep).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(ordersScan);
    expect(stamp).toBeLessThan(queueSweep);
  });

  it("asks for every table's columns once, not once per table", async () => {
    /*
      `SCHEMA_PATCHES` names twenty-nine tables, and deciding whether each
      patch was needed used to cost a `PRAGMA table_info` per table — 
      twenty-nine round trips before a single `ALTER` could be ruled in or out.
    */
    const { trips, db } = fakeD1();
    const mod = await loadWith(db);
    await mod.ensureSchema();

    const flat = trips.flatMap((t) => t.sql);
    expect(flat.filter((s) => /pragma_table_info/i.test(s))).toHaveLength(1);

    /*
      A few tables are still asked for one at a time, and rightly so: the four
      `retireLegacyTables` inspects run before the schema exists to be asked
      about, and five tables named by a patch are not created by `SCHEMA` at
      all, so the single answer has nothing to say about them. What matters is
      that this is a handful rather than one per table.
    */
    const perTable = flat.filter((s) => /^PRAGMA table_info/i.test(s.trim()));
    expect(perTable.length).toBeLessThan(12);
  });

  it("bisects around a statement the database refuses, instead of serialising", async () => {
    /*
      A production database keeps legacy tables, and an index in the base
      schema can name a column one of them has never had. That statement
      fails, is meant to fail, and is tolerated — but it used to take its
      whole chunk of forty down to one-at-a-time with it.
    */
    const failing = (sql: string) => /orders_user_idx/i.test(sql);
    const { trips, db } = fakeD1(failing);
    const mod = await loadWith(db);
    await mod.ensureSchema();

    /* The offending statement still ran on its own, so the tolerance is intact. */
    const singles = trips.filter((t) => t.kind === "single" && failing(t.sql[0]!));
    expect(singles.length).toBeGreaterThan(0);

    /* But the chunk it lived in was halved, not unrolled: a chunk of forty
       unrolled would put forty of its siblings on separate trips. */
    const chunkMates = trips.filter(
      (t) => t.kind === "single" && /^CREATE (TABLE|INDEX|UNIQUE)/i.test(t.sql[0]!.trim()),
    );
    expect(chunkMates.length).toBeLessThan(10);
  });

  it("costs a bounded number of round trips", async () => {
    /*
      Counted, not estimated. Against this same fake the bootstrap as it stood
      when the site went down took 133 round trips; it takes 59 now. At the
      145 ms round trip `/api/health` measured in production that is 19.3 s
      against 8.6 s — and the 19.3 s bought nothing, because the stamp that
      ends it came only after three unbounded scans of the orders table.

      The bound is loose on purpose. It is here to fail if the batching or the
      bisection is undone, not to police a handful of statements.
    */
    const { trips, db } = fakeD1((sql) => /orders_user_idx|users_referred_by_idx/i.test(sql));
    const mod = await loadWith(db);
    await mod.ensureSchema();
    expect(trips.length).toBeLessThan(80);
  });

  it("does not run the bump twice when two callers arrive together", async () => {
    /* Both get the same promise; the work happens once. */
    const { trips, db } = fakeD1();
    const mod = await loadWith(db);
    await Promise.all([mod.ensureSchema(), mod.ensureSchema(), mod.ensureSchema()]);

    const stamps = trips
      .flatMap((t) => t.sql)
      .filter((s) => /runtime_schema_version/.test(s) && /INSERT/i.test(s));
    expect(stamps).toHaveLength(1);
  });
});
