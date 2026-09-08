// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishEnv } from "./env.server";

/**
 * The marketplace against a real SQLite database.
 *
 * A hand-written D1 stub can only assert that the code sent the SQL it was
 * expected to send. What actually protects the money here is the database:
 * the NOT NULL on `wallet_balance` is what makes an unaffordable fee abort the
 * batch, and the unique index on the ledger reference is what makes a second
 * charge for the same window impossible. Those only mean anything if a real
 * engine enforces them, so these tests run the real DDL and the real SQL.
 */

const SUPPORT_SCHEMA = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
    password_hash TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0,
    wallet_balance REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE wallet_transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    amount REAL NOT NULL, description TEXT, order_id TEXT, created_at TEXT NOT NULL,
    reference_type TEXT, reference_id TEXT)`,
  `CREATE UNIQUE INDEX wallet_transactions_ref_idx ON wallet_transactions (reference_type, reference_id)
     WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL`,
];

/**
 * A D1-shaped adapter over node:sqlite.
 *
 * `batch` runs inside a transaction and rolls back on the first failure, which
 * is the property the fee charge depends on: a ledger row must never survive a
 * balance update that was refused.
 */
function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  for (const sql of SUPPORT_SCHEMA) db.exec(sql);

  const isRead = (sql: string) => /^\s*(select|pragma)/i.test(sql);

  const exec = (sql: string, binds: unknown[]) => {
    const statement = db.prepare(sql);
    const values = binds.map((value) => (value === undefined ? null : value)) as never[];
    if (isRead(sql)) return { results: statement.all(...values) };
    const info = statement.run(...values);
    return { success: true, results: [], meta: { changes: Number(info.changes ?? 0) } };
  };

  const make = (sql: string, binds: unknown[]): any => ({
    _sql: sql,
    _params: binds,
    bind: (...values: unknown[]) => make(sql, values),
    all: async () => exec(sql, binds),
    first: async () => (exec(sql, binds).results?.[0] as unknown) ?? null,
    run: async () => exec(sql, binds),
  });

  return {
    raw: db,
    d1: {
      prepare: (sql: string) => make(sql, []),
      batch: async (statements: any[]) => {
        db.exec("BEGIN");
        try {
          const out = statements.map((statement) => exec(statement._sql, statement._params ?? []));
          db.exec("COMMIT");
          return out;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

let sequence = 0;
const notifications: { userId: string; title: string }[] = [];
const audits: { action: string; entityId?: string }[] = [];
let storeSettings: Record<string, unknown> = {};

function mockDbServer() {
  vi.doMock("./db.server", () => ({
    randomId: (prefix: string) => `${prefix}_${(++sequence).toString(36).padStart(6, "0")}`,
    getStore: async () => ({ settings: storeSettings }),
    updateStore: async (fn: (store: any) => any) => {
      const next = fn({ settings: storeSettings });
      storeSettings = next.settings;
      return next;
    },
    createNotification: async (userId: string, title: string) => {
      notifications.push({ userId, title });
    },
    createAuditLog: async (_actor: string, action: string, _type?: string, entityId?: string) => {
      audits.push({ action, entityId });
    },
  }));
}

const SELLER = "usr_seller";

async function setup(options: { balance?: number; config?: Record<string, unknown> } = {}) {
  const { d1, raw } = sqliteD1();
  raw
    .prepare(
      `INSERT INTO users (id, name, email, wallet_balance, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(SELLER, "Seller", "s@example.com", options.balance ?? 100_000, "2026-01-01T00:00:00.000Z");
  storeSettings = options.config ? { usedMarketplace: options.config } : {};
  mockDbServer();
  publishEnv({ bananto: d1, DB: d1 });
  const mod = await import("./used-marketplace.server");
  await mod.ensureUsedMarketplaceSchema();
  return { ...mod, raw };
}

const DRAFT = {
  title: "Nintendo Switch OLED",
  usedType: "console",
  conditionGrade: "very_good",
  priceIqd: 250_000,
  quantity: 1,
  conditionNotes: "خدش بسيط على الظهر ولا توجد مشاكل في الشاشة",
  photos: [`/api/files/uploads/${SELLER}/one.webp`],
  /*
    A listing must carry one way to reach the seller. The whole section is a
    buyer contacting a seller directly, so one without a contact is one nobody
    can answer — and the fee would have been taken for it.
  */
  contact: { telegram: "@ali_gamer" },
} as const;

const balanceOf = (raw: DatabaseSync) =>
  Number((raw.prepare(`SELECT wallet_balance AS b FROM users WHERE id = ?`).get(SELLER) as any).b);

const feeRows = (raw: DatabaseSync) =>
  raw
    .prepare(
      `SELECT * FROM wallet_transactions WHERE reference_type = 'used_listing_fee' ORDER BY id`,
    )
    .all() as any[];

beforeEach(() => {
  vi.resetModules();
  sequence = 0;
  notifications.length = 0;
  audits.length = 0;
  storeSettings = {};
  publishEnv({});
});

afterEach(() => {
  vi.doUnmock("./db.server");
  publishEnv({});
});

describe("submitting a listing", () => {
  it("charges the fee once and leaves a ledger row that matches the balance", async () => {
    const { createDraft, transitionListing, raw } = await setup({ balance: 10_000 });
    const draft = await createDraft(SELLER, DRAFT as never);

    const submitted = await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });

    expect(submitted.status).toBe("SUBMITTED");
    expect(balanceOf(raw)).toBe(9_000);
    const rows = feeRows(raw);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(-1000);
    expect(submitted.feePaidCycle).toBe(0);
  });

  it("refuses a submission the seller cannot afford, and takes nothing", async () => {
    const { createDraft, transitionListing, raw } = await setup({ balance: 400 });
    const draft = await createDraft(SELLER, DRAFT as never);

    await expect(
      transitionListing(draft.id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      }),
    ).rejects.toThrow("INSUFFICIENT_WALLET_BALANCE");

    // The whole batch has to have rolled back: no balance change, no ledger row.
    expect(balanceOf(raw)).toBe(400);
    expect(feeRows(raw)).toHaveLength(0);
  });

  it("does not charge again when a listing sent back for changes is resubmitted", async () => {
    const { createDraft, transitionListing, raw } = await setup({ balance: 10_000 });
    const draft = await createDraft(SELLER, DRAFT as never);

    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    await transitionListing(draft.id, "NEEDS_CHANGES", {
      actor: "admin",
      actorUserId: "usr_admin",
      note: "صور أوضح من فضلك",
    });
    const again = await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
    });

    expect(again.status).toBe("SUBMITTED");
    expect(balanceOf(raw)).toBe(9_000);
    expect(feeRows(raw)).toHaveLength(1);
  });

  it("charges again for a fresh window after a relist", async () => {
    const { createDraft, transitionListing, raw } = await setup({ balance: 10_000 });
    const draft = await createDraft(SELLER, DRAFT as never);

    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    await transitionListing(draft.id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" });
    await transitionListing(draft.id, "EXPIRED", { actor: "system" });
    const relisted = await transitionListing(draft.id, "DRAFT", {
      actor: "seller",
      actorUserId: SELLER,
    });
    expect(relisted.feeCycle).toBe(1);

    await transitionListing(draft.id, "SUBMITTED", { actor: "seller", actorUserId: SELLER });

    expect(balanceOf(raw)).toBe(8_000);
    expect(feeRows(raw)).toHaveLength(2);
  });

  it("refuses a submission that has not accepted the policy", async () => {
    const { createDraft, transitionListing, raw } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);

    await expect(
      transitionListing(draft.id, "SUBMITTED", { actor: "seller", actorUserId: SELLER }),
    ).rejects.toThrow("POLICY_NOT_ACCEPTED");
    expect(feeRows(raw)).toHaveLength(0);
  });

  it("refuses an incomplete listing and names every field", async () => {
    const { createDraft, transitionListing } = await setup();
    const draft = await createDraft(SELLER, { ...DRAFT, conditionNotes: "زين" } as never);

    await expect(
      transitionListing(draft.id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      }),
    ).rejects.toThrow("LISTING_INCOMPLETE");
  });

  it("drops a photo the seller does not own", async () => {
    const { createDraft } = await setup();
    const draft = await createDraft(SELLER, {
      ...DRAFT,
      photos: [
        `/api/files/uploads/${SELLER}/mine.webp`,
        "/api/files/uploads/usr_someone_else/theirs.webp",
        "https://example.com/anything.jpg",
      ],
    } as never);

    expect(draft.photos).toEqual([`/api/files/uploads/${SELLER}/mine.webp`]);
  });
});

describe("review", () => {
  it("publishes with a window that ends after the configured number of days", async () => {
    const { createDraft, transitionListing } = await setup({
      config: { listingDurationDays: 3 },
    });
    const draft = await createDraft(SELLER, DRAFT as never);
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });

    const approved = await transitionListing(draft.id, "APPROVED", {
      actor: "admin",
      actorUserId: "usr_admin",
    });

    expect(approved.publishedAt).toBeTruthy();
    const days =
      (new Date(approved.expiresAt!).getTime() - new Date(approved.publishedAt!).getTime()) /
      86_400_000;
    expect(days).toBe(3);
  });

  it("refunds the fee when the store rejects the listing", async () => {
    const { createDraft, transitionListing, raw } = await setup({ balance: 10_000 });
    const draft = await createDraft(SELLER, DRAFT as never);
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    expect(balanceOf(raw)).toBe(9_000);

    await transitionListing(draft.id, "REJECTED", {
      actor: "admin",
      actorUserId: "usr_admin",
      note: "القطعة غير مسموح ببيعها",
    });

    expect(balanceOf(raw)).toBe(10_000);
    expect(feeRows(raw)).toHaveLength(2);
  });

  it("keeps the fee when the admin has turned refunds off", async () => {
    const { createDraft, transitionListing, raw } = await setup({
      balance: 10_000,
      config: { refundFeeOnReject: false },
    });
    const draft = await createDraft(SELLER, DRAFT as never);
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    await transitionListing(draft.id, "REJECTED", { actor: "admin", actorUserId: "usr_admin" });

    expect(balanceOf(raw)).toBe(9_000);
  });

  it("lets only one of two admins deciding at the same moment win", async () => {
    const { createDraft, transitionListing, listListingEvents, getListing } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });

    /*
      Both admins read the SUBMITTED row before either writes — the two calls
      interleave at their awaits exactly as two requests would. The status write
      is guarded on the status that was read, so the loser matches no row.
    */
    const outcomes = await Promise.allSettled([
      transitionListing(draft.id, "APPROVED", { actor: "admin", actorUserId: "usr_one" }),
      transitionListing(draft.id, "REJECTED", { actor: "admin", actorUserId: "usr_two" }),
    ]);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(String(lost[0]!.reason?.message)).toBe("LISTING_CHANGED_CONCURRENTLY");

    // And the listing carries exactly one decision, not two.
    const events = await listListingEvents(draft.id);
    expect(events.filter((e: any) => e.from_status === "SUBMITTED")).toHaveLength(1);
    expect(["APPROVED", "REJECTED"]).toContain((await getListing(draft.id))!.status);
  });

  it("refuses a move that is not in the state machine", async () => {
    const { createDraft, transitionListing } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);
    await expect(
      transitionListing(draft.id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" }),
    ).rejects.toThrow("TRANSITION_NOT_ALLOWED");
  });

  it("refuses a seller touching someone else's listing", async () => {
    const { createDraft, transitionListing } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);
    await expect(
      transitionListing(draft.id, "SUBMITTED", {
        actor: "seller",
        actorUserId: "usr_intruder",
        policyAccepted: true,
      }),
    ).rejects.toThrow("NOT_YOUR_LISTING");
  });

  it("lets an admin, and only an admin, mark an item as a store return", async () => {
    const { createDraft, transitionListing, getListing } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);
    expect(draft.isReturned).toBe(false);

    // A seller sending the flag with their own submission is ignored: the
    // مسترجع badge is a claim only the store can make.
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
      isReturned: true,
    });
    expect((await getListing(draft.id))!.isReturned).toBe(false);

    await transitionListing(draft.id, "APPROVED", {
      actor: "admin",
      actorUserId: "usr_admin",
      isReturned: true,
    });
    expect((await getListing(draft.id))!.isReturned).toBe(true);
  });

  it("writes an event row for every move", async () => {
    const { createDraft, transitionListing, listListingEvents } = await setup();
    const draft = await createDraft(SELLER, DRAFT as never);
    await transitionListing(draft.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    await transitionListing(draft.id, "UNDER_REVIEW", { actor: "admin", actorUserId: "usr_admin" });
    await transitionListing(draft.id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" });

    const events = await listListingEvents(draft.id);
    expect(events.map((e: any) => e.to_status)).toEqual(["SUBMITTED", "UNDER_REVIEW", "APPROVED"]);
  });
});

describe("the storefront list", () => {
  it("shows only approved listings whose window is still open", async () => {
    const { createDraft, transitionListing, listPublicListings, raw } = await setup();
    const live = await createDraft(SELLER, DRAFT as never);
    const pending = await createDraft(SELLER, DRAFT as never);

    for (const id of [live.id, pending.id]) {
      await transitionListing(id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      });
    }
    await transitionListing(live.id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" });

    expect((await listPublicListings()).map((l) => l.id)).toEqual([live.id]);

    // Wind the window back: an approved listing past its expiry is not public
    // even before the sweeper has had a chance to run.
    raw
      .prepare(`UPDATE used_listings SET expires_at = ? WHERE id = ?`)
      .run("2020-01-01T00:00:00.000Z", live.id);
    expect(await listPublicListings()).toEqual([]);
  });

  it("filters to one canonical product when asked", async () => {
    const { createDraft, transitionListing, listPublicListings } = await setup();
    const linked = await createDraft(SELLER, {
      ...DRAFT,
      canonicalProductId: "prd_mario",
    } as never);
    const loose = await createDraft(SELLER, DRAFT as never);
    for (const id of [linked.id, loose.id]) {
      await transitionListing(id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      });
      await transitionListing(id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" });
    }

    const filtered = await listPublicListings({ canonicalProductId: "prd_mario" });
    expect(filtered.map((l) => l.id)).toEqual([linked.id]);
  });
});

describe("the sweeper", () => {
  it("expires every listing whose window has closed and leaves the rest alone", async () => {
    const { createDraft, transitionListing, expireDueListings, getListing, raw } = await setup();
    const stale = await createDraft(SELLER, DRAFT as never);
    const fresh = await createDraft(SELLER, DRAFT as never);
    for (const id of [stale.id, fresh.id]) {
      await transitionListing(id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      });
      await transitionListing(id, "APPROVED", { actor: "admin", actorUserId: "usr_admin" });
    }
    raw
      .prepare(`UPDATE used_listings SET expires_at = ? WHERE id = ?`)
      .run("2020-01-01T00:00:00.000Z", stale.id);

    const result = await expireDueListings();

    expect(result.expired).toEqual([stale.id]);
    expect((await getListing(stale.id))!.status).toBe("EXPIRED");
    expect((await getListing(fresh.id))!.status).toBe("APPROVED");
  });
});

describe("the per-seller cap", () => {
  it("stops a seller holding more live listings than the admin allows", async () => {
    const { createDraft, transitionListing } = await setup({
      balance: 100_000,
      config: { maxActiveListingsPerSeller: 1 },
    });
    const first = await createDraft(SELLER, DRAFT as never);
    const second = await createDraft(SELLER, DRAFT as never);

    await transitionListing(first.id, "SUBMITTED", {
      actor: "seller",
      actorUserId: SELLER,
      policyAccepted: true,
    });
    await expect(
      transitionListing(second.id, "SUBMITTED", {
        actor: "seller",
        actorUserId: SELLER,
        policyAccepted: true,
      }),
    ).rejects.toThrow("TOO_MANY_ACTIVE_LISTINGS");
  });

  it("does not count drafts against the cap", async () => {
    const { createDraft, countActiveListings } = await setup();
    await createDraft(SELLER, DRAFT as never);
    await createDraft(SELLER, DRAFT as never);
    expect(await countActiveListings(SELLER)).toBe(0);
  });
});
