import { createFileRoute } from "@tanstack/react-router";

import { d1First, d1Run, ensureTelegramSchema } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { getSessionUser } from "@/lib/session.server";
import { createLinkToken } from "@/lib/telegram-link.server";
import { getUserTelegramChatId } from "@/lib/telegram-notifications.server";
import { telegramBotUsername } from "@/lib/telegram.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

async function statusFor(userId: string) {
  const link = await d1First<{
    telegram_chat_id: number;
    telegram_username: string | null;
    linked_at: string;
  }>(
    `SELECT telegram_chat_id, telegram_username, linked_at
       FROM telegram_links WHERE user_id = ? AND verified = 1`,
    userId,
  );
  return {
    linked: !!link,
    /*
      Whether the shop's Telegram messages reach this member at all, asked of
      the lookup every order update and support reply is sent through.

      `linked` is narrower: it is the row this account's own «إلغاء الربط»
      removes. A member reached through a link filed under their phone is not
      `linked`, and is reachable — the alert after an order must not tell them
      Telegram is off when their notifications already arrive.
    */
    reachable: link ? true : Boolean(await getUserTelegramChatId(userId)),
    telegram_username: link?.telegram_username ?? null,
    linked_at: link?.linked_at ?? null,
    bot_username: telegramBotUsername(),
  };
}

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      /** Current Telegram link state for the signed-in account. */
      GET: async ({ request }) =>
        guard(async () => {
          const me = await getSessionUser(request);
          if (!me) return json({ error: "Unauthorized" }, { status: 401 });
          await ensureTelegramSchema();
          return json(await statusFor(me.id));
        }),

      /** action=link → single-use deep link, action=unlink → remove the link. */
      POST: async ({ request }) =>
        guard(async () => {
          const me = await getSessionUser(request);
          if (!me) return json({ error: "Unauthorized" }, { status: 401 });
          await ensureTelegramSchema();
          const throttle = await consumeRateLimit(request, "telegram-link", 10, 15 * 60, me.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          const data = await body<{ action?: "link" | "unlink" }>(request);

          if (data.action === "unlink") {
            await d1Run(`DELETE FROM telegram_links WHERE user_id = ?`, me.id);
            await d1Run(`DELETE FROM telegram_link_tokens WHERE user_id = ?`, me.id);
            return json({ ok: true, ...(await statusFor(me.id)) });
          }

          if (data.action !== "link") {
            return json({ error: "invalid_action" }, { status: 400 });
          }

          // Single-use, short-lived linking token consumed by /start <token>.
          const link = await createLinkToken(me.id);
          return json({
            ok: true,
            bot_username: telegramBotUsername(),
            deep_link: link.deepLink,
            expires_at: link.expiresAt,
          });
        }),
    },
  },
});
