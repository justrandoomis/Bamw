/**
 * @vitest-environment node
 */
/**
 * Where an admin notification goes, and what must never go with it.
 *
 * Two things are being held here. First, that a group with Forum Topics gets
 * each kind in its own topic while a group without them still separates them
 * by eye — because which of the two a shop has is not knowable from here.
 * Second, that a password, a one-time code or a key never reaches a group
 * chat: a private conversation with one admin and a group somebody is added
 * to next week are not the same risk.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRETS: Record<string, string> = {};

vi.mock("./env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({}),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("./telegram-notifications.server", () => ({
  getAdminTelegramChatId: () => "6404042791",
}));

let routing: typeof import("./telegram-admin-routing.server");

beforeEach(async () => {
  for (const key of Object.keys(SECRETS)) delete SECRETS[key];
  vi.resetModules();
  routing = await import("./telegram-admin-routing.server");
});

describe("adminRoute", () => {
  it("keeps notifying the old chat until a group is configured", async () => {
    /*
      The secret will not be set at the moment this deploys. A feature that
      silently stops notifying anybody the instant it ships is worse than the
      problem it fixes.
    */
    const route = routing.adminRoute("order");
    expect(route.chatId).toBe("6404042791");
    expect(route.isGroup).toBe(false);
    expect(route.messageThreadId).toBeUndefined();
    expect(route.prefix).toContain("الطلبات");
  });

  it("sends each kind to its own topic when the group has them", async () => {
    SECRETS["TELEGRAM_ADMIN_GROUP_ID"] = "-1001234567890";
    SECRETS["TELEGRAM_ORDERS_TOPIC_ID"] = "11";
    SECRETS["TELEGRAM_WALLET_TOPIC_ID"] = "22";
    SECRETS["TELEGRAM_SUPPORT_TOPIC_ID"] = "33";
    vi.resetModules();
    routing = await import("./telegram-admin-routing.server");

    expect(routing.adminRoute("order")).toMatchObject({
      chatId: "-1001234567890",
      messageThreadId: 11,
      isGroup: true,
    });
    expect(routing.adminRoute("wallet").messageThreadId).toBe(22);
    expect(routing.adminRoute("support").messageThreadId).toBe(33);
  });

  it("drops the prefix inside a topic and keeps it without one", async () => {
    // The topic's own name already says which kind this is; repeating it
    // costs the first line of every card in a list people scan quickly.
    SECRETS["TELEGRAM_ADMIN_GROUP_ID"] = "-100999";
    SECRETS["TELEGRAM_ORDERS_TOPIC_ID"] = "7";
    vi.resetModules();
    routing = await import("./telegram-admin-routing.server");

    expect(routing.adminRoute("order").prefix).toBe("");
    // No topic configured for wallet: the prefix is what separates them.
    const wallet = routing.adminRoute("wallet");
    expect(wallet.messageThreadId).toBeUndefined();
    expect(wallet.prefix).toContain("المحفظة");
    expect(routing.withRoutePrefix(wallet, "x")).toContain("المحفظة");
  });

  it("ignores a topic id that is not a topic id", async () => {
    // Group ids are negative; a topic never is. A mis-pasted group id in the
    // topic slot would otherwise be sent as `message_thread_id` and rejected.
    SECRETS["TELEGRAM_ADMIN_GROUP_ID"] = "-100999";
    SECRETS["TELEGRAM_ORDERS_TOPIC_ID"] = "-1001234567890";
    vi.resetModules();
    routing = await import("./telegram-admin-routing.server");
    expect(routing.adminRoute("order").messageThreadId).toBeUndefined();
  });
});

describe("findForbiddenSecret", () => {
  it("catches the things that must never reach a group", async () => {
    expect(routing.findForbiddenSecret("الحساب: abc 密码: hunter2")).toBe("password");
    expect(routing.findForbiddenSecret("password: hunter2")).toBe("password");
    expect(routing.findForbiddenSecret("رمز التحقق: 483920")).toBe("otp");
    expect(routing.findForbiddenSecret("api_key = sk-abc")).toBe("api_key");
    expect(
      routing.findForbiddenSecret("123456789:AAHkQwEr_tyuiopASDFGHJKLzxcvbnm12345"),
    ).toBe("bot_token");
  });

  it("matches the Arabic spellings, which a word boundary would not", async () => {
    /*
      Regression guard. `\bرمز` cannot match: JavaScript's word boundary is
      defined on ASCII word characters, so the position before an Arabic
      letter is never one. The first version of these patterns had `\b`
      around the Arabic alternatives and matched nothing at all — a guard
      failing in the one way that leaves no trace.
    */
    expect(routing.findForbiddenSecret("رمز التحقق 483920")).toBe("otp");
    expect(routing.findForbiddenSecret("كلمة المرور: hunter2")).toBe("password");
    expect(routing.findForbiddenSecret("باسورد = abc123")).toBe("password");
  });

  it("leaves an ordinary order message alone", async () => {
    const text =
      "🧾 طلب جديد BN-000123\nاللعبة: Super Mario Odyssey\nحساب أوفلاين • Nintendo Switch 2\nالكمية: 1";
    expect(routing.findForbiddenSecret(text)).toBeUndefined();
  });
});
