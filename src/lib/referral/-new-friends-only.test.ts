/**
 * @vitest-environment node
 *
 * The rule the programme exists for: the code works for new customers only.
 *
 * The shop's words: the person who follows the link "must not already have an
 * account", the referrer is recorded "when they register", and the referrer's
 * ten per cent is "held pending for three days until the order is complete".
 *
 * Before this, none of that was true. Nothing recorded a referrer at signup at
 * all — `bindReferrerIfUnbound` existed for exactly that, with a comment
 * saying "a member who is not buying yet", and was wired only into checkout —
 * so `users.referred_by_user_id` stayed NULL from registration until an order
 * completed. Production bears it out: twenty-four codes minted, zero members
 * bound to a referrer, zero rewards ever paid.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = new DatabaseSync(":memory:");

vi.mock("../d1.server", () => ({
  d1First: async (sql: string, ...binds: unknown[]) => db.prepare(sql).get(...(binds as never[])),
  d1All: async (sql: string, ...binds: unknown[]) => db.prepare(sql).all(...(binds as never[])),
  d1Run: async (sql: string, ...binds: unknown[]) => {
    db.prepare(sql).run(...(binds as never[]));
  },
}));

const { checkReferredAccountIsNew, bindReferrerIfUnbound, claimFirstReferralDiscount, referralBinding } =
  await import("./binding.server");

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function seed(id: string, createdAt: string, referredBy: string | null = null) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, created_at, referred_by_user_id,
       referral_discount_used_at, first_referral_order_id)
     VALUES (?, ?, ?, NULL, NULL)`,
  ).run(id, createdAt, referredBy);
}

beforeEach(() => {
  db.exec(`DROP TABLE IF EXISTS users`);
  db.exec(`DROP TABLE IF EXISTS orders`);
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    created_at TEXT,
    referred_by_user_id TEXT,
    referral_discount_used_at TEXT,
    first_referral_order_id TEXT
  )`);
  db.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT)`);
});

describe("who the offer is for", () => {
  it("accepts somebody who had no account when they followed the link", async () => {
    // The ordinary case: the link is opened, then the account is created.
    const clicked = iso(-5_000);
    seed("usr_new", iso(0));
    expect(await checkReferredAccountIsNew("usr_new", clicked)).toEqual({ ok: true });
  });

  it("refuses a customer whose account already existed", async () => {
    /*
      This is the whole rule, stated literally: they had an account before the
      link, so the link is not bringing a new customer to the shop.
    */
    seed("usr_old", iso(-90 * 24 * HOUR));
    const check = await checkReferredAccountIsNew("usr_old", iso(-1_000));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("account_predates_link");
  });

  it("refuses somebody another member already brought in", async () => {
    seed("usr_bound", iso(0), "usr_someone_else");
    const check = await checkReferredAccountIsNew("usr_bound", iso(-5_000));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("already_referred");
  });

  it("refuses a returning customer, whatever their row says about referrers", async () => {
    seed("usr_buyer", iso(0));
    db.prepare(`INSERT INTO orders (id, user_id) VALUES ('ord_1', 'usr_buyer')`).run();
    const check = await checkReferredAccountIsNew("usr_buyer", iso(-5_000));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("existing_customer");
  });

  it("refuses an account it cannot age", async () => {
    /*
      Everywhere else in this shop a failed check allows, because the cost is a
      message nobody reads. Here the cost is money paid on a rule that was
      never established, so an unreadable `created_at` refuses.
    */
    seed("usr_undated", "");
    const check = await checkReferredAccountIsNew("usr_undated", iso(-5_000));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("unknown_account");
    expect((await checkReferredAccountIsNew("usr_missing", iso(-5_000))).reason).toBe(
      "unknown_account",
    );
  });

  it("allows the seconds between landing and registering", async () => {
    /*
      The click and the account are written by different requests, and a
      visitor who lands and signs up in one motion can put the account a moment
      "before" the click. Well under any real customer's account age, well over
      any clock skew.
    */
    seed("usr_fast", iso(-2_000));
    expect((await checkReferredAccountIsNew("usr_fast", iso(0))).ok).toBe(true);
  });
});

describe("the referrer is recorded when the friend registers", () => {
  it("is written at signup, not left until the first purchase", async () => {
    seed("usr_new", iso(0));
    await bindReferrerIfUnbound("usr_new", "usr_referrer");
    expect((await referralBinding("usr_new")).referrerUserId).toBe("usr_referrer");
  });

  it("still lets that same referrer's discount be claimed at checkout", async () => {
    /*
      The interaction that broke everything once: `claimFirstReferralDiscount`
      guarded on `referred_by_user_id IS NULL`, which was satisfiable only
      while nothing recorded a referrer before checkout. The moment signup
      began recording one, that clause could never be met and every referred
      order silently lost its discount.
    */
    seed("usr_new", iso(0));
    await bindReferrerIfUnbound("usr_new", "usr_referrer");
    const claim = await claimFirstReferralDiscount({
      userId: "usr_new",
      referrerUserId: "usr_referrer",
      orderId: "ord_1",
      now: iso(0),
    });
    expect(claim.claimed).toBe(true);
  });

  it("refuses to move the binding to a different referrer", async () => {
    seed("usr_new", iso(0));
    await bindReferrerIfUnbound("usr_new", "usr_first");
    await bindReferrerIfUnbound("usr_new", "usr_second");
    expect((await referralBinding("usr_new")).referrerUserId).toBe("usr_first");

    const claim = await claimFirstReferralDiscount({
      userId: "usr_new",
      referrerUserId: "usr_second",
      orderId: "ord_2",
      now: iso(0),
    });
    expect(claim.claimed).toBe(false);
  });

  it("gives the one lifetime discount once", async () => {
    seed("usr_new", iso(0));
    await bindReferrerIfUnbound("usr_new", "usr_referrer");
    const first = await claimFirstReferralDiscount({
      userId: "usr_new",
      referrerUserId: "usr_referrer",
      orderId: "ord_1",
      now: iso(0),
    });
    const second = await claimFirstReferralDiscount({
      userId: "usr_new",
      referrerUserId: "usr_referrer",
      orderId: "ord_2",
      now: iso(0),
    });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });
});

describe("what each side gets", () => {
  it("is ten per cent to the friend and ten to the referrer", async () => {
    const { DEFAULT_REFERRAL_SETTINGS } = await import("./config");
    const { REFERRER_PERCENT_BPS, referralAmounts } = await import("./money");

    expect(DEFAULT_REFERRAL_SETTINGS.buyerPercentBps).toBe(1_000);
    /*
      The referrer's share is fixed in code rather than read from a settings
      field — one number, in one place, that a mis-typed admin form cannot
      move. It was 5% under the previous rules.
    */
    expect(REFERRER_PERCENT_BPS).toBe(1_000);

    const amounts = referralAmounts({
      originalPriceIqd: 10_000,
      buyerPercentBps: DEFAULT_REFERRAL_SETTINGS.buyerPercentBps,
      referrerPercentBps: REFERRER_PERCENT_BPS,
      maxRewardIqd: DEFAULT_REFERRAL_SETTINGS.maxRewardIqd,
    });
    expect(amounts.buyerDiscountIqd).toBe(1_000);
    expect(amounts.referrerRewardIqd).toBe(1_000);
  });

  it("holds the referrer's money for three days", async () => {
    const { DEFAULT_REFERRAL_SETTINGS } = await import("./config");
    expect(DEFAULT_REFERRAL_SETTINGS.holdDays).toBe(3);
  });

  it("stamps that hold onto the reward row when it is written", async () => {
    const { insertRewardStatement } = await import("./rewards.server");
    const now = "2026-01-01T00:00:00.000Z";
    const statement = insertRewardStatement({
      orderId: "ord_1",
      orderItemId: "itm_1",
      productId: "prd_1",
      referrerUserId: "usr_referrer",
      buyerUserId: "usr_new",
      originalPriceIqd: 10_000,
      buyerDiscountIqd: 1_000,
      referrerRewardIqd: 1_000,
      buyerPercentBps: 1_000,
      referrerPercentBps: 1_000,
      riskScore: 0,
      riskVerdict: "clear",
      paid: true,
      holdDays: 3,
      now,
    });
    // `hold_until` is the eighteenth of the twenty-one values.
    expect(statement.params).toContain("2026-01-04T00:00:00.000Z");
    // Paid orders start pending: owed, not yet spendable.
    expect(statement.params).toContain("pending");
  });

  it("keeps the top-up cards out, because a referred card would sell at a loss", async () => {
    /*
      The $5 eShop card sells at 7,500 against a 6,800 cost. Ten per cent to
      the buyer and ten to the referrer is 1,500 against a 700 margin. The
      card's own copy already promises it is excluded from every offer.
    */
    const { DEFAULT_REFERRAL_SETTINGS } = await import("./config");
    expect(DEFAULT_REFERRAL_SETTINGS.eligibleCategories).not.toContain("gift_card");
  });
});
