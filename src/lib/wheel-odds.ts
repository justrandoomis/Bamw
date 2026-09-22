/**
 * The wheel's odds, as numbers an admin can set — arithmetic only, no server.
 *
 * «أضف أن هناك حظ أوفر تكون النسبة أعلى من اللعبه ذات الخمسة آلاف، واجعل
 * التحكم بالنسب والتقسيمات تكون من الإدارة بحيث يستطيع تحديد النسب يدويا».
 *
 * Three things the owner asked for, and one trap between them.
 *
 * ## The trap
 *
 * The weights are PER GAME, and the chance of a band is its weight times the
 * number of games in it. Production: 984 games at or under 5,000 د.ع at weight
 * 100, 538 up to 10,000 at weight 30, 178 up to 20,000 at weight 8, 2 up to
 * 40,000 at weight 2. The pool is 115,969 and the cheapest band's share is
 * 98,400 of it — the 84.9% the wheel screen prints.
 *
 * So a «حظ أوفر» written as a tier weight would be about eight hundred times
 * smaller than it looks: an admin typing 120, reasonably expecting something
 * near the cheapest band's 100, would get one tenth of one percent. A losing
 * chance has to be set as a CHANCE, and the weight derived from it, or the one
 * number the owner most wants to control is the one they cannot.
 *
 * ## What "higher than the 5,000 band" means
 *
 * With a losing chance of p, every game band keeps its share of what is left,
 * so the cheapest band's chance becomes (1 − p) × 84.9%. Losing beats it when
 * p > 0.849 × (1 − p), which is p > 45.9%. The default below is 50%, which
 * satisfies what was asked with room to move, and the admin can set anything.
 */

export interface WheelTier {
  /** Inclusive upper price bound in IQD. `null` means "everything above". */
  upTo: number | null;
  /** Relative weight of ONE game in this band. */
  weight: number;
  label: string;
}

export interface WheelOdds {
  tiers: WheelTier[];
  /** Chance a spin wins nothing, 0–95, as a percentage. */
  losingPercent: number;
  /** What one ticket costs in bananas. 0 means the owner has not set one. */
  ticketPriceBananas: number;
}

/**
 * The bands the wheel shipped with, unchanged.
 *
 * The top band's bound is `null` rather than `Number.POSITIVE_INFINITY`
 * because these survive a round trip through the settings document, and
 * `JSON.stringify(Infinity)` is `null` — so a set saved with Infinity in it
 * came back with the top band's bound silently gone.
 */
export const DEFAULT_TIERS: WheelTier[] = [
  { upTo: 5_000, weight: 100, label: "≤ 5,000" },
  { upTo: 10_000, weight: 30, label: "5,001 – 10,000" },
  { upTo: 20_000, weight: 8, label: "10,001 – 20,000" },
  { upTo: 40_000, weight: 2, label: "20,001 – 40,000" },
  { upTo: null, weight: 1, label: "> 40,000" },
];

export const LOSING_LABEL = "حظ أوفر";

export const DEFAULT_WHEEL_ODDS: WheelOdds = {
  tiers: DEFAULT_TIERS,
  losingPercent: 50,
  ticketPriceBananas: 0,
};

const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The band a price falls in, and how heavily one game there is weighted.
 *
 * The bands are walked in order, so an unsorted set would silently mis-band
 * the whole catalogue rather than fail. `normalizeWheelOdds` sorts on the way
 * out of storage and `wheelOddsProblem` refuses an unsorted save, so this only
 * ever sees an ordered set.
 */
export function weightForPriceIn(
  tiers: readonly WheelTier[],
  price: number,
): { weight: number; label: string } {
  const value = Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
  for (const tier of tiers) {
    if (tier.upTo === null || value <= tier.upTo) return { weight: tier.weight, label: tier.label };
  }
  const last = tiers[tiers.length - 1];
  return last ? { weight: last.weight, label: last.label } : { weight: 0, label: "" };
}

/**
 * Which band a price falls in, by POSITION.
 *
 * The caller used to match a game to its band by comparing label strings,
 * which was fine while the bands were a module constant and stopped being fine
 * the moment an admin could rename one: two bands named the same merge into a
 * single row, and every game in the second is counted twice or not at all.
 *
 * `-1` for an empty set of bands, so a caller cannot silently file every game
 * under band zero.
 */
export function tierIndexFor(tiers: readonly WheelTier[], price: number): number {
  const value = Number.isFinite(price) ? Number(price) : Number.POSITIVE_INFINITY;
  const found = tiers.findIndex((tier) => tier.upTo === null || value <= tier.upTo);
  if (found >= 0) return found;
  return tiers.length ? tiers.length - 1 : -1;
}

/**
 * How many of these games sit in each band, in the order the bands are given.
 *
 * `oddsBreakdown` takes exactly this array, and both the wheel screen and the
 * live check need it from the same code — a second copy in the checker would
 * report percentages the shop does not serve.
 */
export function tierCounts(tiers: readonly WheelTier[], prices: readonly number[]): number[] {
  const counts = tiers.map(() => 0);
  for (const price of prices) {
    const index = tierIndexFor(tiers, Number(price));
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}

/**
 * The weight a losing outcome needs to hold `losingPercent` of the wheel.
 *
 * Derived rather than typed, for the reason in the header: a chance is what a
 * person can reason about and a weight is not.
 */
export function losingWeightFor(totalGameWeight: number, losingPercent: number): number {
  const p = Math.min(95, Math.max(0, num(losingPercent, 0))) / 100;
  if (p <= 0) return 0;
  if (!(totalGameWeight > 0)) return 0;
  return (totalGameWeight * p) / (1 - p);
}

/**
 * What makes a set of odds usable, in one place.
 *
 * Returns the Arabic sentence to show the admin, or null. Every rule here is
 * something that would otherwise brick the wheel quietly rather than loudly:
 * an empty set or an all-zero set makes `pickWeighted` return null for every
 * member, and an unsorted set mis-bands the catalogue without any error at
 * all.
 */
export function wheelOddsProblem(odds: WheelOdds): string | null {
  const tiers = odds.tiers ?? [];
  if (tiers.length === 0) return "لا يمكن حفظ عجلة بلا فئات أسعار.";

  let previous = Number.NEGATIVE_INFINITY;
  let sawOpenTop = false;
  for (const tier of tiers) {
    if (sawOpenTop) return "الفئة المفتوحة (بلا حد أعلى) يجب أن تكون الأخيرة.";
    if (!Number.isFinite(tier.weight) || tier.weight < 0) {
      return `وزن غير صالح للفئة «${tier.label}».`;
    }
    if (tier.upTo === null) {
      sawOpenTop = true;
      continue;
    }
    if (!Number.isFinite(tier.upTo) || tier.upTo <= 0) {
      return `حد أعلى غير صالح للفئة «${tier.label}».`;
    }
    if (tier.upTo <= previous) return "حدود الفئات يجب أن تكون تصاعدية.";
    previous = tier.upTo;
  }

  if (!tiers.some((tier) => tier.weight > 0)) {
    return "يجب أن يكون وزن فئة واحدة على الأقل أكبر من صفر.";
  }
  if (!Number.isFinite(odds.losingPercent) || odds.losingPercent < 0 || odds.losingPercent > 95) {
    return "نسبة «حظ أوفر» يجب أن تكون بين 0 و 95.";
  }
  if (!Number.isFinite(odds.ticketPriceBananas) || odds.ticketPriceBananas < 0) {
    return "سعر التذكرة يجب أن يكون صفرًا أو أكثر.";
  }
  if (!Number.isInteger(odds.ticketPriceBananas)) {
    return "سعر التذكرة يجب أن يكون عددًا صحيحًا من الموز.";
  }
  return null;
}

/**
 * Whatever is in the settings document, as a set of odds the wheel can run.
 *
 * Repaired rather than obeyed, for the same reason the market's band is: a
 * refusal on save protects the next save and does nothing for a shop already
 * holding something unusable — and an unusable set here means every member's
 * spin fails.
 */
export function normalizeWheelOdds(raw: unknown): WheelOdds {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawTiers = Array.isArray(source["tiers"]) ? source["tiers"] : [];

  const tiers: WheelTier[] = rawTiers
    .map((entry, index) => {
      const tier = (entry ?? {}) as Record<string, unknown>;
      const upToRaw = tier["upTo"];
      const upTo =
        upToRaw === null || upToRaw === undefined || !Number.isFinite(Number(upToRaw))
          ? null
          : Number(upToRaw);
      return {
        upTo,
        weight: Math.max(0, num(tier["weight"], 0)),
        label: String(tier["label"] ?? `فئة ${index + 1}`),
      };
    })
    .filter((tier) => tier.upTo === null || tier.upTo > 0);

  // An open-topped band belongs last, and only one of them can.
  const bounded = tiers.filter((tier) => tier.upTo !== null).sort((a, b) => a.upTo! - b.upTo!);
  const open = tiers.find((tier) => tier.upTo === null);
  const ordered = open ? [...bounded, open] : bounded;

  const usable = ordered.length > 0 && ordered.some((tier) => tier.weight > 0);

  return {
    tiers: usable ? ordered : DEFAULT_TIERS,
    losingPercent: Math.min(
      95,
      Math.max(0, num(source["losingPercent"], DEFAULT_WHEEL_ODDS.losingPercent)),
    ),
    ticketPriceBananas: Math.max(0, Math.round(num(source["ticketPriceBananas"], 0))),
  };
}

/**
 * The chance of each band and of losing, as the wheel screen should print them.
 *
 * `counts` is how many games fall in each band, in the same order as `tiers`.
 * Returned by index rather than keyed by label, because a label stops being
 * unique the moment an admin edits one.
 */
export function oddsBreakdown(
  odds: WheelOdds,
  counts: readonly number[],
): { label: string; games: number; weight: number; chance: number }[] {
  const totalGameWeight = odds.tiers.reduce(
    (sum, tier, index) => sum + tier.weight * (counts[index] ?? 0),
    0,
  );
  const losing = losingWeightFor(totalGameWeight, odds.losingPercent);
  const total = totalGameWeight + losing;
  if (!(total > 0)) {
    return odds.tiers.map((tier, index) => ({
      label: tier.label,
      games: counts[index] ?? 0,
      weight: tier.weight,
      chance: 0,
    }));
  }

  const rows = odds.tiers.map((tier, index) => ({
    label: tier.label,
    games: counts[index] ?? 0,
    weight: tier.weight,
    chance: (tier.weight * (counts[index] ?? 0)) / total,
  }));
  if (losing > 0) {
    rows.push({ label: LOSING_LABEL, games: 0, weight: losing, chance: losing / total });
  }
  return rows;
}
