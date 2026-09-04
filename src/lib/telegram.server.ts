import { env } from "./env.server";

/**
 * Telegram Bot API client (Cloudflare Workers compatible — fetch only).
 *
 * Every call goes through `callTelegram`, so the API host, logging and error
 * handling stay identical across all helpers. Tokens are never logged.
 */

export interface TelegramResponse<T = any> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  status?: number;
  error?: string;
}

/** Normalized API host — always a valid https origin without trailing slash. */
export function telegramApiHost(): string {
  const raw = (env("TELEGRAM_API_HOST") || "").trim();
  if (!raw) return "https://api.telegram.org";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      // Allow http only in local development if explicitly set
      if (env("APP_ENV") === "production" || url.protocol !== "http:") {
        throw new Error("bad protocol");
      }
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "https://api.telegram.org";
  }
}

export function telegramConfigured(): boolean {
  const token = env("TELEGRAM_BOT_TOKEN");
  return typeof token === "string" && token.length > 20;
}

/** Bot username used for deep links, without the leading @. */
export function telegramBotUsername(): string {
  const configured = (env("TELEGRAM_BOT_USERNAME") || "").replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(configured) ? configured : "Bananto_store_bot";
}

/** Canonical public origin used in Telegram webhook and Web App URLs. */
export function telegramPublicOrigin(): string {
  const fallback = "https://banan.to";
  const configured = (env("APP_URL") || fallback).trim();
  try {
    const url = new URL(configured);
    const isLocalDevelopment =
      env("APP_ENV") !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLocalDevelopment) return fallback;
    if (url.username || url.password) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

/** Standard bot deep link. `/start TOKEN` is reliable across Telegram clients. */
export function telegramBotStartDeepLink(startParam: string): string {
  return `https://t.me/${telegramBotUsername()}?start=${encodeURIComponent(startParam)}`;
}

/**
 * Web App URL carrying the reference explicitly for clients that omit
 * start_param.
 *
 * `/telegram` is the ownership-proof screen and needs a reference to do
 * anything. Pointing the bot's plain "open the app" button at it meant every
 * member who tapped the menu button landed on "رمز التحقق غير موجود" instead of
 * the store, so without a reference this is the storefront.
 */
export function telegramWebAppUrl(startParam?: string): string {
  if (!startParam) return telegramPublicOrigin();
  const url = new URL("/telegram", telegramPublicOrigin());
  url.searchParams.set("session", startParam);
  return url.toString();
}

/** Official Telegram Mini App link, optionally targeting a named app. */
export function telegramMiniAppDeepLink(startParam: string): string {
  const bot = telegramBotUsername();
  const shortName = (env("TELEGRAM_MINI_APP_SHORT_NAME") || "").trim().replace(/^\/+|\/+$/g, "");
  const appPath = shortName ? `/${encodeURIComponent(shortName)}` : "";
  return `https://t.me/${bot}${appPath}?startapp=${encodeURIComponent(startParam)}`;
}

/** Low-level Bot API call. Never throws; never logs the token. */
export async function callTelegram<T = any>(
  method: string,
  payload?: Record<string, unknown>,
): Promise<TelegramResponse<T>> {
  const token = env("TELEGRAM_BOT_TOKEN");

  if (!token) {
    console.error(`[telegram:error] ${method} failed: TELEGRAM_BOT_TOKEN_MISSING`);
    return {
      ok: false,
      error: "TELEGRAM_BOT_TOKEN_MISSING",
    };
  }

  const host = telegramApiHost();
  const url = `${host}/bot${token}/${method}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let data: TelegramResponse<T>;
    try {
      data = (await response.json()) as TelegramResponse<T>;
    } catch (err) {
      data = { ok: false, description: "INVALID_JSON_RESPONSE" };
    }

    data.status = response.status;

    if (!response.ok || !data.ok) {
      console.error(`[telegram:error] ${method} failed`, {
        status: response.status,
        error_code: data.error_code,
        description: data.description,
      });
    }

    return data;
  } catch (error: any) {
    console.error(
      `[telegram:error] ${method} network failure`,
      error?.name === "AbortError" ? "TIMEOUT" : String(error),
    );

    return {
      ok: false,
      error: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
    };
  }
}

/** True when the text carries markup Telegram must parse as HTML. */
function looksLikeHtml(text: string): boolean {
  return /<\/?(b|i|u|s|a|code|pre|tg-spoiler|blockquote)\b[^>]*>/i.test(text);
}

/**
 * Checks if a Telegram user is subscribed to a required channel (e.g. @banan_to).
 */
export async function checkChannelSubscription(
  userId: string | number,
  channel: string = "@banan_to",
): Promise<{ isMember: boolean; error?: string }> {
  try {
    const formattedChannel = channel.startsWith("@") ? channel : `@${channel}`;
    const res = await callTelegram<{ status: string }>("getChatMember", {
      chat_id: formattedChannel,
      user_id: Number(userId),
    });
    if (!res.ok || !res.result) {
      return { isMember: false, error: res.description };
    }
    const status = res.result.status;
    const isMember = ["creator", "administrator", "member", "restricted"].includes(status);
    return { isMember };
  } catch (err: any) {
    return { isMember: false, error: err?.message };
  }
}

/**
 * Sends a plain message. `parse_mode` is only added when the caller asks for
 * it or the text actually contains supported HTML tags — an unparsable body
 * must never be the reason a message fails.
 */
/**
 * Is this destination a group, a supergroup or a channel?
 *
 * Telegram gives every one of them a negative id and every user a positive
 * one, and a channel can also be addressed by `@username`. The routing module
 * already depends on the same invariant.
 */
function isGroupChat(chatId: string | number): boolean {
  const raw = String(chatId).trim();
  if (raw.startsWith("@")) return true;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed < 0 : false;
}

/**
 * The same keyboard, with the buttons a group cannot carry made into ones it
 * can.
 *
 * `web_app` buttons exist only in a private chat with the bot. Sending one to
 * a group does not drop the button — Telegram refuses the entire message with
 * `Bad Request: BUTTON_TYPE_INVALID`, so the notification is lost whole.
 *
 * That is what stopped every admin notification the day the shop's
 * notifications moved from one person's private chat into the admin group.
 * The top-up card carries a "review in the app" `web_app` button, and it had
 * always worked, because until then it had only ever been sent to a private
 * chat.
 *
 * A Mini App opened from a `web_app` button and the same page opened from a
 * `url` button are the same page, so the conversion loses the inline frame
 * and nothing else.
 */
export function groupSafeReplyMarkup(markup: unknown): unknown {
  const keyboard = (markup as { inline_keyboard?: unknown })?.inline_keyboard;
  if (!Array.isArray(keyboard)) return markup;

  let changed = false;
  const rows = keyboard.map((row) =>
    (Array.isArray(row) ? row : []).map((button) => {
      const webApp = (button as { web_app?: { url?: unknown } })?.web_app;
      const url = typeof webApp?.url === "string" ? webApp.url : "";
      if (!url) return button;
      changed = true;
      const { web_app: _dropped, ...rest } = button as Record<string, unknown>;
      return { ...rest, url };
    }),
  );

  return changed ? { ...(markup as object), inline_keyboard: rows } : markup;
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options: Record<string, unknown> = {},
): Promise<TelegramResponse> {
  const payload: Record<string, unknown> = { chat_id: chatId, text, ...options };
  if (!("parse_mode" in options) && looksLikeHtml(text)) payload["parse_mode"] = "HTML";
  if (payload["reply_markup"] && isGroupChat(chatId)) {
    payload["reply_markup"] = groupSafeReplyMarkup(payload["reply_markup"]);
  }

  const res = await callTelegram("sendMessage", payload);

  /*
    A notification is worth more than its buttons.

    If Telegram still refuses the keyboard — a button type this does not know
    about, or one added later — the message is sent again without it rather
    than lost. Whoever is waiting on it gets the order, the top-up or the
    customer's message, and loses a shortcut.
  */
  if (!res.ok && payload["reply_markup"] && /BUTTON/i.test(res.description ?? "")) {
    console.warn("[telegram:keyboard_rejected]", {
      description: res.description,
      retrying_without_buttons: true,
    });
    const { reply_markup: _rejected, ...withoutButtons } = payload;
    return callTelegram("sendMessage", withoutButtons);
  }

  return res;
}

/**
 * Send a picture, as bytes, rather than a link to one.
 *
 * The shop's own uploads live behind a session guard — `/api/files/chat/...`
 * answers 404 without a cookie — so Telegram cannot fetch a customer's
 * attachment by URL, and the URL is relative anyway. Uploading the bytes is
 * the only way the admin sees the picture, and it is also the right one: the
 * file never becomes publicly readable to make it viewable in Telegram.
 *
 * `sendPhoto` re-encodes and caps the long side at 1280, which is fine for a
 * receipt or a screenshot; a file Telegram will not accept as a photo is worth
 * falling back on rather than losing, so the caller is told and can send the
 * caption alone.
 */
export async function sendTelegramPhoto(
  chatId: string | number,
  bytes: Uint8Array,
  options: {
    filename?: string;
    mime?: string;
    caption?: string;
    parseMode?: string;
    messageThreadId?: number;
  } = {},
): Promise<TelegramResponse> {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) {
    console.error("[telegram:error] sendPhoto failed: TELEGRAM_BOT_TOKEN_MISSING");
    return { ok: false, error: "TELEGRAM_BOT_TOKEN_MISSING" };
  }

  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (options.caption) {
    /* Telegram caps a caption at 1024 characters and rejects the whole send over it. */
    form.append("caption", options.caption.slice(0, 1024));
    form.append("parse_mode", options.parseMode ?? "HTML");
  }
  if (options.messageThreadId) form.append("message_thread_id", String(options.messageThreadId));
  form.append(
    "photo",
    new Blob([bytes as unknown as BlobPart], { type: options.mime || "image/jpeg" }),
    options.filename || "photo.jpg",
  );

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(`${telegramApiHost()}/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    let data: TelegramResponse;
    try {
      data = (await response.json()) as TelegramResponse;
    } catch {
      data = { ok: false, description: "INVALID_JSON_RESPONSE" };
    }
    data.status = response.status;
    if (!data.ok) {
      console.error("[telegram:error] sendPhoto failed", {
        status: response.status,
        error_code: data.error_code,
        description: data.description,
      });
    }
    return data;
  } catch (error: any) {
    console.error(
      "[telegram:error] sendPhoto network failure",
      error?.name === "AbortError" ? "TIMEOUT" : String(error),
    );
    return { ok: false, error: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  }
}

/** Bot identity — used by diagnostics and health checks. */
export async function getMe(): Promise<TelegramResponse> {
  return callTelegram("getMe");
}

export async function editTelegramMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  };
  if (!("parse_mode" in options) && looksLikeHtml(text)) payload["parse_mode"] = "HTML";
  const res = await callTelegram("editMessageText", payload);
  return res.ok;
}

export async function getChatMember(chatId: string | number, userId: number) {
  const res = await callTelegram("getChatMember", { chat_id: chatId, user_id: userId });
  return res.ok ? res.result : null;
}

export async function sendTelegramPoll(
  chatId: string | number,
  question: string,
  options: string[],
  extra: Record<string, unknown> = {},
): Promise<TelegramResponse> {
  return callTelegram("sendPoll", { chat_id: chatId, question, options, ...extra });
}

export async function pinTelegramMessage(
  chatId: string | number,
  messageId: number,
): Promise<boolean> {
  const res = await callTelegram("pinChatMessage", { chat_id: chatId, message_id: messageId });
  return res.ok;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  options?: string | { text?: string; show_alert?: boolean; showAlert?: boolean },
): Promise<boolean> {
  const text = typeof options === "string" ? options : options?.text;
  const showAlert =
    typeof options === "object" ? (options?.show_alert ?? options?.showAlert) : false;
  const res = await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    ...(showAlert !== undefined ? { show_alert: showAlert } : {}),
  });
  return res.ok;
}

export async function getWebhookInfo(): Promise<TelegramResponse> {
  return callTelegram("getWebhookInfo");
}

/** Escapes HTML special characters for Telegram messages. */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * The webhook secret must be configured explicitly in production.
 * The value must meet Telegram's secret-token character restrictions.
 */
export function requireWebhookSecret(): string {
  const secret = env("TELEGRAM_WEBHOOK_SECRET");
  const isProd = env("APP_ENV") === "production";

  // Telegram accepts 1-256 characters. We require 16+ for compatibility with
  // existing random secrets while still rejecting trivial values.
  if (secret && secret.length >= 16 && secret.length <= 256 && /^[A-Za-z0-9_-]+$/.test(secret)) {
    return secret;
  }

  if (isProd) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET_MISSING_PRODUCTION");
  }

  throw new Error("TELEGRAM_WEBHOOK_SECRET_MISSING");
}

let webhookReconciliation: Promise<boolean> | undefined;
let lastWebhookAttemptAt = 0;

/**
 * Idempotently re-register the webhook with the current secret. This repairs a
 * stale Telegram-side secret after a rotation/deployment without dropping any
 * pending ownership updates.
 */
export async function reconcileTelegramWebhook(force = false): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const now = Date.now();
  if (!force && now - lastWebhookAttemptAt < 5 * 60 * 1000) return true;
  if (webhookReconciliation) return webhookReconciliation;
  lastWebhookAttemptAt = now;

  webhookReconciliation = (async () => {
    let secret: string;
    try {
      secret = requireWebhookSecret();
    } catch (error) {
      console.error(
        "[telegram:error] webhook reconciliation skipped: secret not configured",
        error instanceof Error ? error.message : "unknown",
      );
      return false;
    }

    const result = await callTelegram("setWebhook", {
      url: `${telegramPublicOrigin()}/api/public/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    if (result.ok) console.info("[telegram] webhook configuration reconciled");
    return result.ok;
  })();

  try {
    return await webhookReconciliation;
  } finally {
    webhookReconciliation = undefined;
  }
}

/**
 * Validates Telegram Mini App initData against the BOT_TOKEN.
 * Based on: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
/** Why a Mini App launch payload was rejected — logged and returned to the client. */
export type TelegramInitDataReason =
  "bot_token_missing" | "malformed" | "stale" | "bad_signature" | "no_user";

/**
 * Maximum accepted age of a Mini App launch payload, in seconds.
 *
 * Telegram signs `initData` once, when the Mini App is launched, and never
 * refreshes it — reloading the page (including the app's own "retry" button)
 * replays the original `auth_date`. A ten-minute ceiling therefore made the
 * Mini App fail permanently for anyone who paused partway through, while adding
 * nothing: the reference it authenticates is a single-use session that expires
 * on its own after ten minutes.
 */
function initDataMaxAgeSeconds(): number {
  const configured = Number(env("TELEGRAM_INIT_DATA_MAX_AGE") ?? "");
  return Number.isSafeInteger(configured) && configured >= 60 && configured <= 86400
    ? configured
    : 3600;
}

export async function verifyTelegramInitData(initData: string): Promise<{
  valid: boolean;
  reason?: TelegramInitDataReason;
  user?: {
    id: number;
    username?: string;
    first_name: string;
    last_name?: string;
    language_code?: string;
    is_premium?: boolean;
    allows_write_to_pm?: boolean;
  };
  authDate?: number;
  startParam?: string;
}> {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) return { valid: false, reason: "bot_token_missing" };
  if (!initData || initData.length > 8192) return { valid: false, reason: "malformed" };

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { valid: false, reason: "malformed" };

    // Replay protection. The signature is still checked below, so this only
    // bounds how long a captured payload stays usable.
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(authDate) ||
      authDate <= 0 ||
      now - authDate > initDataMaxAgeSeconds() ||
      authDate - now > 300
    ) {
      console.warn("[telegram:warn] initData outside accepted time window");
      return { valid: false, reason: "stale" };
    }

    // 1. Sort all parameters (except hash) alphabetically
    const keys = Array.from(params.keys())
      .filter((k) => k !== "hash")
      .sort();
    const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");

    // 2. Compute the secret key: HMAC-SHA256("WebAppData", BOT_TOKEN)
    const encoder = new TextEncoder();
    const webAppDataKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const secretKeyBuffer = await crypto.subtle.sign("HMAC", webAppDataKey, encoder.encode(token));

    // 3. Compute the HMAC-SHA256(data_check_string, secret_key)
    //
    // The key usages must include "verify": WebCrypto enforces them, so a key
    // imported for "sign" alone made crypto.subtle.verify throw
    // InvalidAccessError on *every* launch. The throw landed in the catch below
    // and was reported as an unverifiable Telegram session, which is why the
    // Mini App never worked while the bot's own contact-share flow did.
    const secretKey = await crypto.subtle.importKey(
      "raw",
      secretKeyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const provided = new Uint8Array(hash.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
    if (
      !(await crypto.subtle.verify("HMAC", secretKey, provided, encoder.encode(dataCheckString)))
    ) {
      return { valid: false, reason: "bad_signature" };
    }

    const userJson = params.get("user");
    const user = userJson ? JSON.parse(userJson) : undefined;
    if (
      !user ||
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      typeof user.first_name !== "string" ||
      user.first_name.length > 128
    ) {
      return { valid: false, reason: "no_user" };
    }

    // A `start_param` this app cannot use is not a reason to reject an
    // authenticated launch: Telegram populates it from links the bot does not
    // control (`?startapp=…`, menu-button launches), and discarding the whole
    // payload turned any such launch into "could not verify Telegram session".
    // Drop the unusable value and let the caller fall back to the reference the
    // Mini App carries in its own URL.
    const rawStartParam = params.get("start_param");
    const startParam =
      rawStartParam && /^[A-Za-z0-9_-]{16,128}$/.test(rawStartParam) ? rawStartParam : undefined;
    return {
      valid: true,
      user,
      authDate,
      ...(startParam ? { startParam } : {}),
    };
  } catch (err) {
    console.error(
      "[telegram:error] initData verification failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { valid: false, reason: "malformed" };
  }
}

/** Parses user JSON from verified initData string. (Legacy helper) */
export function parseTelegramInitDataUser(initData: string): any | null {
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get("user");
    return userJson ? JSON.parse(userJson) : null;
  } catch {
    return null;
  }
}
