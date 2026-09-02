import { createServerFn } from "@tanstack/react-start";
import { authed } from "./auth.middleware";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { d1First, d1Run } from "./d1.server";
import { randomId } from "./crypto.server";
import { env } from "./env.server";

export const getMyTelegramStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const link = await d1First<{
      telegram_username: string;
      linked_at: string;
      telegram_chat_id: number;
    }>(
      `SELECT telegram_username, linked_at, telegram_chat_id FROM telegram_links WHERE user_id = ?`,
      authed(context).userId,
    );

    const botUsername = env("TELEGRAM_BOT_USERNAME") || "Bananto_store_bot";

    return {
      linked: !!link?.linked_at,
      telegram_username: link?.telegram_username ?? null,
      chat_id: link?.telegram_chat_id ?? null,
      bot_username: botUsername,
      configured: true,
    };
  });

export const startTelegramLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const bot = env("TELEGRAM_BOT_USERNAME") || "Bananto_store_bot";
    const token = randomId("link");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    await d1Run(
      "INSERT INTO telegram_link_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      token,
      authed(context).userId,
      expiresAt,
      new Date().toISOString(),
    );

    return {
      bot_username: bot,
      deep_link: `https://t.me/${bot}?start=${token}`,
    };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await d1Run(`DELETE FROM telegram_links WHERE user_id = ?`, authed(context).userId);
    return { ok: true };
  });
