/**
 * Banana Market configuration + price engine.
 *
 * All values here are admin-controlled (stored in the store settings document)
 * and the spot price is a deterministic function of the configuration + time,
 * so every user sees exactly the same market at the same moment.
 */

import { getStore, updateStore } from "./db.server";
import { d1All, d1First, d1Run, d1Ready } from "./d1.server";

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
  const store = await getStore();
  const settings = (store.settings ?? {}) as Record<string, unknown>;
  const raw = (settings["bananaMarket"] ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MARKET_CONFIG;

  const config: BananaMarketConfig = {
    basePrice: price(
      price(raw["basePrice"], 0) || settings["bananaOpeningPrice"],
      d.basePrice,
    ),
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

  if (config.minPrice > config.maxPrice) config.minPrice = config.maxPrice;
  if (config.botMinQuantity > config.botMaxQuantity) config.botMinQuantity = config.botMaxQuantity;
  return config;
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

/**
 * The precision the market prices at, and the smallest price it can express.
 *
 * `spotPriceAt` rounds to three decimals below, so any band under 0.0005
 * renders as 0.000 to every customer however carefully it was configured.
 * Exported so the admin save can refuse such a band using the same number the
 * pricing uses, rather than a second opinion about what "too small" means.
 */
export const PRICE_STEP = 0.001;

/** The lowest price that does not round to nothing. */
export function roundsToZero(value: number): boolean {
  return !(Math.round(value * 1000) / 1000 > 0);
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
  return Math.round(clamped * 1000) / 1000;
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
      price: match ? Math.round(match.price * 1000) / 1000 : spotPriceAt(config, ts),
    });
  }

  return out;
}
