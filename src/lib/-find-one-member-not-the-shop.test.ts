/**
 * @vitest-environment node
 *
 * Needs the real `node:sqlite`, which the default jsdom environment cannot load.
 *
 * The coupon screen's "who may use this" picker downloaded the entire members
 * table — `GET /api/admin/users` answers with every account through
 * `toPublicUser`, so every name, email, phone, wallet balance and saved
 * address in the shop — and matched the operator's typing against it in the
 * browser, to fill a list that shows a couple of dozen rows.
 *
 * It never needed any of that. It needed to turn "٠٧٧٠…" into an account id.
 *
 * The behaviour under test is the SQL, so these run against a real database.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = new DatabaseSync(":memory:");

vi.mock("./d1.server", () => ({
  d1Ready: async () => true,
  d1All: async (sql: string, ...binds: unknown[]) => db.prepare(sql).all(...(binds as never[])),
}));

const { searchMembers, membersByIds } = await import("./member-lookup.server");

beforeAll(() => {
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    username TEXT,
    member_no TEXT,
    email TEXT,
    phone TEXT,
    password_hash TEXT,
    wallet_balance REAL,
    addresses TEXT,
    created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(
    `INSERT INTO users (id, name, username, member_no, email, phone, password_hash,
                        wallet_balance, addresses, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    "usr_ali",
    "علي حسن",
    "ali",
    "1001",
    "ali@example.com",
    "+9647701234567",
    "$2b$hash",
    125000,
    '[{"city":"بغداد"}]',
    "2026-01-03T00:00:00.000Z",
  );
  insert.run(
    "usr_sara",
    "Sara K",
    "sara_k",
    "1002",
    "SARA@Example.com",
    "+9647809876543",
    "$2b$hash",
    0,
    "[]",
    "2026-01-02T00:00:00.000Z",
  );
  insert.run(
    "usr_percent",
    "100% Gamer",
    null,
    "1003",
    "pct@example.com",
    null,
    "$2b$hash",
    0,
    "[]",
    "2026-01-01T00:00:00.000Z",
  );
  // Enough accounts that "returns everybody" and "returns the matches" are
  // visibly different answers.
  for (let i = 0; i < 60; i++) {
    insert.run(
      `usr_bulk_${i}`,
      `Member ${i}`,
      null,
      `2${String(i).padStart(3, "0")}`,
      `bulk${i}@example.com`,
      null,
      "$2b$hash",
      0,
      "[]",
      "2025-12-01T00:00:00.000Z",
    );
  }
});

describe("searching for a member", () => {
  it("answers a blank box with nobody, not everybody", async () => {
    expect(await searchMembers("")).toEqual([]);
    expect(await searchMembers("   ")).toEqual([]);
  });

  it("finds them by name", async () => {
    expect((await searchMembers("علي")).map((m) => m.id)).toEqual(["usr_ali"]);
  });

  it("finds them by email whatever case it was typed in", async () => {
    expect((await searchMembers("sara@example.com")).map((m) => m.id)).toEqual(["usr_sara"]);
    expect((await searchMembers("SARA@EXAMPLE.COM")).map((m) => m.id)).toEqual(["usr_sara"]);
  });

  it("finds them by the phone as an operator reads it off a message", async () => {
    /*
      Stored as +9647701234567; nobody types it that way. Each of these is the
      same person, and a picker that finds them only from the stored form is a
      picker nobody can use.
    */
    for (const typed of ["07701234567", "+964 770 123 4567", "٠٧٧٠١٢٣٤٥٦٧"]) {
      expect((await searchMembers(typed)).map((m) => m.id), typed).toEqual(["usr_ali"]);
    }
  });

  it("finds them by member number, username and account id", async () => {
    expect((await searchMembers("1002")).map((m) => m.id)).toEqual(["usr_sara"]);
    expect((await searchMembers("sara_k")).map((m) => m.id)).toEqual(["usr_sara"]);
    expect((await searchMembers("usr_ali")).map((m) => m.id)).toEqual(["usr_ali"]);
  });

  it("treats a wildcard in the term as text", async () => {
    /*
      Unescaped, "%" matches every account: the operator types one character
      and the picker answers with the entire customer list — which is exactly
      the thing this module exists to stop.
    */
    const matches = await searchMembers("100%");
    expect(matches.map((m) => m.id)).toEqual(["usr_percent"]);
  });

  it("sends the fields that identify a person and no others", async () => {
    const [member] = await searchMembers("علي");
    expect(member).toEqual({
      id: "usr_ali",
      name: "علي حسن",
      email: "ali@example.com",
      phone: "+9647701234567",
      memberNo: "1001",
      username: "ali",
    });
    // Not the hash, not the balance, not where they live.
    expect(Object.keys(member ?? {})).not.toContain("password_hash");
    expect(Object.keys(member ?? {})).not.toContain("wallet_balance");
    expect(Object.keys(member ?? {})).not.toContain("addresses");
  });

  it("is capped, so a broad term cannot become the whole table", async () => {
    const matches = await searchMembers("example.com");
    expect(matches.length).toBeLessThanOrEqual(25);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe("the members a coupon is already restricted to", () => {
  it("come back by id", async () => {
    const found = await membersByIds(["usr_ali", "usr_sara"]);
    expect(found.map((m) => m.id).sort()).toEqual(["usr_ali", "usr_sara"]);
  });

  it("ask for nothing when the list is empty", async () => {
    expect(await membersByIds([])).toEqual([]);
    expect(await membersByIds(["", "  "])).toEqual([]);
  });

  it("survive more ids than D1 will bind in one statement", async () => {
    /*
      D1 refuses a statement with a hundred bound parameters. A coupon
      restricted to two hundred accounts is unusual and entirely legal, and the
      version that built one `IN (...)` would have failed the whole screen with
      "too many SQL variables".
    */
    const ids = Array.from({ length: 60 }, (_, i) => `usr_bulk_${i}`);
    const found = await membersByIds([...ids, ...ids]);
    expect(found).toHaveLength(60);
    expect(new Set(found.map((m) => m.id)).size).toBe(60);
  });
});

describe("the coupon screen", () => {
  /*
    Block comments stripped, because this file *describes* the call it used to
    make. Asserting over the prose passes or fails on how the change is
    explained rather than on what the screen does.
  */
  const source = readFileSync(
    resolve(process.cwd(), "src/components/admin/CouponsManager.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("no longer downloads the members table to fill a picker", () => {
    expect(source).not.toContain("adminApi.getUsers()");
    expect(source).toContain("adminApi.searchMembers");
    expect(source).toContain("adminApi.membersByIds");
  });

  it("does not send a request on every keystroke", () => {
    expect(source).toContain("setDebouncedMemberSearch");
  });
});
