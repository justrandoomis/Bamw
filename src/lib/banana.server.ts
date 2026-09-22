/**
 * Banana Logic Centralization Service.
 *
 * Provides administrative and high-level market operations.
 * Balance updates must use src/lib/banana-balance.server.ts.
 */

import { d1All, d1First, d1Run, d1RunChanges, d1Ready, d1BatchRun } from "./d1.server";
import {
  getUserBananaBalance,
  creditBananaBalance,
  debitBananaBalance,
} from "./banana-balance.server";
import {
  getMarketConfig,
  getChart,
  spotPriceAt,
  changePercent24h,
  recordPricePoint,
  saveMarketConfig,
  BUCKET_MS,
  type BananaMarketConfig,
} from "./banana-market-config.server";
import { roundPrice } from "./banana-price";

export { getMarketConfig, saveMarketConfig, type BananaMarketConfig };

export class BananaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BananaError";
  }
}

export interface BananaListing {
  id: string;
  userId: string;
  user: string;
  avatar: string;
  verified: boolean;
  quantity: number;
  pricePer: number;
  total: number;
  isPrivate: boolean;
  isPromoted: boolean;
  promotedUntil?: string;
  isLive: boolean;
  diff: number;
  createdAt: string;
}

export interface BananaSnapshot {
  /*
    The bounds the market enforces, so a refusal can name the number rather
    than only say no. Sent by `marketLimits` in banana.server.ts.
  */
  minPrice: number;
  maxPrice: number;
  minListingQuantity: number;
  maxListingQuantity: number;

  price: number;
  change24h: number;
  volume24h: number;
  listings: BananaListing[];
  myListings: BananaListing[];
  balance: number;
  locked: number;
  chart: { time: string; t: string; price: number }[];
  /*
    The redemption catalogue.

    It was missing here while `useBananaMarket` declared it and both the
    redeem screen and the home rewards strip read it — so `rewards` was always
    undefined and the whole «استرداد الموز» catalogue rendered empty no matter
    what the admin put in it. Tickets are sold from that screen, so this had
    to be true before a ticket could be bought at all.
  */
  rewards: BananaRedeemOffer[];
}

/** One redemption offer, in the shape the redeem screen already expects. */
export interface BananaRedeemOffer {
  id: string;
  title: string;
  cost: number;
  stock: number;
  icon: string;
  category: string;
  description?: string;
  /** How many wheel tickets this offer gives. Absent unless it is a ticket. */
  ticketQuantity?: number;
}

export const getBananaBalance = getUserBananaBalance;
export const grantBananas = creditBananaBalance;
export const spendBananas = debitBananaBalance;

/** Bot market-maker offer id: bot_<botId>_<bucket>. */
const BOT_PREFIX = "botoffer_";

interface BotRow {
  id: string;
  name: string;
  budget_iqd: number;
  max_trade_banana: number | null;
  min_price_iqd: number | null;
  max_purchase_price_iqd: number | null;
  is_active: number;
}

function botHash(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Market-maker offers generated from the admin-managed banana_bots rows.
 * Prices float around the live spot price within the configured volatility.
 */
async function getBotListings(config: BananaMarketConfig, spot: number): Promise<BananaListing[]> {
  if (!config.botsEnabled || config.botCount <= 0) return [];
  if (!(await d1Ready())) return [];

  const bots = await d1All<BotRow>(
    `SELECT id, name, budget_iqd, max_trade_banana, min_price_iqd, max_purchase_price_iqd, is_active
     FROM banana_bots WHERE is_active = 1 ORDER BY created_at ASC LIMIT ?`,
    config.botCount,
  );
  if (!bots.length) return [];

  const bucket = Math.floor(Date.now() / BUCKET_MS);
  const amp = Math.max(0, config.volatilityPercent) / 100;

  return bots.map((bot) => {
    const jitter = (botHash(bot.id, bucket) - 0.5) * 2 * amp;
    let pricePer = roundPrice(spot * (1 + jitter));
    if (bot.min_price_iqd) pricePer = Math.max(pricePer, bot.min_price_iqd);
    /*
      The market's band is the OUTER constraint, applied after the bot's own
      floor rather than before it.

      Production's six bots were seeded when the price was around 1 IQD and
      carry floors from 0.643 to 0.769. The spot price is 0.0004. With the
      clamp first and the bot's floor second, every bot listed at its own
      stale floor — a board of offers priced nineteen hundred times the
      market, which is a dead market with numbers on it. A per-bot floor is a
      preference; the admin's floor and ceiling are the rule.
    */
    pricePer = roundPrice(Math.min(config.maxPrice, Math.max(config.minPrice, pricePer)));

    const span = Math.max(0, config.botMaxQuantity - config.botMinQuantity);
    let quantity = Math.round(config.botMinQuantity + botHash(bot.id, bucket + 991) * span);
    if (bot.max_trade_banana) quantity = Math.min(quantity, bot.max_trade_banana);
    quantity = Math.max(1, quantity);

    const diff = spot > 0 ? Math.round(((pricePer - spot) / spot) * 1000) / 10 : 0;

    return {
      id: `${BOT_PREFIX}${bot.id}_${bucket}`,
      userId: bot.id,
      user: bot.name,
      avatar: "🤖",
      verified: true,
      quantity,
      pricePer,
      total: Math.round(quantity * pricePer * 100) / 100,
      isPrivate: false,
      isPromoted: false,
      isLive: true,
      diff,
      createdAt: new Date(bucket * BUCKET_MS).toISOString(),
    } satisfies BananaListing;
  });
}

/**
 * Fetch a complete market snapshot from real data:
 * live spot price, real user offers, admin-controlled bot offers and
 * the recorded price history.
 */
export async function getSnapshot(userId?: string, range = "1D"): Promise<BananaSnapshot> {
  const config = await getMarketConfig();
  const price = spotPriceAt(config);
  void recordPricePoint(price).catch(() => undefined);

  const bal = userId ? await getUserBananaBalance(userId) : { balance: 0, locked: 0 };

  if (!(await d1Ready())) {
    return {
      price,
      change24h: changePercent24h(config),
      volume24h: 0,
      listings: [],
      myListings: [],
      balance: bal.balance,
      locked: bal.locked,
      chart: await getChart(config, range),
      rewards: [],
      ...marketLimits(config),
    };
  }

  const offers = await d1All<any>(
    `SELECT o.*, u.name as user_name, u.username as user_username, u.avatar as user_avatar
     FROM banana_market_offers o
     JOIN users u ON o.user_id = u.id
     WHERE o.status = 'active'
     ORDER BY o.created_at DESC LIMIT 100`,
  );

  const userListings: BananaListing[] = offers.map((o) => {
    const pricePer = o.quantity > 0 ? o.price_iqd / o.quantity : 0;
    return {
      id: o.id,
      userId: o.user_id,
      user: o.user_username ? `@${o.user_username}` : o.user_name || "مستخدم",
      avatar: o.user_avatar || "",
      verified: Boolean(o.user_username),
      quantity: o.quantity,
      /*
        A member's own listing, at the precision the market actually prices at.

        The one offer ever created in this shop was 430,000 bananas for 50.0047
        IQD — 0.000116 per banana — and three decimals showed its owner a price
        of 0.000 for their own sale. That is «البيع لا يعمل» seen from the
        member's side: the listing existed and read as worthless.
      */
      pricePer: roundPrice(pricePer),
      total: o.price_iqd,
      isPrivate: false,
      isPromoted: false,
      isLive: false,
      diff: price > 0 ? Math.round(((pricePer - price) / price) * 1000) / 10 : 0,
      createdAt: o.created_at,
    };
  });

  const bots = await getBotListings(config, price);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const volumeRow = await d1First<{ v: number }>(
    `SELECT COALESCE(SUM(quantity), 0) AS v FROM banana_market_offers
     WHERE status = 'sold' AND updated_at >= ?`,
    since,
  );

  const rewards = await readRedeemOffers();

  return {
    price,
    change24h: changePercent24h(config),
    volume24h: Number(volumeRow?.v ?? 0),
    rewards,
    listings: [...bots, ...userListings.filter((l) => l.userId !== userId)].sort(
      (a, b) => a.pricePer - b.pricePer,
    ),
    myListings: userId ? userListings.filter((l) => l.userId === userId) : [],
    balance: bal.balance,
    locked: bal.locked,
    chart: await getChart(config, range),
    ...marketLimits(config),
  };
}

/**
 * The redemption catalogue, as the redeem screen wants it.
 *
 * Only what is live: inactive offers, ones whose window has not opened or has
 * closed, and ones that have sold out are not choices a member can make, and
 * listing them would be the shop advertising something it will then refuse.
 * `stock = -1` is the table's way of saying unlimited.
 */
async function readRedeemOffers(): Promise<BananaRedeemOffer[]> {
  try {
    const now = new Date().toISOString();
    const rows = await d1All<{
      id: string;
      title: string;
      description: string | null;
      image_url: string | null;
      banana_price: number;
      stock: number | null;
    }>(
      `SELECT id, title, description, image_url, banana_price, stock
       FROM banana_redemption_offers
       WHERE is_active = 1
         AND (stock IS NULL OR stock < 0 OR stock > 0)
         AND (start_date IS NULL OR start_date = '' OR start_date <= ?)
         AND (end_date IS NULL OR end_date = '' OR end_date >= ?)
       ORDER BY banana_price ASC
       LIMIT 60`,
      now,
      now,
    );
    if (rows.length === 0) return [];

    const { ticketOfferIds } = await import("./wheel.server");
    const tickets = await ticketOfferIds().catch(() => ({}) as Record<string, number>);

    return rows.map((row) => {
      const ticketQuantity = tickets[row.id];
      return {
        id: row.id,
        title: row.title,
        cost: Number(row.banana_price) || 0,
        stock: Number(row.stock ?? -1),
        icon: row.image_url || (ticketQuantity ? "🎟️" : "🎁"),
        category: ticketQuantity ? "wheel_ticket" : "reward",
        ...(row.description ? { description: row.description } : {}),
        ...(ticketQuantity ? { ticketQuantity } : {}),
      };
    });
  } catch (error) {
    /*
      A broken catalogue must not take the market page down with it. The
      snapshot carries the price, the balance and the listings too, and a
      member who came to trade should not meet an error because a reward row
      is malformed.
    */
    console.warn("[banana:redeem_offers_failed]", error);
    return [];
  }
}

/**
 * The bounds a member is trading inside, sent with the snapshot.
 *
 * Not secrets: they are the rules of the market, and the page needs them to
 * say «أعلى سعر مسموح 5 د.ع» instead of «price_above_max». Prices and limits
 * only — nothing about the shop's own money.
 */
function marketLimits(config: BananaMarketConfig) {
  return {
    minPrice: config.minPrice,
    maxPrice: config.maxPrice,
    minListingQuantity: config.minListingQuantity,
    maxListingQuantity: config.maxListingQuantity,
    promoRatePerMinute: config.promoRatePerMinute,
  };
}

/** Validate a user listing against the admin-controlled market bounds. */
async function assertListingWithinBounds(quantity: number, pricePer: number) {
  const config = await getMarketConfig();
  if (!Number.isFinite(quantity) || quantity < config.minListingQuantity) {
    throw new BananaError("quantity_below_min");
  }
  if (quantity > config.maxListingQuantity) throw new BananaError("quantity_above_max");
  if (!Number.isFinite(pricePer) || pricePer < config.minPrice)
    throw new BananaError("price_below_min");
  if (pricePer > config.maxPrice) throw new BananaError("price_above_max");
}

export async function createListing(
  userId: string,
  data: {
    quantity: number;
    pricePer: number;
    isPrivate?: boolean;
    isPromoted?: boolean;
    promoteMinutes?: number;
  },
) {
  await assertListingWithinBounds(data.quantity, data.pricePer);
  const total = data.quantity * data.pricePer;

  // Use market functions logic: Debit balance, add to locked, create offer.
  // We delegate to the centralized balance logic for the debit part.
  const res = await debitBananaBalance(userId, data.quantity, {
    reason: "Market Listing Creation",
    kind: "listing_fee",
    meta: { pricePer: data.pricePer, total },
  });

  if (!res.success) throw new BananaError(res.error || "insufficient_balance");

  /*
    A random id, not a timestamp.

    `bmo_${Date.now()}` collides for two listings created in the same
    millisecond — and the collision lands AFTER `debitBananaBalance` has
    already taken the bananas, so the INSERT fails and the member is simply
    poorer. It is not a theoretical race: a double-tapped publish button is
    inside one millisecond often enough, and a test that creates three
    listings in a loop hit it on the second.
  */
  const { randomId } = await import("./crypto.server");
  const id = randomId("bmo");
  await d1BatchRun([
    {
      sql: `UPDATE users SET banana_locked = banana_locked + ? WHERE id = ?`,
      binds: [data.quantity, userId],
    },
    {
      sql: `INSERT INTO banana_market_offers (id, user_id, quantity, price_iqd, locked_banana, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      binds: [
        id,
        userId,
        data.quantity,
        total,
        data.quantity,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    },
  ]);

  return { success: true, id };
}

export async function updateListing(
  userId: string,
  data: { id: string; quantity: number; pricePer: number },
) {
  await assertListingWithinBounds(data.quantity, data.pricePer);

  /*
    An ACTIVE listing, and the seller's own.

    `cancelListing` below has always required `status = 'active'`; this did
    not, and the two together printed bananas. Create a listing of N — the
    balance falls by N and `banana_locked` rises by N. Cancel it — the locked
    figure is released and the balance is credited back, correctly, and the
    row survives at status 'cancelled' still saying `quantity = N`. Then edit
    that cancelled row down: `diff` is negative, so the difference is credited
    a SECOND time, out of nothing, against bananas that are no longer locked
    against anything. Repeat for as much as you like.

    Nothing about that needed a race or a special account. It is one ordinary
    edit on a listing the seller had already cancelled.
  */
  const offer = await d1First<{ quantity: number }>(
    `SELECT quantity FROM banana_market_offers
     WHERE id = ? AND user_id = ? AND status = 'active'`,
    data.id,
    userId,
  );
  if (!offer) throw new BananaError("listing_not_found");

  const diff = data.quantity - Number(offer.quantity);

  /*
    The bananas move only once the row has been claimed.

    Two edits arriving together both read the same quantity, and without a
    claim both would be refunded the same difference. The UPDATE names the
    quantity it expects, so the second one changes no rows and is told the
    listing moved under it — the same shape of guard `executeBotPurchase` uses
    to claim an offer.

    An increase is debited BEFORE the claim, because the seller may not have
    the bananas and refusing is cheaper than undoing; if the claim then fails,
    the debit is returned. A decrease is credited AFTER, so a failed claim
    credits nothing.
  */
  if (diff > 0) {
    const res = await debitBananaBalance(userId, diff, {
      reason: "Listing Update Increase",
      kind: "listing_fee",
    });
    if (!res.success) throw new BananaError(res.error || "insufficient_balance");
  }

  const claimed = await d1RunChanges(
    `UPDATE banana_market_offers
     SET quantity = ?, price_iqd = ?, locked_banana = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'active' AND quantity = ?`,
    data.quantity,
    data.quantity * data.pricePer,
    data.quantity,
    new Date().toISOString(),
    data.id,
    userId,
    offer.quantity,
  );

  if (!claimed) {
    if (diff > 0) {
      await creditBananaBalance(userId, diff, {
        reason: "Listing Update Reverted",
        kind: "refund",
      });
    }
    throw new BananaError("listing_changed");
  }

  if (diff > 0) {
    await d1Run(`UPDATE users SET banana_locked = banana_locked + ? WHERE id = ?`, diff, userId);
  } else if (diff < 0) {
    await d1Run(
      `UPDATE users SET banana_locked = MAX(0, banana_locked - ?) WHERE id = ?`,
      Math.abs(diff),
      userId,
    );
    await creditBananaBalance(userId, Math.abs(diff), {
      reason: "Listing Update Decrease",
      kind: "refund",
    });
  }

  return { success: true };
}

export async function cancelListing(userId: string, listingId: string) {
  const offer = await d1First<{ quantity: number }>(
    `SELECT quantity FROM banana_market_offers
     WHERE id = ? AND user_id = ? AND status = 'active'`,
    listingId,
    userId,
  );
  if (!offer) throw new BananaError("listing_not_found");

  /*
    Claimed, then refunded — not read, then refunded.

    The read and the write were two statements with a gap between them, and
    both of two cancels arriving together passed the read. Each then released
    the lock and credited the quantity, so one listing paid its owner twice.
    `updateListing` got this guard when it was found to be printing bananas;
    cancelling had the same shape and the same consequence.

    The UPDATE is the claim: exactly one caller changes a row, and only that
    caller goes on to move any bananas. It names the quantity it read, the way
    `updateListing` does, because status alone is not enough — an edit that
    shrinks the listing between the read and the claim refunds the difference
    itself, and a cancel still holding the old figure would refund the whole
    of it on top.
  */
  const claimed = await d1RunChanges(
    `UPDATE banana_market_offers SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'active' AND quantity = ?`,
    new Date().toISOString(),
    listingId,
    userId,
    offer.quantity,
  );
  if (!claimed) throw new BananaError("listing_changed");

  await d1Run(
    `UPDATE users SET banana_locked = MAX(0, COALESCE(banana_locked, 0) - ?) WHERE id = ?`,
    offer.quantity,
    userId,
  );
  await creditBananaBalance(userId, Number(offer.quantity), {
    reason: "Listing Cancellation",
    kind: "refund",
    /*
      One refund per listing, whatever happens above. The claim already makes
      a second caller impossible; this makes a second ATTEMPT by the same
      caller — a retry after a timeout — impossible too.
    */
    idempotencyKey: `cancel:${listingId}`,
  });
  return { success: true };
}

/** Buy a market-maker (bot) offer: the bot sells bananas, the store collects the IQD. */
async function buyBotListing(userId: string, listingId: string) {
  const config = await getMarketConfig();
  const rest = listingId.slice(BOT_PREFIX.length);
  const sep = rest.lastIndexOf("_");
  const botId = sep > 0 ? rest.slice(0, sep) : rest;

  const spot = spotPriceAt(config);
  const listings = await getBotListings(config, spot);
  const listing = listings.find((l) => l.id === listingId || l.userId === botId);
  if (!listing) throw new BananaError("listing_not_found");
  // Reject stale prices (the offer refreshed into a new bucket).
  if (listing.id !== listingId) throw new BananaError("listing_expired");

  const buyer = await d1First<any>(`SELECT wallet_balance FROM users WHERE id = ?`, userId);
  if (!buyer || buyer.wallet_balance < listing.total) throw new BananaError("insufficient_funds");

  const now = new Date().toISOString();
  await d1BatchRun([
    {
      sql: `UPDATE users SET wallet_balance = CASE WHEN wallet_balance >= ? THEN wallet_balance - ? ELSE NULL END WHERE id = ?`,
      binds: [listing.total, listing.total, userId],
    },
    {
      sql: `UPDATE banana_bots SET budget_iqd = budget_iqd + ?, updated_at = ? WHERE id = ?`,
      binds: [listing.total, now, botId],
    },
    {
      sql: `INSERT INTO bot_activity_logs (id, bot_id, action, details, created_at) VALUES (?, ?, 'sale', ?, ?)`,
      binds: [
        `bal_${Date.now()}`,
        botId,
        JSON.stringify({ buyerId: userId, quantity: listing.quantity, total: listing.total }),
        now,
      ],
    },
  ]);

  await creditBananaBalance(userId, listing.quantity, {
    reason: `Market Purchase (bot): ${botId}`,
    kind: "trade",
    meta: { botId, price: listing.total, pricePer: listing.pricePer },
  });

  return { success: true, commission: 0 };
}

export async function buyListing(userId: string, listingId: string) {
  if (listingId.startsWith(BOT_PREFIX)) return buyBotListing(userId, listingId);

  const config = await getMarketConfig();
  const offer = await d1First<any>(
    `SELECT * FROM banana_market_offers WHERE id = ? AND status = 'active'`,
    listingId,
  );
  if (!offer) throw new BananaError("listing_not_found");
  if (offer.user_id === userId) throw new BananaError("cannot_buy_own_listing");

  const buyer = await d1First<any>(`SELECT wallet_balance FROM users WHERE id = ?`, userId);
  if (!buyer || buyer.wallet_balance < offer.price_iqd) throw new BananaError("insufficient_funds");

  // Store commission is deducted from the seller's payout.
  const commission =
    Math.round(offer.price_iqd * (Math.max(0, config.commissionPercent) / 100) * 100) / 100;
  const sellerPayout = Math.max(0, Math.round((offer.price_iqd - commission) * 100) / 100);

  await d1BatchRun([
    // Money transfer
    {
      sql: `UPDATE users SET wallet_balance = CASE WHEN wallet_balance >= ? THEN wallet_balance - ? ELSE NULL END WHERE id = ?`,
      binds: [offer.price_iqd, offer.price_iqd, userId],
    },
    {
      sql: `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
      binds: [sellerPayout, offer.user_id],
    },
    // Locked banana reduction for seller
    {
      sql: `UPDATE users SET banana_locked = CASE WHEN banana_locked >= ? THEN banana_locked - ? ELSE NULL END WHERE id = ?`,
      binds: [offer.quantity, offer.quantity, offer.user_id],
    },
    // Status update
    {
      sql: `UPDATE banana_market_offers SET status = 'sold', updated_at = ? WHERE id = ?`,
      binds: [new Date().toISOString(), listingId],
    },
  ]);

  // Banana credit for buyer
  await creditBananaBalance(userId, offer.quantity, {
    reason: `Market Purchase: ${listingId}`,
    kind: "trade",
    meta: { sellerId: offer.user_id, price: offer.price_iqd, commission },
  });

  return { success: true, commission };
}

/**
 * Put a redemption back: the bananas, and the stock that was spent on it.
 *
 * Three paths could fail after the debit and each one had written its own
 * version of this — the first restored the stock, the second did not, and a
 * third silently did nothing at all. A member who lost their bananas to a
 * failed ticket grant also lost one unit of stock that nobody received, and
 * a reward with ten in stock could reach zero having delivered none.
 *
 * `creditBananaBalance` really is idempotent on `idempotencyKey` (unlike the
 * debit, whose key is only the transaction's id), so calling this twice for
 * one redemption cannot pay the member twice.
 */
async function refundRedemption(
  userId: string,
  reward: { banana_price?: unknown; title?: unknown; id?: unknown },
  rid: string,
  reason: string,
): Promise<void> {
  await creditBananaBalance(userId, Number(reward.banana_price) || 0, {
    reason,
    kind: "refund",
    idempotencyKey: `refund_${rid}`,
  }).catch(() => undefined);
  await d1Run(
    `UPDATE banana_redemption_offers SET stock = CASE WHEN stock >= 0 THEN stock + 1 ELSE stock END WHERE id = ?`,
    String(reward.id ?? ""),
  ).catch(() => undefined);
  /*
    And the row itself, so the member is not shown a redemption they were
    refunded for. Deleted by its own id, which is this redemption and no
    other.
  */
  await d1Run(`DELETE FROM banana_redemptions WHERE id = ? AND user_id = ?`, rid, userId).catch(
    () => undefined,
  );
}

export async function redeemReward(userId: string, rewardId: string) {
  const reward = await d1First<any>(
    `SELECT * FROM banana_redemption_offers WHERE id = ? AND is_active = 1`,
    rewardId,
  );
  /*
    A field, not the row.

    `d1First` answers with a truthy empty object when there is no D1 binding,
    so `if (!reward)` was true of "the reward exists" and of "there is no
    database" alike. The second case then read `reward.banana_price` as
    undefined and handed `NaN` to the debit.
  */
  if (!reward?.id) throw new BananaError("reward_not_found");
  if (reward.stock === 0) throw new BananaError("out_of_stock");

  const res = await debitBananaBalance(userId, reward.banana_price, {
    reason: `Redemption: ${reward.title}`,
    kind: "spend",
  });

  if (!res.success) throw new BananaError(res.error || "insufficient_balance");

  /*
    The stock claim, and it has to be a claim rather than a subtraction.

    It was `SET stock = CASE WHEN stock > 0 THEN stock - 1 ELSE stock END`,
    which cannot fail and cannot say no. Two members who both read `stock = 1`
    a moment apart both passed the check above, both paid, and the second
    UPDATE wrote 0 over 0 and reported success — one unit, sold twice.
    `changes` alone does not help either: SQLite counts a row whose WHERE
    matched even when the value written was identical, so the guard belongs
    in the WHERE.

    It was also the one statement after the debit with no catch and no
    compensation. A transient failure here left the bananas gone, nothing
    recorded, and a 500 at the member.

    Unlimited stock is `-1`, which is the schema default and what most
    rewards carry. It is not decremented at all — `stock > 0` would match
    nothing and a run that read that as "sold out" would refuse every
    unlimited reward in the shop.
  */
  const unlimitedStock = Number(reward.stock) < 0;
  if (!unlimitedStock) {
    const claimed = await d1RunChanges(
      `UPDATE banana_redemption_offers SET stock = stock - 1 WHERE id = ? AND stock > 0`,
      rewardId,
    ).catch(() => -1);

    if (claimed !== 1) {
      /*
        Either somebody took the last one between the check and here, or the
        statement failed. The bananas have already gone, so they come back
        either way; only the message differs, because one is a fact about the
        shop and the other is a fault.
      */
      await creditBananaBalance(userId, Number(reward.banana_price) || 0, {
        reason: `Redemption refund: ${reward.title}`,
        kind: "refund",
        idempotencyKey: `refund_stock_${userId}_${rewardId}_${Date.now()}`,
      }).catch(() => undefined);
      throw new BananaError(claimed === 0 ? "out_of_stock" : "redemption_not_recorded");
    }
  }

  /*
    The redemption log, with the column it is actually declared with.

    This INSERT named a `status` column the table does not have and omitted
    `cost`, which is `INTEGER NOT NULL` with no default (d1.server.ts:293-294).
    So every redemption against a real D1 threw a constraint error — *after*
    `debitBananaBalance` had already taken the bananas, and the throw reached
    the route as a 500 rather than anything a member could act on. Bananas
    went in, nothing came out, and no row recorded it.
  */
  /*
    A millisecond is not an identity.

    `rid` is the `banana_redemptions` primary key, the ticket grant's
    idempotency reference, and the key both refunds are written under. Built
    from `Date.now()` alone, two members redeeming in the same millisecond
    computed the same one — and on a Worker that is not a remote possibility,
    it is what a popular reward looks like at launch. The second INSERT would
    fail on the primary key, and the refund that followed would be written
    under the first member's key.
  */
  const { randomId } = await import("./crypto.server");
  const rid = randomId("brd");
  const loggedAt = new Date().toISOString();
  try {
    await d1Run(
      `INSERT INTO banana_redemptions (id, user_id, reward_id, cost, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      rid,
      userId,
      rewardId,
      Number(reward.banana_price) || 0,
      loggedAt,
    );
  } catch (error) {
    /*
      The log is not worth the member's bananas. If it cannot be written the
      redemption is put back rather than silently swallowed — the credit is
      idempotent, so a retry cannot double it.
    */
    await creditBananaBalance(userId, Number(reward.banana_price) || 0, {
      reason: `Redemption refund: ${reward.title}`,
      kind: "refund",
      idempotencyKey: `refund_${rid}`,
    }).catch(() => undefined);
    await d1Run(
      `UPDATE banana_redemption_offers SET stock = CASE WHEN stock >= 0 THEN stock + 1 ELSE stock END WHERE id = ?`,
      rewardId,
    ).catch(() => undefined);
    throw new BananaError("redemption_not_recorded");
  }

  /*
    A wheel ticket is a redemption like any other: the admin sets its banana
    price on the same screen as every other reward, and this is where that
    purchase turns into a ticket. `rid` is the idempotency reference, so a
    retried redemption cannot mint a second ticket.
  */
  const { grantTickets, ticketQuantityForOffer } = await import("./wheel.server");

  /*
    A lookup that failed and an offer that sells no tickets are not the same
    thing, and `.catch(() => 0)` made them one. A transient error here read as
    "this reward is not a ticket offer", so the member's bananas were taken,
    the redemption was recorded, no tickets were granted, and the reply said
    `success: true`. Nothing anywhere would have said otherwise.

    It is asked again once, because the usual cause is a single dropped
    request; if it still cannot be answered the redemption is put back rather
    than guessed at.
  */
  let quantity = 0;
  try {
    quantity = await ticketQuantityForOffer(rewardId);
  } catch {
    try {
      quantity = await ticketQuantityForOffer(rewardId);
    } catch {
      await refundRedemption(userId, reward, rid, "Ticket lookup refund");
      throw new BananaError("ticket_not_granted");
    }
  }

  if (quantity > 0) {
    const granted = await grantTickets({
      userId,
      quantity,
      reason: "redemption",
      referenceId: rid,
      now: loggedAt,
    }).catch(() => ({ granted: false, balance: 0 }));

    if (!granted.granted) {
      await refundRedemption(userId, reward, rid, `Ticket refund: ${reward.title}`);
      throw new BananaError("ticket_not_granted");
    }

    return { success: true, redemptionId: rid, tickets: granted.balance };
  }

  return { success: true, redemptionId: rid };
}

// Admin functions
export async function getAdminBananaData() {
  /* Settings only — the admin panel has no use for the catalogue here. */
  const { getStoreSettings } = await import("./db.server");
  const s = await getStoreSettings();
  const marketConfig = await getMarketConfig();

  /*
    How many wheel tickets each reward hands over, alongside the reward itself.

    It is a second table because a redemption offer has no column for it, and
    the admin screen has to be able to see the number it is editing — an
    offer that silently sells tickets, with nothing on the card to say so, is
    how the owner ends up unable to tell which one it is.
  */
  const { ticketOfferIds } = await import("./wheel.server");
  const ticketOffers = await ticketOfferIds().catch(() => ({}) as Record<string, number>);
  const rewards = (
    await d1All<any>(
      `SELECT * FROM banana_redemption_offers ORDER BY sort_order ASC, created_at DESC`,
    )
  )
    .map(toAdminReward)
    .map((reward) => ({ ...reward, ticketQuantity: Number(ticketOffers[reward.id] ?? 0) }));
  const redemptions = await d1All<any>(
    `SELECT r.*, u.name as user_name FROM banana_redemptions r JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC LIMIT 100`,
  );
  const listings = await d1All<any>(
    `SELECT o.*, u.name as user_name FROM banana_market_offers o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 100`,
  );
  const bots = await d1All<any>(`SELECT * FROM banana_bots ORDER BY created_at ASC`);
  const topUsers = await d1All<any>(
    `SELECT id, name, username, phone, banana_balance, banana_locked FROM users
     ORDER BY banana_balance DESC LIMIT 50`,
  );

  const circulating = await d1First<{ v: number }>(
    `SELECT COALESCE(SUM(banana_balance), 0) AS v FROM users`,
  );
  const wallets = await d1First<{ v: number }>(
    `SELECT COUNT(*) AS v FROM users WHERE banana_balance > 0`,
  );
  const activeListings = await d1First<{ c: number; v: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(quantity), 0) AS v FROM banana_market_offers WHERE status = 'active'`,
  );
  const redemptionStats = await d1First<{ c: number; v: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(cost), 0) AS v FROM banana_redemptions`,
  );

  return {
    settings: {
      rewardRatePerIqd: Number(s["bananaPerDinar"] ?? 6.8),
      dinarPerBanana: Number(s["dinarPerBanana"] ?? 1000),
      openingPrice: marketConfig.basePrice,
      promoRatePerMinute: marketConfig.promoRatePerMinute,
      signupGrant: Number(s["bananaSignupGrant"] ?? 500),
    },
    marketConfig,
    /*
      The wheel's bands, its losing chance and what a ticket costs, so the
      panel can show the owner the numbers it is asking them to edit rather
      than a form with nothing in it.
    */
    wheelOdds: await (async () => {
      const { getWheelOdds } = await import("./wheel.server");
      return getWheelOdds().catch(async () => {
        const { normalizeWheelOdds } = await import("./wheel-odds");
        return normalizeWheelOdds(undefined);
      });
    })(),
    livePrice: spotPriceAt(marketConfig),
    bots,
    rewards,
    redemptions,
    listings,
    topUsers,
    stats: {
      circulatingBananas: Number(circulating?.v ?? 0),
      userWalletsCount: Number(wallets?.v ?? 0),
      activeListingsCount: Number(activeListings?.c ?? 0),
      activeListingsVolume: Number(activeListings?.v ?? 0),
      totalRedemptionsCount: Number(redemptionStats?.c ?? 0),
      totalBananasRedeemed: Number(redemptionStats?.v ?? 0),
    },
  };
}

/** Create/update a market-maker bot. */
export async function adminSaveBot(bot: any) {
  const id = bot.id || `bot_${Date.now()}`;
  const now = new Date().toISOString();
  const existing = bot.id
    ? await d1First<any>(`SELECT id FROM banana_bots WHERE id = ?`, id)
    : undefined;

  if (existing) {
    await d1Run(
      `UPDATE banana_bots SET name = ?, budget_iqd = ?, max_trade_banana = ?, daily_limit_banana = ?,
        max_total_banana = ?, min_price_iqd = ?, max_purchase_price_iqd = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      bot.name,
      Number(bot.budgetIqd ?? 0),
      bot.maxTradeBanana ?? null,
      bot.dailyLimitBanana ?? null,
      bot.maxTotalBanana ?? null,
      bot.minPriceIqd ?? null,
      bot.maxPurchasePriceIqd ?? null,
      bot.isActive ? 1 : 0,
      now,
      id,
    );
  } else {
    await d1Run(
      `INSERT INTO banana_bots (id, name, budget_iqd, max_trade_banana, daily_limit_banana, max_total_banana,
        min_price_iqd, max_purchase_price_iqd, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      bot.name || "Bot",
      Number(bot.budgetIqd ?? 0),
      bot.maxTradeBanana ?? null,
      bot.dailyLimitBanana ?? null,
      bot.maxTotalBanana ?? null,
      bot.minPriceIqd ?? null,
      bot.maxPurchasePriceIqd ?? null,
      bot.isActive ? 1 : 0,
      now,
      now,
    );
  }
  return { success: true, id };
}

export async function adminDeleteBot(id: string) {
  await d1Run(`DELETE FROM banana_bots WHERE id = ?`, id);
  return { success: true };
}

/**
 * The price in bananas, under either of the names it travels by.
 *
 * The form field is `cost` and this function read `bananaPrice`, so every save
 * arrived as `Number(undefined)` — NaN — and the route refused it before it got
 * here. Both names are read rather than one being renamed, because the reward
 * list, the redemption screen and the storefront each picked their own.
 */
function rewardBananaPrice(reward: any): number {
  const value = Number(reward?.bananaPrice ?? reward?.cost ?? reward?.banana_price);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Writes a reward, whether or not one with that id is already there.
 *
 * It used to choose between INSERT and UPDATE by asking whether the caller had
 * sent an id — and the form generates one for a *new* reward before the admin
 * has typed anything (`rw-x7f2q1`). So every new reward took the UPDATE branch,
 * matched no row, changed nothing, and returned success. The admin pressed save
 * and the reward simply never existed.
 *
 * An upsert asks the database instead of guessing. `ON CONFLICT` is decided by
 * the row that is actually there, so the same statement is right for both cases
 * and there is no read-then-write between them to race.
 */
export async function adminSaveReward(reward: any) {
  const id = String(reward.id || `bre_${Date.now()}`);
  const now = new Date().toISOString();
  const price = rewardBananaPrice(reward);

  await d1Run(
    `INSERT INTO banana_redemption_offers
       (id, title, description, banana_price, stock, is_active,
        icon, category, coupon_value, coupon_type, reward_code, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       banana_price = excluded.banana_price,
       stock = excluded.stock,
       is_active = excluded.is_active,
       icon = excluded.icon,
       category = excluded.category,
       coupon_value = excluded.coupon_value,
       coupon_type = excluded.coupon_type,
       reward_code = excluded.reward_code,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
    id,
    String(reward.title ?? "").trim(),
    reward.description ?? null,
    price,
    Number(reward.stock ?? -1),
    reward.isActive === false ? 0 : 1,
    reward.icon ?? null,
    reward.category ?? null,
    Number(reward.couponValue ?? 0) || null,
    reward.couponType ?? null,
    reward.rewardCode ?? null,
    Number(reward.sortOrder ?? 0) || 0,
    now,
    now,
  );

  const saved = await d1First<any>(`SELECT * FROM banana_redemption_offers WHERE id = ?`, id);
  /*
    Read back rather than echoing the request. A save that wrote nothing used to
    return the caller's own object, so it looked identical to one that worked.
  */
  if (!saved) throw new BananaError("reward_not_stored");
  return toAdminReward(saved);
}

/**
 * One reward row, in the names the admin screen reads.
 *
 * `getAdminBananaData` returned `SELECT *` — raw snake_case — and the form
 * reads `cost`, `icon`, `category`, `couponValue`, `isActive`. Not one of those
 * exists on the row, so opening an existing reward to edit it filled the form
 * with undefined and saving it back would have blanked the record.
 */
export function toAdminReward(row: any) {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: row.description ?? "",
    /* Both names, because the form reads one and the storefront the other. */
    cost: Number(row.banana_price ?? 0),
    bananaPrice: Number(row.banana_price ?? 0),
    stock: Number(row.stock ?? -1),
    isActive: Number(row.is_active ?? 1) === 1,
    icon: row.icon ?? "🎁",
    category: row.category ?? "vouchers",
    couponValue: Number(row.coupon_value ?? 0),
    couponType: row.coupon_type ?? "fixed",
    rewardCode: row.reward_code ?? "",
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function adminDeleteReward(id: string) {
  await d1Run(`DELETE FROM banana_redemption_offers WHERE id = ?`, id);
  return { success: true };
}

export async function adminToggleReward(id: string, active: boolean) {
  await d1Run(`UPDATE banana_redemption_offers SET is_active = ? WHERE id = ?`, active ? 1 : 0, id);
  return { success: true };
}

export async function adminUpdateRedemption(id: string, data: any) {
  await d1Run(
    `UPDATE banana_redemptions SET status = ?, admin_notes = ?, delivery_code = ? WHERE id = ?`,
    data.status,
    data.adminNotes,
    data.deliveryCode,
    id,
  );
  return { success: true };
}

export async function adminCancelMarketListing(id: string) {
  const offer = await d1First<any>(`SELECT * FROM banana_market_offers WHERE id = ?`, id);
  if (offer && offer.status === "active") {
    await cancelListing(offer.user_id, id);
  }
  return { success: true };
}

export async function adminAdjustUserBanana(userId: string, delta: number, reason: string) {
  if (delta > 0) {
    const res = await creditBananaBalance(userId, delta, { reason, kind: "admin" });
    return { success: res.success, newBalance: res.newBalance };
  } else if (delta < 0) {
    const res = await debitBananaBalance(userId, Math.abs(delta), { reason, kind: "penalty" });
    return { success: res.success, newBalance: res.newBalance, error: res.error };
  }
  const bal = await getUserBananaBalance(userId);
  return { success: true, newBalance: bal.balance };
}
