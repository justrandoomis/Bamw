/**
 * "الطلب المكتمل لا يرسل زر للتقييم مع خطوات التقييم وكود الخصم الصالح ل٧ ايام
 * بقيمه الف دينار."
 *
 * Of the four things asked for, one existed: a rating card posted into the
 * website conversation. The Telegram message did not exist — the digital
 * delivery path, which is the shop's main product, contained no notification
 * call at all, so a customer who closed the app was never told the order had
 * finished. The steps did not exist. And the reward did not exist: the one
 * function in the repository that minted a coupon had no callers, was keyed to
 * an admin approving a review rather than to an order finishing, and read
 * `review.userId` off a raw snake_case D1 row — so the code it would have
 * written was usable by anyone who learned it.
 *
 * What is asserted here is the part that must not drift: the code is worth
 * 1000 IQD, lasts 7 days, belongs to one customer, and is minted once per
 * order however many paths complete it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const statements: { sql: string; args: unknown[] }[] = [];
let ledger: Record<string, any> | null = null;
let insertFails: ((sql: string) => string | null) | null = null;

vi.mock("./d1.server", () => ({
  d1Run: async (sql: string, ...args: unknown[]) => {
    const failure = insertFails?.(sql);
    if (failure) throw new Error(failure);
    statements.push({ sql, args });
    return {};
  },
  d1First: async (sql: string) => (/FROM review_rewards/.test(sql) ? ledger : null),
}));

vi.mock("./telegram-notifications.server", () => ({
  getUserTelegramChatId: async () => "555000111",
}));

const sent: { chatId: string | number; text: string; options: any }[] = [];
vi.mock("./telegram.server", () => ({
  sendTelegramMessage: async (chatId: string | number, text: string, options: any) => {
    sent.push({ chatId, text, options });
    return { ok: true, result: { message_id: 1 } };
  },
  escapeHtml: (t: string) => t,
  telegramMiniAppDeepLink: (p: string) => `https://t.me/bot?startapp=${p}`,
}));

const ORDER = {
  id: "ord_1",
  code: "BNT-1234",
  userId: "usr_9",
  items: [],
} as any;

beforeEach(() => {
  statements.length = 0;
  sent.length = 0;
  ledger = null;
  insertFails = null;
  vi.resetModules();
});

const couponInsert = () => statements.find((s) => s.sql.includes("INSERT INTO coupons"));

describe("the reward code", () => {
  it("is worth 1000 dinars, as a fixed amount rather than a percentage", async () => {
    const { issueReviewReward } = await import("./review-reward.server");
    await issueReviewReward(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    const insert = couponInsert();
    expect(insert).toBeDefined();
    expect(insert!.args).toContain("fixed");
    expect(insert!.args).toContain(1000);
  });

  it("expires seven days after it is issued", async () => {
    const { issueReviewReward } = await import("./review-reward.server");
    const reward = await issueReviewReward(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    expect(reward?.expiresAt).toBe("2026-09-11T00:00:00.000Z");
    expect(couponInsert()!.args).toContain("2026-09-11T00:00:00.000Z");
  });

  it("belongs to the customer who earned it, and to nobody else", async () => {
    /*
      `eligible_users` is what `checkCoupon` refuses everyone else by. Without
      it the code works for whoever is shown it in a screenshot.
    */
    const { issueReviewReward } = await import("./review-reward.server");
    await issueReviewReward(ORDER);

    expect(couponInsert()!.args).toContain(JSON.stringify(["usr_9"]));
  });

  it("can be spent once, by one member", async () => {
    const { issueReviewReward } = await import("./review-reward.server");
    await issueReviewReward(ORDER);

    const insert = couponInsert()!;
    const usageLimit = insert.args[6];
    const perUserLimit = insert.args[7];
    expect(usageLimit).toBe(1);
    expect(perUserLimit).toBe(1);
  });

  it("is drawn from an alphabet with no characters that read alike", async () => {
    const { issueReviewReward } = await import("./review-reward.server");
    const reward = await issueReviewReward(ORDER);

    expect(reward?.code).toMatch(/^REV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    // No O/0 or I/1 to mistype off a screenshot.
    expect(reward!.code.slice(4)).not.toMatch(/[O0I1]/);
  });
});

describe("minting is once per order", () => {
  it("returns the existing code rather than a second one", async () => {
    ledger = {
      coupon_code: "REV-ABCDEFGH",
      amount_iqd: 1000,
      expires_at: "2026-09-11T00:00:00.000Z",
    };
    const { issueReviewReward } = await import("./review-reward.server");
    const reward = await issueReviewReward(ORDER);

    expect(reward?.code).toBe("REV-ABCDEFGH");
    expect(couponInsert()).toBeUndefined();
  });

  it("never lets a failure become the order's problem", async () => {
    insertFails = () => "D1 is down";
    const { issueReviewReward } = await import("./review-reward.server");

    await expect(issueReviewReward(ORDER)).resolves.toBeNull();
  });
});

describe("the invitation", () => {
  it("carries numbered steps, because the card is somewhere they have to go", async () => {
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    const text = sent[0]!.text;
    expect(text).toContain("1️⃣");
    expect(text).toContain("2️⃣");
    expect(text).toContain("3️⃣");
  });

  it("carries a button that opens the order", async () => {
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER);

    const button = sent[0]!.options.reply_markup.inline_keyboard[0][0];
    expect(button.url).toContain("order_ord_1");
    /*
      A `url` button, not `web_app`: the same refusal that silenced every
      admin notification applies to any chat Telegram does not consider
      private, and this one is worth keeping simple.
    */
    expect(button.web_app).toBeUndefined();
  });

  it("states the amount, the expiry date and that the code is theirs alone", async () => {
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    const text = sent[0]!.text;
    expect(text).toContain("1,000");
    expect(text).toContain("2026-09-11");
    expect(text).toContain("مخصص لحسابك");
  });

  it("still congratulates the customer when no code could be minted", async () => {
    /*
      The order really is finished. Telling them nothing because the reward
      failed would be the worse of the two outcomes.
    */
    insertFails = (sql) => (sql.includes("INSERT INTO coupons") ? "D1 is down" : null);
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("تم اكتمال طلبك");
    expect(sent[0]!.text).not.toContain("كود خصم");
  });
});

describe("both completion paths invite the customer", () => {
  it.each([
    ["src/lib/order-completion.server.ts", "the admin, customer and timer path"],
    ["src/lib/order-delivery-items.server.ts", "the digital-delivery path"],
  ])("%s calls sendReviewInvitation", async (file) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    /*
      Two independent completion paths exist, each with its own rating card.
      Wiring one and not the other is how half the customers would keep
      hearing nothing.
    */
    expect(text).toContain("sendReviewInvitation(");
  });
});
