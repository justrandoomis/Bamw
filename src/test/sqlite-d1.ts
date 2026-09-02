/**
 * A real SQLite database behind the D1 binding, for tests.
 *
 * The admin listing is now SQL — pagination, ordering, the folded name key, the
 * indexes. Asserting any of that against a hand-written fake would only prove
 * the fake agrees with itself, so these tests run the statements the Worker
 * runs against `node:sqlite` and read back what SQLite actually returns.
 *
 * It implements the small surface `src/lib/d1.server.ts` uses: `prepare`,
 * `bind`, `all`, `first`, `run` and `batch`. Every statement is counted, which
 * is how the N+1 test can assert that rendering fifty rows costs two queries
 * whatever the catalogue size.
 */

import { DatabaseSync } from "node:sqlite";

export interface FakeD1 {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => ReturnType<FakeD1["prepare"]>;
    all: <T>() => Promise<{ results?: T[] }>;
    first: <T>() => Promise<T | null>;
    run: () => Promise<{ success: boolean; meta: { changes: number } }>;
  };
  batch: (statements: unknown[]) => Promise<unknown[]>;
  /** Every statement executed, newest last. */
  log: string[];
  reset: () => void;
  close: () => void;
  raw: DatabaseSync;
}

const isRead = (sql: string) => /^\s*select/i.test(sql);

/**
 * Cloudflare D1 rejects a statement carrying more than 100 bound parameters.
 *
 * `node:sqlite` is built with SQLITE_MAX_VARIABLE_NUMBER at its default — tens
 * of thousands — so without this the harness happily runs statements D1 will
 * refuse, and a test suite full of green ticks says nothing about production.
 * That is exactly what happened: a 540-parameter INSERT passed here and came
 * back from D1 as `too many SQL variables at offset 488`, which is character
 * offset of the 100th `?`.
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

function enforceD1Limit(sql: string, binds: unknown[]) {
  if (binds.length > D1_MAX_BOUND_PARAMETERS) {
    let seen = 0;
    let offset = 0;
    for (let i = 0; i < sql.length; i++) {
      if (sql[i] === "?" && ++seen === D1_MAX_BOUND_PARAMETERS) {
        offset = i;
        break;
      }
    }
    // The message D1 actually returns, so a test failure reads like the bug.
    throw new Error(`D1_ERROR: too many SQL variables at offset ${offset}: SQLITE_ERROR`);
  }
}

export function createSqliteD1(schema: string[] = []): FakeD1 {
  const db = new DatabaseSync(":memory:");
  const log: string[] = [];

  for (const statement of schema) {
    // The runtime bootstrap ships multi-statement strings; SQLite's exec takes
    // them as they are.
    db.exec(statement);
  }

  const makeStatement = (sql: string, binds: unknown[] = []) => {
    const normalised = binds.map((value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === "boolean") return value ? 1 : 0;
      return value as never;
    });
    const record = () => log.push(sql.replace(/\s+/g, " ").trim());

    const api = {
      bind: (...values: unknown[]) => makeStatement(sql, values),
      all: async <T>() => {
        record();
        enforceD1Limit(sql, normalised);
        return { results: db.prepare(sql).all(...normalised) as T[] };
      },
      first: async <T>() => {
        record();
        enforceD1Limit(sql, normalised);
        const rows = db.prepare(sql).all(...normalised) as T[];
        return rows[0] ?? null;
      },
      run: async () => {
        record();
        enforceD1Limit(sql, normalised);
        const result = db.prepare(sql).run(...normalised);
        return { success: true, meta: { changes: Number(result.changes ?? 0) } };
      },
      /** Read back by the batch runner, which has only the statement objects. */
      _sql: sql,
      _params: normalised,
    };
    return api as unknown as ReturnType<FakeD1["prepare"]>;
  };

  return {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: unknown[]) => {
      const out: unknown[] = [];
      for (const statement of statements) {
        const s = statement as { _sql: string; _params: unknown[] };
        log.push(s._sql.replace(/\s+/g, " ").trim());
        enforceD1Limit(s._sql, s._params);
        const prepared = db.prepare(s._sql);
        if (isRead(s._sql)) out.push({ results: prepared.all(...(s._params as never[])) });
        else out.push({ success: true, meta: { changes: prepared.run(...(s._params as never[])).changes } });
      }
      return out;
    },
    log,
    reset: () => {
      log.length = 0;
    },
    close: () => db.close(),
    raw: db,
  };
}

/** The `product_index` schema exactly as the runtime bootstrap creates it. */
export const PRODUCT_INDEX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS product_index (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     title_en TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL DEFAULT '',
     category_id TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT '',
     schema_id TEXT NOT NULL DEFAULT '',
     platform TEXT NOT NULL DEFAULT '',
     price REAL,
     cost REAL,
     stock INTEGER,
     infinite_stock INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT '',
     sales INTEGER NOT NULL DEFAULT 0,
     image TEXT NOT NULL DEFAULT '',
     display_order INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     release_date TEXT NOT NULL DEFAULT '',
     sort_name TEXT NOT NULL DEFAULT '',
     sort_updated INTEGER,
     sort_release INTEGER,
     sort_rank INTEGER NOT NULL DEFAULT 0,
     performance_required INTEGER NOT NULL DEFAULT 0,
     rev INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pi_updated_desc ON product_index (sort_updated IS NULL, sort_updated DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_updated_asc ON product_index (sort_updated IS NULL, sort_updated, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_price_desc ON product_index (price IS NULL, price DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_price_asc ON product_index (price IS NULL, price, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_name_desc ON product_index (sort_name = '', sort_name DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_name_asc ON product_index (sort_name = '', sort_name, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_rank_desc ON product_index (display_order DESC, sort_rank DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_rank_asc ON product_index (display_order, sort_rank, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_category ON product_index (category_id, display_order DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_hidden ON product_index (hidden, sort_updated DESC)`,
];
