/**
 * The owner's pricing rules, as arithmetic.
 *
 * Stated twice, in these words:
 *
 *   «الالعاب ذات التكلفة من 0-2000 دينار يكون سعرها من 5000 فما فوق والاكثر
 *    5000، ولنقل ١٢ الف كحد اقصى في الالعاب القويه جدا، مع مراعاه ان اغلب
 *    الالعاب متوسط يعني ٥٠٠٠ او ٨٠٠٠ وهكذا حسب قوه اللعبه، اذا كان سعر اللعبه
 *    ٥ او ٧ اتركها، اذا رايت سعر يستحق ان تنخفض مثلا من ٩ الى ٨ اعملها لتكون
 *    ولتبدو ارخص للزبون.
 *    اما في الالعاب التي فوق 2001 اجعل الربح اقل شي هو 5000، يعني الاسعار تبدأ
 *    من 7000 فما فوق.»
 *
 * Every rule below traces to one of those sentences, and nothing else is
 * invented. In particular there is no notion of "strength" here: the shop
 * records no sales at all and carries a Metacritic score for 173 of 1,712
 * games, so the only ranking of strength that exists is the price the owner
 * already set. These rules therefore move a price only where a sentence says
 * to, and leave it otherwise.
 *
 * «والاكثر 5000» is read as "and most of them at 5,000" rather than "and at
 * most 5,000", because the very next clause sets the maximum at 12,000. It is
 * a description of the shape the catalogue should have, and it already has it:
 * 985 of the 1,549 games costing 2,000 or less are at 5,000 today.
 */

import { comparableTitle } from "@/lib/bestSellers";

/** IQD. Below this a game must not be sold, whatever it cost. */
export const CHEAP_FLOOR = 5_000;
/**
 * IQD. The top of the cheap band, LOWERED from 12,000 on the owner's
 * instruction: «اجعل السعر يعرض بحد اقصى ٩ الف بدلا من ١٢».
 */
export const CHEAP_CEILING = 9_000;

/* ------------------------------------------------------------------
 * THE LADDER, in the owner's own words:
 *
 *   «الالعاب الاقل من ٢ الف تكون بحد اقصى ٩ الف
 *    ( ٥ اغلبها وأكثرها، ٧ متوسط ، ٨ العاب قويه،
 *      ٩ العاب قويه جدا وسويتش ٢ )»
 *
 * and the four games he priced himself:
 *
 *   «مثلا لعبه زيلدا botw او totk تكون ٨ الف سويتش ٢ ،و ٧ الف سويتش ١
 *    مثلا ماريو كارت ورلد ب٩ الف
 *    دونكي كونك ب٨ الف»
 *
 * Read together, every 8,000 and 9,000 he named is a SWITCH 2 title and his
 * only Switch 1 figure is 7,000 — including for Breath of the Wild, which is
 * the fourth best-selling Switch game there is. So the generation, not the
 * fame, is what lifts a price above 7,000:
 *
 *   9,000  Switch 2, and named by the owner himself
 *   8,000  Switch 2
 *   7,000  everything else
 *   5,000  the floor, and where most of the catalogue already sits
 *
 * The 9,000 rung is deliberately ANCHOR-ONLY. There is no signal in this shop
 * that separates «قويه» from «قويه جدا» in the direction the owner's examples
 * point: Mario Kart World must be 9,000 and Breath of the Wild's Switch 2
 * edition must be 8,000, and every popularity measure available here ranks
 * Breath of the Wild higher. Rather than invent a ranking that produces the
 * answer he gave, the top rung holds only titles he has named.
 * ------------------------------------------------------------------ */

/** IQD. A Switch 2 title the owner has not singled out. */
export const CHEAP_SWITCH2 = 8_000;
/** IQD. «٧ متوسط» — and his price for a Switch 1 game however famous. */
export const CHEAP_MIDDLE = 7_000;

/** What the owner said a named game should cost, by generation. */
export interface NamedPrice {
  /** His figure for the Switch 2 edition. */
  switch2?: number;
  /** His figure for the Switch 1 edition. */
  switch1?: number;
  /** One figure, whichever generation — used when he gave only one. */
  both?: number;
}

/**
 * The games the owner priced by name, and the price he gave.
 *
 *   «مثلا لعبه زيلدا botw او totk تكون ٨ الف سويتش ٢ ،و ٧ الف سويتش ١
 *    مثلا ماريو كارت ورلد ب٩ الف
 *    دونكي كونك ب٨ الف»
 *
 * Matched through `comparableTitle` by containment — the same rule
 * `bestSellerRank` uses — so the catalogue's «Mario Kart World [Switch 2]», its
 * «The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition» and his
 * «زيلدا botw» all reach the right row. Keys are tried longest first so a short
 * one cannot swallow a longer one.
 *
 * An anchor OVERRIDES everything, INCLUDING THE COST SPLIT — it is the owner
 * speaking about one specific game, which outranks any rule inferred from his
 * general sentence. That is not decoration: the dry run put Breath of the
 * Wild's Switch 2 edition at 7,000 because its cost of 2,500 carried it into
 * the dear band, where the ladder does not reach. He said 8,000 for that exact
 * game, and he is not wrong about his own shop.
 *
 * Only «دونكي كونك بنانزا» is anchored of the four Donkey Kong games in the
 * catalogue. It is the Switch 2 title, released beside Mario Kart World, and it
 * is what «دونكي كونك ب٨ الف» names in a sentence about Switch 2 games.
 * Tropical Freeze reaches 8,000 on its own cost, and the two Switch 1 titles
 * settle at 7,000 — which is his own figure for a Switch 1 game.
 */
export const NAMED_PRICES: Readonly<Record<string, NamedPrice>> = {
  "mario kart world": { both: 9_000 },
  "zelda breath of the wild": { switch2: 8_000, switch1: 7_000 },
  "zelda tears of the kingdom": { switch2: 8_000, switch1: 7_000 },
  "donkey kong bananza": { both: 8_000 },
};

/** Longest key first, so «zelda breath of the wild» is never lost to a prefix. */
const NAMED_KEYS: readonly string[] = Object.keys(NAMED_PRICES).sort(
  (a, b) => b.length - a.length,
);

/**
 * The price the owner gave this game by name, or null.
 *
 * `undefined` for a game he never mentioned; a number for one he did. The
 * generation decides between his two Zelda figures, and a game with only one
 * figure takes it whatever generation it is.
 */
export function namedPriceFor(title: unknown, isSwitch2?: boolean): number | null {
  const text = comparableTitle(title);
  if (!text) return null;
  for (const key of NAMED_KEYS) {
    if (text !== key && !text.includes(key)) continue;
    const said = NAMED_PRICES[key]!;
    const price = isSwitch2 ? (said.switch2 ?? said.both) : (said.switch1 ?? said.both);
    return price ?? null;
  }
  return null;
}
/** IQD. The cost that divides the two rules. */
export const COST_SPLIT = 2_000;
/** IQD. «اجعل الربح اقل شي هو 5000» */
export const MIN_MARGIN = 5_000;
/**
 * IQD. «يعني الاسعار تبدأ من 7000 فما فوق»
 *
 * A backstop that never actually binds, and that is worth saying plainly. The
 * bands split at a cost of 2,000, so any game in this one costs at least
 * 2,000.01 and needs at least 7,000.01 to earn 5,000 — which rounds up to
 * 8,000. The illustration in the sentence and the rule in the sentence do not
 * quite meet, and the rule wins: rounding down to 7,000 would sell ten real
 * games below the owner's own stated minimum profit.
 */
export const DEAR_FLOOR = 7_000;
/** A price at or above this is not a game; it is a console. */
export const OUTLIER = 100_000;

/** Prices the owner named as already right. «اذا كان سعر اللعبه ٥ او ٧ اتركها» */
export const LEAVE_ALONE = new Set([5_000, 7_000]);

/** Kinds that are not a game, and are priced by rules these are not. */
export const NOT_A_GAME = new Set([
  "hardware",
  "device",
  "accessory",
  "amiibo",
  "collectible",
  "bundle",
  "gift_card",
  "digital_code",
  "used",
]);

/**
 * A gift card, whatever the record calls itself.
 *
 * The Nintendo eShop Hong Kong card costs 17,600 and sells at 18,500, and
 * `kind` does not say so — it came through the catalogue as a game. Under the
 * margin rule it would be repriced to 22,600, which is nonsense: a top-up card
 * sells near its face value and nobody would buy one at a 28% premium. It is
 * matched by name as well as by kind, because being wrong about this one costs
 * the owner a product line.
 */
const GIFT_CARD_TEXT = /gift\s*card|e-?shop|بطاقة|بطاقات|كروت|شحن|تعبئة|رصيد|voucher|top-?up/i;

export interface RepriceProduct {
  id: string;
  title: string;
  kind?: string;
  schemaId?: string;
  cost: number | null;
  price: number | null;
  /**
   * Whether this listing is a Nintendo Switch 2 title.
   *
   * The caller decides, through `isNintendoSwitch2Product`, because that reads
   * four places on a product record and this module is given only a price and
   * a cost. It is the ONE thing that lifts a cheap-band game above 7,000.
   */
  isSwitch2?: boolean;
}

export interface RepriceDecision {
  id: string;
  title: string;
  cost: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  /** True when `newPrice` differs from `oldPrice` and may be written. */
  changed: boolean;
  /** Why, in the owner's own terms. */
  reason: string;
  /** Set when the product is out of scope entirely. */
  skipped: string | null;
}

const isThousand = (value: number) => value % 1_000 === 0;
const floorThousand = (value: number) => Math.floor(value / 1_000) * 1_000;
const ceilThousand = (value: number) => Math.ceil(value / 1_000) * 1_000;
/**
 * The nearest whole thousand, with an exact half going DOWN.
 *
 * `Math.round` sends a half up, and the owner's own worked example sends it
 * down: a cost of 2,500 needs 7,500 for a margin of 5,000 and he priced it at
 * 7,000. Written as a ceiling of `value - 500` so the tie is unambiguous
 * rather than left to a floating-point comparison.
 */
const roundHalfDownThousand = (value: number) => Math.ceil((value - 500) / 1_000) * 1_000;

/** Out of scope, and why — or null when the product is a game to be priced. */
export function skipReason(product: RepriceProduct): string | null {
  const kind = String(product.kind ?? "")
    .trim()
    .toLowerCase();
  const schema = String(product.schemaId ?? "")
    .trim()
    .toLowerCase();
  if (NOT_A_GAME.has(kind)) return `نوعه «${kind}» وليس لعبة`;
  if (NOT_A_GAME.has(schema)) return `قالبه «${schema}» وليس لعبة`;
  if (GIFT_CARD_TEXT.test(product.title ?? "")) return "بطاقة شحن تُباع قرب قيمتها الاسمية";
  const cost = Number(product.cost);
  const price = Number(product.price);
  if (!Number.isFinite(cost) || cost <= 0) return "بلا تكلفة مسجّلة";
  if (!Number.isFinite(price) || price <= 0) return "بلا سعر مسجّل";
  if (cost >= OUTLIER || price >= OUTLIER) return "جهاز لا لعبة (سعر أو تكلفة فوق 100,000)";
  return null;
}

/**
 * The price this game should carry, and the sentence that says so.
 *
 * Deliberately conservative: where no rule speaks, the price does not move.
 * The owner has priced this catalogue by hand and the rules are corrections to
 * it, not a replacement for it.
 */
export function repriceOne(product: RepriceProduct): RepriceDecision {
  const base: Omit<RepriceDecision, "newPrice" | "changed" | "reason" | "skipped"> = {
    id: product.id,
    title: product.title,
    cost: product.cost,
    oldPrice: product.price,
  };

  const skip = skipReason(product);
  if (skip) {
    return { ...base, newPrice: product.price, changed: false, reason: "", skipped: skip };
  }

  const cost = Number(product.cost);
  const price = Number(product.price);

  /*
    A GAME THE OWNER PRICED HIMSELF.

    Checked before anything else — before the cost split, not inside the cheap
    band — because it is him naming a game and a number, and no rule inferred
    from his general sentence gets to argue with it. Inside the cheap band it
    would have missed Breath of the Wild's Switch 2 edition, whose cost of 2,500
    puts it in the other band entirely.

    The one thing that can refuse it is the shop's own floor: a price at or
    under cost is not a price, it is a loss, and the guard below would stop the
    run anyway. Falling through to the rules is the honest answer there, and it
    has never fired on this catalogue — the dearest anchored game costs 2,500.
  */
  const named = namedPriceFor(product.title, product.isSwitch2);
  if (named !== null && named > cost) {
    return {
      ...base,
      newPrice: named,
      changed: named !== price,
      reason: `سعر حدّده المالك بالاسم: ${named.toLocaleString("en-US")}`,
      skipped: null,
    };
  }

  if (cost <= COST_SPLIT) {
    // «اذا كان سعر اللعبه ٥ او ٧ اتركها» — said outright, so it is checked first.
    if (LEAVE_ALONE.has(price)) {
      return {
        ...base,
        newPrice: price,
        changed: false,
        reason: "سعر 5 أو 7 — تُترك",
        skipped: null,
      };
    }

    const notes: string[] = [];
    let next = price;

    // «لتكون ولتبدو ارخص للزبون» — 10,250 and 8,500 are currency-conversion
    // leftovers, not decisions, and they are the ones that read as expensive.
    if (!isThousand(next)) {
      next = floorThousand(next);
      notes.push("تقريب لأقرب ألف للأسفل");
    }

    /*
      THE CEILING IS THE LADDER'S RUNG FOR THIS GAME.

      8,000 for a Switch 2 title, 7,000 for everything else, and 9,000 only for
      a game the owner has named — which the branch above has already answered.

      It can only ever LOWER a price: the owner asked for cheaper, and raising a
      game to its rung would be reading «بحد اقصى» as a target instead of a
      limit. A game already below its rung is a judgement he made and this
      keeps.
    */
    const rung = product.isSwitch2 ? CHEAP_SWITCH2 : CHEAP_MIDDLE;
    if (next > rung) {
      next = rung;
      notes.push(
        product.isSwitch2
          ? `سقف ${CHEAP_SWITCH2.toLocaleString("en-US")} لسويتش 2`
          : `سقف ${CHEAP_MIDDLE.toLocaleString("en-US")}`,
      );
    }
    if (next < CHEAP_FLOOR) {
      next = CHEAP_FLOOR;
      notes.push(`أرضية ${CHEAP_FLOOR.toLocaleString("en-US")}`);
    }

    return {
      ...base,
      newPrice: next,
      changed: next !== price,
      reason: notes.join(" · ") || "داخل النطاق أصلاً",
      skipped: null,
    };
  }

  /*
    Cost above 2,000: «اجعل الربح اقل شي هو 5000 ... الاسعار تبدأ من 7000».

    ROUNDED TO THE NEAREST THOUSAND, WITH A HALF GOING DOWN — because the owner
    worked an example that the old arithmetic got wrong:

      «٧ الف اغلبها لو كانت مثلا سعر التكلفه ٢٥٠٠ يكون سعرها ٧ الف»

    A cost of 2,500 wants 7,500 for a margin of exactly 5,000. Rounding that UP
    gave 8,000; he says 7,000. So the half rounds down, which costs the margin
    500 dinars on that one point and gives him the «٧ الف اغلبها» he asked for —
    most of this band at 7,000. Anything at or above x,501 still rounds up, so
    the margin is never more than 500 short and is usually over.

    `DEAR_FLOOR` is no longer a backstop that never binds: at a cost of 2,001
    the nearest thousand to 7,001 is 7,000, which is the floor exactly.
  */
  const required = Math.max(DEAR_FLOOR, roundHalfDownThousand(cost + MIN_MARGIN));

  /*
    AND THE COST NOW DECIDES THE PRICE, IN BOTH DIRECTIONS.

    This used to be a floor only: a price above it was left alone. But the
    owner's example is not a minimum, it is the answer —

      «لو كانت مثلا سعر التكلفه ٢٥٠٠ يكون سعرها ٧ الف وهكذا»

    «يكون سعرها ٧ الف» is «its price IS 7,000», and «وهكذا» — and so on — says
    the cost determines it. A cost-2,500 game sitting at 14,000 was left at
    14,000 by a floor, which is the opposite of «اجعل الالعاب تكون سعرها ارخص».

    So this band is now deterministic: price = cost + 5,000, to the nearer
    thousand with a half going down, never under 7,000. Nothing in it is left to
    judgement, which is what «وهكذا» asks for — and it is the reason the dry run
    matters before any of it is written.
  */
  const next = required;

  return {
    ...base,
    newPrice: next,
    changed: next !== price,
    reason:
      next === price
        ? "مطابق للقاعدة أصلاً"
        : `${MIN_MARGIN.toLocaleString("en-US")} ربحًا فوق تكلفة ${cost.toLocaleString("en-US")}`,
    skipped: null,
  };
}

/** Every decision, in catalogue order. */
export function repriceAll(products: readonly RepriceProduct[]): RepriceDecision[] {
  return products.map((product) => repriceOne(product));
}

/**
 * A decision that would break one of the owner's own rules.
 *
 * The last gate before a write: a proposal that sells below cost, or below the
 * band's floor, or above the band's ceiling, is a bug in the rules above and
 * must stop the run rather than reach the shelf.
 */
export function decisionProblem(decision: RepriceDecision): string | null {
  if (decision.skipped) return null;
  const cost = Number(decision.cost);
  const next = Number(decision.newPrice);
  if (!Number.isFinite(next) || next <= 0) return `${decision.id}: سعر جديد غير صالح`;
  if (next <= cost) return `${decision.id}: السعر ${next} لا يتجاوز التكلفة ${cost}`;
  if (!isThousand(next)) return `${decision.id}: السعر ${next} ليس ألفًا كاملًا`;
  if (cost <= COST_SPLIT) {
    if (next < CHEAP_FLOOR) return `${decision.id}: ${next} تحت أرضية ${CHEAP_FLOOR}`;
    if (next > CHEAP_CEILING) return `${decision.id}: ${next} فوق سقف ${CHEAP_CEILING}`;
  } else {
    if (next < DEAR_FLOOR) return `${decision.id}: ${next} تحت أرضية ${DEAR_FLOOR}`;
    /*
      The margin, with the half-thousand the owner's own example gives away.

      «لو كانت مثلا سعر التكلفه ٢٥٠٠ يكون سعرها ٧ الف» — a margin of 4,500, not
      5,000, because the price rounds to the nearer thousand and a half goes
      down. So the gate allows the rounding to cost at most 500 and no more: a
      margin of 4,499 is still a bug in the rules and still stops the run.
    */
    if (next - cost < MIN_MARGIN - 500) {
      return `${decision.id}: الربح ${next - cost} أقل من ${MIN_MARGIN - 500}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The online account, and the DLC increase.
 *
 * «في خيار الاونلاين اجعل الربح 10 الف اقل شي و اعلى شي 15 الف، سواء كان
 *  عادي او مع الاضافات.»
 * «وdlc للحساب الاوفلاين تكون الزياده على العادي حسب فرقها عن العادي.»
 *
 * These are a different rule from the offline price above, and deliberately a
 * separate function: the offline price is floored and capped on its own cost,
 * while an online account is priced on ITS own cost — the two options of one
 * product carry different costs, and a sample from production shows an online
 * option at cost 27,500 against a game whose offline cost is 1,750.
 * ------------------------------------------------------------------ */

/** IQD. «اجعل الربح 10 الف اقل شي» for an online account. */
export const ONLINE_MIN_MARGIN = 10_000;
/** IQD. «و اعلى شي 15 الف» */
export const ONLINE_MAX_MARGIN = 15_000;

/**
 * What an online account should cost, given what it cost the shop.
 *
 * The band is on the PROFIT, not the price, so the answer moves with the cost
 * rather than being a number typed once and left behind — which is how the
 * market's bot floors came to quote nineteen hundred times the spot price.
 *
 * A price already inside the band is left exactly where it is. The owner set
 * these by hand and a rule that nudged every one of them to a computed value
 * would be overwriting judgement with arithmetic for no gain.
 */
export function onlinePriceFor(cost: number, current: number): number {
  const c = Number(cost);
  const now = Number(current);
  if (!Number.isFinite(c) || c <= 0) return now;
  const floor = ceilThousand(c + ONLINE_MIN_MARGIN);
  const ceiling = floorThousand(c + ONLINE_MAX_MARGIN);
  /*
    A band narrower than one thousand cannot hold a whole-thousand price. It
    cannot happen with a 5,000-wide band, but the guard is here because the
    alternative is silently returning a floor above the ceiling.
  */
  if (ceiling < floor) return floor;
  if (!Number.isFinite(now) || now <= 0) return floor;
  if (now < floor) return floor;
  if (now > ceiling) return ceiling;
  return now;
}

/**
 * How much the edition WITH the add-ons costs above the plain one.
 *
 * Not a ladder — a formula, and the owner's own numbers determine it exactly.
 * Doubling holds while the gap is small, and above it the increase settles to
 * the gap plus two thousand:
 *
 *     increase = max(1,000, min(2 × gap, gap + 2,000))
 *
 * The two arms cross at a gap of 2,000, where both give 4,000. Every figure
 * the owner has given is reproduced by it, and none was fitted afterwards:
 *
 *   gap    300 → 1,000   «اذا كان ١٧٠٠ عادي و ٢٠٠٠ مع الاضافات ... الزياده ١٠٠٠»
 *   gap  1,000 → 2,000   «فرق في التكلفه ١٠٠٠ تكون الزياده ٢٠٠٠ اي الضعف»
 *   gap  2,000 → 4,000   online 26,000 → 30,000 in the worked example
 *   gap  3,000 → 5,000   «نجعل الزياده هي ٥٠٠٠ ... وليس ٦٠٠٠»
 *   gap  5,000 → 7,000   offline 8,000 → 15,000 in the worked example
 *   gap 10,000 → 12,000  «فرق التكلفه ١٠٠٠٠ يكون زياده السعر ١٢٠٠٠»
 *
 * The first version of this was a ladder that stopped at 5,000, because
 * «نجعل الزياده هي ٥٠٠٠ لتكون منطقيه» read as a cap. It was not a cap: «انا لا
 * اقصد ان تتوقف ... انا اقصد تكون زياده ٢٠٠٠ فقط». A cap would have sold a
 * 10,000-dinar add-on for five, which is the shop paying the customer to take
 * it.
 *
 * The floor of 1,000 is what keeps a trivial gap from pricing at nothing: at
 * a gap of 300 the doubling arm gives 600, and the owner asked for 1,000.
 */
export function dlcIncreaseFor(costDiff: number): number {
  const diff = Number(costDiff);
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.max(1_000, Math.min(2 * diff, diff + 2_000));
}

/**
 * The edition's price: the plain price plus what the add-ons are worth,
 * rounded DOWN to a whole thousand.
 *
 * The rounding is not decoration. The supplier's costs are quarter-thousands
 * — 1,250, 2,750, 18,500 — so a real cost gap is very often 1,250 or 4,500,
 * and `2 × gap` then lands on a five hundred: an 8,000 game with a 1,250 gap
 * priced at 10,500. Every price the owner has ever quoted is a whole thousand,
 * and «لتكون ولتبدو ارخص للزبون» says which way to round.
 *
 * Found by the pre-write gate on the live catalogue, not by me: fourteen
 * add-ons editions were proposed at a price ending in 500, and `tierProblem`
 * refused the whole run. None of the owner's six anchors move, because every
 * gap they name is a whole thousand and was already landing on one.
 *
 * The floor can never take the price back to the plain edition's: the
 * increase is at least 1,000 and a plain price is itself a whole thousand, so
 * what is left after rounding down is at least a thousand above it.
 */
export function dlcPriceFor(offlinePrice: number, costDiff: number): number {
  const base = Number(offlinePrice);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const increase = dlcIncreaseFor(costDiff);
  if (increase <= 0) return base;
  return floorThousand(base + increase);
}
