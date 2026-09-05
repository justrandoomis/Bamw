/**
 * The referral programme's settings, and their safe defaults.
 *
 * These live in the store document alongside every other admin setting
 * (`store.settings`), so the existing settings save path carries them and no
 * new persistence layer is needed. Everything is read through `readReferral-
 * Settings`, which is total: a missing key, a string where a number belongs, a
 * percentage somebody typed as "10%" — all resolve to the default rather than
 * to `NaN`, because a `NaN` rate silently pays nobody.
 */

import type { CategoryType } from "../productSection";
import { DEFAULT_PERCENT_BPS, percentToBps, toBps, toIqd } from "./money";

export interface ReferralSettings {
  /** Master switch. Off means no capture, no discount, no reward. */
  enabled: boolean;
  /** The buyer's discount. */
  buyerPercentBps: number;
  /** The referrer's wallet reward. */
  referrerPercentBps: number;
  /** Cap per reward, in dinars. Zero means uncapped. */
  maxRewardIqd: number;
  /** How long an attribution survives after capture. */
  linkTtlDays: number;
  /** Which store sections take part. */
  eligibleCategories: CategoryType[];
  /** Only the friend's first completed purchase earns. */
  firstPurchaseOnly: boolean;
  /**
   * Restrict the offer to the exact product the link was shared from.
   *
   * The first version of the programme required this and hardcoded it, so a
   * friend who followed a link to one game and bought another was refused —
   * with the same unhelpful sentence as an abuser. Off by default now: a
   * referral brings a customer to the shop, not to one shelf of it.
   */
  restrictToSharedProduct: boolean;
  /**
   * Restrict the offer to offline-account selections.
   *
   * Also hardcoded in the first version, and the single narrowest rule in the
   * programme: every online account, every physical item and every card was
   * refused. Off by default.
   */
  offlineAccountsOnly: boolean;
  /** May a referral and a coupon both come off one order? */
  stackWithCoupon: boolean;
  /**
   * Days a reward is held at `pending` before it may be approved.
   *
   * The hold and the order both have to clear: `approveRewardsForOrder` skips
   * a reward whose `hold_until` is still in the future, and `dueHeldRewards`
   * — which the scheduled job drains — only picks up rewards whose order has
   * reached `completed`. So "three days *and* the order is finished", not
   * whichever comes first.
   */
  holdDays: number;
  /** How many friends one member may bring in per day. */
  dailyInviteLimit: number;
  /** Ceilings on what one member may earn. Zero means uncapped. */
  dailyRewardCapIqd: number;
  monthlyRewardCapIqd: number;
  /**
   * Refuse a referral when both sides share a network address.
   *
   * On by default, as specified. Worth knowing before turning it off — and
   * before leaving it on: Iraqi mobile carriers put thousands of unrelated
   * subscribers behind one public address, so on a phone network this refuses
   * a great many honest referrals along with the dishonest ones. The device
   * check is unaffected either way, and is the sharper of the two.
   */
  blockSameIp: boolean;
}

/**
 * The safe defaults the programme ships with, exactly as specified: ten per
 * cent each way, the friend's first completed purchase only, and never
 * stacked on top of a coupon.
 */
export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: true,
  buyerPercentBps: DEFAULT_PERCENT_BPS,
  referrerPercentBps: DEFAULT_PERCENT_BPS,
  maxRewardIqd: 0,
  linkTtlDays: 30,
  /*
    Everything the shop sells, except the top-up cards.

    This was `["game"]` alone, which refused a referral on hardware, amiibo,
    accessories, used items and bundles — most of the catalogue.

    Gift cards stay out, and not as an oversight: the $5 card sells at 7,500
    against a 6,800 cost, so ten per cent to the buyer and ten to the referrer
    is 1,500 against a 700 margin — every referred card would be sold at a
    loss. The shop already says so on the card itself ("مستثناة من جميع العروض
    الترويجية والتخفيضات"), and this keeps the code and that promise agreeing.
  */
  eligibleCategories: ["game", "hardware", "amiibo", "accessory", "used", "bundle"],
  firstPurchaseOnly: true,
  stackWithCoupon: false,
  restrictToSharedProduct: false,
  offlineAccountsOnly: false,
  /*
    Three days, as the shop asks: the referrer's ten per cent sits in their
    wallet as pending and becomes spendable once the hold has passed and the
    order is complete. It was zero, which paid the moment an order completed
    and left nothing to claw back if it unravelled afterwards.
  */
  holdDays: 3,
  dailyInviteLimit: 50,
  dailyRewardCapIqd: 0,
  monthlyRewardCapIqd: 0,
  blockSameIp: true,
};

/** The key the settings document stores this block under. */
export const REFERRAL_SETTINGS_KEY = "referral";

const CATEGORY_VALUES: readonly CategoryType[] = [
  "game",
  "hardware",
  "amiibo",
  "accessory",
  "gift_card",
  "used",
  "bundle",
];

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "نعم"].includes(text)) return true;
  if (["0", "false", "no", "off", "لا"].includes(text)) return false;
  return fallback;
}

/**
 * A rate written either way.
 *
 * The admin form speaks whole percent ("10"); the database and every
 * calculation speak basis points. A key ending in `Bps` is taken as-is,
 * anything else is read as a percentage — so `referralBuyerPercent: 10` and
 * `buyerPercentBps: 1000` both mean the same ten per cent.
 */
function readRate(source: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const bps = /bps$/i.test(key) ? toBps(raw) : percentToBps(raw);
    if (bps !== undefined && bps > 0) return bps;
    // An explicit zero is a real choice — a side of the programme turned off.
    if (bps === 0) return 0;
  }
  return fallback;
}

function readInteger(source: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return fallback;
}

function readCategories(value: unknown, fallback: CategoryType[]): CategoryType[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : undefined;
  if (!list) return fallback;
  const picked = list
    .map((entry) => String(entry).trim().toLowerCase() as CategoryType)
    .filter((entry) => CATEGORY_VALUES.includes(entry));
  // An empty list would silently disable the programme for every product; that
  // is what the master switch is for, so fall back instead.
  return picked.length ? Array.from(new Set(picked)) : fallback;
}

/**
 * Read the programme's settings out of the store document.
 *
 * Accepts both the nested `settings.referral` block written by the admin
 * screen and flat `settings.referral*` keys, because the store settings
 * document has always been a loose bag and older keys must keep working.
 */
export function readReferralSettings(storeSettings: unknown): ReferralSettings {
  const settings = (storeSettings ?? {}) as Record<string, unknown>;
  const nested = settings[REFERRAL_SETTINGS_KEY];
  const block: Record<string, unknown> =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : {};

  // Flat keys are read as a fallback layer beneath the nested block.
  const merged: Record<string, unknown> = { ...settings, ...block };

  return {
    enabled: readBoolean(
      merged["enabled"] ?? merged["referralEnabled"],
      DEFAULT_REFERRAL_SETTINGS.enabled,
    ),
    buyerPercentBps: readRate(
      merged,
      ["buyerPercentBps", "referralBuyerPercentBps", "buyerPercent", "referralBuyerPercent"],
      DEFAULT_REFERRAL_SETTINGS.buyerPercentBps,
    ),
    referrerPercentBps: readRate(
      merged,
      [
        "referrerPercentBps",
        "referralOwnerPercentBps",
        "referrerPercent",
        "referralOwnerPercent",
        "ownerPercent",
      ],
      DEFAULT_REFERRAL_SETTINGS.referrerPercentBps,
    ),
    maxRewardIqd: toIqd(
      readInteger(
        merged,
        ["maxRewardIqd", "referralMaxReward", "maxReward"],
        DEFAULT_REFERRAL_SETTINGS.maxRewardIqd,
      ),
    ),
    linkTtlDays: Math.max(
      1,
      Math.min(
        365,
        readInteger(
          merged,
          ["linkTtlDays", "referralLinkTtlDays", "attributionDays"],
          DEFAULT_REFERRAL_SETTINGS.linkTtlDays,
        ),
      ),
    ),
    eligibleCategories: readCategories(
      merged["eligibleCategories"] ?? merged["referralEligibleCategories"],
      DEFAULT_REFERRAL_SETTINGS.eligibleCategories,
    ),
    firstPurchaseOnly: readBoolean(
      merged["firstPurchaseOnly"] ?? merged["referralFirstPurchaseOnly"],
      DEFAULT_REFERRAL_SETTINGS.firstPurchaseOnly,
    ),
    stackWithCoupon: readBoolean(
      merged["stackWithCoupon"] ?? merged["referralStackWithCoupon"],
      DEFAULT_REFERRAL_SETTINGS.stackWithCoupon,
    ),
    restrictToSharedProduct: readBoolean(
      merged["restrictToSharedProduct"] ?? merged["referralRestrictToSharedProduct"],
      DEFAULT_REFERRAL_SETTINGS.restrictToSharedProduct,
    ),
    offlineAccountsOnly: readBoolean(
      merged["offlineAccountsOnly"] ?? merged["referralOfflineAccountsOnly"],
      DEFAULT_REFERRAL_SETTINGS.offlineAccountsOnly,
    ),
    holdDays: Math.min(
      90,
      readInteger(
        merged,
        ["holdDays", "referralHoldDays"],
        DEFAULT_REFERRAL_SETTINGS.holdDays,
      ),
    ),
    dailyInviteLimit: readInteger(
      merged,
      ["dailyInviteLimit", "referralDailyInviteLimit"],
      DEFAULT_REFERRAL_SETTINGS.dailyInviteLimit,
    ),
    dailyRewardCapIqd: toIqd(
      readInteger(
        merged,
        ["dailyRewardCapIqd", "referralDailyRewardCap"],
        DEFAULT_REFERRAL_SETTINGS.dailyRewardCapIqd,
      ),
    ),
    monthlyRewardCapIqd: toIqd(
      readInteger(
        merged,
        ["monthlyRewardCapIqd", "referralMonthlyRewardCap"],
        DEFAULT_REFERRAL_SETTINGS.monthlyRewardCapIqd,
      ),
    ),
    blockSameIp: readBoolean(
      merged["blockSameIp"] ?? merged["referralBlockSameIp"],
      DEFAULT_REFERRAL_SETTINGS.blockSameIp,
    ),
  };
}
