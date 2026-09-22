/**
 * Saving anything about a member must never write their balance.
 *
 * The hole: `updateUser` is a read-modify-write of the WHOLE user row, and
 * `upsertUserRow`'s conflict clause used to include
 *
 *     wallet_balance = excluded.wallet_balance,
 *     banana_balance = excluded.banana_balance,
 *     banana_locked  = excluded.banana_locked
 *
 * bound from the snapshot the request started with. So a member saving a
 * profile field in one tab while buying a game in another had their
 * pre-purchase balance written back over the checkout debit — and the game was
 * already delivered. The debit itself was never wrong. It was overwritten
 * afterwards by a request that had no business touching money.
 *
 * This reads the SQL and holds the shape of the statement, because that is
 * where the fault was: not in any branch, but in a column list. A test that
 * called the function would need a database; a test that reads the statement
 * catches the exact edit that would bring it back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "db.server.ts"), "utf8");

/** The `INSERT INTO users ... ON CONFLICT ... DO UPDATE SET ...` statement. */
const upsert = (() => {
  const start = source.indexOf("INSERT INTO users (id, name, username");
  expect(start, "the users upsert is still in db.server.ts").toBeGreaterThan(-1);
  const clause = source.indexOf("ON CONFLICT(id) DO UPDATE SET", start);
  expect(clause, "the upsert still has a conflict clause").toBeGreaterThan(-1);
  const end = source.indexOf("`,", clause);
  return source.slice(clause, end);
})();

const MONEY_COLUMNS = ["wallet_balance", "banana_balance", "banana_locked"];

describe("the user upsert does not write money", () => {
  for (const column of MONEY_COLUMNS) {
    it(`never sets ${column} on conflict`, () => {
      expect(upsert).not.toContain(`${column} = excluded.${column}`);
      expect(upsert).not.toContain(column);
    });
  }

  it("still writes the things a profile save is actually for", () => {
    for (const column of ["name", "phone", "avatar", "addresses", "favorites", "settings"]) {
      expect(upsert).toContain(`${column} = excluded.${column}`);
    }
  });
});

describe("money moves only relative to what is stored", () => {
  /*
    A snapshot cannot lose a race it never enters. Every statement that moves a
    balance has to read the column on the left of its own assignment — `x = x +
    ?` — rather than binding a number the request computed earlier.
  */
  const assignments = [...source.matchAll(/SET\s+(wallet_balance|banana_balance|banana_locked)\s*=\s*([^,\n]+)/g)];

  it("finds the statements at all, so a rename cannot make this vacuous", () => {
    expect(assignments.length).toBeGreaterThan(0);
  });

  for (const [, column, expression] of assignments) {
    it(`sets ${column} from ${column} itself: ${expression.trim().slice(0, 48)}`, () => {
      expect(expression).toContain(column);
    });
  }
});

describe("adding bananas does not rewrite the row", () => {
  it("addBananaBalance exists and adds to the stored value", () => {
    expect(source).toContain("export async function addBananaBalance");
    expect(source).toContain("SET banana_balance = COALESCE(banana_balance, 0) + ?");
  });

  it("the banana-code redemptions no longer go through updateUser", () => {
    // The mutator shape that used to overwrite the column.
    expect(source).not.toMatch(/updateUser\([^)]*\(u\)\s*=>\s*\(\{[^}]*bananaBalance:/s);
  });
});
