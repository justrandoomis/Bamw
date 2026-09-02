import { createServerFn } from "@tanstack/react-start";
import { authed } from "./auth.middleware";
import { z } from "zod";
import { d1All, d1First, d1Run } from "./d1.server";
import {
  sendTelegramMessage,
  sendTelegramPoll,
  pinTelegramMessage,
  escapeHtml,
} from "./telegram.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { env } from "./env.server";

/**
 * Creates and publishes a contest to the Telegram channel.
 */
export const createTelegramContest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      title: z.string().min(3),
      prize: z.string().min(3),
      winners_count: z.number().int().positive().default(1),
      draw_at: z.string().optional(),
      channel_id: z.string().optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    // Check admin
    const user = await d1First<{ is_admin: number }>(
      "SELECT is_admin FROM users WHERE id = ?",
      authed(context).userId,
    );
    if (!user?.is_admin) throw new Error("Unauthorized: Admin only");

    const contestId = crypto.randomUUID();
    const channelId = data.channel_id || env("TELEGRAM_CHANNEL_ID");

    if (!channelId) throw new Error("Missing TELEGRAM_CHANNEL_ID");

    const messageText =
      `🎁 <b>مسابقة جديدة من بنانا ستور!</b> 🍌\n\n` +
      `🏆 <b>الجائزة:</b> ${escapeHtml(data.prize)}\n` +
      `👥 <b>عدد الفائزين:</b> ${data.winners_count}\n\n` +
      `للمشاركة في المسابقة، اضغط على الزر أدناه! 👇`;

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "✅ دخول المسابقة",
            url: `https://t.me/${env("TELEGRAM_BOT_USERNAME")}?start=contest_${contestId}`,
          },
        ],
      ],
    };

    // 1. Post to Channel
    const channelResult = await sendTelegramMessage(channelId, messageText, {
      reply_markup: replyMarkup,
    });
    if (!channelResult.ok)
      throw new Error(`Failed to post to channel: ${channelResult.description}`);

    const channelMessageId = channelResult.result.message_id;

    // 2. Save to DB
    await d1Run(
      `INSERT INTO telegram_contests (id, title, prize, winners_count, draw_at, channel_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      contestId,
      data.title,
      data.prize,
      data.winners_count,
      data.draw_at || null,
      channelMessageId,
      new Date().toISOString(),
    );

    // Optional: pin it
    await pinTelegramMessage(channelId, channelMessageId);

    return { ok: true, contest_id: contestId };
  });

/**
 * Sends a general notification to all linked Telegram users.
 */
export const broadcastTelegramNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      message: z.string().min(5),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const user = await d1First<{ is_admin: number }>(
      "SELECT is_admin FROM users WHERE id = ?",
      authed(context).userId,
    );
    if (!user?.is_admin) throw new Error("Unauthorized");

    const linkedUsers = await d1All<{ telegram_chat_id: number }>(
      "SELECT telegram_chat_id FROM telegram_links WHERE telegram_chat_id IS NOT NULL",
    );

    let successCount = 0;
    for (const u of linkedUsers) {
      const res = await sendTelegramMessage(u.telegram_chat_id, data.message);
      if (res.ok) successCount++;
    }

    return { total: linkedUsers.length, success: successCount };
  });

/**
 * Manually sends an OTP to a specific user via Telegram (for testing/support).
 */
export const sendManualOtpTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string(),
      code: z.string().length(6),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const admin = await d1First<{ is_admin: number }>(
      "SELECT is_admin FROM users WHERE id = ?",
      authed(context).userId,
    );
    if (!admin?.is_admin) throw new Error("Unauthorized");

    const link = await d1First<{ telegram_chat_id: number }>(
      "SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?",
      data.userId,
    );

    if (!link?.telegram_chat_id) throw new Error("User has no linked Telegram");

    const message = `🍌 رمز التحقق الخاص بك (طلب يدوي): <b>${data.code}</b>`;
    const ok = await sendTelegramMessage(link.telegram_chat_id, message);

    return { success: !!ok };
  });
