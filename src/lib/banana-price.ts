/**
 * How the banana market expresses a price — arithmetic only, no server.
 *
 * Split out of `banana-market-config.server.ts` because the admin panel needs
 * to PRINT a price and a client component may not import a `.server` module.
 * Two copies of "how many decimals is a price" is how the engine came to hold
 * 0.0004 while the screen above it printed 0.000.
 */

/**
 * The precision the market prices at, and the smallest price it can express.
 *
 * Three decimals, until production showed what that costs. This shop's banana
 * is worth four ten-thousandths of a dinar — 13.9 million in circulation
 * against an earn rate of 6.8 per dinar spent — and the owner set exactly
 * that: `basePrice: 0.0004`. At a step of 0.001 the rounding IS the price:
 * `Math.round(0.0004 * 1000) / 1000` is 0, so every customer saw «0.000 د.ع»
 * and `processBotTrading` stood down on its `marketPrice > 0` guard. The whole
 * market, dead from one constant.
 *
 * A step must be orders of magnitude finer than the price it quantises or it
 * is not quantising, it is erasing. Six decimals gives one dinar of resolution
 * per million bananas — finer than this economy can distinguish — and costs
 * nothing: a shop priced at 0.24 still prices at 0.24.
 */
export const PRICE_STEP = 0.000001;

const PRICE_SCALE = 1 / PRICE_STEP;

/** The price as the market can actually express it. */
export function roundPrice(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * PRICE_SCALE) / PRICE_SCALE;
}

/** A value the market cannot tell apart from nothing. */
export function roundsToZero(value: number): boolean {
  return !(roundPrice(value) > 0);
}

/**
 * A price, written for a person.
 *
 * `toFixed(3)` was hard-coded in the admin panel and in the bot seeder, so both
 * printed 0.000 for a price the engine holds perfectly well. Decimals come from
 * the magnitude and trailing zeros are trimmed no further than three, so 0.24
 * still reads «0.240» and 0.0004 reads «0.0004» rather than rounding away.
 */
export function formatPrice(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.000";
  return n.toFixed(6).replace(/(\.\d{3}\d*?)0+$/, "$1");
}
