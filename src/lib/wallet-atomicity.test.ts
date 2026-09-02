import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishEnv } from "./env.server";

/**
 * The wallet used to be adjusted with a read-modify-write: read the balance,
 * add the delta in JavaScript, write the whole user row back. Two requests that
 * read the same starting balance both "succeeded" and the second overwrote the
 * first, which is how a member could spend the same money twice.
 *
 * A single-threaded stub cannot reproduce the race, so these tests pin the SQL
 * shape that makes it impossible: a relative update carrying its own guard.
 */

type Statement = { sql: string; binds: unknown[] };

const USER_ROW = {
  id: "usr_member",
  name: "Member",
  email: "m@example.com",
  password_hash: "",
  is_admin: 0,
  provider: "password",
  settings: "{}",
  addresses: "[]",
  favorites: "[]",
  preferred_genres: "[]",
  wallet_balance: 100,
  banana_balance: 100,
  banana_locked: 0,
  created_at: "2026-01-01T00:00:00.000Z",
};

/** Reports `guardedChanges` for any UPDATE that carries a `>= ?` balance guard. */
function stubD1(guardedChanges = 1) {
  const statements: Statement[] = [];

  const changesFor = (sql: string) =>
    /UPDATE users SET (?:wallet_balance|banana_balance)/.test(sql) && /balance\s*>=\s*\?/.test(sql)
      ? guardedChanges
      : 1;

  const prepare = (sql: string, binds: unknown[] = []): any => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async () => {
      statements.push({ sql, binds });
      return { results: /FROM users/.test(sql) ? [USER_ROW] : [] };
    },
    first: async () => {
      statements.push({ sql, binds });
      return /FROM users/.test(sql) ? USER_ROW : null;
    },
    run: async () => {
      statements.push({ sql, binds });
      return { success: true, meta: { changes: changesFor(sql) } };
    },
  });

  return {
    statements,
    find: (pattern: RegExp) => statements.find((s) => pattern.test(s.sql)),
    db: {
      prepare: (sql: string) => prepare(sql),
      batch: async (prepared: any[]) => {
        const out: unknown[] = [];
        for (const statement of prepared) out.push(await statement.run());
        return out;
      },
    },
  };
}

/** Schema bootstrap is not what is under test and would flood the statement log. */
function mockSchemaBootstrap() {
  vi.doMock("./d1.server", async () => {
    const actual = await vi.importActual<typeof import("./d1.server")>("./d1.server");
    return {
      ...actual,
      ensureSchema: async () => {},
      ensureUsersSchema: async () => {},
      ensureOtpSchema: async () => {},
      d1Ready: async () => true,
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  publishEnv({});
});

afterEach(() => {
  vi.doUnmock("./d1.server");
  publishEnv({});
});

describe("adjustUserWalletBalance", () => {
  it("debits with a relative update guarded on the current balance", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ bananto: stub.db });
    const { adjustUserWalletBalance } = await import("./db.server");

    await adjustUserWalletBalance(USER_ROW.id, -40, "purchase", "order");

    const update = stub.find(/UPDATE users SET wallet_balance/);
    expect(update).toBeDefined();
    // Relative, never `= <value computed in JS>`.
    expect(update!.sql).toMatch(/wallet_balance\s*=\s*wallet_balance\s*\+\s*\?/);
    // And it declines to apply if the balance moved underneath it.
    expect(update!.sql).toMatch(/wallet_balance\s*>=\s*\?/);
  });

  it("refuses a debit the guard rejected, and gates the ledger row on it", async () => {
    const stub = stubD1(0);
    mockSchemaBootstrap();
    publishEnv({ bananto: stub.db });
    const { adjustUserWalletBalance } = await import("./db.server");

    await expect(adjustUserWalletBalance(USER_ROW.id, -40, "purchase")).rejects.toThrow(
      /Insufficient wallet balance/,
    );

    // The ledger insert rides in the same batch but only applies when the
    // balance update did, so it can never record a transfer that did not happen.
    expect(stub.find(/INSERT INTO wallet_transactions/)!.sql).toMatch(/WHERE changes\(\) = 1/);
  });

  it("credits without a balance guard so a top-up never fails on a stale read", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ bananto: stub.db });
    const { adjustUserWalletBalance } = await import("./db.server");

    await adjustUserWalletBalance(USER_ROW.id, 250, "deposit");

    const update = stub.find(/UPDATE users SET wallet_balance/);
    expect(update!.sql).toMatch(/wallet_balance\s*=\s*wallet_balance\s*\+\s*\?/);
    expect(update!.sql).not.toMatch(/wallet_balance\s*>=/);
  });
});

describe("debitBananaBalance", () => {
  it("guards the debit instead of writing NULL into a NOT NULL column", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ bananto: stub.db });
    const { debitBananaBalance } = await import("./banana-balance.server");

    const result = await debitBananaBalance(USER_ROW.id, 40, { reason: "spend" });
    expect(result.success).toBe(true);

    const update = stub.find(/UPDATE users SET banana_balance/);
    expect(update).toBeDefined();
    expect(update!.sql).not.toMatch(/NULL/);
    expect(update!.sql).toMatch(/banana_balance\s*>=\s*\?/);
  });

  it("reports insufficient_balance rather than throwing when the guard rejects", async () => {
    const stub = stubD1(0);
    mockSchemaBootstrap();
    publishEnv({ bananto: stub.db });
    const { debitBananaBalance } = await import("./banana-balance.server");

    const result = await debitBananaBalance(USER_ROW.id, 40, { reason: "spend" });

    expect(result).toMatchObject({ success: false, error: "insufficient_balance" });
    expect(stub.find(/INSERT INTO banana_transactions/)).toBeUndefined();
  });
});
