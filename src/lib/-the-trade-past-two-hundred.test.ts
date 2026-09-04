/**
 * @vitest-environment node
 *
 * Needs the real `node:sqlite`, which the default jsdom environment cannot load.
 *
 * The admin's trade list asked for `LIMIT 200` and offered no next page, and
 * the screen filtered those two hundred rows in the browser. A shop past two
 * hundred trades could not reach the older ones at all — and a trade nobody
 * can open is a trade nobody can price, with a customer waiting on the other
 * end of it.
 *
 * The behaviour under test *is* the SQL, so these run the statements the
 * Worker runs against a real database with 250 rows in it. A hand-written fake
 * would only prove the fake agrees with itself.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MAX_PAGE_SIZE,
  adminTradePageQuery,
  cursorOf,
  pageSize,
  parseCursor,
  takePage,
} from "./disc-trade-page";

const db = new DatabaseSync(":memory:");

/** 250 trades — past the old cap — with a deliberate timestamp collision. */
const TOTAL = 250;

beforeAll(() => {
  db.exec(`CREATE TABLE disc_trades (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    game_name TEXT,
    platform TEXT,
    status TEXT,
    created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(
    `INSERT INTO disc_trades (id, user_id, game_name, platform, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < TOTAL; i++) {
    /*
      Two trades share the 100th second exactly. Somebody submitting two discs
      in one sitting is the ordinary case, not a contrived one, and a cursor
      that keys on the timestamp alone either skips the second of them or
      returns the first forever.
    */
    const second = i === 101 ? 100 : i;
    insert.run(
      `t${String(i).padStart(3, "0")}`,
      i % 7 === 0 ? "u-repeat" : `u${i}`,
      i === 42 ? "زيلدا" : `Game ${i}`,
      i % 2 === 0 ? "switch" : "switch2",
      i % 3 === 0 ? "waiting_review" : "completed",
      `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
    );
  }
});

function fetchPage(request: Parameters<typeof adminTradePageQuery>[0]) {
  const query = adminTradePageQuery(request);
  const rows = db.prepare(query.sql).all(...(query.binds as never[])) as Record<string, unknown>[];
  return takePage(rows, query.limit);
}

/** Walk every page the endpoint will serve, the way the screen does. */
function walkAll(request: Parameters<typeof adminTradePageQuery>[0]) {
  const seen: string[] = [];
  let cursor: string | null = "";
  let pages = 0;
  do {
    const page = fetchPage({ ...request, cursor: cursor ?? "" });
    seen.push(...page.items.map((row) => String(row["id"])));
    cursor = page.nextCursor;
    pages++;
    if (pages > 50) throw new Error("the cursor is not advancing");
  } while (cursor);
  return { seen, pages };
}

describe("the trade past the two hundredth", () => {
  it("is reachable", () => {
    const { seen } = walkAll({ limit: 50 });
    expect(seen).toHaveLength(TOTAL);
    // The oldest trade in the shop — the one the old query could never return.
    expect(seen).toContain("t000");
  });

  it("is returned exactly once", () => {
    const { seen } = walkAll({ limit: 50 });
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it("comes back newest first, without a gap at a shared timestamp", () => {
    const { seen } = walkAll({ limit: 7 });
    const stamps = seen.map(
      (id) =>
        db.prepare(`SELECT created_at, id FROM disc_trades WHERE id = ?`).get(id) as {
          created_at: string;
          id: string;
        },
    );
    for (let i = 1; i < stamps.length; i++) {
      const before = stamps[i - 1]!;
      const after = stamps[i]!;
      const descending =
        before.created_at > after.created_at ||
        (before.created_at === after.created_at && before.id > after.id);
      expect(descending, `${before.id} then ${after.id}`).toBe(true);
    }
    // The colliding pair is still two rows, in a defined order.
    expect(seen.filter((id) => id === "t101" || id === "t100")).toHaveLength(2);
  });

  it("survives a page size that does not divide the total", () => {
    // 250 rows in pages of 60: four full pages and a last page of ten. An
    // off-by-one in the lookahead shows up here and nowhere else.
    const { seen, pages } = walkAll({ limit: 60 });
    expect(seen).toHaveLength(TOTAL);
    expect(pages).toBe(5);
  });
});

describe("a filter the database answers", () => {
  it("finds every waiting trade, not the ones inside the first page", () => {
    const expected = (
      db
        .prepare(`SELECT id FROM disc_trades WHERE status = 'waiting_review'`)
        .all() as { id: string }[]
    ).map((row) => row.id);
    const { seen } = walkAll({ status: "waiting_review", limit: 20 });
    expect(seen.sort()).toEqual(expected.sort());
    // Filtering in the browser over one page could never have found this many.
    expect(seen.length).toBeGreaterThan(20);
  });

  it("still matches rows written before the status was renamed", () => {
    /*
      The route normalises the filter before it gets here, so the value is
      always a current `TradeStatus` — and the column holds whatever name was
      current when the row was written. `pending`, `submitted` and
      `waiting_review` all mean "no price yet".

      A `WHERE status = 'awaiting_pricing'` would answer "بانتظار التسعير" with
      only the rows written since the rename, and quietly hide every older
      trade still waiting for a price. That is worse than the cap this change
      is about: those trades would be missing from the one filter the shop
      opens the screen to use.
    */
    const legacy = ["pending", "submitted", "waiting_review"];
    for (const [index, status] of legacy.entries()) {
      db.prepare(
        `INSERT INTO disc_trades (id, user_id, game_name, platform, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`t-legacy-${index}`, "u-legacy", "Legacy", "switch", status, "2026-01-01T00:00:00.000Z");
    }
    const { seen } = walkAll({ status: "awaiting_pricing", limit: 20 });
    for (const [index] of legacy.entries()) {
      expect(seen, legacy[index]).toContain(`t-legacy-${index}`);
    }
    db.prepare(`DELETE FROM disc_trades WHERE user_id = 'u-legacy'`).run();
  });

  it("maps the other renamed names onto the status they mean", () => {
    const rows: [string, string, string][] = [
      ["t-received", "received", "inspecting"],
      ["t-coupon", "coupon_issued", "completed"],
      ["t-cash", "cash_paid", "completed"],
      ["t-offer", "offer_sent", "awaiting_customer_approval"],
      ["t-autocancel", "auto_cancelled", "cancelled"],
    ];
    for (const [id, stored] of rows) {
      db.prepare(
        `INSERT INTO disc_trades (id, user_id, game_name, platform, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, "u-legacy", "Legacy", "switch", stored, "2026-01-01T00:00:00.000Z");
    }
    for (const [id, stored, normalized] of rows) {
      expect(walkAll({ status: normalized, limit: 20 }).seen, `${stored} → ${normalized}`).toContain(
        id,
      );
    }
    db.prepare(`DELETE FROM disc_trades WHERE user_id = 'u-legacy'`).run();
  });

  it("keeps a trade whose status nobody recognises findable", () => {
    /*
      `normalizeTradeStatus` sends an unknown or empty status to
      `awaiting_pricing`, and a request in a state nobody recognises is exactly
      one that still needs a price. Dropping it out of that filter would leave
      it findable only by scrolling the whole unfiltered list.
    */
    for (const [index, stored] of ["", "some_future_status"].entries()) {
      db.prepare(
        `INSERT INTO disc_trades (id, user_id, game_name, platform, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`t-odd-${index}`, "u-odd", "Odd", "switch", stored, "2026-01-01T00:00:00.000Z");
    }
    db.prepare(
      `INSERT INTO disc_trades (id, user_id, game_name, platform, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("t-odd-null", "u-odd", "Odd", "switch", null, "2026-01-01T00:00:00.000Z");
    const { seen } = walkAll({ status: "awaiting_pricing", limit: 20 });
    expect(seen).toContain("t-odd-0");
    expect(seen).toContain("t-odd-1");
    expect(seen).toContain("t-odd-null");
    // And they do not leak into a filter they have nothing to do with.
    const done = walkAll({ status: "completed", limit: 20 }).seen;
    expect(done).not.toContain("t-odd-0");
    expect(done).not.toContain("t-odd-null");
    db.prepare(`DELETE FROM disc_trades WHERE user_id = 'u-odd'`).run();
  });

  it("searches an Arabic game name, which LIKE would not fold on its own", () => {
    const { seen } = walkAll({ search: "زيلدا", limit: 20 });
    expect(seen).toEqual(["t042"]);
  });

  it("searches the member id across every page", () => {
    const { seen } = walkAll({ search: "u-repeat", limit: 5 });
    // Every seventh trade — far more than one page holds.
    expect(seen.length).toBe(Math.ceil(TOTAL / 7));
  });

  it("treats a wildcard in the term as text", () => {
    /*
      Unescaped, "%" matches every row: the admin types one character and the
      screen answers with the entire table, which reads as a broken filter.
    */
    expect(fetchPage({ search: "%", limit: 50 }).items).toHaveLength(0);
    expect(fetchPage({ search: "_", limit: 50 }).items).toHaveLength(0);
  });

  it("combines a filter with a page without losing either", () => {
    const { seen } = walkAll({ status: "waiting_review", search: "switch2", limit: 9 });
    for (const id of seen) {
      const row = db.prepare(`SELECT status, platform FROM disc_trades WHERE id = ?`).get(id) as {
        status: string;
        platform: string;
      };
      expect(row.status).toBe("waiting_review");
      expect(row.platform).toBe("switch2");
    }
    expect(seen.length).toBeGreaterThan(9);
  });
});

describe("the page size", () => {
  it("cannot be talked past the cap", () => {
    expect(pageSize(100000)).toBe(MAX_PAGE_SIZE);
    expect(pageSize(-5)).toBe(1);
    expect(pageSize("abc")).toBe(50);
    expect(pageSize(undefined)).toBe(50);
  });

  it("asks for one row more than it returns", () => {
    const query = adminTradePageQuery({ limit: 25 });
    expect(query.binds[query.binds.length - 1]).toBe(26);
    expect(query.limit).toBe(25);
  });
});

describe("the cursor", () => {
  it("keeps an id that contains the separator whole", () => {
    expect(parseCursor("2026-01-01T00:00:00.000Z|t|weird")).toEqual({
      at: "2026-01-01T00:00:00.000Z",
      id: "t|weird",
    });
  });

  it("is ignored rather than trusted when it is malformed", () => {
    for (const junk of ["", "|", "|abc", "abc", "abc|"]) {
      expect(parseCursor(junk)).toBeNull();
      // A junk cursor must not silently narrow the list to nothing.
      expect(adminTradePageQuery({ cursor: junk }).binds).toEqual([51]);
    }
  });

  it("is nothing at all on the last page", () => {
    const page = fetchPage({ limit: MAX_PAGE_SIZE });
    expect(page.hasMore).toBe(true);
    const rest = fetchPage({ limit: MAX_PAGE_SIZE, cursor: page.nextCursor ?? "" });
    expect(rest.hasMore).toBe(false);
    expect(rest.nextCursor).toBeNull();
  });

  it("names a row by both halves of its key", () => {
    expect(cursorOf({ created_at: "2026-01-01T00:00:00.000Z", id: "t001" })).toBe(
      "2026-01-01T00:00:00.000Z|t001",
    );
    expect(cursorOf({ created_at: "", id: "t001" })).toBeNull();
    expect(cursorOf(undefined)).toBeNull();
  });
});
