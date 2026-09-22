/**
 * The roulette's odds: a bucket is chosen first, and a game only afterwards.
 *
 * The owner, replacing the wheel's model outright:
 *
 *   «لا تعتمد فرصة الفئة على عدد الألعاب الموجودة داخلها بطريقة تجعل وجود 1000
 *    لعبة رخيصة يجعل Chance الفئة 1000 مرة أكبر. أولاً اختَر outcome bucket حسب
 *    النسبة المحددة، ثم إذا وقع الاختيار على هذه الفئة اختَر لعبة من الألعاب
 *    المؤهلة داخلها.»
 *
 * ## What changed, and why it is not a tweak
 *
 * `wheel-odds.ts` weights ONE GAME, and a band's chance is that weight times
 * how many games are in it. Its own header says so: 984 games at weight 100
 * gave the cheapest band 84.9% of the wheel. That model has a property nobody
 * chose — the shop's buying decisions move the odds. Import two hundred cheap
 * games and every rare prize becomes rarer, silently, with no admin touching
 * anything.
 *
 * Here a bucket's probability is a NUMBER. `high_premium` is 0.01% whether two
 * games qualify or two hundred. The population decides only which game comes
 * out once that bucket has already won.
 *
 * ## The seven outcomes
 *
 * Price crossed with popularity, plus losing. Popularity is the owner's second
 * axis — «الاحتمالات تعتمد على عاملين: سعر اللعبة، وشهرة اللعبة عالمياً» — and
 * it is an admin-set tier, never anything a browser sends and never guessed
 * from sales figures.
 *
 * ## The curve from one ticket to ten
 *
 * Three fixed points the owner named: 75% losing at one ticket, about 25% at
 * five, exactly 0% at ten. Everything between them is one smooth monotone
 * curve rather than a table somebody hand-wrote, because a table has steps in
 * it and «لا أريد قفزات غير منطقية بين 4 و5 أو 9 و10».
 *
 * The win budget left over is split by shares that slide from the one-ticket
 * shape to the ten-ticket shape, geometrically. Geometric rather than linear
 * because the rare buckets have to move by multiples, not by additions:
 * `high_premium` travels 0.01% → 1%, a hundredfold, while `low_cheap` travels
 * 20% → 50%. A linear blend would drown the hundredfold in the additive one.
 *
 * Both endpoints are exact by construction, not by fitting: at one ticket the
 * blend is the base vector itself, at ten it is the target vector itself.
 *
 * ## What this module will not do
 *
 * It does not read the database, the catalogue, the settings or the clock. It
 * is arithmetic over numbers the caller supplies, so every claim in the tests
 * is a claim about the real thing rather than about a copy of it.
 */

/** How famous a game is. Admin-set, server-side, never inferred from sales. */
export type PopularityTier = "low" | "medium" | "high";

/** Which side of the price boundary a game sits on. */
export type PriceBand = "cheap" | "premium";

/** The six ways to win. */
export type PrizeBucketKey =
  | "low_cheap"
  | "medium_cheap"
  | "high_cheap"
  | "low_premium"
  | "medium_premium"
  | "high_premium";

/** The six ways to win, and the one way not to. */
export type BucketKey = PrizeBucketKey | "lose";

export const PRIZE_BUCKETS: readonly PrizeBucketKey[] = [
  "low_cheap",
  "medium_cheap",
  "high_cheap",
  "low_premium",
  "medium_premium",
  "high_premium",
] as const;

export const LOSE = "lose" as const;

/** What a member is shown for each outcome. */
export const BUCKET_LABELS: Readonly<Record<BucketKey, string>> = {
  lose: "حظ أوفر",
  low_cheap: "لعبة غير مشهورة — سعر منخفض",
  medium_cheap: "لعبة شبه مشهورة — سعر منخفض",
  high_cheap: "لعبة مشهورة — سعر منخفض",
  low_premium: "لعبة غير مشهورة — سعر أعلى",
  medium_premium: "لعبة شبه مشهورة — سعر أعلى",
  high_premium: "لعبة مشهورة — سعر أعلى",
};

export const POPULARITY_LABELS: Readonly<Record<PopularityTier, string>> = {
  low: "غير مشهورة",
  medium: "شبه مشهورة",
  high: "مشهورة",
};

/**
 * The price that separates «سعر منخفض» from «سعر أعلى».
 *
 * The owner wrote the bands as «حتى 5,000» and «6,000 فما فوق», and then named
 * the trap himself: «انتبه للفجوة بين 5000 و6000 إذا كانت الأسعار يمكن أن تقع
 * فيها. لا تترك أي لعبة في حالة undefined بسبب هذه الحدود.»
 *
 * So there is no gap. One boundary, and every price in the shop is on one side
 * of it or the other: `price <= BOUNDARY` is cheap, anything above is premium.
 * A game priced 5,500 is premium rather than unclassified.
 *
 * The number is a default, not a law — `bucketOfPrice` takes the boundary as an
 * argument so the admin can move it, and the shop's own ladder is the reason
 * that matters: the repricing put ordinary Switch games at 7,000–9,000, so
 * where this line sits decides whether the cheap half of the roulette has
 * anything in it at all. It is measured against the live catalogue rather than
 * assumed, and the admin owns the answer.
 */
export const DEFAULT_PRICE_BOUNDARY = 5_000;

/** Fewest tickets a spin may use. */
export const MIN_TICKETS_PER_SPIN = 1;
/** Most tickets a spin may use: «الحد الأقصى للدورة: 10 تذاكر». */
export const MAX_TICKETS_PER_SPIN = 10;

/**
 * One ticket, exactly as the owner wrote it. These seven add to 100.
 *
 * Expressed as percentages rather than fractions because that is how they were
 * specified, how the admin will edit them and how the member is shown them —
 * one representation end to end, so nobody has to remember which surface
 * multiplies by a hundred.
 */
export const BASE_ODDS: Readonly<Record<BucketKey, number>> = {
  lose: 75,
  low_cheap: 20,
  medium_cheap: 4,
  high_cheap: 0.5,
  low_premium: 0.4,
  medium_premium: 0.09,
  high_premium: 0.01,
};

/**
 * Ten tickets: the win budget is the whole wheel, split this way.
 *
 * These are SHARES OF THE WIN BUDGET and they add to 1. At ten tickets losing
 * is impossible, so the budget is the entire 100% and each share is also the
 * bucket's own percentage — which is what makes `high_premium` land on exactly
 * the 1% the owner asked for: «تبدأ 0.01% وعند 10 تذاكر استهدف تقريباً 1%».
 *
 * Every one of the six is worth more at ten tickets than at one. The cheap and
 * unknown games give up the most ground, which is the point of buying ten.
 */
export const TEN_TICKET_SHARES: Readonly<Record<PrizeBucketKey, number>> = {
  low_cheap: 0.5,
  medium_cheap: 0.25,
  high_cheap: 0.12,
  low_premium: 0.08,
  medium_premium: 0.04,
  high_premium: 0.01,
};

/**
 * The exponent that puts losing at 25% on the fifth ticket.
 *
 * `lose(t) = 75 · (1 − u)^K` with `u = (t − 1) / 9`, so `lose(1) = 75` and
 * `lose(10) = 0` fall out of the shape itself. Only the middle point needs
 * fixing, and rather than hand-tuning a decimal until the number looked right,
 * K is solved: 75·(5/9)^K = 25 ⟹ K = ln(1/3) / ln(5/9).
 *
 * Written as the division rather than as 1.8687… so the fixed point is the
 * thing in the source and the constant is derived from it. Change the target
 * and the curve follows; a typed decimal would drift away from the sentence it
 * came from.
 */
const LOSE_CURVE_EXPONENT = Math.log(1 / 3) / Math.log(5 / 9);

/**
 * A ticket count the roulette will actually accept, or null.
 *
 * «لا تسمح للعميل بإرسال: 0، negative، fraction، 11+، NaN أو أي قيمة غير صالحة.»
 *
 * A number, or a string of nothing but digits — the shape a JSON body really
 * carries when a form posts it. Everything else is refused by TYPE rather than
 * by value, which is the part `Number()` alone gets wrong: `Number([5])` is 5
 * and `Number(true)` is 1, so an array and a boolean both pass a range check
 * that was never asked about them. A caller sending either is not a member
 * with a spin to make.
 */
export function validTicketCount(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) {
    n = Number(raw);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < MIN_TICKETS_PER_SPIN || n > MAX_TICKETS_PER_SPIN) return null;
  return n;
}

/** Where a price sits, with no gap and no undefined middle. */
export function bandOfPrice(price: number, boundary: number = DEFAULT_PRICE_BOUNDARY): PriceBand {
  const value = Number(price);
  const line = Number.isFinite(boundary) && boundary > 0 ? boundary : DEFAULT_PRICE_BOUNDARY;
  if (!Number.isFinite(value)) return "cheap";
  return value <= line ? "cheap" : "premium";
}

/** The bucket a game belongs to, from its two axes. */
export function bucketOf(
  popularity: PopularityTier,
  price: number,
  boundary: number = DEFAULT_PRICE_BOUNDARY,
): PrizeBucketKey {
  return `${popularity}_${bandOfPrice(price, boundary)}` as PrizeBucketKey;
}

/**
 * The chance of losing, for this many tickets.
 *
 * Monotone decreasing by construction: `(1 − u)` falls with every ticket and
 * the exponent is positive, so no ticket ever makes losing more likely than
 * the ticket before it.
 */
export function losePercentFor(tickets: number): number {
  const t = validTicketCount(tickets);
  if (t === null) return BASE_ODDS.lose;
  if (t >= MAX_TICKETS_PER_SPIN) return 0;
  const u = (t - MIN_TICKETS_PER_SPIN) / (MAX_TICKETS_PER_SPIN - MIN_TICKETS_PER_SPIN);
  return BASE_ODDS.lose * Math.pow(1 - u, LOSE_CURVE_EXPONENT);
}

/** The one-ticket shares of the win budget, which is 25% of the wheel. */
const BASE_WIN_BUDGET = 100 - BASE_ODDS.lose;
const BASE_SHARES: Readonly<Record<PrizeBucketKey, number>> = Object.freeze(
  Object.fromEntries(
    PRIZE_BUCKETS.map((key) => [key, BASE_ODDS[key] / BASE_WIN_BUDGET]),
  ) as Record<PrizeBucketKey, number>,
);

/**
 * The full set of probabilities for a ticket count, before any bucket is known
 * to be empty. Percentages, summing to exactly 100.
 */
export function oddsForTickets(tickets: number): Record<BucketKey, number> {
  const t = validTicketCount(tickets) ?? MIN_TICKETS_PER_SPIN;
  const lose = losePercentFor(t);
  const budget = 100 - lose;
  const u = (t - MIN_TICKETS_PER_SPIN) / (MAX_TICKETS_PER_SPIN - MIN_TICKETS_PER_SPIN);

  /*
    Geometric blend between the two endpoints. `a^(1−u) · b^u` is a straight
    line in log space: it moves each bucket by a RATIO rather than by an
    amount, which is the only way 0.01 → 1 and 20 → 50 can travel together
    without the larger number swamping the smaller one.
  */
  const blended = PRIZE_BUCKETS.map((key) => {
    const from = BASE_SHARES[key];
    const to = TEN_TICKET_SHARES[key];
    return { key, value: Math.pow(from, 1 - u) * Math.pow(to, u) };
  });
  const total = blended.reduce((sum, row) => sum + row.value, 0);

  const out = { lose } as Record<BucketKey, number>;
  for (const row of blended) {
    out[row.key] = total > 0 ? (budget * row.value) / total : 0;
  }
  return exactlyOneHundred(out);
}

/**
 * How many eligible games each bucket holds. Zero is a real answer.
 *
 * Counts only ever decide WHICH game, never whether the bucket wins — except
 * for the one case a count cannot be ignored: a bucket with nothing in it
 * cannot pay out, and the probability it was holding has to go somewhere
 * declared.
 */
export type BucketPopulation = Readonly<Record<PrizeBucketKey, number>>;

export interface ResolvedOdds {
  /** The probabilities actually used, in percent, summing to 100. */
  probabilities: Record<BucketKey, number>;
  /** Buckets that had no eligible game and gave their share away. */
  emptied: PrizeBucketKey[];
  /** The ticket count these belong to. */
  tickets: number;
  /** The boundary between the price bands when these were computed. */
  priceBoundary: number;
}

/**
 * The probabilities a spin will really run on.
 *
 * «إذا كانت الفئة المختارة فارغة: لا تفشل العملية ولا تعطِ لعبة من فئة غير
 * مقصودة بصمت. أنشئ redistribution واضح ومحكوم للفئات المتاحة مع الحفاظ على
 * total=100، وسجّل snapshot الاحتمالات التي استُخدمت.»
 *
 * Three rules, in order:
 *
 *  1. an empty bucket's share is handed to the buckets that CAN pay, in
 *     proportion to what they already hold — so the relative shape the owner
 *     designed survives, and a shop with no famous cheap games does not get a
 *     roulette where the rare tier quietly absorbs everything;
 *  2. losing keeps its own share untouched, because losing is what the member
 *     was told the chance was and it is not there to soak up shortfalls;
 *  3. if NOTHING can pay, the whole wheel is losing — which is a state the
 *     caller must refuse before it spins, and is reported rather than hidden.
 *
 * The result is the snapshot: what this spin actually ran on, recorded with it.
 */
export function resolveOdds(
  tickets: number,
  population: BucketPopulation,
  priceBoundary: number = DEFAULT_PRICE_BOUNDARY,
): ResolvedOdds {
  const t = validTicketCount(tickets) ?? MIN_TICKETS_PER_SPIN;
  const base = oddsForTickets(t);

  const countOf = (key: PrizeBucketKey) => {
    const n = Number(population?.[key]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const emptied = PRIZE_BUCKETS.filter((key) => countOf(key) === 0);
  const usable = PRIZE_BUCKETS.filter((key) => countOf(key) > 0);

  if (emptied.length === 0) {
    return { probabilities: base, emptied: [], tickets: t, priceBoundary };
  }

  const orphaned = emptied.reduce((sum, key) => sum + base[key], 0);
  const anchor = usable.reduce((sum, key) => sum + base[key], 0);

  const probabilities = { lose: base.lose } as Record<BucketKey, number>;
  for (const key of emptied) probabilities[key] = 0;

  if (!(anchor > 0)) {
    /*
      Every bucket that could win is empty. There is no honest place to put the
      win budget, so it is losing — and the caller is expected to refuse the
      spin on `emptied.length === PRIZE_BUCKETS.length` rather than charge a
      member for a certainty.
    */
    for (const key of usable) probabilities[key] = 0;
    probabilities.lose = 100;
    return { probabilities: exactlyOneHundred(probabilities), emptied, tickets: t, priceBoundary };
  }

  for (const key of usable) {
    probabilities[key] = base[key] + (orphaned * base[key]) / anchor;
  }
  return { probabilities: exactlyOneHundred(probabilities), emptied, tickets: t, priceBoundary };
}

/**
 * Floating point, made to add up.
 *
 * Six geometric blends and a power curve do not sum to exactly 100 in binary,
 * and this number is shown to members as a percentage and audited afterwards.
 * The residue — parts in 10^13 — is given to the largest bucket, where it is
 * far below anything anyone can see, rather than left to make a snapshot that
 * does not total 100 or a picker whose last bucket is unreachable.
 */
function exactlyOneHundred(input: Record<BucketKey, number>): Record<BucketKey, number> {
  const out = { ...input };
  const keys = Object.keys(out) as BucketKey[];
  for (const key of keys) {
    const value = Number(out[key]);
    out[key] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  const total = keys.reduce((sum, key) => sum + out[key], 0);
  if (!(total > 0)) return out;
  let largest = keys[0];
  for (const key of keys) if (out[key] > out[largest]) largest = key;
  out[largest] += 100 - total;
  return out;
}

/**
 * Which outcome a draw lands on.
 *
 * `draw` returns a unit in [0, 1) and is the caller's — the server's CSPRNG in
 * production, a fixed sequence in a test. The order is fixed and declared so a
 * recorded draw can be re-walked against a recorded snapshot: losing first,
 * then the six in `PRIZE_BUCKETS` order.
 *
 * The final `else` is not reachable for a snapshot that sums to 100, and it
 * returns the last non-zero bucket rather than throwing, because a rounding
 * residue must never be the reason a member who paid ten tickets gets an
 * error.
 */
export function pickBucket(
  probabilities: Readonly<Record<BucketKey, number>>,
  draw: () => number,
): BucketKey {
  const order: BucketKey[] = [LOSE, ...PRIZE_BUCKETS];
  const total = order.reduce((sum, key) => sum + Math.max(0, Number(probabilities[key]) || 0), 0);
  if (!(total > 0)) return LOSE;

  const unit = Number(draw());
  const roll = (Number.isFinite(unit) ? Math.min(Math.max(unit, 0), 0.999999999) : 0) * total;

  let cursor = 0;
  let last: BucketKey = LOSE;
  for (const key of order) {
    const weight = Math.max(0, Number(probabilities[key]) || 0);
    if (weight <= 0) continue;
    last = key;
    cursor += weight;
    if (roll < cursor) return key;
  }
  return last;
}

/**
 * The odds as a screen should print them: one row per outcome, biggest first,
 * with losing always on top so «حظ أوفر» is never buried among six prizes.
 */
export function oddsRows(
  probabilities: Readonly<Record<BucketKey, number>>,
  population?: BucketPopulation,
): { key: BucketKey; label: string; percent: number; games: number }[] {
  const prizes = PRIZE_BUCKETS.map((key) => ({
    key: key as BucketKey,
    label: BUCKET_LABELS[key],
    percent: Number(probabilities[key]) || 0,
    games: Math.max(0, Math.floor(Number(population?.[key] ?? 0)) || 0),
  })).sort((a, b) => b.percent - a.percent);

  return [
    {
      key: LOSE,
      label: BUCKET_LABELS.lose,
      percent: Number(probabilities.lose) || 0,
      games: 0,
    },
    ...prizes,
  ];
}
