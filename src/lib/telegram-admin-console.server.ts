import {
  approveRechargeRequest,
  getRechargeRequestWithUser,
  listAllRechargeRequests,
  rejectRechargeRequest,
} from "./db.server";
import { randomId } from "./crypto.server";
import { d1Run } from "./d1.server";
import { env } from "./env.server";
import { isAdminCallback, isAdminPrivateMessage } from "./telegram-admin.server";
import {
  answerCallbackQuery,
  editTelegramMessageText,
  escapeHtml,
  pinTelegramMessage,
  sendTelegramMessage,
  telegramBotStartDeepLink,
  telegramPublicOrigin,
} from "./telegram.server";

/**
 * The operator's console inside the bot.
 *
 * Everything an administrator can do through Telegram lives here, behind one
 * gate, for two reasons the request spells out: the operator's commands are
 * nothing like a member's, and no member may reach them or even learn they
 * exist. So every entry point starts with the same identity check, a caller who
 * fails it is answered as if the command simply does not exist, and the buttons
 * themselves carry no authority — pressing one is checked again at the moment
 * it is pressed.
 */

const MONEY = new Intl.NumberFormat("en-US");

function money(amount: number | undefined): string {
  return `${MONEY.format(Math.round(Number(amount ?? 0)))} د.ع`;
}

const METHOD_LABEL: Record<string, string> = {
  zain_cash: "زين كاش",
  rafidain: "ماستركارد الرافدين",
  crypto: "عملات رقمية",
  eshop_card: "بطاقة Nintendo",
  banan_code: "كود بنانتو",
};

/** How a Telegram decision is recorded in the wallet audit trail. */
function reviewerFrom(from: { id?: unknown; first_name?: string; username?: string } | undefined) {
  const name = [from?.first_name, from?.username ? `@${from.username}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: `telegram:${String(from?.id ?? "unknown")}`,
    ...(name ? { name } : {}),
    source: "telegram",
  };
}

/* ========================================================================
   Wallet top-up decisions
   ======================================================================== */

function requestSummary(request: Awaited<ReturnType<typeof getRechargeRequestWithUser>>): string {
  if (!request) return "الطلب غير موجود.";
  const user = request.user;
  return (
    `💳 <b>طلب تعبئة</b>\n` +
    `👤 ${escapeHtml(user?.name || request.userId)}` +
    (user?.phone ? ` — <code>${escapeHtml(user.phone)}</code>` : "") +
    `\n💰 ${money(request.amount)}\n` +
    `🏦 ${escapeHtml(METHOD_LABEL[request.method] ?? request.method)}\n` +
    (user ? `👛 الرصيد الحالي: ${money(user.walletBalance)}\n` : "") +
    `<code>${escapeHtml(request.id)}</code>`
  );
}

/**
 * Settle a top-up straight from the message, with no window in between.
 *
 * The decision goes through exactly the same guarded path as the dashboard, so
 * a request already settled elsewhere is refused here too rather than paying
 * twice.
 */
async function handleRechargeDecision(callback: any): Promise<void> {
  const parts = String(callback.data ?? "").split(":");
  const action = parts[1];
  const requestId = parts.slice(2).join(":");
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;

  if (!requestId || (action !== "ok" && action !== "no")) {
    if (callback.id) await answerCallbackQuery(callback.id, { text: "طلب غير صالح" });
    return;
  }

  const reviewer = reviewerFrom(callback.from);
  const result =
    action === "ok"
      ? await approveRechargeRequest(requestId, reviewer)
      : await rejectRechargeRequest(requestId, reviewer);

  let notice: string;
  let outcome: string;
  if (result.ok && action === "ok") {
    notice = `✅ تمت الموافقة — أضيف ${money(result.creditedAmount)}`;
    outcome =
      `✅ <b>تمت الموافقة على طلب التعبئة</b>\n` +
      `💰 أضيف للمحفظة: <b>${money(result.creditedAmount)}</b>\n` +
      (result.balance !== undefined ? `👛 الرصيد الآن: ${money(result.balance)}\n` : "") +
      `👤 بواسطة: ${escapeHtml(reviewer.name || reviewer.id)}\n` +
      `<code>${escapeHtml(requestId)}</code>`;
  } else if (result.ok) {
    notice = "❌ تم رفض الطلب";
    outcome =
      `❌ <b>تم رفض طلب التعبئة</b>\n` +
      `👤 بواسطة: ${escapeHtml(reviewer.name || reviewer.id)}\n` +
      `<code>${escapeHtml(requestId)}</code>`;
  } else if (result.reason === "already_settled") {
    notice = "سبق أن تمت معالجة هذا الطلب";
    outcome =
      `ℹ️ <b>هذا الطلب تمت معالجته مسبقاً</b> (${escapeHtml(result.request?.status ?? "")})\n` +
      `<code>${escapeHtml(requestId)}</code>`;
  } else if (result.reason === "credit_failed") {
    // The claim was released, so the request is still actionable — say so
    // instead of leaving the operator thinking the money moved.
    notice = "تعذر إضافة الرصيد، الطلب ما زال معلقاً";
    outcome =
      `⚠️ <b>تعذر إضافة الرصيد</b> — أُعيد الطلب إلى قائمة الانتظار، حاول مجدداً.\n` +
      `<code>${escapeHtml(requestId)}</code>`;
  } else {
    notice = "الطلب غير موجود";
    outcome = `⚠️ الطلب غير موجود.\n<code>${escapeHtml(requestId)}</code>`;
  }

  if (callback.id) await answerCallbackQuery(callback.id, { text: notice, show_alert: !result.ok });
  if (chatId && messageId) {
    // Clearing the keyboard is part of the outcome: a settled request must not
    // keep offering an approve button.
    await editTelegramMessageText(chatId, messageId, outcome, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  }
}

/* ========================================================================
   Contests
   ======================================================================== */

export interface ParsedContestCommand {
  title: string;
  prize: string;
  winnersCount: number;
  channelId?: string;
  messageThreadId?: number;
}

/**
 * `/contest Title | Prize | winners | target | topic`
 *
 * Everything after the title has a sensible default so the common case is two
 * fields. `target` is a channel username or numeric id; `topic` is the id of a
 * forum topic inside a group, which is how a contest is posted into one topic
 * rather than the group's main feed.
 */
export function parseContestCommand(text: string): ParsedContestCommand | { error: string } {
  const body = text.replace(/^\/contest(?:@\S+)?\s*/i, "").trim();
  if (!body) return { error: "empty" };

  const parts = body.split("|").map((part) => part.trim());
  const title = parts[0] ?? "";
  const prize = parts[1] ?? "";
  if (title.length < 3) return { error: "title" };
  if (prize.length < 2) return { error: "prize" };
  if (title.length > 200 || prize.length > 200) return { error: "too_long" };

  const winners = parts[2] ? Number(parts[2]) : 1;
  if (!Number.isInteger(winners) || winners < 1 || winners > 100) return { error: "winners" };

  const target = parts[3];
  const topic = parts[4] ? Number(parts[4]) : undefined;
  if (topic !== undefined && (!Number.isInteger(topic) || topic < 1 || topic > 2_000_000_000)) {
    return { error: "topic" };
  }
  if (target && !/^(@[A-Za-z0-9_]{4,64}|-?\d{5,20})$/.test(target)) return { error: "target" };

  return {
    title,
    prize,
    winnersCount: winners,
    ...(target ? { channelId: target } : {}),
    ...(topic !== undefined ? { messageThreadId: topic } : {}),
  };
}

const CONTEST_USAGE =
  "🎁 <b>إنشاء مسابقة</b>\n\n" +
  "<code>/contest العنوان | الجائزة | عدد الفائزين | الوجهة | رقم الموضوع</code>\n\n" +
  "• <b>العنوان</b> و<b>الجائزة</b> مطلوبان.\n" +
  "• <b>عدد الفائزين</b> افتراضياً 1.\n" +
  "• <b>الوجهة</b>: @اسم_القناة أو معرّف المجموعة الرقمي — الافتراضي قناة المتجر.\n" +
  "• <b>رقم الموضوع</b>: رقم الـtopic داخل المجموعة للنشر فيه تحديداً.\n\n" +
  "مثال:\n<code>/contest مسابقة الأسبوع | بطاقة eShop بقيمة 50$ | 3 | @banan_to</code>";

async function createContestFromCommand(chatId: number, from: any, text: string): Promise<void> {
  const parsed = parseContestCommand(text);
  if ("error" in parsed) {
    const hint =
      parsed.error === "empty"
        ? CONTEST_USAGE
        : parsed.error === "winners"
          ? "عدد الفائزين يجب أن يكون رقماً بين 1 و100."
          : parsed.error === "target"
            ? "الوجهة يجب أن تكون @اسم_قناة أو معرّفاً رقمياً."
            : parsed.error === "topic"
              ? "رقم الموضوع يجب أن يكون رقماً صحيحاً."
              : parsed.error === "too_long"
                ? "العنوان أو الجائزة طويل جداً."
                : "أكمل العنوان والجائزة على الأقل.\n\n" + CONTEST_USAGE;
    await sendTelegramMessage(chatId, hint, { parse_mode: "HTML" });
    return;
  }

  const channelId = parsed.channelId || env("TELEGRAM_CHANNEL_ID") || "";
  if (!channelId) {
    await sendTelegramMessage(
      chatId,
      "⚠️ لم تُحدَّد وجهة النشر ولا يوجد TELEGRAM_CHANNEL_ID مضبوط. أضف الوجهة في الأمر.",
    );
    return;
  }

  const contestId = randomId("contest");
  const announcement =
    `🎁 <b>${escapeHtml(parsed.title)}</b>\n\n` +
    `🏆 <b>الجائزة:</b> ${escapeHtml(parsed.prize)}\n` +
    `👥 <b>عدد الفائزين:</b> ${parsed.winnersCount}\n\n` +
    `للمشاركة اضغط الزر بالأسفل 👇`;

  const posted = await sendTelegramMessage(channelId, announcement, {
    parse_mode: "HTML",
    ...(parsed.messageThreadId ? { message_thread_id: parsed.messageThreadId } : {}),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ دخول المسابقة",
            // `randomId` already prefixes the id with `contest_`, which is what
            // the bot matches on when the member arrives through this link.
            url: telegramBotStartDeepLink(contestId),
          },
        ],
      ],
    },
  });

  if (!posted.ok) {
    await sendTelegramMessage(
      chatId,
      `⚠️ تعذر النشر في الوجهة: ${escapeHtml(String(posted.description ?? "خطأ غير معروف"))}`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const messageId = posted.result?.message_id ?? null;
  await d1Run(
    `INSERT INTO telegram_contests
       (id, title, prize, status, winners_count, created_at, channel_message_id, channel_id, message_thread_id, created_by)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    contestId,
    parsed.title,
    parsed.prize,
    parsed.winnersCount,
    new Date().toISOString(),
    messageId,
    String(channelId),
    parsed.messageThreadId ?? null,
    `telegram:${String(from?.id ?? "unknown")}`,
  );

  // Pinning is a convenience, never a reason to report failure.
  if (messageId) await pinTelegramMessage(channelId, messageId).catch(() => false);

  await sendTelegramMessage(
    chatId,
    `✅ <b>تم نشر المسابقة</b>\n` +
      `🎁 ${escapeHtml(parsed.title)}\n` +
      `🏆 ${escapeHtml(parsed.prize)}\n` +
      `👥 ${parsed.winnersCount} فائز\n` +
      `📍 ${escapeHtml(String(channelId))}` +
      (parsed.messageThreadId ? ` (موضوع ${parsed.messageThreadId})` : "") +
      `\n<code>${escapeHtml(contestId)}</code>`,
    { parse_mode: "HTML" },
  );
}

/* ========================================================================
   Command surface
   ======================================================================== */

async function sendAdminMenu(chatId: number): Promise<void> {
  // Annotated: a bare `[]` in the catch infers `never[]`, and the fields read
  // off each request below then had no type to be read from.
  const requests = await listAllRechargeRequests({ limit: 100 }).catch(
    (): Awaited<ReturnType<typeof listAllRechargeRequests>> => [],
  );
  const pending = requests.filter((request) => request.status === "pending");
  const origin = telegramPublicOrigin();

  await sendTelegramMessage(
    chatId,
    `🛠️ <b>لوحة المشرف</b>\n\n` +
      `💳 طلبات تعبئة معلقة: <b>${pending.length}</b>\n` +
      (pending.length > 0
        ? `💰 بمجموع ${money(pending.reduce((sum, r) => sum + r.amount, 0))}\n`
        : "") +
      `\nالأوامر المتاحة:\n` +
      `<code>/pending</code> — طلبات التعبئة المعلقة\n` +
      `<code>/contest</code> — إنشاء مسابقة ونشرها\n` +
      `<code>/admin</code> — هذه اللوحة`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 طلبات التعبئة", callback_data: "adm:pending" }],
          [{ text: "🌐 فتح لوحة الإدارة", url: `${origin}/admin` }],
        ],
      },
    },
  );
}

async function sendPendingRequests(chatId: number): Promise<void> {
  // Annotated: a bare `[]` in the catch infers `never[]`, and the fields read
  // off each request below then had no type to be read from.
  const requests = await listAllRechargeRequests({ limit: 100 }).catch(
    (): Awaited<ReturnType<typeof listAllRechargeRequests>> => [],
  );
  const pending = requests.filter((request) => request.status === "pending").slice(0, 10);

  if (pending.length === 0) {
    await sendTelegramMessage(chatId, "✨ لا توجد طلبات تعبئة معلقة.");
    return;
  }

  const origin = telegramPublicOrigin();
  for (const request of pending) {
    await sendTelegramMessage(chatId, requestSummary(request), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ موافقة فورية", callback_data: `rq:ok:${request.id}` },
            { text: "❌ رفض", callback_data: `rq:no:${request.id}` },
          ],
          [
            {
              text: "🔍 مراجعة في التطبيق",
              web_app: {
                url: `${origin}/telegram/wallet-review?request=${encodeURIComponent(request.id)}`,
              },
            },
          ],
        ],
      },
    });
  }
}

/**
 * Handle an inline button press if it belongs to the operator's console.
 *
 * Returns true when the update was consumed, so the caller stops. A press from
 * anyone who is not the operator is consumed too, and answered as an expired
 * button: the reply must not reveal that an administrative action exists here.
 */
export async function handleAdminCallback(callback: any): Promise<boolean> {
  const data = String(callback?.data ?? "");
  if (!data.startsWith("rq:") && !data.startsWith("adm:")) return false;

  if (!isAdminCallback(callback)) {
    if (callback?.id) {
      await answerCallbackQuery(callback.id, { text: "هذا الزر لم يعد متاحاً." });
    }
    return true;
  }

  if (data.startsWith("rq:")) {
    await handleRechargeDecision(callback);
    return true;
  }

  const chatId = callback.message?.chat?.id;
  if (callback.id) await answerCallbackQuery(callback.id);
  if (chatId && data === "adm:pending") await sendPendingRequests(chatId);
  return true;
}

/**
 * Handle an operator command if this message is one.
 *
 * Returns true when the update was consumed. A member typing the same command
 * gets nothing at all — not an error, not a refusal — so the console leaves no
 * trace for anyone it does not belong to.
 */
export async function handleAdminCommand(message: any): Promise<boolean> {
  const text = String(message?.text ?? "").trim();
  if (!/^\/(admin|pending|contest)\b/i.test(text)) return false;

  if (!isAdminPrivateMessage(message)) return true;

  const chatId = Number(message.chat.id);
  if (/^\/admin\b/i.test(text)) {
    await sendAdminMenu(chatId);
  } else if (/^\/pending\b/i.test(text)) {
    await sendPendingRequests(chatId);
  } else {
    await createContestFromCommand(chatId, message.from, text);
  }
  return true;
}
