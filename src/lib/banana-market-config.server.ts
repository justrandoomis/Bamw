/**
 * Banana Market configuration + price engine.
 *
 * All values here are admin-controlled (stored in the store settings document)
 * and the spot price is a deterministic function of the configuration + time,
 * so every user sees exactly the same market at the same moment.
 */

import { getStoreSettings, updateStore } from "./db.server";
/*
  Re-exported rather than redefined. The panel prints a price and a client
  component may not import a `.server` module, so the arithmetic lives in
  `banana-price.ts` and everything that already imports it from here keeps
  working — one definition of how many decimals a price has.
*/
export { PRICE_STEP, formatPrice, roundPrice, roundsToZero } from "./banana-price";
import { d1All, d1First, d1Run, d1Ready } from "./d1.server";
import { PRICE_STEP, formatPrice, roundPrice, roundsToZero } from "./banana-price";

export interface BananaMarketConfig {
  /** Reference price (IQD per banana). */
  basePrice: number;
  /** Hard floor / ceiling for both the engine and user listings. */
  minPrice: number;
  maxPrice: number;
  /** Store commission taken from every market sale (percent of total). */
  commissionPercent: number;
  /** Automatic fluctuation amplitude around the base price (percent). */
  volatilityPercent: number;
  /** Market-maker bots. */
  botsEnabled: boolean;
  botCount: number;
  botMinQuantity: number;
  botMaxQuantity: number;
  /** Listing limits for real users. */
  minListingQuantity: number;
  maxListingQuantity: number;
  /** Cost per promoted minute (bananas). */
  promoRatePerMinute: number;
}

export const DEFAULT_MARKET_CONFIG: BananaMarketConfig = {
  basePrice: 0.24,
  minPrice: 0.1,
  maxPrice: 1,
  commissionPercent: 5,
  volatilityPercent: 8,
  botsEnabled: true,
  botCount: 4,
  botMinQuantity: 500,
  botMaxQuantity: 25000,
  minListingQuantity: 100,
  maxListingQuantity: 1000000,
  promoRatePerMinute: 2,
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A price, or the fallback — where zero is not a price.
 *
 * `raw.basePrice ?? settings.bananaOpeningPrice` keeps a stored zero, because
 * `??` only steps over null and undefined. A legacy settings document holding
 * `bananaOpeningPrice: 0` therefore made the base price zero, `spotPriceAt`
 * multiplied by it, and the whole market read 0.00 to every customer with no
 * way for the admin to correct it — the panel that sets these values could not
 * save them either (its route had no handler), so the shop was pinned at a
 * price nobody had chosen.
 *
 * A market cannot run at zero, so a non-positive stored value is treated as
 * absent rather than obeyed. Saving a real one through the admin panel now
 * refuses a non-positive base price outright, so this only ever catches what
 * is already in the database.
 */
function price(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getMarketConfig(): Promise<BananaMarketConfig> {
  /*
    The settings, not the catalogue.

    This read `getStore()` — 3.8 MB of chunks, parsed, with every product
    normalised — to reach five numbers that live on the base `store` row. It is
    called by `/api/banana` on every request and by `processBotTrading()` on
    every firing of the every-minute cron, which is how one base price came to
    be the Worker's largest single CPU cost. See `getStoreSettings`.
  */
  const settings = await getStoreSettings();
  const raw = (settings["bananaMarket"] ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MARKET_CONFIG;

  const config: BananaMarketConfig = {
    basePrice: price(price(raw["basePrice"], 0) || settings["bananaOpeningPrice"], d.basePrice),
    minPrice: price(raw["minPrice"], d.minPrice),
    maxPrice: price(raw["maxPrice"], d.maxPrice),
    commissionPercent: num(raw["commissionPercent"], d.commissionPercent),
    volatilityPercent: num(raw["volatilityPercent"], d.volatilityPercent),
    botsEnabled: raw["botsEnabled"] === undefined ? d.botsEnabled : Boolean(raw["botsEnabled"]),
    botCount: Math.max(0, Math.round(num(raw["botCount"], d.botCount))),
    botMinQuantity: Math.max(1, Math.round(num(raw["botMinQuantity"], d.botMinQuantity))),
    botMaxQuantity: Math.max(1, Math.round(num(raw["botMaxQuantity"], d.botMaxQuantity))),
    minListingQuantity: Math.max(
      1,
      Math.round(num(raw["minListingQuantity"], d.minListingQuantity)),
    ),
    maxListingQuantity: Math.max(
      1,
      Math.round(num(raw["maxListingQuantity"], d.maxListingQuantity)),
    ),
    promoRatePerMinute: num(
      raw["promoRatePerMinute"] ?? settings["bananaPromoRate"],
      d.promoRatePerMinute,
    ),
  };

  return repairBand(config);
}

/**
 * A configuration the engine can run, from one it cannot.
 *
 * Production held `basePrice: 0.0004` against `maxPrice: 0.0003`, so
 * `spotPriceAt` clamped every price to the ceiling and the number the owner
 * had actually typed meant nothing — and the whole market died, because
 * `processBotTrading` stands down when the price is not above zero.
 *
 * `marketConfigProblem` refuses that combination on the way in now, but a
 * refusal only protects the next save. It does nothing for the shop already in
 * that state, and nobody is going to guess that re-typing the same number into
 * a different tab would revive it. So the stored value is repaired on the way
 * out as well.
 *
 * The base wins. It is the field on the admin's screen — the panel shows «سعر
 * الافتتاح المرجعي» and does not show the floor or the ceiling — so those are
 * far more likely to be a leftover nobody chose. The band widens to admit the
 * base; neither number is thrown away.
 */
export function repairBand(config: BananaMarketConfig): BananaMarketConfig {
  const fixed = { ...config };
  if (fixed.minPrice > fixed.maxPrice) fixed.minPrice = fixed.maxPrice;
  if (fixed.basePrice > fixed.maxPrice) fixed.maxPrice = fixed.basePrice;
  if (fixed.basePrice < fixed.minPrice) fixed.minPrice = fixed.basePrice;
  if (fixed.botMinQuantity > fixed.botMaxQuantity) fixed.botMinQuantity = fixed.botMaxQuantity;
  return fixed;
}

/**
 * What makes a market configuration usable, in one place.
 *
 * These rules lived inside the `save_market_config` action and nowhere else,
 * and the screen the owner actually uses is a different action — `save_settings`,
 * which writes `basePrice` straight through `saveMarketConfig` with nothing
 * checked at all. So every guard was in the door nobody walks through, and
 * `0.0004` went into a shop whose ceiling was `0.0003` without a word.
 *
 * Returns the Arabic sentence to show the admin, or null when the
 * configuration is one the engine can actually run.
 */
export function marketConfigProblem(config: BananaMarketConfig): string | null {
  if (!(config.basePrice > 0)) return "السعر الأساسي يجب أن يكون أكبر من صفر";
  if (config.minPrice > config.maxPrice) return "أدنى سعر أكبر من أعلى سعر";
  if (config.basePrice < config.minPrice || config.basePrice > config.maxPrice) {
    return (
      `السعر الأساسي (${config.basePrice}) خارج حدوده: ` +
      `أدنى ${config.minPrice} وأعلى ${config.maxPrice}. ` +
      "المحرك يحصر السعر داخل الحدين، فالقيمة خارجهما لا أثر لها."
    );
  }
  for (const [label, value] of [
    ["السعر الأساسي", config.basePrice],
    ["أدنى سعر", config.minPrice],
    ["أعلى سعر", config.maxPrice],
  ] as const) {
    if (roundsToZero(value)) {
      return (
        `${label} (${value}) يُقرَّب إلى صفر عند دقة السوق. ` +
        `أصغر قيمة قابلة للعرض هي ${formatPrice(PRICE_STEP)}.`
      );
    }
  }
  if (config.botMinQuantity > config.botMaxQuantity) return "أقل كمية للبوت أكبر من أكبر كمية";
  if (config.minListingQuantity > config.maxListingQuantity) {
    return "أقل كمية للعرض أكبر من أكبر كمية";
  }
  return null;
}

export async function saveMarketConfig(
  patch: Partial<BananaMarketConfig>,
): Promise<BananaMarketConfig> {
  const current = await getMarketConfig();
  const next: BananaMarketConfig = { ...current, ...patch };

  await updateStore((store) => ({
    ...store,
    settings: {
      ...(store.settings ?? {}),
      bananaMarket: next,
      // keep the legacy mirrors in sync so old screens stay correct
      bananaOpeningPrice: next.basePrice,
      bananaPromoRate: next.promoRatePerMinute,
    },
  }));

  return next;
}

/* ------------------------------------------------------------------ */
/* Price engine                                                        */
/* ------------------------------------------------------------------ */

/** 5 minute price buckets. */
export const BUCKET_MS = 5 * 60 * 1000;

/** Deterministic 0..1 hash for a bucket + salt. */
function hash01(bucket: number, salt: number): number {
  let x = Math.imul(bucket ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  return ((x >>> 0) % 100000) / 100000;
}

/** Spot price for a given timestamp — same for everyone, clamped to admin bounds. */
export function spotPriceAt(config: BananaMarketConfig, at: number = Date.now()): number {
  const bucket = Math.floor(at / BUCKET_MS);
  const amp = Math.max(0, config.volatilityPercent) / 100;
  // Smooth multi-wave drift + a small deterministic jitter per bucket.
  const wave =
    Math.sin(bucket / 17) * 0.6 + Math.sin(bucket / 53) * 0.3 + (hash01(bucket, 7) - 0.5) * 0.2;
  const price = config.basePrice * (1 + wave * amp);
  const clamped = Math.min(config.maxPrice, Math.max(config.minPrice, price));
  return roundPrice(clamped);
}

export function changePercent24h(config: BananaMarketConfig, at: number = Date.now()): number {
  const now = spotPriceAt(config, at);
  const before = spotPriceAt(config, at - 24 * 3600 * 1000);
  if (!before) return 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

const RANGES: Record<string, { hours: number; points: number }> = {
  "1H": { hours: 1, points: 12 },
  "1D": { hours: 24, points: 48 },
  "1W": { hours: 24 * 7, points: 56 },
  "1M": { hours: 24 * 30, points: 60 },
  "1Y": { hours: 24 * 365, points: 73 },
};

export interface ChartPoint {
  time: string;
  t: string;
  price: number;
}

function label(at: Date, hours: number): string {
  if (hours <= 48) {
    return at.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  }
  return at.toLocaleDateString("ar-IQ", { day: "2-digit", month: "2-digit" });
}

/** Record the current spot price once per bucket so history is real data. */
export async function recordPricePoint(price: number): Promise<void> {
  if (!(await d1Ready())) return;
  const bucket = Math.floor(Date.now() / BUCKET_MS);
  const id = `bpp_${bucket}`;
  const exists = await d1First<{ id: string }>(
    `SELECT id FROM banana_price_points WHERE id = ?`,
    id,
  );
  if (exists) return;
  await d1Run(
    `INSERT OR IGNORE INTO banana_price_points (id, price, recorded_at) VALUES (?, ?, ?)`,
    id,
    price,
    new Date().toISOString(),
  );
}

/**
 * Chart series: recorded history when available, engine-computed values for
 * the part of the window that predates the first recorded point.
 */
export async function getChart(config: BananaMarketConfig, range = "1D"): Promise<ChartPoint[]> {
  const spec = RANGES[range] ?? RANGES["1D"]!;
  const now = Date.now();
  const from = now - spec.hours * 3600 * 1000;

  let recorded: { price: number; recorded_at: string }[] = [];
  if (await d1Ready()) {
    recorded = await d1All<{ price: number; recorded_at: string }>(
      `SELECT price, recorded_at FROM banana_price_points WHERE recorded_at >= ? ORDER BY recorded_at ASC`,
      new Date(from).toISOString(),
    );
  }

  const stepMs = (spec.hours * 3600 * 1000) / Math.max(1, spec.points - 1);
  const out: ChartPoint[] = [];

  for (let i = spec.points - 1; i >= 0; i -= 1) {
    const at = new Date(now - i * stepMs);
    const ts = at.getTime();
    // Prefer a recorded point inside this slot.
    const match = recorded.find((r) => {
      const rt = new Date(r.recorded_at).getTime();
      return Math.abs(rt - ts) <= stepMs / 2;
    });
    out.push({
      time: label(at, spec.hours),
      t: at.toISOString(),
      // The chart at the market's own precision; three decimals drew this
      // shop's entire price history as a flat line along zero.
      price: match ? roundPrice(match.price) : spotPriceAt(config, ts),
    });
  }

  return out;
}
