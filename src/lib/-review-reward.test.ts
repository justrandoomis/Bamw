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
let notification: Record<string, any> | null = null;
let insertFails: ((sql: string) => string | null) | null = null;

vi.mock("./d1.server", () => ({
  d1Run: async (sql: string, ...args: unknown[]) => {
    const failure = insertFails?.(sql);
    if (failure) throw new Error(failure);
    statements.push({ sql, args });
    if (/UPDATE review_reward_notifications/.test(sql) && notification) {
      notification = { ...notification, status: "sent", sent_at: args[0] };
    }
    if (/DELETE FROM review_reward_notifications/.test(sql)) notification = null;
    if (/DELETE FROM review_rewards/.test(sql)) ledger = null;
    return {};
  },
  d1RunChanges: async (sql: string, ...args: unknown[]) => {
    const failure = insertFails?.(sql);
    if (failure) throw new Error(failure);
    statements.push({ sql, args });
    if (/INSERT OR IGNORE INTO review_rewards/.test(sql)) {
      if (ledger) return 0;
      ledger = {
        user_id: args[1],
        coupon_code: args[2],
        amount_iqd: args[3],
        expires_at: args[4],
        issued_at: args[5],
      };
      return 1;
    }
    if (/INSERT OR IGNORE INTO review_reward_notifications/.test(sql)) {
      if (notification) return 0;
      notification = { status: "sending", attempted_at: args[1] };
      return 1;
    }
    return 0;
  },
  d1First: async (sql: string) => {
    if (/FROM review_rewards/.test(sql)) return ledger;
    if (/FROM review_reward_notifications/.test(sql)) return notification;
    return null;
  },
  d1All: async () => [],
  ensureCouponsSchema: async () => undefined,
}));

let telegramChatId: string | null = "555000111";
vi.mock("./telegram-notifications.server", () => ({
  getUserTelegramChatId: async () => telegramChatId,
}));

vi.mock("./notification-preferences.server", () => ({
  memberAllowsNotification: async () => true,
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
  status: "completed",
  items: [],
} as any;

beforeEach(() => {
  statements.length = 0;
  sent.length = 0;
  ledger = null;
  notification = null;
  telegramChatId = "555000111";
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
      user_id: "usr_9",
      coupon_code: "REV-ABCDEFGH",
      amount_iqd: 1000,
      expires_at: "2026-09-11T00:00:00.000Z",
      issued_at: "2026-09-04T00:00:00.000Z",
    };
    const { issueReviewReward } = await import("./review-reward.server");
    const reward = await issueReviewReward(ORDER);

    expect(reward?.code).toBe("REV-ABCDEFGH");
    // The durable entitlement is authoritative. Re-ensuring its coupon repairs
    // a coupon row that may have been lost without ever minting a second code.
    expect(couponInsert()!.args[1]).toBe("REV-ABCDEFGH");
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

  it("asks for the review and names the prize, without handing over a code", async () => {
    /*
      The contract changed, and this is the sentence that changed it: the code
      is no longer minted on completion. The customer is told what rating the
      order is worth and what to do; the code itself exists only after they
      submit proof and an admin approves it.
    */
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    const text = sent[0]!.text;
    expect(text).toContain("يرجى التقييم");
    expect(text).toContain("1,000");
    expect(text).toContain("منشور الإنستغرام");
    expect(text).toContain("بعد موافقة الإدارة");
    // No code, and none of the phrasing that used to accompany one.
    expect(text).not.toMatch(/REV-/);
    expect(text).not.toContain("مخصص لحسابك");
  });

  it("mints nothing at all — not a coupon, not a ledger row", async () => {
    /*
      The owner's objection in one assertion. An invitation that quietly paid
      out is what made the reward automatic; a customer must now earn it.
    */
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:00:00.000Z" });

    // The fixture starts it null, so falsy is the honest assertion here.
    expect(ledger).toBeFalsy();
    expect(couponInsert()).toBeUndefined();
  });

  it("is still sent when the member has not linked Telegram — and still mints nothing", async () => {
    telegramChatId = null;
    const { sendReviewInvitation } = await import("./review-reward.server");

    await expect(sendReviewInvitation(ORDER)).resolves.toBe(false);

    expect(ledger).toBeFalsy();
    expect(couponInsert()).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("does not send a second Telegram invitation when completion is retried", async () => {
    const { sendReviewInvitation } = await import("./review-reward.server");

    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:00:00.000Z" });
    await sendReviewInvitation(ORDER, { now: "2026-09-04T00:01:00.000Z" });

    expect(sent).toHaveLength(1);
  });
});

describe("every completion path reaches the invitation", () => {
  it.each([
    ["src/lib/order-completion.server.ts", "sendReviewInvitation("],
    ["src/lib/order-delivery-items.server.ts", "completeOrder("],
  ])("%s delegates to the central completion flow", async (file, call) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    /*
      Digital delivery must enter the central completion service, and that
      service owns the invitation. Keeping a single owner prevents one path
      from silently drifting away from the other.
    */
    expect(text).toContain(call);
  });
});
