import { env } from "./env.server";
import {
  sendTelegramMessage,
  escapeHtml,
  telegramMiniAppDeepLink,
  telegramPublicOrigin,
} from "./telegram.server";
import { d1First } from "./d1.server";
import type { Order, ProductRequest, User } from "./types";

/**
 * Primary admin Telegram Chat ID:
 * Uses environment variable TELEGRAM_ADMIN_CHAT_ID, falling back to 6404042791 (@levo_4li).
 */
export function getAdminTelegramChatId(): string {
  const configured = (
    env("TELEGRAM_ADMIN_CHAT_ID") ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ""
  ).trim();
  return configured || "6404042791";
}

/**
 * Look up a user's Telegram Chat ID from users table or telegram_links table.
 */
export async function getUserTelegramChatId(userId: string): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const user = await d1First<{ telegram_id?: string | number }>(
      "SELECT telegram_id FROM users WHERE id = ?",
      userId,
    );
    if (user?.telegram_id) return String(user.telegram_id);

    const link = await d1First<{ telegram_chat_id: string | number }>(
      "SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?",
      userId,
    );
    if (link?.telegram_chat_id) return String(link.telegram_chat_id);
  } catch (err) {
    console.warn("[telegram:notify] Failed to lookup user chat ID:", err);
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
export async function notifyAdminNewOrder(params: {
  order: Order;
  user: { id: string; name?: string; phone?: string; email?: string; username?: string };
}): Promise<boolean> {
  const { order, user } = params;
  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

  const hasDigital = order.items.some(
    (item) => !["hardware", "physical", "accessory", "device"].includes(item.kind),
  );

  const itemsList = order.items
    .map((item, index) => {
      const kindLabel = ["hardware", "physical", "accessory", "device"].includes(item.kind)
        ? "📦 منتج فيزيائي"
        : "🎮 حساب رقمي / لعبة";
      const edition = item.edition ? ` (${item.edition})` : "";
      return `${index + 1}. <b>${escapeHtml(item.title)}</b>${edition} — <i>${kindLabel}</i>\n   الكمية: ${item.quantity || 1} | السعر: ${item.unitPrice.toLocaleString()} د.ع`;
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

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminNewOrder] failed", err);
    return false;
  }
}

/**
 * Notify Admin when a customer sends a message in human/order/support chat.
 */
export async function notifyAdminCustomerMessage(params: {
  thread: { id: string; subject?: string; orderId?: string; chatType?: string };
  message: { text?: string; imageUrl?: string; senderRole: string };
  user: { id: string; name?: string; phone?: string; username?: string };
}): Promise<boolean> {
  const { thread, message, user } = params;
  if (message.senderRole !== "user") return false;

  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

  const customerName = escapeHtml(user.name || user.username || "عميل بنانا");
  const textContent = escapeHtml(message.text || (message.imageUrl ? "📸 [صورة / مرفق]" : ""));
  const threadSubject = escapeHtml(thread.subject || "محادثة الدعم");

  const messageText =
    `💬 <b>رسالة جديدة من عميل في بنانا ستور!</b> 🍌\n\n` +
    `👤 <b>المرسل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    `📂 <b>الموضوع:</b> ${threadSubject}\n` +
    (thread.orderId ? `🔖 <b>مرتبط بطلب:</b> <code>${escapeHtml(thread.orderId)}</code>\n` : "") +
    `\n📝 <b>نص الرسالة:</b>\n<i>${textContent}</i>\n\n` +
    `اضغط على الزر للرد على العميل مباشرة في MiniApp 👇`;

  const startParam = thread.orderId ? `order_${thread.orderId}` : `chat_${thread.id}`;
  const replyMarkup = buildInlineAppButton(
    `💬 الرد على المحادثة في MiniApp`,
    startParam,
    `/chat?threadId=${thread.id}`,
  );

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminCustomerMessage] failed", err);
    return false;
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

export async function notifyAdminWalletTopUp(params: {
  requestId: string;
  amount: number;
  method: string;
  user: { id: string; name?: string; phone?: string };
  proofUrl?: string;
}): Promise<boolean> {
  const { requestId, amount, method, user, proofUrl } = params;
  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

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

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminWalletTopUp] failed", err);
    return false;
  }
}

/**
 * Notify Admin when a user submits a game request.
 */
export async function notifyAdminGameRequest(params: {
  request: ProductRequest;
  user: { id: string; name?: string; phone?: string };
}): Promise<boolean> {
  const { request, user } = params;
  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

  const customerName = escapeHtml(user.name || "عميل بنانا");
  const messageText =
    `🎯 <b>طلب توفير لعبة / منتج جديد!</b> 🍌\n\n` +
    `🕹️ <b>اسم اللعبة / المنتج:</b> <b>${escapeHtml(request.productName)}</b>\n` +
    `📱 <b>المنصة:</b> ${escapeHtml(request.platform || "Nintendo Switch")}\n` +
    `👤 <b>العميل:</b> ${customerName} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    (request.notes ? `📝 <b>ملاحظات:</b> ${escapeHtml(request.notes)}\n` : "") +
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

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminGameRequest] failed", err);
    return false;
  }
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
}): Promise<boolean> {
  const { tradeId, gameName, platform, finalIqd, isCustom, user } = params;
  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

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

  const replyMarkup = buildInlineAppButton(
    `💿 معاينة المقايضة في MiniApp`,
    `trade_${tradeId}`,
    `/trade`,
  );

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminDiscTrade] failed", err);
    return false;
  }
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
}): Promise<boolean> {
  const { listingId, title, priceIqd, conditionGrade, usedType, user } = params;
  const adminChatId = getAdminTelegramChatId();
  if (!adminChatId) return false;

  const messageText =
    `🏷️ <b>عرض قطعة مستعملة بانتظار المراجعة</b> 🍌\n\n` +
    `📦 <b>القطعة:</b> <b>${escapeHtml(title)}</b>\n` +
    (usedType ? `🔖 <b>النوع:</b> ${escapeHtml(usedType)}\n` : "") +
    (conditionGrade ? `⭐ <b>الحالة:</b> ${escapeHtml(conditionGrade)}\n` : "") +
    `💰 <b>السعر:</b> <b>${Math.round(priceIqd).toLocaleString()} د.ع</b>\n` +
    `👤 <b>البائع:</b> ${escapeHtml(user.name || "عضو")} (<code>${escapeHtml(user.phone || user.id)}</code>)\n` +
    `\nلا يظهر العرض لأي زبون قبل موافقتك 👇`;

  const replyMarkup = buildInlineAppButton(`🔍 مراجعة العرض`, `used_${listingId}`, `/admin`);

  try {
    const res = await sendTelegramMessage(adminChatId, messageText, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return res.ok;
  } catch (err) {
    console.error("[telegram:notifyAdminUsedListing] failed", err);
    return false;
  }
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
