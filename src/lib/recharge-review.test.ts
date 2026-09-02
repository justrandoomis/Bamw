import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishEnv } from "./env.server";

/**
 * Approving a top-up moves real money into a member's wallet, so it has to be
 * exactly-once and it has to leave a trail. These tests pin the three
 * properties the review flow depends on: the status is claimed with a guard so
 * two reviewers cannot both win, a failed credit releases the claim instead of
 * leaving a request marked approved with nothing paid, and a request that is
 * already settled is refused rather than silently re-run.
 */

type Statement = { sql: string; binds: unknown[] };

const REQUEST_ROW = {
  id: "rrq_1",
  user_id: "usr_member",
  amount: 25000,
  method: "zain_cash",
  proof_url: "/api/files/wallets/usr_member/f_1.png",
  eshop_code: null,
  banan_code: null,
  status: "pending",
  admin_notes: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

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
  wallet_balance: 100000,
  banana_balance: 0,
  banana_locked: 0,
  created_at: "2026-01-01T00:00:00.000Z",
};

function stubD1(options: { claimChanges?: number; failCredit?: boolean; status?: string } = {}) {
  const { claimChanges = 1, failCredit = false, status = "pending" } = options;
  const statements: Statement[] = [];
  const requestRow = { ...REQUEST_ROW, status };

  const changesFor = (sql: string) => {
    if (/SET status = 'approved'/.test(sql)) return claimChanges;
    if (/SET status = 'rejected'/.test(sql)) return claimChanges;
    return 1;
  };

  const prepare = (sql: string, binds: unknown[] = []): any => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async () => {
      statements.push({ sql, binds });
      if (/FROM recharge_requests/.test(sql)) return { results: [requestRow] };
      if (/FROM users/.test(sql)) return { results: [USER_ROW] };
      return { results: [] };
    },
    first: async () => {
      statements.push({ sql, binds });
      if (/FROM recharge_requests/.test(sql)) return requestRow;
      if (/FROM users/.test(sql)) return USER_ROW;
      return null;
    },
    run: async () => {
      statements.push({ sql, binds });
      if (failCredit && /UPDATE users SET wallet_balance/.test(sql)) {
        throw new Error("D1_ERROR: database is locked");
      }
      return { success: true, meta: { changes: changesFor(sql) } };
    },
  });

  return {
    statements,
    find: (pattern: RegExp) => statements.find((s) => pattern.test(s.sql)),
    all: (pattern: RegExp) => statements.filter((s) => pattern.test(s.sql)),
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

const reviewer = { id: "usr_admin", name: "Admin One", source: "admin_panel" };

beforeEach(() => {
  vi.resetModules();
  publishEnv({});
});

afterEach(() => {
  vi.doUnmock("./d1.server");
  publishEnv({});
});

describe("approveRechargeRequest", () => {
  it("claims the request with a guard and records who approved it", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { approveRechargeRequest } = await import("./db.server");

    const result = await approveRechargeRequest("rrq_1", reviewer);

    expect(result.ok).toBe(true);
    expect(result.creditedAmount).toBe(25000);

    const claim = stub.find(/UPDATE recharge_requests\s+SET status = 'approved'/);
    expect(claim).toBeDefined();
    // Only a still-pending row may be claimed — this is what makes a double
    // approval impossible when two reviewers press at the same moment.
    expect(claim!.sql).toMatch(/WHERE id = \? AND status = 'pending'/);
    expect(claim!.binds).toContain("usr_admin");
    expect(claim!.binds).toContain("Admin One");

    // And the money moved through the guarded relative update, once.
    const credits = stub.all(/UPDATE users SET wallet_balance/);
    expect(credits).toHaveLength(1);
    expect(credits[0]!.sql).toMatch(/wallet_balance\s*=\s*wallet_balance\s*\+\s*\?/);
  });

  it("refuses a request another reviewer already claimed, and credits nothing", async () => {
    const stub = stubD1({ claimChanges: 0 });
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { approveRechargeRequest } = await import("./db.server");

    const result = await approveRechargeRequest("rrq_1", reviewer);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_settled");
    expect(stub.all(/UPDATE users SET wallet_balance/)).toHaveLength(0);
  });

  it("refuses outright when the request is no longer pending", async () => {
    const stub = stubD1({ status: "approved" });
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { approveRechargeRequest } = await import("./db.server");

    const result = await approveRechargeRequest("rrq_1", reviewer);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_settled");
    expect(stub.all(/UPDATE recharge_requests\s+SET status = 'approved'/)).toHaveLength(0);
  });

  it("puts the request back to pending when the credit fails", async () => {
    const stub = stubD1({ failCredit: true });
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { approveRechargeRequest } = await import("./db.server");

    const result = await approveRechargeRequest("rrq_1", reviewer);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("credit_failed");
    // An approved row with no money behind it is the one outcome that must
    // never survive, so the claim is released.
    const release = stub.find(/UPDATE recharge_requests\s+SET status = 'pending'/);
    expect(release).toBeDefined();
    expect(release!.sql).toMatch(/WHERE id = \? AND status = 'approved'/);
  });
});

describe("rejectRechargeRequest", () => {
  it("only rejects a pending request", async () => {
    const stub = stubD1({ status: "approved" });
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { rejectRechargeRequest } = await import("./db.server");

    const result = await rejectRechargeRequest("rrq_1", reviewer);

    // Rejecting after the wallet was credited would leave a paid member with a
    // rejected record, so it is refused.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_settled");
    expect(stub.all(/UPDATE recharge_requests\s+SET status = 'rejected'/)).toHaveLength(0);
  });

  it("claims with the same pending guard as approval", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { rejectRechargeRequest } = await import("./db.server");

    const result = await rejectRechargeRequest("rrq_1", reviewer);

    expect(result.ok).toBe(true);
    const claim = stub.find(/UPDATE recharge_requests\s+SET status = 'rejected'/);
    expect(claim!.sql).toMatch(/WHERE id = \? AND status = 'pending'/);
  });
});

describe("recharge listing", () => {
  it("returns the camelCase shape the review screens read", async () => {
    const stub = stubD1();
    mockSchemaBootstrap();
    publishEnv({ DB: stub.db, bananto: stub.db });
    const { listAllRechargeRequests } = await import("./db.server");

    const [request] = await listAllRechargeRequests();

    // The raw row is snake_case; passing it through left the proof and the
    // member undefined, so staff saw neither.
    expect(request?.userId).toBe("usr_member");
    expect(request?.proofUrl).toBe("/api/files/wallets/usr_member/f_1.png");
    expect(request?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(request?.user?.name).toBe("Member");
    expect(request?.user?.walletBalance).toBe(100000);
  });
});
