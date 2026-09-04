/**
 * The whole shop's admin notifications stopped arriving, and this is why.
 *
 * `web_app` inline buttons exist only in a private chat with the bot. The
 * top-up card carries one, and it worked for as long as notifications went to
 * one person's private chat. The day they moved into the admin group Telegram
 * began refusing them with `Bad Request: BUTTON_TYPE_INVALID` — and it does
 * not drop the button, it refuses the whole message, so every top-up
 * notification was lost entire. Production's own log at 07:16 says exactly
 * that.
 *
 * These tests are the guard: a keyboard bound for a group carries no button a
 * group cannot hold, and a notification is never lost because of a button.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const calls: { method: string; payload: any }[] = [];
let reply: (method: string, payload: any) => any;

vi.mock("./env.server", () => ({
  env: (name: string) =>
    ({
      TELEGRAM_BOT_TOKEN: "123456:test-token",
      TELEGRAM_BOT_USERNAME: "Bananto_store_bot",
      APP_URL: "https://banan.to",
      APP_ENV: "production",
    })[name] ?? "",
  getBinding: () => undefined,
  publishEnv: () => {},
}));

beforeEach(() => {
  calls.length = 0;
  reply = () => ({ ok: true, result: { message_id: 42 } });
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    const payload = JSON.parse(init.body);
    const method = String(_url).split("/").pop() ?? "";
    calls.push({ method, payload });
    return new Response(JSON.stringify(reply(method, payload)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const webAppKeyboard = {
  inline_keyboard: [
    [
      { text: "✅ موافقة فورية", callback_data: "rq:ok:1" },
      { text: "❌ رفض", callback_data: "rq:no:1" },
    ],
    [{ text: "🔍 مراجعة في التطبيق", web_app: { url: "https://banan.to/telegram/wallet-review" } }],
    [{ text: "🌐 فتح لوحة الإدارة", url: "https://banan.to/admin" }],
  ],
};

describe("a keyboard sent to a group", () => {
  it("carries no web_app button — the type Telegram refuses there", async () => {
    const { sendTelegramMessage } = await import("./telegram.server");
    await sendTelegramMessage(-1002345678901, "top-up", { reply_markup: webAppKeyboard });

    const sent = calls[0]?.payload.reply_markup;
    const flat = sent.inline_keyboard.flat();
    expect(flat.some((b: any) => b.web_app)).toBe(false);
  });

  it("keeps the button, as a link to the same page", async () => {
    const { sendTelegramMessage } = await import("./telegram.server");
    await sendTelegramMessage(-1002345678901, "top-up", { reply_markup: webAppKeyboard });

    const flat = calls[0]?.payload.reply_markup.inline_keyboard.flat();
    const converted = flat.find((b: any) => b.text === "🔍 مراجعة في التطبيق");
    expect(converted.url).toBe("https://banan.to/telegram/wallet-review");
  });

  it("leaves callback and url buttons alone — a group accepts both", async () => {
    const { sendTelegramMessage } = await import("./telegram.server");
    await sendTelegramMessage(-1002345678901, "top-up", { reply_markup: webAppKeyboard });

    const flat = calls[0]?.payload.reply_markup.inline_keyboard.flat();
    expect(flat.filter((b: any) => b.callback_data)).toHaveLength(2);
    expect(flat.find((b: any) => b.text === "🌐 فتح لوحة الإدارة").url).toBe(
      "https://banan.to/admin",
    );
  });

  it("does not touch a keyboard bound for a private chat", async () => {
    const { sendTelegramMessage } = await import("./telegram.server");
    await sendTelegramMessage(6404042791, "top-up", { reply_markup: webAppKeyboard });

    const flat = calls[0]?.payload.reply_markup.inline_keyboard.flat();
    expect(flat.some((b: any) => b.web_app)).toBe(true);
  });
});

describe("when Telegram refuses the keyboard anyway", () => {
  it("sends the message again without it, rather than losing it", async () => {
    reply = (_method, payload) =>
      payload.reply_markup
        ? { ok: false, error_code: 400, description: "Bad Request: BUTTON_TYPE_INVALID" }
        : { ok: true, result: { message_id: 7 } };

    const { sendTelegramMessage } = await import("./telegram.server");
    const res = await sendTelegramMessage(-1002345678901, "a new order", {
      reply_markup: { inline_keyboard: [[{ text: "x", some_future_type: {} }]] },
    });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.payload.reply_markup).toBeUndefined();
    expect(calls[1]?.payload.text).toBe("a new order");
  });

  it("does not retry a refusal that has nothing to do with buttons", async () => {
    reply = () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" });

    const { sendTelegramMessage } = await import("./telegram.server");
    const res = await sendTelegramMessage(-1002345678901, "a new order", {
      reply_markup: { inline_keyboard: [[{ text: "x", url: "https://banan.to" }]] },
    });

    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
