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
  /*
    Whether the member reading this is signed in.

    `useBananaMarket` has declared this field the whole time and the market page
    gates its footer on it, so an absent one read as "signed out": every member
    saw «سجّل الدخول للمشاركة في السوق» underneath a market they were already
    trading in, and the profile-completion prompt beside it could never appear.
    A market that works and says it does not is indistinguishable from a dead
    one, which is what it was reported as.
  */
  signedIn: boolean;
  change24h: number;
  /*
    The same number under the name the page reads.

    The server has always sent `change24h`; the hook and the page have always
    read `changePct`. So the 24-hour badge printed «0%» with a green up-arrow
    whatever the market did. Both names are carried rather than either side
    renamed: between them they are read from four places, and a rename that
    misses one restores the fault silently.
  */
  changePct: number;
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
/*
  Exported so the live check can ask production what its board looks like.

  The reported fault was a market «ميت» — a price of zero and no bots buying —
  and the board is generated, not stored: there is no table a check could read
  to find out what a customer sees. Reimplementing the generation in the
  checker would report on a market the shop does not have, which is how the
  stale per-bot floors went unseen in the first place.
*/
export async function getBotListings(
  config: BananaMarketConfig,
  spot: number,
): Promise<BananaListing[]> {
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

    /*
      The offer size is the admin's, and only the admin's.

      «العدد للموز مقابل السعر غير صحيح بالنسبة لما يدخله الأدمن في إعدادات
      البوت» — and it was not. This capped the generated quantity with
      `max_trade_banana`, which is not an offer size at all: it is the largest
      MEMBER offer this bot is willing to BUY, and `executeBotPurchase` uses it
      for exactly that — `if (bot.maxTradeBanana && offer.quantity >
      bot.maxTradeBanana) return;`. Worse, «إضافة بوت» seeds it with a random
      multiple of 500 between 1,000 and 20,000, so the cap almost always bound
      and the number the customer read was that random seed. The four offers on
      the owner's screen — 19,500, 18,000, 19,000 and 12,000 — are all
      multiples of 500 in that range, which is the seeder's fingerprint, not a
      setting anybody chose.

      So the buy-side cap stays on the buy side. The offer quantity comes from
      «أقل كمية لعرض البوت» and «أكبر كمية لعرض البوت», which is what those two
      fields say they are.
    */
    const span = Math.max(0, config.botMaxQuantity - config.botMinQuantity);
    let quantity = Math.round(config.botMinQuantity + botHash(bot.id, bucket + 991) * span);
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
      /*
        THE TWO NAMES THE SCREEN READS.

        `signedIn` is declared by `useBananaMarket` and was never in this
        object, so `!snapshot?.signedIn` was permanently true and every signed-in
        member read «سجّل الدخول للمشاركة في السوق» at the bottom of a market
        they were already signed into. That is what «السوق ميت» looks like from
        the outside: it works, and it tells you it does not.

        `changePct` is the same fault one line up — the server has always sent
        `change24h` and the page has always read `changePct`, so the 24-hour
        badge printed «0%» with a green arrow whatever the market did. Both
        names are sent rather than either side being renamed, because the two
        are read from four places between them and a rename that misses one puts
        the fault straight back.
      */
      signedIn: Boolean(userId),
      change24h: changePercent24h(config),
      changePct: changePercent24h(config),
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

  const nowIso = new Date().toISOString();
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
      /*
        The seller's own choices, read back. Both were hardcoded false, so a
        listing published as «خاص» came back to its own seller labelled «عام» —
        the shop contradicting the member about what they had just done.

        A promotion expires: `is_promoted` stays 1 as the record of what was
        bought, and `promoted_until` decides whether it is still in force.
      */
      isPrivate: Boolean(o.is_private),
      isPromoted: Boolean(o.is_promoted) && String(o.promoted_until ?? "") > nowIso,
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
    // See the offline branch above for why both names are sent.
    signedIn: Boolean(userId),
    change24h: changePercent24h(config),
    changePct: changePercent24h(config),
    volume24h: Number(volumeRow?.v ?? 0),
    rewards,
    /*
      The public board: everyone else's listings, minus the private ones.

      «خاص» has to mean something on the side that matters — a private listing
      is reachable by its own link and by its seller, and does not sit on the
      public board. The seller still sees it below, in `myListings`.

      Promoted listings lead, and only while their window is open; price is the
      order within each group, as it always was.
    */
    listings: [...bots, ...userListings.filter((l) => l.userId !== userId && !l.isPrivate)].sort(
      (a, b) => Number(b.isPromoted) - Number(a.isPromoted) || a.pricePer - b.pricePer,
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
      icon: string | null;
      category: string | null;
      banana_price: number;
      stock: number | null;
    }>(
      /*
        `icon` and `category` are what the ADMIN saves, and this read asked for
        neither. It selected `image_url` — a column the admin panel never writes
        — and then replaced the category with the literal «reward».

        The redeem screen's tabs are `wheel_ticket`, `vouchers`, `digital`,
        `physical` and `perks`. Nothing ever carried any of those four, so four
        of the six tabs were permanently empty and every non-ticket reward
        showed 🎁, whatever the owner had chosen for it.
      */
      `SELECT id, title, description, image_url, icon, category, banana_price, stock
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
        icon: row.icon || row.image_url || (ticketQuantity ? "🎟️" : "🎁"),
        /*
          Tickets keep their own tab — it is listed first on the redeem screen
          precisely because «they are the one reward that leads somewhere else».
          Everything else goes where the owner put it, and a row written before
          the column existed falls back to the same default the admin form
          itself starts on, so it lands where a new one would.
        */
        category: ticketQuantity ? "wheel_ticket" : row.category || "vouchers",
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

  /*
    THE PROMOTION IS CHARGED, NOT JUST QUOTED.

    The form prices it — «${promoHours} × 60 × promoRatePerMinute» bananas — and
    disables the publish button when the seller cannot afford it. Then this
    function accepted `isPromoted` and `promoteMinutes`, named neither in its
    INSERT, and charged nothing. The seller paid nothing and got nothing, which
    is the only reason it never became a complaint about money.

    The cost is taken in the SAME debit as the listing itself: one call, so a
    seller can never end up paying for a promotion on a listing that then failed
    to be created. The rate comes from the shop's config, never from the
    request — the browser sends minutes, and the price of a minute is the
    owner's to set.
  */
  const config = await getMarketConfig();
  const promoteMinutes =
    data.isPromoted && Number.isFinite(Number(data.promoteMinutes))
      ? Math.max(0, Math.trunc(Number(data.promoteMinutes)))
      : 0;
  const promoCost = Math.round(promoteMinutes * Math.max(0, config.promoRatePerMinute));

  // Use market functions logic: Debit balance, add to locked, create offer.
  // We delegate to the centralized balance logic for the debit part.
  const res = await debitBananaBalance(userId, data.quantity + promoCost, {
    reason: promoCost > 0 ? "Market Listing Creation + Promotion" : "Market Listing Creation",
    kind: "listing_fee",
    meta: { pricePer: data.pricePer, total, promoteMinutes, promoCost },
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
      /*
        Only the listed bananas are LOCKED. The promotion's cost is spent, not
        held: it buys placement and does not come back when the listing sells or
        is cancelled, which is why `locked_banana` stays `data.quantity`.
      */
      sql: `INSERT INTO banana_market_offers
              (id, user_id, quantity, price_iqd, locked_banana, status,
               is_private, is_promoted, promoted_until, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      binds: [
        id,
        userId,
        data.quantity,
        total,
        data.quantity,
        data.isPrivate ? 1 : 0,
        promoteMinutes > 0 ? 1 : 0,
        promoteMinutes > 0 ? new Date(Date.now() + promoteMinutes * 60_000).toISOString() : null,
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
  /*
    ONE BOT OFFER, ONE SALE.

    A bot offer's id is derived from its five-minute bucket, nothing recorded
    that it had been sold, and the bot's budget is INCREMENTED on a sale — so it
    could never run out. Reproduced: the same `botoffer_<bot>_<bucket>` bought
    three times in a row by one member, a bot whose stored budget was 0 selling
    8,004 bananas. Bananas minted at will, which is a currency this shop then
    has to honour.

    The log row is the claim. It is the first statement rather than the last,
    its id is derived from the offer and the buyer instead of the clock, and
    everything after it is chained to `changes() = 1` — so a second buy of the
    same bucket collides on the primary key, inserts nothing, and no money
    moves. That also retires the collision the old `bal_${Date.now()}` caused
    between two sales in one millisecond, which used to abort a whole purchase
    with a raw database error.
  */
  await d1BatchRun([
    {
      sql: `INSERT OR IGNORE INTO bot_activity_logs (id, bot_id, action, details, created_at)
            VALUES (?, ?, 'sale', ?, ?)`,
      binds: [
        `bal_${listingId}_${userId}`,
        botId,
        JSON.stringify({ buyerId: userId, quantity: listing.quantity, total: listing.total }),
        now,
      ],
    },
    {
      /*
        The condition in the WHERE clause, not in a CASE — see `buyListing`.
        Also chained on the claim above, so a repeat buy of one bucket cannot
        reach the member's wallet.
      */
      sql: `UPDATE users SET wallet_balance = wallet_balance - ?
            WHERE id = ? AND wallet_balance >= ? AND changes() = 1`,
      binds: [listing.total, userId, listing.total],
    },
    {
      /*
        THE LINE THAT EXPLAINS THE MONEY.

        This batch moved a member's balance and wrote nothing to
        `wallet_transactions`, which is what «كشف المحفظة» renders. Money left
        and the statement had no row for it — the same complaint as a purchase
        not being deducted, arriving from the other direction: the member sees
        a smaller balance and cannot find out why.

        Chained on `changes() = 1` like every ledger row in this codebase, so
        it can never record a transfer the debit did not make.
      */
      sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
            SELECT ?, ?, 'purchase', ?, ?, '', ? WHERE changes() = 1`,
      binds: [
        `wtx_bnm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        userId,
        -listing.total,
        `شراء ${listing.quantity} موزة من السوق`.slice(0, 180),
        now,
      ],
    },
    {
      sql: `UPDATE banana_bots SET budget_iqd = budget_iqd + ?, updated_at = ?
            WHERE id = ? AND changes() = 1`,
      binds: [listing.total, now, botId],
    },
  ]);

  /*
    Did the claim actually win? A second buy of the same bucket inserts nothing,
    so nothing downstream ran either and there is no sale to credit.
  */
  const sold = await d1First<{ n: number }>(
    `SELECT count(*) AS n FROM bot_activity_logs WHERE id = ?`,
    `bal_${listingId}_${userId}`,
  );
  if (!Number(sold?.n)) throw new BananaError("listing_expired");

  await creditBananaBalance(userId, listing.quantity, {
    reason: `Market Purchase (bot): ${botId}`,
    kind: "trade",
    idempotencyKey: `buybot:${listingId}:${userId}`,
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

  /*
    CLAIM THE LISTING BEFORE ANY MONEY MOVES.

    The read above tests `status = 'active'`, and then the batch below marked it
    sold with `WHERE id = ?` — no status in the condition at all. Two buyers who
    both passed the read both completed the whole batch. Reproduced against the
    repo's own SQLite harness: one 10,000-banana listing sold twice, the seller
    paid 1,900 IQD twice, both buyers credited 10,000 bananas, four
    `wallet_transactions` rows for one sale. Ten thousand bananas minted from
    nothing.

    It went unnoticed because an unrelated constraint was half-catching it: the
    locked-banana release wrote NULL through a CASE and `users.banana_locked` is
    NOT NULL, so the second buyer aborted — but ONLY when the seller had no
    other listing locking bananas. A seller with two listings, and both buys
    succeeded.

    So the claim is its own statement, first, and it is the thing that decides
    who won: `status = 'active'` in the WHERE, and `changes()` read. This is the
    shape `executeBotPurchase` already uses on this same table, and the one
    `orders.server.ts` documents at length for the wallet debit.
  */
  const claimedAt = new Date().toISOString();
  const claimed = await d1RunChanges(
    `UPDATE banana_market_offers SET status = 'sold', buyer_id = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    userId,
    claimedAt,
    listingId,
  );
  if (claimed !== 1) throw new BananaError("listing_not_found");

  await d1BatchRun([
    // Money transfer
    {
      /*
        The condition belongs in the WHERE clause, not in a CASE.

        `CASE WHEN … ELSE NULL END` leaned on `wallet_balance` being NOT NULL to
        abort, so an overdraw surfaced as a raw database error rather than
        «الرصيد غير كافٍ» — and it made the `WHERE changes() = 1` on the ledger
        row below meaningless, because SQLite counts a row as changed whenever
        the UPDATE matched it, whichever branch of the CASE ran. Exactly the
        defect `orders.server.ts` carries the long explanation for.
      */
      sql: `UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?`,
      binds: [offer.price_iqd, userId, offer.price_iqd],
    },
    {
      /* The buyer's side of the statement — see `buyBotListing` above. */
      sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
            SELECT ?, ?, 'purchase', ?, ?, '', ? WHERE changes() = 1`,
      binds: [
        `wtx_bnm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        userId,
        -offer.price_iqd,
        `شراء ${offer.quantity} موزة من عضو`.slice(0, 180),
        new Date().toISOString(),
      ],
    },
    {
      sql: `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
      binds: [sellerPayout, offer.user_id],
    },
    {
      /* And the seller's, so a payout is as traceable as a payment. */
      sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
            SELECT ?, ?, 'payout', ?, ?, '', ? WHERE changes() = 1`,
      binds: [
        `wtx_bnm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        offer.user_id,
        sellerPayout,
        `بيع ${offer.quantity} موزة${commission > 0 ? ` (بعد عمولة ${commission})` : ""}`.slice(
          0,
          180,
        ),
        new Date().toISOString(),
      ],
    },
    /*
      Locked banana reduction for seller — floored, not NULLed.

      This was the same `CASE … ELSE NULL END`, and because `banana_locked` is
      NOT NULL it was the accidental half-guard described above: it aborted the
      batch for a seller with nothing else locked and let it through for a
      seller with a second listing. The claim above is the guard now, so this
      can be what it should always have been. `MAX(0, COALESCE(…))` is the form
      `cancelListing` and the cron already use on this same column.
    */
    {
      sql: `UPDATE users SET banana_locked = MAX(0, COALESCE(banana_locked, 0) - ?) WHERE id = ?`,
      binds: [offer.quantity, offer.user_id],
    },
  ]);

  /*
    The bananas the buyer paid for.

    Outside the batch, which is where it has always been, so the idempotency key
    matters: the wallet debit, the payout and the sold flag have already
    committed by the time this runs, and a retry without a key would credit the
    bananas twice for one sale. Keyed on the listing, which can only be sold
    once now that the claim above decides it.
  */
  await creditBananaBalance(userId, offer.quantity, {
    reason: `Market Purchase: ${listingId}`,
    kind: "trade",
    idempotencyKey: `buy:${listingId}`,
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
  /*
    TRANSLATED, LIKE THE REWARDS BESIDE THEM.

    Both of these handed raw D1 rows to a screen that reads camelCase, and the
    screen rendered exactly what that produces: every redemption row showed
    «مستخدم» with no name, a blank reward, «—» for the delivery code and
    `Invalid Date`, and all four of the admin's search boxes matched nothing.
    The listings table printed `NaN د.ع` in both price columns, because it reads
    `price_per` — a column `banana_market_offers` does not have. The stored
    column is `price_iqd`, and it is the TOTAL, not the unit price, so the unit
    price has to be divided out here rather than guessed at in the component.

    `toAdminReward` two calls above already does this for rewards. These follow
    it, and the phone comes from the join rather than from a column on the
    offer, which never existed either.
  */
  const redemptions = (
    await d1All<any>(
      /*
        The reward's name and icon are on `banana_rewards`, not on the
        redemption — the redemption stores only `reward_id`. LEFT, so a reward
        the admin has since deleted still shows its redemption rather than
        dropping the row out of the list entirely.
      */
      `SELECT r.*, u.name AS user_name, u.phone AS user_phone,
              w.title AS reward_title, w.icon AS reward_icon
       FROM banana_redemptions r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN banana_rewards w ON w.id = r.reward_id
       ORDER BY r.created_at DESC LIMIT 100`,
    )
  ).map((row) => ({
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    userName: String(row.user_name ?? "") || "مستخدم",
    userPhone: String(row.user_phone ?? ""),
    rewardId: String(row.reward_id ?? ""),
    rewardTitle: String(row.reward_title ?? ""),
    rewardIcon: String(row.reward_icon ?? ""),
    cost: Number(row.cost ?? 0),
    status: String(row.status ?? ""),
    deliveryCode: String(row.delivery_code ?? ""),
    adminNotes: String(row.admin_notes ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
  const listings = (
    await d1All<any>(
      `SELECT o.*, u.name AS user_name, u.phone AS user_phone
       FROM banana_market_offers o JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC LIMIT 100`,
    )
  ).map((row) => {
    const quantity = Number(row.quantity ?? 0);
    const priceIqd = Number(row.price_iqd ?? 0);
    return {
      id: String(row.id ?? ""),
      userId: String(row.user_id ?? ""),
      userName: String(row.user_name ?? "") || "مستخدم",
      userPhone: String(row.user_phone ?? ""),
      quantity,
      priceIqd,
      // The unit price the table's own column header promises.
      pricePer: quantity > 0 ? roundPrice(priceIqd / quantity) : 0,
      lockedBanana: Number(row.locked_banana ?? 0),
      status: String(row.status ?? ""),
      isPrivate: Boolean(row.is_private),
      isPromoted: Boolean(row.is_promoted),
      promotedUntil: String(row.promoted_until ?? ""),
      buyerId: String(row.buyer_id ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  });
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
    /*
      The prices of every game the wheel can land on, and nothing else about
      them.

      «واجعل التحكم بالنسب والتقسيمات تكون من الإدارة بحيث يستطيع تحديد النسب
      يدويا» — and a weight is not a percentage. The chance of a band is its
      weight times the number of games in it, and in this catalogue that
      multiplier ranges from one game to nine hundred and eighty-four: an owner
      typing 100 into the cheapest band and 120 into «حظ أوفر» would reasonably
      expect the second to be larger, and get a thousandth of it. A panel that
      shows only weights cannot be used to set percentages, whatever it is
      labelled.

      So the panel is given the pool's prices and works the percentages out as
      the owner types, with the wheel's own `tierCounts` and `oddsBreakdown`.
      Prices rather than counts because the bands themselves are what is being
      edited — a count computed here would be for the bands as they were saved,
      not as they are being typed.

      Prices only. Not a title, not an id, nothing that says which game is
      which — it is a histogram, and it is the admin's own screen besides.
    */
    wheelPoolPrices: await (async () => {
      const { wheelCandidates } = await import("./wheel-pool.server");
      return wheelCandidates()
        .then((pool) => pool.map((candidate) => Number(candidate.price)))
        .catch(() => [] as number[]);
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
