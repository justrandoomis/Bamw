import { readOrderItemSelection, selectionSummary } from "./orderItemSelection";
import { memberAllowsNotification } from "./notification-preferences.server";
import { telegramAdminIds } from "./telegram-admin.server";
import {
  adminRoute,
  findForbiddenSecret,
  redactSecrets,
  routeOptions,
  withRoutePrefix,
  type AdminRoute,
  type AdminNotificationKind,
} from "./telegram-admin-routing.server";
import { recordSendFailure } from "./telegram-send-log.server";
import {
  sendTelegramMessage,
  escapeHtml,
  telegramMiniAppDeepLink,
  telegramPublicOrigin,
} from "./telegram.server";
import { d1First } from "./d1.server";
import { normalizePhone } from "./phone";
import type { Order, ProductRequest, User } from "./types";

/**
 * Primary admin Telegram Chat ID.
 *
 * `TELEGRAM_ADMIN_CHAT_ID` may name several operators, comma separated — that
 * is what `telegramAdminIds()` has always documented and what authorisation
 * reads. This function did not: it returned the raw setting, so an owner who
 * added a second operator turned every fallback notification into a send to
 * the chat id `"111111111, 222222222"`, which Telegram answers with "Bad
 * Request: chat not found". Every order, top-up and support message would have
 * been lost for as long as the admin group binding was missing — and the
 * fallback exists precisely for when it is missing.
 *
 * So the parsing rule lives in one place now, and the first configured
 * operator is the primary. Falls back to 6404042791 (@levo_4li) so a fresh
 * deployment still notifies somebody.
 */
export function getAdminTelegramChatId(): string {
  return telegramAdminIds()[0] ?? "6404042791";
}

/**
 * Look up a user's Telegram Chat ID from users table or telegram_links table.
 */
export async function getUserTelegramChatId(userId: string): Promise<string | undefined> {
  if (!userId) return undefined;

  /*
    `telegram_links` is where the mapping actually lives — the table the login
    flow writes when a member connects their account.

    It used to be consulted second, after `SELECT telegram_id FROM users`, and
    `users` has no `telegram_id` column: that statement threw "no such column",
    the one try/catch around both queries swallowed it, and the function
    returned undefined every time it was called. Every per-user Telegram
    message in the app depended on it — order status, game-request updates,
    release alerts — so none of them ever reached anybody. The real table is
    read first now, and the legacy column is its own attempt so a schema that
    lacks it cannot abort the lookup.
  */
  try {
    const link = await d1First<{ telegram_chat_id: string | number }>(
      "SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?",
      userId,
    );
    if (link?.telegram_chat_id) return String(link.telegram_chat_id);
  } catch (err) {
    console.warn("[telegram:notify] telegram_links lookup failed:", err);
  }

  try {
    const user = await d1First<{ telegram_id?: string | number }>(
      "SELECT telegram_id FROM users WHERE id = ?",
      userId,
    );
    if (user?.telegram_id) return String(user.telegram_id);
  } catch {
    // Deployments without the legacy column: not an error, just nothing here.
  }

  /*
    The member is linked, and the link is filed under a phone.

    `telegram_links.user_id` is not always a user id. Someone who verifies
    Telegram before their account exists is filed under the owner key
    `guest:<phone>`, and `adoptGuestTelegramLink` re-keys it when they sign in.
    That adoption runs on the OTP paths only, so a member who arrived another
    way keeps a row nothing will ever look up: linked as far as they can tell,
    and unreachable. Production is carrying such a row right now.

    Matching the member's own phone against the link's is the same criterion
    `adoptGuestTelegramLink` already uses to recognise their row, so this
    recognises exactly what adoption would have — without waiting for a sign-in
    that may never happen, and without rewriting anybody's data.
  */
  try {
    const owner = await d1First<{ phone?: string | null }>(
      "SELECT phone FROM users WHERE id = ?",
      userId,
    );
    const phone = owner?.phone ? normalizePhone(String(owner.phone)) : undefined;
    if (phone) {
      const byPhone = await d1First<{ telegram_chat_id: string | number }>(
        `SELECT telegram_chat_id FROM telegram_links
          WHERE telegram_phone = ? AND telegram_chat_id IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
        phone,
      );
      if (byPhone?.telegram_chat_id) return String(byPhone.telegram_chat_id);
    }
  } catch (err) {
    console.warn("[telegram:notify] phone-keyed link lookup failed:", err);
  }

  return undefined;
}

/**
 * Build inline keyboard buttons that open the Telegram Mini App or WebApp URL.
 */
function buildInlineAppButton(text: string, startParam: string, fallbackPath = "/") {
  const miniAppLink = telegramMiniAppDeepLink(startParam);
  const webAppUrl = `${telegramPublicOrigin()}${fallbackPath.startsWith("/") ? fallbackPath : `/${fallbackPath}`}`;

  return {
    inline_keyboard: [
      [
        {
          text,
          url: miniAppLink,
        },
      ],
      [
        {
          text: "🌐 فتح عبر المتصفح",
          url: webAppUrl,
        },
      ],
    ],
  };
}

/* =========================================================================
   1. ADMIN NOTIFICATIONS
   ========================================================================= */

/**
 * Notify Admin when a customer places a new order (especially digital accounts).
 */
/**
 * Send one admin notification to wherever its kind belongs.
 *
 * Every admin notification goes through here, so the routing, the topic, the
 * prefix and the secret check are decided once rather than in eight places
 * that would drift.
 *
 * Never throws. A Telegram outage must not fail an order, a top-up or a
 * customer's message — the send is a notification about the thing, not the
 * thing itself.
 */
export interface AdminNotificationResult {
  ok: boolean;
  /** Where it landed, so a reply to it can be traced back. */
  chatId?: string;
  messageId?: number;
  /**
   * Nothing was due, as opposed to something being lost.
   *
   * A notification for an event that does not warrant one is not a failure,
   * and the queue must not retry it five times before giving up.
   */
  skipped?: boolean;
}

/**
 * How to name a destination in a diagnostics table.
 *
 * Not the chat id and not a hash of it. The only thing the table is ever
 * asked is which of the three destinations was chosen — the group with a
 * topic, the group without one, or the single private chat the routing falls
 * back to — and that answer needs no identifier at all.
 */
function routeLabel(route: AdminRoute): string {
  if (!route.isGroup) return "legacy-private-chat";
  return route.messageThreadId ? "group-topic" : "group-no-topic";
}

export async function sendAdminNotification(
  kind: AdminNotificationKind,
  text: string,
  options: Record<string, unknown> = {},
): Promise<AdminNotificationResult> {
  const route = await adminRoute(kind);
  if (!route.chatId) return { ok: false };

  /*
    Telegram refuses a message over 4096 characters, and refuses it whole.

    A customer's own text is interpolated into these bodies, and the chat input
    accepts up to 4000 characters — so one long message pushed the notification
    past the limit and the admin was told nothing at all. Trimming costs the
    tail of a message the admin can still open in the app; not trimming costs
    the whole notification.
  */
  const TELEGRAM_MESSAGE_LIMIT = 4096;
  const body =
    text.length > TELEGRAM_MESSAGE_LIMIT
      ? `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 40)}\n\n… <i>(اختُصرت)</i>`
      : text;

  /*
    A group is forwardable, searchable, and joined by whoever is added next.
    A message carrying a password, a one-time code or a key is dropped rather
    than trimmed: one that has to be censored to be sent was assembled wrongly,
    and sending the censored half would hide that.
  */
  const forbidden = findForbiddenSecret(body);
  if (forbidden) {
    console.error("[telegram:admin_notification_blocked]", { kind, forbidden });
    await recordSendFailure({
      kind,
      route: routeLabel(route),
      description: `blocked: ${forbidden}`,
    });
    return { ok: false };
  }

  try {
    const res = await sendTelegramMessage(route.chatId, withRoutePrefix(route, body), {
      parse_mode: "HTML",
      ...routeOptions(route),
      ...options,
    });
    if (!res.ok) {
      /*
        `res.error` is only set for the failures this app invents — a missing
        token, a timeout, a socket error. A refusal from Telegram itself
        arrives as `error_code` and `description`, and logging `error` alone
        printed `{ kind: "wallet", error: undefined }`: the one line naming
        which notification was lost said nothing about why. "Bad Request:
        chat not found" and "bot was kicked from the supergroup chat" are
        different problems with different fixes, and neither survived.
      */
      console.warn("[telegram:admin_notification_failed]", {
        kind,
        status: res.status,
        error_code: res.error_code,
        description: res.description,
        error: res.error,
      });
      await recordSendFailure({
        kind,
        route: routeLabel(route),
        ...(typeof res.status === "number" ? { status: res.status } : {}),
        ...(typeof res.error_code === "number" ? { errorCode: res.error_code } : {}),
        description: res.description ?? res.error,
      });
      return { ok: false };
    }
    /*
      The message id is what a reply in Telegram carries back, and it is the
      only thing that can say which customer an admin is answering. Discarding
      it — which this used to do, returning a bare boolean — is what made
      replying from Telegram impossible.
    */
    const messageId = Number(
      (res as { result?: { message_id?: unknown } }).result?.message_id,
    );
    return {
      ok: true,
      chatId: route.chatId,
      ...(Number.isSafeInteger(messageId) && messageId > 0 ? { messageId } : {}),
    };
  } catch (err) {
    console.error("[telegram:admin_notification_threw]", { kind, err });
    await recordSendFailure({
      kind,
      route: routeLabel(route),
      description: `threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false };
  }
}

export async function notifyAdminNewOrder(params: {
  order: Order;
  user: { id: string; name?: string; phone?: string; email?: string; username?: string };
}): Promise<AdminNotificationResult> {
  const { order, user } = params;

  const hasDigital = order.items.some(
    (item) => !["hardware", "physical", "accessory", "device"].includes(item.kind),
  );

  const itemsList = order.items
    .map((item, index) => {
      const kindLabel = ["hardware", "physical", "accessory", "device"].includes(item.kind)
        ? "📦 منتج فيزيائي"
        : "🎮 حساب رقمي / لعبة";
      const edition = item.edition ? ` (${item.edition})` : "";
      /*
        The option, the type and the console, from the order's own snapshot.

        The message named the game and nothing else, so whoever picked it up
        had to open the order to find out whether it was the offline account
        or the online one — which is the single thing they need before they
        can start. `readOrderItemSelection` coerces every value, so an object
        stored in `meta` cannot print as "[object Object]" here.
      */
      const selection = selectionSummary(readOrderItemSelection(item.meta));
      const selectionLine = selection ? `\n   ${escapeHtml(selection)}` : "";
      return `${index + 1}. <b>${escapeHtml(item.title)}</b>${edition} — <i>${kindLabel}</i>${selectionLine}\n   الكمية: ${item.quantity || 1} | السعر: ${item.unitPrice.toLocaleString()} د.ع`;
    })
    .join("\n");

  const customerName = escapeHtml(user.name || user.username || "عميل بنانا");
  const customerContact = escapeHtml(user.phone || user.email || user.id);

  const messageText =
    `🚨 <b>طلب جديد في بنانا ستور!</b> 🍌\n\n` +
    `🔖 <b>رمز الطلب:</b> <code>${escapeHtml(order.code)}</code>\n` +
    `💰 <b>الإجمالي:</b> <b>${order.total.toLocaleString()} ${order.currency || "IQD"}</b>\n` +
    `💳 <b>حالة الدفع:</b> ${order.paymentStatus === "paid" ? "✅ مدفوع من المحفظة" : "⏳ بانتظار التأكيد"}\n` +
    `👤 <b>الزبون:</b> ${customerName} (<code>${customerContact}</code>)\n` +
    (hasDigital
      ? `\n⚡ <b>نوع الطلب:</b> يتضمن حسابات/ألعاب رقمية تتطلب تجهيزاً في المحادثة!\n`
      : `\n🚚 <b>نوع الطلب:</b> شحن وتوصيل فيزيائي\n`) +
    `\n📋 <b>المنتجات المشمولة:</b>\n${itemsList}\n\n` +
    `اضغط على الزر أدناه لفتح الطلب في MiniApp فوراً والبدء بتجهيزه 👇`;

  const replyMarkup = buildInlineAppButton(
    `🎮 فتح الطلب ${order.code} في MiniApp`,
    `order_${order.id}`,
    `/orders/${order.id}`,
  );

  return sendAdminNotification("order", messageText, { reply_markup: replyMarkup });
}

/**
 * Notify Admin when a customer sends a message in human/order/support chat.
 */
export async function notifyAdminCustomerMessage(params: {
  thread: { id: string; subject?: string; orderId?: string; chatType?: string };
  message: { text?: string; imageUrl?: string; senderRole: string };
  user: { id: string; name?: string; phone?: string; username?: string };
}): Promise<AdminNotificationResult> {
  const { thread, message, user } = params;
  /*
    Only a customer's own message is worth telling the admins about. Nothing
    failed here, so it is marked skipped: the queue's retry exists for a
    notification that was lost, not for one that was never due.
  */
  if (message.senderRole !== "user") return { ok: false, skipped: true };


  const customerName = escapeHtml(user.name || user.username || "عميل بنانا");
  /*
    An attachment is announced even when it arrives with a caption.

    This read `message.text || (imageUrl ? "📸 …" : "")`, so the placeholder
    was reachable only when there was no text — and a customer who writes
    "شوف الصورة" and attaches a receipt sends both. The admin was told the
    sentence and never that anything came with it.
  */
  /*
    Scrubbed before it is embedded, not judged after.

    A member who writes "كلمة المرور: 1234" while asking for help tripped
    `findForbiddenSecret` on the assembled body, and the guard drops the whole
    notification — so the admin was never told that customer had written in at
    all. Their words are untrusted input, and the boundary is the place to
    clean them; the guard keeps dropping anything the shop itself composed
    wrongly.
  */
  const textContent = escapeHtml(redactSecrets(message.text || ""));
  const attachmentLine = message.imageUrl ? "\n📸 <i>مرفق صورة</i>" : "";
  const threadSubject = escapeHtml(thread.subject || "محادثة الدعم");

  const messageText =
    `💬 <b>رسالة جديدة من عميل في بنانا ستور!</b> 🍌\n\n` +
    `👤 <b>المرسل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    `📂 <b>الموضوع:</b> ${threadSubject}\n` +
    (thread.orderId ? `🔖 <b>مرتبط بطلب:</b> <code>${escapeHtml(thread.orderId)}</code>\n` : "") +
    `\n📝 <b>نص الرسالة:</b>\n<i>${textContent || "—"}</i>${attachmentLine}\n\n` +
    `اضغط على الزر للرد على العميل مباشرة في MiniApp 👇`;

  const startParam = thread.orderId ? `order_${thread.orderId}` : `chat_${thread.id}`;
  const replyMarkup = buildInlineAppButton(
    `💬 الرد على المحادثة في MiniApp`,
    startParam,
    `/chat?threadId=${thread.id}`,
  );

  const sent = await sendAdminNotification("support", messageText, {
    reply_markup: replyMarkup,
  });

  /*
    And the picture itself.

    Until now the entire representation of a customer's attachment in Telegram
    was the string "📸 [صورة / مرفق]" — no photo, and not even the URL, so
    there was nothing to tap. A repo-wide search for `sendPhoto` found nothing:
    the outbound side had no photo primitive at all, while the inbound one
    (a photo an admin sends from Telegram) was fully built.

    The bytes are uploaded rather than a link handed over, because the file
    lives behind a session guard Telegram cannot pass — and making it publicly
    readable to solve that would publish every customer's receipt.

    After the card, and never instead of it: the card carries who and which
    conversation, and a photo that fails to send must not take that with it.
  */
  if (sent.ok && message.imageUrl) {
    try {
      await forwardAttachmentToAdmin(sent.chatId, message.imageUrl, customerName);
    } catch (err) {
      console.warn("[telegram:attachment_forward_failed]", err);
    }
  }

  /*
    Remember which customer this card is about.

    `reply_to_message.message_id` is the only thing an admin's reply in Telegram
    carries that says which conversation they are answering. Without this row a
    reply has nowhere to go, and guessing from the topic would send one customer
    another customer's answer.
  */
  if (sent.ok && sent.chatId && sent.messageId) {
    const { rememberSupportLink } = await import("./telegram-support-reply.server");
    await rememberSupportLink({
      telegramChatId: sent.chatId,
      telegramMessageId: sent.messageId,
      conversationId: thread.id,
      userId: user.id,
      ...(thread.orderId ? { orderId: thread.orderId } : {}),
    });
  }

  return sent;
}

/**
 * Put a customer's attachment in the admin's Telegram, as a picture.
 *
 * The stored URL is `/api/files/<folder>/<owner>/<name>` and the object key is
 * the same path under `files/`. Reading it back and uploading the bytes is
 * what makes it viewable without making it public.
 */
async function forwardAttachmentToAdmin(
  chatId: string | undefined,
  imageUrl: string,
  customerName: string,
): Promise<void> {
  if (!chatId) return;
  const path = String(imageUrl).split("?")[0] ?? "";
  if (!path.startsWith("/api/files/")) return;

  /*
    A video is not a photo, and `sendPhoto` refuses one.

    The member's picker offers mp4, webm and mov, so this path really does see
    them. Telling the admin where to watch it beats a refusal that leaves the
    card saying an attachment arrived and never showing it.
  */
  const { isVideoUploadUrl } = await import("./uploads");
  if (isVideoUploadUrl(path)) {
    await sendAdminNotification(
      "support",
      `🎬 ${escapeHtml(customerName)} أرسل مقطع فيديو — افتحه من لوحة الإدارة.`,
    );
    return;
  }

  const { readBinary } = await import("./storage.server");
  const stored = await readBinary(`files/${path.slice("/api/files/".length)}`);
  if (!stored?.bytes?.length) return;

  /*
    Telegram refuses a photo over 10 MB. Every member upload is converted to
    WebP well under that, so this is a guard rather than an expectation — and
    losing the picture silently would put us back where we started.
  */
  if (stored.bytes.length > 10 * 1024 * 1024) {
    await sendAdminNotification(
      "support",
      `📎 مرفق من ${customerName} أكبر من أن يُرسل في تليكرام — افتحه من لوحة الإدارة.`,
    );
    return;
  }

  const { sendTelegramPhoto } = await import("./telegram.server");
  const route = await adminRoute("support");
  const res = await sendTelegramPhoto(chatId, stored.bytes, {
    mime: stored.mime,
    filename: path.split("/").pop() || "attachment",
    caption: `📸 مرفق من ${customerName}`,
    ...(route.messageThreadId ? { messageThreadId: route.messageThreadId } : {}),
  });
  if (!res.ok) {
    console.warn("[telegram:attachment_photo_failed]", { description: res.description });
  }
}

/**
 * Notify Admin when a user submits a wallet recharge request.
 */
/**
 * The operator's controls for one top-up request.
 *
 * Three ways in, because the right one depends on where they are: the Mini App
 * for a full review with the receipt on screen, the browser for the dashboard,
 * and a direct approve that settles the request from the message itself without
 * opening anything. Every one of them is checked against the operator's own
 * Telegram id when it is used — these buttons carry no authority of their own.
 *
 * The `web_app` button stays a `web_app` button here. It only works in a
 * private chat, and Telegram refuses the entire message rather than the button
 * when it is sent anywhere else — which is what silenced every top-up
 * notification once they moved into the admin group. `sendTelegramMessage`
 * converts it to a plain link when the destination is a group, so the private
 * chat keeps the inline Mini App and the group gets the same page as a link.
 */
export function buildRechargeReviewKeyboard(requestId: string) {
  const origin = telegramPublicOrigin();
  return {
    inline_keyboard: [
      [
        {
          text: "✅ موافقة فورية",
          callback_data: `rq:ok:${requestId}`,
        },
        {
          text: "❌ رفض",
          callback_data: `rq:no:${requestId}`,
        },
      ],
      [
        {
          text: "🔍 مراجعة في التطبيق",
          web_app: {
            url: `${origin}/telegram/wallet-review?request=${encodeURIComponent(requestId)}`,
          },
        },
      ],
      [
        {
          text: "🌐 فتح لوحة الإدارة",
          url: `${origin}/admin`,
        },
      ],
    ],
  };
}

/**
 * A customer asked to speak to a person.
 *
 * This was the one admin-facing event that notified nobody at all. The
 * escalation created a `GENERAL_SUPPORT` thread with `needsAdmin: true` and
 * returned, and an admin only found out if the customer then typed something
 * into it — so a request that went unanswered looked, from the shop's side,
 * exactly like a request that was never made.
 */
export async function notifyAdminHumanSupportRequest(params: {
  threadId: string;
  user: { id: string; name?: string; username?: string };
  /** What the customer was talking about when they asked. Optional. */
  lastUserText?: string;
}): Promise<AdminNotificationResult> {
  const { threadId, user } = params;
  const who = escapeHtml(user.name || user.username || user.id);

  /*
    A short excerpt, not the conversation. Enough for whoever picks it up to
    know what they are walking into; not so much that the group becomes a
    copy of the customer's messages.
  */
  /* Same reason as the support card: the customer wrote this, so it is scrubbed. */
  const excerpt = redactSecrets((params.lastUserText ?? "").trim()).slice(0, 200);
  const excerptLine = excerpt ? `\n\n💬 <i>${escapeHtml(excerpt)}</i>` : "";

  const text =
    `🙋 <b>طلب تحدث مع الدعم البشري</b>\n\n` +
    `👤 <b>العميل:</b> ${who}\n` +
    `🔗 <b>المحادثة:</b> <code>${escapeHtml(threadId)}</code>` +
    excerptLine;

  return sendAdminNotification(
    "support",
    text,
    {
      reply_markup: buildInlineAppButton(
        "💬 فتح المحادثة",
        `thread_${threadId}`,
        `/admin/inbox?thread=${encodeURIComponent(threadId)}`,
      ),
    },
  );
}

export async function notifyAdminWalletTopUp(params: {
  requestId: string;
  amount: number;
  method: string;
  user: { id: string; name?: string; phone?: string };
  proofUrl?: string;
}): Promise<AdminNotificationResult> {
  const { requestId, amount, method, user, proofUrl } = params;

  const customerName = escapeHtml(user.name || "عميل بنانا");
  const methodLabel =
    method === "zain_cash"
      ? "زين كاش"
      : method === "rafidain"
        ? "مصرف الرافدين / الماستر"
        : method === "crypto"
          ? "باينانس باي / USDT"
          : method === "eshop_card"
            ? "بطاقة eShop"
            : method;

  const messageText =
    `💳 <b>طلب تعبئة رصيد محفظة جديد!</b> 🍌\n\n` +
    `👤 <b>العميل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    `💰 <b>المبلغ المطلوب:</b> <b>${amount.toLocaleString()} د.ع</b>\n` +
    `🏦 <b>طريقة الدفع:</b> ${escapeHtml(methodLabel)}\n` +
    (proofUrl ? `📎 <b>يوجد صورة إيصال مرفقة مع الطلب</b>\n` : "") +
    `\n<code>${escapeHtml(requestId)}</code>`;

  const replyMarkup = buildRechargeReviewKeyboard(requestId);

  return sendAdminNotification("wallet", messageText, { reply_markup: replyMarkup });
}

/**
 * Notify Admin when a user submits a game request.
 */
/* Game requests are an administrative ask, not an order. They go to General. */
export async function notifyAdminGameRequest(params: {
  request: ProductRequest;
  user: { id: string; name?: string; phone?: string };
}): Promise<AdminNotificationResult> {
  const { request, user } = params;

  const customerName = escapeHtml(user.name || "عميل بنانا");
  const messageText =
    `🎯 <b>طلب توفير لعبة / منتج جديد!</b> 🍌\n\n` +
    `🕹️ <b>اسم اللعبة / المنتج:</b> <b>${escapeHtml(redactSecrets(request.productName))}</b>\n` +
    `📱 <b>المنصة:</b> ${escapeHtml(request.platform || "Nintendo Switch")}\n` +
    `👤 <b>العميل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    /* The member typed these notes, so they are scrubbed like any other. */
    (request.notes ? `📝 <b>ملاحظات:</b> ${escapeHtml(redactSecrets(request.notes))}\n` : "") +
    `\nيمكنك مراجعة الطلب وتحديث حالته للعميل 👇`;

  const replyMarkup = buildInlineAppButton(
    `🎮 فتح طلبات الألعاب في MiniApp`,
    `gamereq_${request.id}`,
    // The browser fallback, for an admin who cannot open the Mini App. There
    // is no `/game-request` page — the requests screen lives under the admin
    // panel, and `/add_game` is the customer-facing one — so that link was a
    // 404 every time it was tapped.
    `/admin`,
  );

  return sendAdminNotification("general", messageText, { reply_markup: replyMarkup });
}

/**
 * Notify Admin when a customer submits a disc trade / exchange request.
 */
export async function notifyAdminDiscTrade(params: {
  tradeId: string;
  gameName: string;
  platform: string;
  finalIqd?: number | null;
  isCustom?: boolean;
  user: { id: string; name?: string; phone?: string };
}): Promise<AdminNotificationResult> {
  const { tradeId, gameName, platform, finalIqd, isCustom, user } = params;

  const customerName = escapeHtml(user.name || "عميل بنانا");
  const valuationText = finalIqd
    ? `${finalIqd.toLocaleString()} د.ع`
    : "السعر بعد المراجعة اليدوية";

  const messageText =
    `🔄 <b>طلب مقايضة شريط ألعاب جديد!</b> 🍌\n\n` +
    `🕹️ <b>اللعبة:</b> <b>${escapeHtml(gameName)}</b>\n` +
    `📱 <b>المنصة:</b> ${escapeHtml(platform)}\n` +
    `💰 <b>التقييم:</b> <b>${valuationText}</b>\n` +
    `👤 <b>العميل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    (isCustom ? `⚠️ <i>إضافة يدوية تتطلب تسعيراً ومراجعة</i>\n` : "") +
    `\nاضغط أدناه لمعاينة صور القرص وتأكيد المقايضة 👇`;

  /*
    `/disc_trade`, which is the route that exists.

    `/trade` has never been a page. The button was the one way from this alert
    to the request it announces, and it opened a 404 — so pricing a disc meant
    finding the admin screen by hand and matching the id from the message.
  */
  const replyMarkup = buildInlineAppButton(
    `💿 معاينة المقايضة في MiniApp`,
    `trade_${tradeId}`,
    `/disc_trade`,
  );

  return sendAdminNotification("general", messageText, { reply_markup: replyMarkup });
}

/**
 * Tell the store a member has put a second-hand item up for review.
 *
 * The listing is already paid for and already waiting; this only shortens the
 * time before someone looks at it. A Telegram failure is logged and swallowed —
 * the submission is the transaction, and losing it because a bot token expired
 * would be absurd.
 */
export async function notifyAdminUsedListing(params: {
  listingId: string;
  title: string;
  priceIqd: number;
  conditionGrade?: string | null;
  usedType?: string | null;
  user: { id: string; name?: string; phone?: string };
}): Promise<AdminNotificationResult> {
  const { listingId, title, priceIqd, conditionGrade, usedType, user } = params;

  const messageText =
    `🏷️ <b>عرض قطعة مستعملة بانتظار المراجعة</b> 🍌\n\n` +
    `📦 <b>القطعة:</b> <b>${escapeHtml(title)}</b>\n` +
    (usedType ? `🔖 <b>النوع:</b> ${escapeHtml(usedType)}\n` : "") +
    (conditionGrade ? `⭐ <b>الحالة:</b> ${escapeHtml(conditionGrade)}\n` : "") +
    `💰 <b>السعر:</b> <b>${Math.round(priceIqd).toLocaleString()} د.ع</b>\n` +
    `👤 <b>البائع:</b> ${escapeHtml(user.name || "عضو")} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    `\nلا يظهر العرض لأي زبون قبل موافقتك 👇`;

  const replyMarkup = buildInlineAppButton(`🔍 مراجعة العرض`, `used_${listingId}`, `/admin`);

  return sendAdminNotification("general", messageText, { reply_markup: replyMarkup });
}

/* =========================================================================
   2. USER NOTIFICATIONS
   ========================================================================= */

/**
 * Notify user when Admin sends a message or reply in support chat.
 */
export async function notifyUserAdminMessage(params: {
  userId: string;
  threadId: string;
  messageText: string;
  adminName?: string;
}): Promise<boolean> {
  const { userId, threadId, messageText, adminName } = params;
  const userChatId = await getUserTelegramChatId(userId);
  if (!userChatId) return false;
  // The member's own preference, from `/telegram/notifications`.
  if (!(await memberAllowsNotification(userId, "messages"))) return false;

  const text =
    `💬 <b>رد جديد من فريق دعم بنانا ستور</b> 🍌\n\n` +
    `👤 <b>${escapeHtml(adminName || "خدمة العملاء")}:</b>\n` +
    `<i>${escapeHtml(messageText)}</i>\n\n` +
    `اضغط أدناه لمتابعة المحادثة مباشرة في تليكرام 👇`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "💬 فتح المحادثة في المتجر",
          url: telegramMiniAppDeepLink(`chat_${threadId}`),
        },
      ],
    ],
  };

  try {
    const res = await sendTelegramMessage(userChatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.warn("[telegram:notifyUserAdminMessage] failed", err);
    return false;
  }
}

/**
 * Notify user when an order status changes or digital credentials are delivered.
 */
export async function notifyUserOrderStatus(params: {
  userId: string;
  order: Order;
  statusText?: string;
  credentialsDelivered?: boolean;
}): Promise<boolean> {
  const { userId, order, statusText, credentialsDelivered } = params;
  const userChatId = await getUserTelegramChatId(userId);
  if (!userChatId) return false;
  if (!(await memberAllowsNotification(userId, "orders"))) return false;

  let text = "";
  if (credentialsDelivered) {
    text =
      `🎉 <b>تم تجهيز وتسليم بيانات حسابك الرقمي!</b> 🎮\n\n` +
      `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(order.code)}</code>\n` +
      `تم إرسال اسم المستخدم وكلمة المرور في بطاقة محادثة الطلب بأمان.\n\n` +
      `اضغط على الزر أدناه لفتح المحادثة واستعراض بيانات حسابك فوراً 👇`;
  } else {
    text =
      `📦 <b>تحديث على حالة طلبك في بنانا ستور</b> 🍌\n\n` +
      `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(order.code)}</code>\n` +
      `📋 <b>الحالة الجديدة:</b> <b>${escapeHtml(statusText || order.status)}</b>\n\n` +
      `يمكنك متابعة تفاصيل الطلب والمحادثة عبر الزر أدناه 👇`;
  }

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: credentialsDelivered ? "🎮 استلام بيانات الحساب الآن" : "🔍 تفاصيل الطلب",
          url: telegramMiniAppDeepLink(`order_${order.id}`),
        },
      ],
    ],
  };

  try {
    const res = await sendTelegramMessage(userChatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.warn("[telegram:notifyUserOrderStatus] failed", err);
    return false;
  }
}
