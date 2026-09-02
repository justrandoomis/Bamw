import {
  d1All,
  d1First,
  d1Run,
  d1Batch,
  randomId,
  createAuditLog,
  createNotification,
} from "./db.server";
import type { BananaBot, BananaMarketOffer } from "./types";

/**
 * Worker function to process automated Banana Market trades by bots.
 * To be called by a Cloudflare Worker CRON.
 */
export async function processBotTrading() {
  const now = new Date().toISOString();

  // 1. Get active bots
  const bots = await d1All<BananaBot>(`SELECT * FROM banana_bots WHERE is_active = 1`);
  if (!bots.length) return;

  // 2. Get current market price
  const marketPriceRow = await d1First<{ new_price: number }>(
    `SELECT new_price FROM banana_price_history ORDER BY created_at DESC LIMIT 1`,
  );
  const marketPrice = marketPriceRow?.new_price || 0.005;

  for (const bot of bots) {
    // 3. Find cheap offers from users (Anti-Fraud: Check seller is not another bot)
    const offers = await d1All<BananaMarketOffer>(
      `SELECT o.* FROM banana_market_offers o
       LEFT JOIN banana_bots b ON o.user_id = b.id
       WHERE o.status = 'active' AND b.id IS NULL
       AND o.price_iqd <= ?`,
      marketPrice,
    );

    for (const offer of offers) {
      // Logic for price deviation and waiting period
      const deviation = (marketPrice - offer.priceIqd) / marketPrice;
      const waitingMinutes = Math.max(10, 60 - deviation * 100); // 50% less -> 10min, 10% less -> 50min

      const offerTime = new Date(offer.createdAt).getTime();
      const nowTime = Date.now();

      if (nowTime - offerTime > waitingMinutes * 60 * 1000) {
        // Atomic Trade Execution
        try {
          await executeBotPurchase(bot, offer, now);
        } catch (e) {
          console.error(`Bot ${bot.name} failed to buy offer ${offer.id}:`, e);
        }
      }
    }
  }
}

async function executeBotPurchase(bot: BananaBot, offer: BananaMarketOffer, now: string) {
  // Budget & Limit checks
  if (bot.budgetIqd < offer.priceIqd) return;
  if (bot.maxTradeBanana && offer.quantity > bot.maxTradeBanana) return;

  // 1. Atomically Claim the offer first for the bot
  const claimRes = await d1Run(
    `UPDATE banana_market_offers SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'active'`,
    now,
    offer.id,
  );

  if (claimRes.meta.changes === 0) {
    return; // Already taken
  }

  try {
    await d1Batch([
      // Bot Deduct Budget
      {
        sql: `UPDATE banana_bots SET budget_iqd = budget_iqd - ?, updated_at = ? WHERE id = ? AND budget_iqd >= ?`,
        params: [offer.priceIqd, now, bot.id, offer.priceIqd],
      },
      // Seller Add IQD (Wallet)
      {
        sql: `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
        params: [offer.priceIqd, offer.userId],
      },
      // Financial Ledger - Seller IQD
      {
        sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, created_at, reference_type, reference_id)
               VALUES (?, ?, 'deposit', ?, ?, ?, 'banana_market', ?)`,
        params: [
          randomId("wtx"),
          offer.userId,
          offer.priceIqd,
          `مبيعات سوق الموز: ${offer.quantity} موزة`,
          now,
          offer.id,
        ],
      },
      // Seller Deduct Locked Banana
      {
        sql: `UPDATE users SET banana_locked = CASE WHEN banana_locked >= ? THEN banana_locked - ? ELSE NULL END WHERE id = ?`,
        params: [offer.lockedBanana, offer.lockedBanana, offer.userId],
      },
      // Close Offer
      {
        sql: `UPDATE banana_market_offers SET status = 'sold', updated_at = ? WHERE id = ? AND status = 'processing'`,
        params: [now, offer.id],
      },
      // Bot Log
      {
        sql: `INSERT INTO bot_activity_logs (id, bot_id, action, details, created_at)
              VALUES (?, ?, 'purchase', ?, ?)`,
        params: [
          randomId("bal"),
          bot.id,
          JSON.stringify({ offerId: offer.id, price: offer.priceIqd, quantity: offer.quantity }),
          now,
        ],
      },
    ]);
  } catch (err) {
    // Revert claim on failure
    await d1Run(`UPDATE banana_market_offers SET status = 'active' WHERE id = ?`, offer.id);
    throw err;
  }

  await createNotification(
    offer.userId,
    "تم بيع الموز لبوت!",
    `قام ${bot.name} بشراء ${offer.quantity} موزة منك.`,
  );
}

/**
 * Worker function for automated reviews and delivery confirmations.
 */
export async function processAutoScheduledTasks() {
  const now = new Date().toISOString();

  // 1. Auto Review (Pending reviews due for auto-completion)
  const pendingReviews = await d1All<{ id: string }>(
    `SELECT id FROM product_reviews WHERE status = 'pending' AND review_due_at <= ? AND is_auto_review = 0`,
    now,
  );

  for (const rev of pendingReviews) {
    await d1Run(
      `UPDATE product_reviews SET status = 'approved', rating = 5, comment = 'Auto Review', is_auto_review = 1, approved_at = ?, approved_by = 'system', updated_at = ? WHERE id = ?`,
      now,
      now,
      rev.id,
    );
  }

  // 2. Disc Trade Inactivity (7d after creation if still pending/not shipped)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await d1Run(
    `UPDATE disc_trades SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND created_at <= ?`,
    now,
    sevenDaysAgo,
  );

  // 3. Process chat queue & inactivity (5m auto-transfer to AI, 5m/7m/9m reminders, 10m snooze)
  try {
    const { processInactivityAndQueue } = await import("./chat-queue.server");
    await processInactivityAndQueue();
  } catch (err) {
    console.error("[scheduled-jobs] processInactivityAndQueue error:", err);
  }

  /*
    4. Close used-marketplace listings whose paid window has ended.

    The storefront query already hides an expired listing, so this is about the
    seller's own view and the per-seller cap rather than about what a customer
    can see. It goes through the same transition gate as every other status
    change, so each expiry still gets its event row and its notification.
  */
  try {
    const { expireDueListings } = await import("./used-marketplace.server");
    const result = await expireDueListings();
    if (result.expired.length) console.log("[scheduled-jobs:used-market]", result.expired.length);
  } catch (err) {
    console.error("[scheduled-jobs] expiring used listings failed:", err);
  }
}

/**
 * Minute-granular digital-delivery maintenance.
 *
 * Keep this separate from reviews, trade cleanup, and chat inactivity so the
 * one-hour delivery deadline does not make every heavier scheduled scan run
 * once per minute. Cloudflare Cron is at-least-once, so the underlying service
 * uses conditional/idempotent writes.
 */
export async function processDigitalDeliveryMaintenance(now = new Date().toISOString()) {
  try {
    const { processDueDeliveryAutoCompletions } = await import("./order-delivery-items.server");
    const result = await processDueDeliveryAutoCompletions(now);
    if (result.completed || result.reconciled || result.errors) {
      console.log("[scheduled-jobs:digital-delivery]", result);
    }
  } catch (err) {
    console.error("[scheduled-jobs] digital delivery maintenance error:", err);
  }
}

/**
 * Tell everyone who registered for a pre-order that it is out.
 *
 * The buy button needs nothing from this job — the release gate reads the date
 * on every request, so a product sells itself the moment its date passes. This
 * only carries the message, which is the half a customer cannot discover on
 * their own.
 *
 * Cloudflare Cron is at-least-once, so `notified_at` is what stops a repeated
 * firing telling the same person twice: a row is claimed by stamping it, and
 * only rows still unstamped are ever read. A message that fails to send leaves
 * the row stamped rather than retrying forever — a duplicate "it's out!" days
 * later is worse than a missed one, and the product is on the shelf either way.
 */
export async function processReleaseAlerts(now = new Date()) {
  try {
    const pending = await d1All<{
      id: string;
      user_id: string;
      product_id: string;
      product_title: string | null;
    }>(
      `SELECT id, user_id, product_id, product_title FROM product_release_alerts
       WHERE notified_at IS NULL LIMIT 200`,
    );
    if (!pending.length) return;

    const { getStore } = await import("./db.server");
    const { isReleased, releaseDayISO } = await import("./release");
    const store = await getStore();
    const products = new Map(
      (store.products || []).map((product) => [String(product.id), product] as const),
    );

    let sent = 0;
    for (const row of pending) {
      const product = products.get(String(row.product_id));
      // A product that has been deleted since the customer registered can
      // never be released; the row would otherwise sit here forever.
      if (!product) {
        await d1Run(
          `UPDATE product_release_alerts SET notified_at = ? WHERE id = ?`,
          now.toISOString(),
          row.id,
        );
        continue;
      }
      if (!isReleased(product, now)) continue;

      // Claim the row before sending, so a second run cannot send it again.
      await d1Run(
        `UPDATE product_release_alerts SET notified_at = ?, release_date = ? WHERE id = ? AND notified_at IS NULL`,
        now.toISOString(),
        releaseDayISO(product),
        row.id,
      );

      const title = String(product.title || product.titleEn || row.product_title || "اللعبة");
      const link = `/product/${encodeURIComponent(String(product.id))}`;
      try {
        await createNotification(
          row.user_id,
          "صدرت اللعبة التي تنتظرها 🎮",
          `${title} أصبحت متوفرة الآن ويمكنك شراؤها من المتجر.`,
          link,
        );
      } catch (err) {
        console.warn("[scheduled-jobs:release-alert] in-app notification failed", err);
      }

      try {
        const { getUserTelegramChatId } = await import("./telegram-notifications.server");
        const chatId = await getUserTelegramChatId(row.user_id);
        if (chatId) {
          const { sendTelegramMessage } = await import("./telegram.server");
          await sendTelegramMessage(
            chatId,
            `🎮 <b>صدرت اللعبة التي تنتظرها!</b>\n\n<b>${title}</b> أصبحت متوفرة الآن في متجر بنانتو ويمكنك شراؤها.`,
            { parse_mode: "HTML" },
          );
        }
      } catch (err) {
        console.warn("[scheduled-jobs:release-alert] telegram notification failed", err);
      }
      sent++;
    }

    if (sent) console.log(`[scheduled-jobs:release-alerts] notified=${sent}`);
  } catch (err) {
    console.error("[scheduled-jobs] release alerts error:", err);
  }
}
