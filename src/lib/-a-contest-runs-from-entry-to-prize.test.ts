/**
 * @vitest-environment node
 *
 * A contest, end to end, against a real SQLite database.
 *
 *   «الدخول للمسابقة ممكن أن يكون مجاني أو عن طريق الموز أو عن طريق التذاكر
 *    التي ينشئها الأدمن ... أو عن طريق رابط الإحالة»
 *   «انتهاء المسابقة يكون إما انتهاء يدوي أو يكون هنالك موعد للانتهاء ويكون
 *    السحب عادل عن طريق النظام يحدد التذكرة الفائزة»
 *   «في المسابقات أيضاً يضيف اللعبة في قسم جوائزي ... ويستطيع عمل استرداد
 *    لاستيراد اللعبة»
 *
 * Each test is one promise the feature makes, checked where it would break: in
 * the rows, after a double tap, a cap, a cancelled contest, a disqualified
 * winner.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__CONTEST_TEST_D1__"] = db;

vi.mock("./env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__CONTEST_TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

/* Bananas are under maintenance in production; each test says which it wants. */
let bananasClosed = true;
vi.mock("./maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./maintenance")>();
  return {
    ...actual,
    isUnderMaintenance: (feature: string) =>
      feature === "bananas" ? bananasClosed : actual.isUnderMaintenance(feature as never),
  };
});

const telegramLinked = new Set<string>();
vi.mock("./telegram-notifications.server", () => ({
  getUserTelegramChatId: async (userId: string) =>
    telegramLinked.has(userId) ? `chat-${userId}` : undefined,
}));

const sent: { chatId: string; text: string }[] = [];
vi.mock("./telegram.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./telegram.server")>();
  return {
    ...actual,
    sendTelegramMessage: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return { ok: true };
    },
    telegramPublicOrigin: () => "https://banan.to",
  };
});

vi.mock("./db.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db.server")>();
  return {
    ...actual,
    getStore: async () => ({
      products: [
        { id: "mk8", title: "Mario Kart 8 Deluxe", price: 45_000, kind: "game", image: "mk8.jpg" },
        { id: "zelda", title: "Zelda TOTK", price: 60_000, kind: "game", image: "z.jpg" },
      ],
    }),
  };
});

const giftCalls: Record<string, unknown>[] = [];
vi.mock("./wheel-gift-order.server", () => ({
  WHEEL_GIFT_SOURCE: "wheel_prize",
  createWheelGiftOrder: async (input: Record<string, unknown>) => {
    giftCalls.push(input);
    return {
      orderId: String(input["orderId"]),
      code: "BN-G-TEST",
      threadId: String(input["threadId"]),
    };
  },
}));

let contests: typeof import("./contests.server");
let roulette: typeof import("./roulette.server");
let draw: typeof import("./contestDraw");

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const ADMIN = "usr_admin";

type TestUser = import("./types").User;
const member = (id: string, extra: Partial<TestUser> = {}): TestUser =>
  ({
    id,
    name: `عضو ${id}`,
    email: `${id}@x.test`,
    createdAt: iso(-400 * DAY),
    settings: {},
    addresses: [],
    favorites: [],
    walletBalance: 0,
    ...extra,
  }) as TestUser;

function addUser(user: TestUser, bananas = 0, referredBy: string | null = null) {
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO users (id, name, email, created_at, banana_balance, referred_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, user.name, user.email, user.createdAt, bananas, referredBy);
}

const bananasOf = (id: string) =>
  Number(
    (
      db.raw.prepare(`SELECT banana_balance FROM users WHERE id = ?`).get(id) as {
        banana_balance: number;
      }
    ).banana_balance,
  );

async function openContest(settings: Record<string, unknown>): Promise<string> {
  const saved = await contests.saveContest({
    adminId: ADMIN,
    settings: {
      title: "مسابقة ماريو",
      productId: "mk8",
      entryMethods: ["free"],
      endsAt: iso(DAY),
      ...settings,
    },
  });
  if (!saved.ok) throw new Error(saved.error);
  const published = await contests.setContestStatus({
    adminId: ADMIN,
    id: saved.id,
    action: "publish",
  });
  if (!published.ok) throw new Error(published.error);
  return saved.id;
}

beforeAll(async () => {
  const { ensureSchema } = await import("./d1.server");
  await ensureSchema();
  contests = await import("./contests.server");
  roulette = await import("./roulette.server");
  draw = await import("./contestDraw");
  await contests.ensureContestSchema();
  await roulette.ensureRouletteSchema();
});

beforeEach(() => {
  for (const table of [
    "contests",
    "contest_entries",
    "contest_tickets",
    "contest_winners",
    "contest_ig_comments",
    "roulette_prizes",
    "users",
    "banana_transactions",
    "referral_attributions",
    "orders",
  ]) {
    db.raw.exec(`DELETE FROM ${table}`);
  }
  bananasClosed = true;
  telegramLinked.clear();
  sent.length = 0;
  giftCalls.length = 0;
});

describe("entering", () => {
  it("takes a member in free once, numbering their ticket", async () => {
    const id = await openContest({});
    const ali = member("usr_ali");
    addUser(ali);
    const first = await contests.enterContest({ user: ali, contestId: id, method: "free" });
    expect(first).toMatchObject({ ok: true, added: 1 });
    const again = await contests.enterContest({ user: ali, contestId: id, method: "free" });
    expect(again.ok).toBe(false);
    const view = await contests.contestView((await contests.readContestRow(id))!, ali);
    expect(view.mine).toMatchObject({ tickets: 1, entryNumbers: [1] });
    expect(view.phase).toBe("open");
  });

  it("refuses a way in the contest does not offer", async () => {
    const id = await openContest({ entryMethods: ["ticket"] });
    const ali = member("usr_ali");
    addUser(ali);
    const result = await contests.enterContest({ user: ali, contestId: id, method: "free" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps to the number of participants", async () => {
    const id = await openContest({ maxParticipants: 2 });
    for (const name of ["a", "b"]) {
      const user = member(`usr_${name}`);
      addUser(user);
      expect((await contests.enterContest({ user, contestId: id, method: "free" })).ok).toBe(true);
    }
    const late = member("usr_c");
    addUser(late);
    const refused = await contests.enterContest({ user: late, contestId: id, method: "free" });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toContain("اكتمل عدد المشاركين");
  });

  it("asks for what the admin required: Telegram, orders, an account old enough", async () => {
    const id = await openContest({
      requireTelegram: true,
      minCompletedOrders: 1,
      minAccountAgeDays: 30,
    });
    const fresh = member("usr_new", { createdAt: iso(-2 * DAY) });
    addUser(fresh);
    const refused = await contests.enterContest({ user: fresh, contestId: id, method: "free" });
    expect(refused.ok).toBe(false);
    const reason = (refused as { error: string }).error;
    expect(reason).toContain("تلغرام");
    expect(reason).toContain("طلبات");
    expect(reason).toContain("يوماً");

    const regular = member("usr_regular");
    addUser(regular);
    telegramLinked.add(regular.id);
    db.raw
      .prepare(
        `INSERT INTO orders (id, code, user_id, doc, status, payment_status, total, created_at, updated_at)
         VALUES ('o1', 'BN-1', ?, '{}', 'completed', 'paid', 1000, ?, ?)`,
      )
      .run(regular.id, iso(-DAY), iso(-DAY));
    expect((await contests.enterContest({ user: regular, contestId: id, method: "free" })).ok).toBe(
      true,
    );
  });
});

describe("tickets the admin hands out", () => {
  it("each enters once, only in its own contest, and not once revoked", async () => {
    const id = await openContest({ entryMethods: ["ticket"], maxEntriesPerUser: 5 });
    const other = await openContest({ entryMethods: ["ticket"] });
    const made = await contests.createTickets({
      adminId: ADMIN,
      contestId: id,
      count: 3,
      note: "@insta",
    });
    if (!made.ok) throw new Error(made.error);
    expect(made.codes[0]).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const [one, two, three] = made.codes as [string, string, string];

    const ali = member("usr_ali");
    const sara = member("usr_sara");
    addUser(ali);
    addUser(sara);
    // typed by hand, lower case and without the dash, still the same code
    const typed = one.replace("-", "").toLowerCase();
    expect(
      await contests.enterContest({ user: ali, contestId: id, method: "ticket", code: typed }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      (await contests.enterContest({ user: sara, contestId: id, method: "ticket", code: one })).ok,
    ).toBe(false);
    expect(
      (await contests.enterContest({ user: sara, contestId: other, method: "ticket", code: two }))
        .ok,
    ).toBe(false);

    expect((await contests.revokeTicket({ adminId: ADMIN, code: three })).ok).toBe(true);
    const revoked = await contests.enterContest({
      user: sara,
      contestId: id,
      method: "ticket",
      code: three,
    });
    expect(revoked).toMatchObject({ ok: false, status: 410 });
  });
});

describe("bananas", () => {
  it("are not spent while bananas are under maintenance", async () => {
    const id = await openContest({
      entryMethods: ["bananas"],
      bananaCost: 100,
      maxEntriesPerUser: 5,
    });
    const ali = member("usr_ali");
    addUser(ali, 1000);
    const refused = await contests.enterContest({
      user: ali,
      contestId: id,
      method: "bananas",
      count: 2,
      requestId: "press-0001",
    });
    expect(refused).toMatchObject({ ok: false, status: 503, code: "maintenance" });
    expect(bananasOf(ali.id)).toBe(1000);
  });

  it("are taken once per press, however often it is sent, and refunded when the contest is cancelled", async () => {
    bananasClosed = false;
    const id = await openContest({
      entryMethods: ["bananas"],
      bananaCost: 100,
      maxEntriesPerUser: 5,
    });
    const ali = member("usr_ali");
    addUser(ali, 1000);
    const press = {
      user: ali,
      contestId: id,
      method: "bananas" as const,
      count: 3,
      requestId: "press-0001",
    };
    expect(await contests.enterContest(press)).toMatchObject({ ok: true, added: 3 });
    expect(await contests.enterContest(press)).toMatchObject({ ok: true, added: 3 });
    expect(bananasOf(ali.id)).toBe(700);

    const tooMany = await contests.enterContest({ ...press, count: 3, requestId: "press-0002" });
    expect(tooMany.ok).toBe(false);
    expect(bananasOf(ali.id)).toBe(700);

    const cancelled = await contests.setContestStatus({ adminId: ADMIN, id, action: "cancel" });
    expect(cancelled).toMatchObject({ ok: true, refunded: 300 });
    expect(bananasOf(ali.id)).toBe(1000);
    // A second cancel refunds nothing more.
    await contests.setContestStatus({ adminId: ADMIN, id, action: "cancel" });
    expect(bananasOf(ali.id)).toBe(1000);
  });

  it("are refused when the balance cannot cover them", async () => {
    bananasClosed = false;
    const id = await openContest({
      entryMethods: ["bananas"],
      bananaCost: 500,
      maxEntriesPerUser: 5,
    });
    const ali = member("usr_ali");
    addUser(ali, 600);
    const refused = await contests.enterContest({
      user: ali,
      contestId: id,
      method: "bananas",
      count: 2,
      requestId: "press-0003",
    });
    expect(refused).toMatchObject({ ok: false, status: 402 });
    expect(bananasOf(ali.id)).toBe(600);
  });
});

describe("referrals", () => {
  it("count each friend who bought through the link since the start, once", async () => {
    const id = await openContest({ entryMethods: ["referral"], maxEntriesPerUser: 10 });
    const ali = member("usr_ali");
    addUser(ali);
    const insert = db.raw.prepare(
      `INSERT INTO referral_attributions
         (id, referrer_user_id, referred_user_id, referral_code_id, guest_session_hash, status,
          captured_at, expires_at, converted_at, updated_at)
       VALUES (?, ?, ?, 'code', ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("a1", ali.id, "usr_f1", "g1", "used", iso(-1000), iso(DAY), iso(-500), iso(-500));
    insert.run("a2", ali.id, "usr_f2", "g2", "used", iso(-1000), iso(DAY), iso(-400), iso(-400));
    insert.run("a3", ali.id, "usr_f3", "g3", "pending", iso(-1000), iso(DAY), null, iso(-400));
    insert.run(
      "a4",
      ali.id,
      "usr_f4",
      "g4",
      "used",
      iso(-9 * DAY),
      iso(DAY),
      iso(-8 * DAY),
      iso(-8 * DAY),
    );

    // The contest started before these two purchases and after the old one.
    db.raw.prepare(`UPDATE contests SET created_at = ? WHERE id = ?`).run(iso(-2 * DAY), id);
    const first = await contests.enterContest({ user: ali, contestId: id, method: "referral" });
    expect(first).toMatchObject({ ok: true, added: 2 });
    const again = await contests.enterContest({ user: ali, contestId: id, method: "referral" });
    expect(again).toMatchObject({ ok: true, added: 0 });
  });
});

describe("the draw", () => {
  it("draws once, gives the winner the game in «ألعابك», and can be re-run from its proof", async () => {
    const id = await openContest({ winnersCount: 1, alternatesCount: 2 });
    const users = ["a", "b", "c", "d", "e"].map((name) => member(`usr_${name}`));
    for (const user of users) {
      addUser(user);
      telegramLinked.add(user.id);
      await contests.enterContest({ user, contestId: id, method: "free" });
    }

    const result = await contests.drawContest({ contestId: id, actor: ADMIN });
    expect(result).toMatchObject({ ok: true, winners: 1, alternates: 2 });
    const second = await contests.drawContest({ contestId: id, actor: ADMIN });
    expect(second).toMatchObject({ ok: true, already: true });

    const winners = db.raw
      .prepare(`SELECT * FROM contest_winners WHERE contest_id = ? ORDER BY position`)
      .all(id) as { user_id: string; status: string; alternate: number; entry_no: number }[];
    expect(winners.map((w) => w.status)).toEqual(["confirmed", "standby", "standby"]);

    const prizes = await roulette.listPrizes(winners[0]!.user_id);
    expect(prizes).toHaveLength(1);
    expect(prizes[0]).toMatchObject({
      productId: "mk8",
      status: "available",
      source: "contest",
      contestId: id,
    });

    // Anyone with the seed and the numbered tickets gets the same winner.
    const view = await contests.contestView((await contests.readContestRow(id))!, null);
    expect(view.phase).toBe("drawn");
    const pool = (
      db.raw
        .prepare(`SELECT id, entry_no, user_id FROM contest_entries WHERE contest_id = ?`)
        .all(id) as {
        id: string;
        entry_no: number;
        user_id: string;
      }[]
    ).map((e) => ({ id: e.id, number: e.entry_no, holder: e.user_id }));
    const rerun = await draw.drawPicks({
      tickets: pool,
      seed: view.proof!.seed,
      winners: 1,
      alternates: 2,
    });
    expect(rerun.map((p) => p.number)).toEqual(winners.map((w) => w.entry_no));
    expect(view.proof!.poolDigest).toBe(await draw.poolDigest(pool));

    // The winner was told, on Telegram.
    expect(sent.some((m) => m.chatId === `chat-${winners[0]!.user_id}`)).toBe(true);
  });

  it("holds the game until the admin confirms, when asked to", async () => {
    const id = await openContest({ requireConfirmation: true });
    const ali = member("usr_ali");
    addUser(ali);
    await contests.enterContest({ user: ali, contestId: id, method: "free" });
    await contests.drawContest({ contestId: id, actor: ADMIN });
    expect(await roulette.listPrizes(ali.id)).toHaveLength(0);
    const winner = db.raw
      .prepare(`SELECT id, status FROM contest_winners WHERE contest_id = ?`)
      .get(id) as {
      id: string;
      status: string;
    };
    expect(winner.status).toBe("pending");
    expect((await contests.confirmWinner({ adminId: ADMIN, winnerId: winner.id })).ok).toBe(true);
    expect(await roulette.listPrizes(ali.id)).toHaveLength(1);
  });

  it("replaces a disqualified winner with the next alternate of the same draw", async () => {
    const id = await openContest({ winnersCount: 1, alternatesCount: 1 });
    for (const name of ["a", "b"]) {
      const user = member(`usr_${name}`);
      addUser(user);
      await contests.enterContest({ user, contestId: id, method: "free" });
    }
    await contests.drawContest({ contestId: id, actor: ADMIN });
    const [first, backup] = db.raw
      .prepare(
        `SELECT id, user_id, prize_id FROM contest_winners WHERE contest_id = ? ORDER BY position`,
      )
      .all(id) as { id: string; user_id: string; prize_id: string | null }[];

    const out = await contests.disqualifyWinner({
      adminId: ADMIN,
      winnerId: first!.id,
      reason: "لم يشارك ستوري",
    });
    expect(out).toMatchObject({ ok: true, promoted: backup!.id });
    expect((await roulette.listPrizes(first!.user_id))[0]?.status).toBe("expired");
    expect(await roulette.listPrizes(backup!.user_id)).toHaveLength(1);
  });

  it("happens by itself once the end time passes", async () => {
    const id = await openContest({});
    const ali = member("usr_ali");
    addUser(ali);
    await contests.enterContest({ user: ali, contestId: id, method: "free" });
    db.raw.prepare(`UPDATE contests SET ends_at = ? WHERE id = ?`).run(iso(-1000), id);

    const late = member("usr_late");
    addUser(late);
    expect((await contests.enterContest({ user: late, contestId: id, method: "free" })).ok).toBe(
      false,
    );

    expect(await contests.settleDueContests()).toBe(1);
    expect((await contests.readContestRow(id))?.status).toBe("drawn");
    expect(await roulette.listPrizes(ali.id)).toHaveLength(1);
  });

  it("imports the won game as a contest gift order", async () => {
    const id = await openContest({});
    const ali = member("usr_ali");
    addUser(ali);
    await contests.enterContest({ user: ali, contestId: id, method: "free" });
    await contests.drawContest({ contestId: id, actor: ADMIN });
    const [prize] = await roulette.listPrizes(ali.id);
    const { importPrize } = await import("./roulette-import.server");
    const imported = await importPrize({ userId: ali.id, prizeId: prize!.id });
    expect(imported.ok).toBe(true);
    expect(giftCalls[0]).toMatchObject({ productId: "mk8", occasion: "contest" });
  });
});

describe("drawing from Instagram comments", () => {
  it("applies the rules, draws one ticket per account, and the winner claims the game with a code", async () => {
    const saved = await contests.saveContest({
      adminId: ADMIN,
      settings: {
        title: "مسابقة إنستغرام",
        productId: "zelda",
        drawSource: "instagram",
        instagramUrl: "https://www.instagram.com/p/DUBtwxGEqz2/",
        winnersCount: 1,
        alternatesCount: 1,
        igFilters: { minMentions: 2, excludeAccounts: ["banan.to"] },
      },
    });
    if (!saved.ok) throw new Error(saved.error);
    await contests.setContestStatus({ adminId: ADMIN, id: saved.id, action: "publish" });

    const pasted = await contests.importPastedComments({
      contestId: saved.id,
      raw: ["sara: @a @b", "sara: @c @d", "omar: @a", "banan.to: @a @b", "lina: @x @y أتمنى"].join(
        "\n",
      ),
    });
    expect(pasted).toMatchObject({ ok: true, added: 5 });

    const preview = await contests.previewInstagram({ contestId: saved.id });
    expect(preview?.stats).toMatchObject({ qualifiedAccounts: 2, duplicatesDropped: 1 });

    const result = await contests.drawFromInstagram({ contestId: saved.id, actor: ADMIN });
    expect(result).toMatchObject({ ok: true, winners: 1, alternates: 1 });
    const [winner] = db.raw
      .prepare(
        `SELECT instagram_username, claim_code FROM contest_winners WHERE contest_id = ? ORDER BY position`,
      )
      .all(saved.id) as { instagram_username: string; claim_code: string }[];
    expect(["sara", "lina"]).toContain(winner!.instagram_username);

    const ali = member("usr_ali");
    addUser(ali);
    const claimed = await contests.claimContestPrize({
      user: ali,
      code: contests.formatContestCode(winner!.claim_code),
    });
    expect(claimed.ok).toBe(true);
    expect(await roulette.listPrizes(ali.id)).toHaveLength(1);
    const thief = member("usr_thief");
    addUser(thief);
    expect((await contests.claimContestPrize({ user: thief, code: winner!.claim_code })).ok).toBe(
      false,
    );
  });
});
