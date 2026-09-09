/**
 * Banana Logic Centralization Service.
 *
 * Provides administrative and high-level market operations.
 * Balance updates must use src/lib/banana-balance.server.ts.
 */

import { d1All, d1First, d1Run, d1Ready, d1BatchRun } from "./d1.server";
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
    let pricePer = Math.round(spot * (1 + jitter) * 1000) / 1000;
    pricePer = Math.min(config.maxPrice, Math.max(config.minPrice, pricePer));
    if (bot.min_price_iqd) pricePer = Math.max(pricePer, bot.min_price_iqd);

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
      pricePer: Math.round(pricePer * 1000) / 1000,
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

  return {
    price,
    change24h: changePercent24h(config),
    volume24h: Number(volumeRow?.v ?? 0),
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

  const id = `bmo_${Date.now()}`;
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
  // Check ownership

  const offer = await d1First<any>(
    `SELECT * FROM banana_market_offers WHERE id = ? AND user_id = ?`,
    data.id,
    userId,
  );
  if (!offer) throw new BananaError("listing_not_found");

  const diff = data.quantity - offer.quantity;
  if (diff > 0) {
    // Need more bananas
    const res = await debitBananaBalance(userId, diff, {
      reason: "Listing Update Increase",
      kind: "listing_fee",
    });
    if (!res.success) throw new BananaError("insufficient_balance");
    await d1Run(`UPDATE users SET banana_locked = banana_locked + ? WHERE id = ?`, diff, userId);
  } else if (diff < 0) {
    // Return some bananas
    await creditBananaBalance(userId, Math.abs(diff), {
      reason: "Listing Update Decrease",
      kind: "refund",
    });
    await d1Run(
      `UPDATE users SET banana_locked = MAX(0, banana_locked - ?) WHERE id = ?`,
      Math.abs(diff),
      userId,
    );
  }

  await d1Run(
    `UPDATE banana_market_offers SET quantity = ?, price_iqd = ?, locked_banana = ?, updated_at = ? WHERE id = ?`,
    data.quantity,
    data.quantity * data.pricePer,
    data.quantity,
    new Date().toISOString(),
    data.id,
  );
  return { success: true };
}

export async function cancelListing(userId: string, listingId: string) {
  const offer = await d1First<any>(
    `SELECT * FROM banana_market_offers WHERE id = ? AND user_id = ? AND status = 'active'`,
    listingId,
    userId,
  );
  if (!offer) throw new BananaError("listing_not_found");

  await d1BatchRun([
    {
      sql: `UPDATE banana_market_offers SET status = 'cancelled', updated_at = ? WHERE id = ?`,
      binds: [new Date().toISOString(), listingId],
    },
    {
      sql: `UPDATE users SET banana_locked = MAX(0, banana_locked - ?) WHERE id = ?`,
      binds: [offer.quantity, userId],
    },
  ]);

  await creditBananaBalance(userId, offer.quantity, {
    reason: "Listing Cancellation",
    kind: "refund",
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

export async function redeemReward(userId: string, rewardId: string) {
  const reward = await d1First<any>(
    `SELECT * FROM banana_redemption_offers WHERE id = ? AND is_active = 1`,
    rewardId,
  );
  if (!reward) throw new BananaError("reward_not_found");
  if (reward.stock === 0) throw new BananaError("out_of_stock");

  const res = await debitBananaBalance(userId, reward.banana_price, {
    reason: `Redemption: ${reward.title}`,
    kind: "spend",
  });

  if (!res.success) throw new BananaError(res.error || "insufficient_balance");

  await d1Run(
    `UPDATE banana_redemption_offers SET stock = CASE WHEN stock > 0 THEN stock - 1 ELSE stock END WHERE id = ?`,
    rewardId,
  );

  // Create redemption log
  const rid = `brd_${Date.now()}`;
  await d1Run(
    `INSERT INTO banana_redemptions (id, user_id, reward_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
    rid,
    userId,
    rewardId,
    new Date().toISOString(),
  );

  return { success: true, redemptionId: rid };
}

// Admin functions
export async function getAdminBananaData() {
  const { getStore } = await import("./db.server");
  const store = await getStore();
  const s = (store.settings ?? {}) as Record<string, unknown>;
  const marketConfig = await getMarketConfig();

  const rewards = (
    await d1All<any>(
      `SELECT * FROM banana_redemption_offers ORDER BY sort_order ASC, created_at DESC`,
    )
  ).map(toAdminReward);
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
