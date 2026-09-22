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

/** IQD. Below this a game must not be sold, whatever it cost. */
export const CHEAP_FLOOR = 5_000;
/** IQD. «ولنقل ١٢ الف كحد اقصى في الالعاب القويه جدا» */
export const CHEAP_CEILING = 12_000;
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

    // «اذا رايت سعر يستحق ان تنخفض مثلا من ٩ الى ٨ اعملها» — the example, applied.
    if (next === 9_000) {
      next = 8_000;
      notes.push("من 9 إلى 8");
    }

    if (next > CHEAP_CEILING) {
      next = CHEAP_CEILING;
      notes.push(`سقف ${CHEAP_CEILING.toLocaleString("en-US")} للألعاب القوية`);
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

    The floor is rounded UP to a whole thousand, so a cost of 2,142.8 requires
    8,000 rather than 7,142.8 — the margin is never allowed below 5,000, and
    the price stays a round number a customer can read. Rounding the current
    price down happens first and can only ever be undone by the floor, so no
    game in this band can end up earning less than 5,000.
  */
  const required = Math.max(DEAR_FLOOR, ceilThousand(cost + MIN_MARGIN));
  const notes: string[] = [];
  let next = price;

  if (!isThousand(next)) {
    next = floorThousand(next);
    notes.push("تقريب لأقرب ألف للأسفل");
  }
  if (next < required) {
    next = required;
    notes.push(
      `أقل ربح ${MIN_MARGIN.toLocaleString("en-US")} — التكلفة ${cost.toLocaleString("en-US")}`,
    );
  }

  return {
    ...base,
    newPrice: next,
    changed: next !== price,
    reason: notes.join(" · ") || "داخل النطاق أصلاً",
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
    if (next - cost < MIN_MARGIN) {
      return `${decision.id}: الربح ${next - cost} أقل من ${MIN_MARGIN}`;
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
