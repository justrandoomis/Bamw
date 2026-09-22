import {
  d1All,
  d1First,
  d1Run,
  d1Batch,
  randomId,
  createAuditLog,
  createNotification,
} from "./db.server";
import type { BananaBot, BananaMarketOffer, Thread } from "./types";
import { hasExpired } from "./thread-lifecycle";
import {
  toBananaBot,
  toBananaMarketOffer,
  type BananaBotRow,
  type BananaMarketOfferRow,
} from "./banana-rows";

/**
 * Worker function to process automated Banana Market trades by bots.
 * To be called by a Cloudflare Worker CRON.
 */
export async function processBotTrading() {
  const now = new Date().toISOString();

  /*
    Rows are translated, never cast. The columns are snake_case and everything
    below reads camelCase, so `d1All<BananaBot>` handed this loop bots whose
    budget was `undefined` and offers whose price and timestamp were too — and
    a NaN comparison is false, so the bots have never bought anything.
  */
  const bots = (await d1All<BananaBotRow>(`SELECT * FROM banana_bots WHERE is_active = 1`)).map(
    toBananaBot,
  );
  if (!bots.length) return;

  /*
    2. The market price, from the engine rather than from a log of itself.

    This read the newest row of `banana_price_history`, which is a record of
    what the price *was*; the shop prices everything else through
    `spotPriceAt(getMarketConfig())`. Two sources for one number, and the one
    the bots used falls back to a hard-coded 0.005 whenever the history table is
    empty — so on a fresh database the bots traded against a price nobody set.
  */
  const { getMarketConfig, spotPriceAt } = await import("./banana-market-config.server");
  const marketConfig = await getMarketConfig();
  const marketPrice = spotPriceAt(marketConfig);
  /*
    A market priced at nothing has no cheap offers, only free ones. Buying
    against a zero spot would hand the bots every listing on the board for
    nothing, so the job stands down until the price is real.
  */
  if (!(marketPrice > 0)) return;

  /*
    3. Offers cheaper than the market, per banana.

    `price_iqd` is the *total* the seller wants — `createListing` writes
    `quantity × pricePer` into it — and this compared that total against a
    per-banana price. A thousand bananas at a fair price has a total in the
    hundreds and the market price is a fraction of one dinar, so the test was
    false for every listing that has ever existed: the bots have never bought
    anything from anyone.

    Dividing here rather than storing a second column, because the total is
    what the seller is owed and the per-banana price is derived from it
    everywhere else too (see `getSnapshot`).

    Asked once, not once per bot. This sat inside the loop below and mentions
    no bot: every active bot re-ran the identical join, every minute, on a cron
    that is already being killed for exceeding its CPU. Working from one list
    is safe because `executeBotPurchase` claims each offer with a conditional
    update and returns when the claim changes no rows — so a second bot
    reaching an offer the first has taken finds it gone, exactly as it would
    have with a freshly read list.
  */
  const offers = (
    await d1All<BananaMarketOfferRow>(
      `SELECT o.* FROM banana_market_offers o
       LEFT JOIN banana_bots b ON o.user_id = b.id
       WHERE o.status = 'active' AND b.id IS NULL
       AND o.quantity > 0
       AND (o.price_iqd / o.quantity) <= ?`,
      marketPrice,
    )
  ).map(toBananaMarketOffer);
  if (!offers.length) return;

  for (const bot of bots) {
    for (const offer of offers) {
      // Logic for price deviation and waiting period
      const offerPricePer = offer.quantity > 0 ? offer.priceIqd / offer.quantity : 0;
      /* Per banana on both sides — the same unit error as the query above. */
      const deviation = (marketPrice - offerPricePer) / marketPrice;
      const waitingMinutes = Math.max(10, 60 - deviation * 100); // 50% less -> 10min, 10% less -> 50min

      const offerTime = new Date(offer.createdAt).getTime();
      const nowTime = Date.now();

      /*
        An offer whose timestamp cannot be read is left alone rather than
        treated as infinitely old. `NaN` used to make this test false and skip
        everything; making it true instead would buy every such offer the
        instant it appeared, which is the wrong direction for a job that spends
        money on its own.
      */
      if (!Number.isFinite(offerTime)) continue;

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

  /*
    THE THREE LIMITS THE ADMIN SETS AND NOTHING READ.

    `maxTradeBanana` above was the only one of four enforced. The other three
    are stored, mapped onto the bot object and shown in the panel — «أقصى سعر
    شراء», «الحد اليومي», «الحد الأقصى الكلي» — and bounded nothing at all, so
    the numbers the owner types were decoration.

    `maxPurchasePriceIqd` is a price PER BANANA: the panel derives it from the
    live spot price (`roundPrice(base * (1.1 + …))`), not from an offer total.
    So it is compared against this offer's unit price, and a zero-quantity
    offer is refused rather than divided by.
  */
  const unitPrice = offer.quantity > 0 ? offer.priceIqd / offer.quantity : Infinity;
  if (bot.maxPurchasePriceIqd && unitPrice > bot.maxPurchasePriceIqd) return;

  /*
    The two volume limits, counted from the offers this bot actually bought.

    `buyer_id` is the source rather than the activity log: it is a real column
    on a real row with the quantity beside it, and the cron writes it on every
    close. The log's quantity lives inside a JSON blob.

    Counted only when a limit is set, so an unlimited bot costs no query.
  */
  if (bot.dailyLimitBanana || bot.maxTotalBanana) {
    const dayStart = new Date(now).toISOString().slice(0, 10);
    const bought = await d1First<{ today: number; total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN updated_at >= ? THEN quantity ELSE 0 END), 0) AS today,
              COALESCE(SUM(quantity), 0) AS total
       FROM banana_market_offers
       WHERE buyer_id = ? AND status = 'sold'`,
      `${dayStart}T00:00:00.000Z`,
      bot.id,
    );
    const today = Number(bought?.today ?? 0);
    const total = Number(bought?.total ?? 0);
    if (bot.dailyLimitBanana && today + offer.quantity > bot.dailyLimitBanana) return;
    if (bot.maxTotalBanana && total + offer.quantity > bot.maxTotalBanana) return;
  }

  // 1. Atomically Claim the offer first for the bot
  const claimRes = await d1Run(
    `UPDATE banana_market_offers SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'active'`,
    now,
    offer.id,
  );

  if (claimRes.meta.changes === 0) {
    return; // Already taken
  }

  /*
    A GUARD NOTHING WAS CHAINED TO IS NOT A GUARD.

    Statement 0 deducts the bot's budget under `AND budget_iqd >= ?`. When that
    matched no rows — the bot is out of money — the other five statements ran
    anyway: the seller was paid, the bananas released and the offer closed, with
    money the bot does not have. `bot.budgetIqd` is read once for the whole run,
    so it is stale for every offer after the first, and the batch result was
    thrown away.

    Reproduced: a bot with a budget of 1 IQD bought two 1-IQD offers. Seller
    wallet 2, bot budget floored at 0, both offers sold, two deposit rows.

    Every statement after the guard is chained to it now, and the result is
    read — the pattern `orders.server.ts` uses for the wallet debit.
  */
  try {
    const paid = await d1Batch([
      // Bot Deduct Budget
      {
        sql: `UPDATE banana_bots SET budget_iqd = budget_iqd - ?, updated_at = ? WHERE id = ? AND budget_iqd >= ?`,
        params: [offer.priceIqd, now, bot.id, offer.priceIqd],
      },
      // Seller Add IQD (Wallet)
      {
        sql: `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ?
              WHERE id = ? AND changes() = 1`,
        params: [offer.priceIqd, offer.userId],
      },
      // Financial Ledger - Seller IQD
      {
        sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, created_at, reference_type, reference_id)
               SELECT ?, ?, 'deposit', ?, ?, ?, 'banana_market', ? WHERE changes() = 1`,
        params: [
          randomId("wtx"),
          offer.userId,
          offer.priceIqd,
          `مبيعات سوق الموز: ${offer.quantity} موزة`,
          now,
          offer.id,
        ],
      },
      /*
        Seller: release the bananas this offer had locked.

        `ELSE NULL` wrote NULL into a balance column whenever the locked figure
        was somehow short — and every later `banana_locked + ?` or comparison
        against NULL yields NULL, so one mismatched offer would have made that
        member's locked balance permanently unreadable. `MAX(0, …)` is what the
        rest of the banana code does (banana.server.ts:301, :332) and it floors
        instead of poisoning.
      */
      {
        sql: `UPDATE users SET banana_locked = MAX(0, COALESCE(banana_locked, 0) - ?)
              WHERE id = ? AND changes() = 1`,
        params: [offer.lockedBanana, offer.userId],
      },
      // Close Offer
      {
        sql: `UPDATE banana_market_offers SET status = 'sold', buyer_id = ?, updated_at = ?
              WHERE id = ? AND status = 'processing' AND changes() = 1`,
        params: [bot.id, now, offer.id],
      },
      // Bot Log
      {
        sql: `INSERT INTO bot_activity_logs (id, bot_id, action, details, created_at)
              SELECT ?, ?, 'purchase', ?, ? WHERE changes() = 1`,
        params: [
          randomId("bal"),
          bot.id,
          JSON.stringify({ offerId: offer.id, price: offer.priceIqd, quantity: offer.quantity }),
          now,
        ],
      },
    ]);
    /*
      The budget did not cover it. Nothing downstream ran, so there is nothing
      to undo beyond the claim — and the `catch` below is the one place that
      releases it.
    */
    if (Number(paid?.[0]?.meta?.changes ?? 0) !== 1) {
      throw new Error("bot_budget_exhausted");
    }
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

  /*
    Reviews are published synchronously only after the API proves a completed
    purchase. Do not turn checkout-time placeholders into invented five-star
    reviews: those rows have no customer rating or comment, and the former job
    overwrote both with `5 / Auto Review` three days after checkout whether the
    order completed or not. Existing pending rows remain visible to staff for
    cleanup; no new placeholders are created by the repaired checkout path.
  */

  // Repair a bounded batch of older completions that missed their review card
  // or durable reward. The service is idempotent, so cron retries are safe.
  try {
    const { reconcileCompletedOrderReviewFollowups } = await import("./order-completion.server");
    const repaired = await reconcileCompletedOrderReviewFollowups(now, 25);
    if (repaired.repaired || repaired.errors) {
      console.log("[scheduled-jobs:review-followups]", repaired);
    }
  } catch (err) {
    console.error("[scheduled-jobs] review follow-up repair failed:", err);
  }

  try {
    const { reconcilePendingVerifiedReviews } = await import("./reviews.server");
    const reviews = await reconcilePendingVerifiedReviews(25);
    if (reviews.published || reviews.errors) {
      console.log("[scheduled-jobs:verified-reviews]", reviews);
    }
  } catch (err) {
    console.error("[scheduled-jobs] verified review reconciliation failed:", err);
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

  /*
    5. Ask a seller whether the item sold, three days after somebody contacted
       them about it.

    A private sale never touches the till, so a contact button being pressed is
    the only sign the shop gets that one might be happening — and without
    asking, a sold item sits in the section until its window closes. Asking is
    all it does: a seller who does not answer keeps their listing to the end of
    the month they paid for.

    Each listing is asked once. The claim and the stamp are the same statement,
    which matters because Cloudflare Cron is at-least-once and this runs every
    minute alongside the rest.
  */
  try {
    const { promptSellersAboutSales } = await import("./used-marketplace.server");
    const result = await promptSellersAboutSales();
    if (result.asked.length) console.log("[scheduled-jobs:used-sold-prompt]", result.asked.length);
  } catch (err) {
    console.error("[scheduled-jobs] asking sellers about sales failed:", err);
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
    if (result.completed || result.reconciled || result.prompted || result.errors) {
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

/**
 * Pay out referral rewards whose hold period has run out.
 *
 * Most rewards are paid the moment the order completes. This exists for the
 * case where the admin has set a holding period: the completion pass refuses a
 * reward whose `hold_until` is still in the future, and without this nothing
 * would come back for it. Restricted to orders that are actually `completed`,
 * so a hold expiring on a cancelled order pays nobody.
 *
 * Idempotent through the same route as every other approval: the unique key on
 * the wallet transaction, so a second pass over the same reward inserts
 * nothing.
 */
/**
 * Delete the assistant's expired conversations.
 *
 * The member's list already hides them — `listThreadsByUser` filters on read
 * — so this is the part that actually reclaims the rows. Deleting rather than
 * hiding for ever is the point: an assistant conversation from six months ago
 * is noise the member never asked to keep.
 *
 * Everything protective lives in `isExpirable`, and the SQL below does not
 * repeat it: rows are read, judged by the same function the UI uses, and only
 * then deleted. A `WHERE chatType = ...` here would be a second copy of the
 * rule that could drift from the first — and the failure mode of drift is a
 * deleted support ticket.
 */
export async function processExpiredBotThreads(): Promise<{
  scanned: number;
  deleted: number;
}> {
  const result = { scanned: 0, deleted: 0 };
  try {
    /*
      Bounded per run. A sweep that tries to delete everything at once on a
      backlog is a sweep that times out and deletes nothing; the next minute's
      run takes the next batch.
    */
    const rows = await d1All<{ id: string; doc: string }>(
      `SELECT id, doc FROM threads ORDER BY last_message_at ASC LIMIT 200`,
    );
    result.scanned = rows.length;

    const doomed: string[] = [];
    for (const row of rows) {
      let thread: Thread | undefined;
      try {
        thread = JSON.parse(row.doc) as Thread;
      } catch {
        // An unreadable thread is never deleted: it cannot be shown to be
        // expendable, and this job only removes what it can prove.
        continue;
      }
      if (thread && hasExpired(thread)) doomed.push(row.id);
    }

    for (const id of doomed) {
      /*
        Messages first. A thread row without its messages is a broken
        conversation; messages without their thread are invisible rows that
        nothing will ever clean up.
      */
      await d1Run(`DELETE FROM messages WHERE thread_id = ?`, id).catch(() => undefined);
      await d1Run(`DELETE FROM threads WHERE id = ?`, id).catch(() => undefined);
      result.deleted += 1;
    }
  } catch (error) {
    console.warn("[cron:expired_bot_threads_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}

export async function processHeldReferralRewards() {
  try {
    const { dueHeldRewards, approveRewardsForOrder } = await import("./referral/rewards.server");
    const due = await dueHeldRewards(50);
    if (!due.length) return;

    const { getOrder } = await import("./db.server");
    const seen = new Set<string>();
    let paid = 0;
    for (const reward of due) {
      if (seen.has(reward.orderId)) continue;
      seen.add(reward.orderId);
      const order = await getOrder(reward.orderId);
      if (!order || order.status !== "completed") continue;
      const result = await approveRewardsForOrder(order);
      if (result.approved > 0) {
        paid += result.approved;
        try {
          const { notifyReferralApproved } = await import("./referral/notifications.server");
          await notifyReferralApproved(order);
        } catch (err) {
          console.warn("[scheduled-jobs:referral] notification failed", err);
        }
      }
    }
    if (paid) console.log(`[scheduled-jobs:referral-rewards] approved=${paid}`);
  } catch (err) {
    console.error("[scheduled-jobs] referral rewards error:", err);
  }
}
