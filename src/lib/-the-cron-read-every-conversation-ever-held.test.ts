/**
 * @vitest-environment node
 *
 * Needs the real `node:sqlite`, which the default jsdom environment cannot load.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The every-minute cron read the document of every conversation the shop has
 * ever had.
 *
 * `processInactivityAndQueue()` wanted the open ones and got them by calling
 * `listThreads()` — which selects every row, ships every document to the
 * Worker and parses each one — then filtering the result on two fields. Sixty
 * times an hour, growing with the shop's whole history, on a cron already
 * being killed for exceeding its CPU.
 *
 * The filter is now a JSON path in the query. What that has to survive is not
 * the happy case: it is a thread with no `mode`, whose SQL comparison against
 * NULL is neither true nor false, and a document that is not valid JSON, on
 * which `json_extract` raises and would take the whole sweep down with it.
 *
 * These run the statement the Worker runs against a real SQLite, because a
 * hand-written fake would only prove the fake agrees with itself — and the two
 * cases above are exactly the ones a fake gets wrong.
 */

const db = new DatabaseSync(":memory:");

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...binds: unknown[]) => db.prepare(sql).all(...(binds as never[])),
  d1First: async (sql: string, ...binds: unknown[]) =>
    db.prepare(sql).get(...(binds as never[])) ?? null,
  d1Run: async (sql: string, ...binds: unknown[]) => {
    db.prepare(sql).run(...(binds as never[]));
  },
  d1RunChanges: async (sql: string, ...binds: unknown[]) =>
    Number(db.prepare(sql).run(...(binds as never[])).changes ?? 0),
  d1BatchRun: async () => [],
  d1Batch: async () => [],
  /*
    `d1Ready()` in db.server is `getD1()` plus the schema bootstrap, so a falsy
    binding here silently routes every call to the filesystem driver and the
    statement under test never runs at all.
  */
  getD1: () => ({ prepare: (sql: string) => ({ sql }) }),
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));

vi.mock("./storage.server", () => ({
  listKeys: async () => [],
  mutateJson: async () => undefined,
  readJson: async (_key: string, fallback: unknown) => fallback,
  writeJson: async () => undefined,
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({ sendTelegramMessage: async () => undefined }));

const store = await import("./db.server");

/** The production schema for this table, as `d1.server.ts` creates it. */
function createSchema() {
  db.exec(`DROP TABLE IF EXISTS threads`);
  db.exec(
    `CREATE TABLE threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT,
       doc TEXT NOT NULL, last_message_at TEXT NOT NULL)`,
  );
}

let clock = 0;
/** Each row lands one second after the last, so insertion order is the sort order. */
function insert(doc: Record<string, unknown> | string, extra: { orderId?: string } = {}) {
  clock += 1;
  const id = typeof doc === "string" ? `t${clock}` : String(doc["id"] ?? `t${clock}`);
  const text = typeof doc === "string" ? doc : JSON.stringify({ id, ...doc });
  db.prepare(
    `INSERT INTO threads (id, user_id, order_id, doc, last_message_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    "u1",
    extra.orderId ?? null,
    text,
    `2026-09-15T00:00:${String(clock).padStart(2, "0")}Z`,
  );
  return id;
}

beforeEach(() => {
  createSchema();
  clock = 0;
});

describe("listOpenThreads", () => {
  it("returns the open conversations and leaves the closed ones in the database", async () => {
    insert({ id: "open-1", status: "open", mode: "WAITING_FOR_USER" });
    insert({ id: "closed-1", status: "closed", mode: "AI_ACTIVE" });
    insert({ id: "open-2", status: "open", mode: "ADMIN_ACTIVE" });

    const open = await store.listOpenThreads();
    expect(open.map((t) => t.id).sort()).toEqual(["open-1", "open-2"]);
  });

  it("excludes a resolved conversation even while its status is open", async () => {
    insert({ id: "resolved", status: "open", mode: "RESOLVED" });
    expect(await store.listOpenThreads()).toHaveLength(0);
  });

  /*
    The case a NULL-blind filter loses. `json_extract` returns NULL for an
    absent `mode`, `NULL <> 'RESOLVED'` is NULL rather than true, and this
    open conversation would have been dropped from the sweep — never chased
    for inactivity, never transferred, never closed.
  */
  it("keeps an open conversation that has no mode at all", async () => {
    insert({ id: "no-mode", status: "open" });
    const open = await store.listOpenThreads();
    expect(open.map((t) => t.id)).toEqual(["no-mode"]);
  });

  it("keeps an open conversation whose mode is explicitly null", async () => {
    insert({ id: "null-mode", status: "open", mode: null });
    expect((await store.listOpenThreads()).map((t) => t.id)).toEqual(["null-mode"]);
  });

  /*
    `json_extract` raises on a malformed document. Without the `json_valid`
    guard, one unreadable row fails the statement and the cron stops sweeping
    every conversation in the shop — which is strictly worse than the single
    row it could not read.
  */
  it("survives a document that is not valid JSON, and still returns the rest", async () => {
    insert("{ this is not json");
    insert({ id: "open-after", status: "open", mode: "WAITING_FOR_USER" });

    const open = await store.listOpenThreads();
    expect(open.map((t) => t.id)).toEqual(["open-after"]);
  });

  it("orders newest conversation first, as the list it replaces did", async () => {
    insert({ id: "older", status: "open" });
    insert({ id: "newer", status: "open" });
    expect((await store.listOpenThreads()).map((t) => t.id)).toEqual(["newer", "older"]);
  });

  /*
    The property that makes the change a refactor rather than a behaviour
    change: whatever the old JavaScript filter would have kept, the query
    keeps — over a mixed set built to include every shape above.
  */
  it("agrees with the filter it replaces, over a mixed set", async () => {
    const docs = [
      { id: "a", status: "open", mode: "WAITING_FOR_USER" },
      { id: "b", status: "open", mode: "RESOLVED" },
      { id: "c", status: "closed", mode: "AI_ACTIVE" },
      { id: "d", status: "open" },
      { id: "e", status: "open", mode: null },
      { id: "f", status: "closed" },
      { id: "g", status: "open", mode: "ORDER_PREPARATION" },
    ];
    for (const doc of docs) insert(doc);

    const expected = docs
      .filter((t) => t.status === "open" && t.mode !== "RESOLVED")
      .map((t) => t.id)
      .sort();

    expect((await store.listOpenThreads()).map((t) => t.id).sort()).toEqual(expected);
  });
});

describe("findThreadByIdOrOrder", () => {
  it("finds a conversation by its own id", async () => {
    insert({ id: "thread-1", status: "open" });
    expect((await store.findThreadByIdOrOrder("thread-1"))?.id).toBe("thread-1");
  });

  it("finds it by the order it belongs to", async () => {
    insert({ id: "thread-2", status: "open", orderId: "ord_9" }, { orderId: "ord_9" });
    expect((await store.findThreadByIdOrOrder("ord_9"))?.id).toBe("thread-2");
  });

  /*
    The queue metrics ask about a conversation that may well be finished, so
    this must not inherit the open-only scope of the list beside it.
  */
  it("finds a closed conversation, which the open list deliberately will not", async () => {
    insert({ id: "done", status: "closed", mode: "RESOLVED" });
    expect((await store.findThreadByIdOrOrder("done"))?.id).toBe("done");
    expect(await store.listOpenThreads()).toHaveLength(0);
  });

  it("returns nothing for an unknown reference, and for an empty one", async () => {
    expect(await store.findThreadByIdOrOrder("nobody")).toBeUndefined();
    expect(await store.findThreadByIdOrOrder("")).toBeUndefined();
  });
});
