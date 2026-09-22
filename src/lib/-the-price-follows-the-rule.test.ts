/**
 * The owner's pricing rules, tested against the owner's own sentences.
 *
 * These prices are the shop's income. The rules were given twice, in Arabic,
 * as prose — and prose turns into arithmetic only once, here. Each test names
 * the clause it enforces, so a future change to the engine has to argue with
 * the sentence rather than with the code.
 *
 * The catalogue these run against: 1,712 games, 1,549 of them costing 2,000 or
 * less, three quarters at a cost of exactly 1,496 د.ع.
 */
import { describe, expect, it } from "vitest";

import type { RepriceProduct } from "@/lib/repricing";
import {
  CHEAP_CEILING,
  CHEAP_FLOOR,
  DEAR_FLOOR,
  MIN_MARGIN,
  decisionProblem,
  repriceAll,
  repriceOne,
  skipReason,
} from "@/lib/repricing";

const game = (over: Partial<RepriceProduct> = {}): RepriceProduct => ({
  id: "prd_game",
  title: "لعبة",
  kind: "game",
  cost: 1_496,
  price: 5_000,
  ...over,
});

const priceOf = (over: Partial<RepriceProduct>) => repriceOne(game(over)).newPrice;

describe("«اذا كان سعر اللعبه ٥ او ٧ اتركها»", () => {
  it("leaves 5,000 exactly where it is", () => {
    const decision = repriceOne(game({ price: 5_000 }));
    expect(decision.newPrice).toBe(5_000);
    expect(decision.changed).toBe(false);
  });

  it("leaves 7,000 exactly where it is", () => {
    const decision = repriceOne(game({ price: 7_000 }));
    expect(decision.newPrice).toBe(7_000);
    expect(decision.changed).toBe(false);
  });

  it("leaves them alone even though 985 and 206 games sit there", () => {
    // The two largest price groups in the shop. A rule that moved these would
    // reprice two thirds of the catalogue on a sentence that says not to.
    const many = Array.from({ length: 50 }, (_, i) =>
      game({ id: `p${i}`, price: i % 2 === 0 ? 5_000 : 7_000 }),
    );
    expect(repriceAll(many).every((d) => d.changed === false)).toBe(true);
  });
});

describe("«اذا رايت سعر يستحق ان تنخفض مثلا من ٩ الى ٨ اعملها»", () => {
  it("takes 9,000 down to 8,000", () => {
    expect(priceOf({ price: 9_000 })).toBe(8_000);
  });

  it("does not take 8,000 down any further", () => {
    expect(priceOf({ price: 8_000 })).toBe(8_000);
  });

  it("does not invent the same move for 11,000 or 10,000", () => {
    // The sentence gives one example. Reading it as "shave a thousand off
    // everything" would cut the shop's income on a hundred and twenty games
    // nobody asked about.
    expect(priceOf({ price: 10_000 })).toBe(10_000);
    expect(priceOf({ price: 11_000 })).toBe(11_000);
    expect(priceOf({ price: 12_000 })).toBe(12_000);
    expect(priceOf({ price: 6_000 })).toBe(6_000);
  });
});

describe("«لتكون ولتبدو ارخص للزبون» — the prices that are not whole thousands", () => {
  it("rounds 10,250 down to 10,000", () => {
    expect(priceOf({ price: 10_250 })).toBe(10_000);
  });

  it("rounds 8,500 down to 8,000", () => {
    expect(priceOf({ price: 8_500 })).toBe(8_000);
  });

  it("rounds 7,500 down to 7,000", () => {
    expect(priceOf({ price: 7_500 })).toBe(7_000);
  });

  it("rounds 11,500 down to 11,000", () => {
    expect(priceOf({ price: 11_500 })).toBe(11_000);
  });

  it("rounds down and then caps, for 14,750", () => {
    // Monster Hunter Stories 3, cost 2,000: 14,750 → 14,000 → the 12,000 cap.
    expect(priceOf({ price: 14_750, cost: 2_000 })).toBe(12_000);
  });

  it("never rounds up in the cheap band, because up is not cheaper", () => {
    for (const price of [5_500, 6_250, 8_750, 9_900, 11_999]) {
      expect(priceOf({ price })).toBeLessThanOrEqual(price);
    }
  });
});

describe("«ولنقل ١٢ الف كحد اقصى في الالعاب القويه جدا»", () => {
  it("brings Zelda down from 17,500 to 12,000", () => {
    // The Legend of Zelda: Tears of the Kingdom — cost 1,500, priced 17,500.
    expect(priceOf({ title: "Zelda: Tears of the Kingdom", cost: 1_500, price: 17_500 })).toBe(
      12_000,
    );
  });

  it("brings Mario Kart World down from 14,500 to 12,000", () => {
    expect(priceOf({ title: "Mario Kart World", cost: 1_750, price: 14_500 })).toBe(12_000);
  });

  it("caps at 12,000 and not at 11,000 — the ceiling is a ceiling, not a target", () => {
    expect(priceOf({ price: 13_000 })).toBe(CHEAP_CEILING);
    expect(priceOf({ price: 40_000 })).toBe(CHEAP_CEILING);
  });
});

describe("«يكون سعرها من 5000 فما فوق»", () => {
  it("raises anything below the floor to 5,000", () => {
    expect(priceOf({ price: 3_000 })).toBe(CHEAP_FLOOR);
    expect(priceOf({ price: 1_500 })).toBe(CHEAP_FLOOR);
  });

  it("never sells a cheap-band game below 5,000, whatever it costs", () => {
    for (const price of [1, 999, 4_999, 5_001, 5_500]) {
      expect(repriceOne(game({ price })).newPrice).toBeGreaterThanOrEqual(CHEAP_FLOOR);
    }
  });
});

describe("«في الالعاب التي فوق 2001 اجعل الربح اقل شي هو 5000»", () => {
  it("lifts a 2,142.8 game from 7,000 to 8,000", () => {
    // Ten games sit at exactly this cost and price, short of the margin by 143.
    expect(priceOf({ cost: 2_142.8, price: 7_000 })).toBe(8_000);
  });

  it("lifts Wo Long from 14,000 to 15,000", () => {
    expect(priceOf({ title: "Wo Long", cost: 9_042, price: 14_000 })).toBe(15_000);
  });

  it("lifts Stray from 8,000 to 9,000", () => {
    expect(priceOf({ title: "Stray switch 2", cost: 3_500, price: 8_000 })).toBe(9_000);
  });

  it("never prices a dear game below 7,000", () => {
    expect(priceOf({ cost: 2_001, price: 5_000 })).toBeGreaterThanOrEqual(DEAR_FLOOR);
  });

  it("in practice starts at 8,000, because a whole thousand is what clears the margin", () => {
    /*
      «اجعل الربح اقل شي هو 5000، يعني الاسعار تبدأ من 7000 فما فوق» gives both
      a rule and an illustration, and they do not quite meet. A cost of 2,001
      needs 7,001 to earn 5,000, and 7,001 is not a price this shop writes —
      the whole point of the rounding clause is that prices are whole
      thousands. Rounding UP to 8,000 is the only way to honour the margin,
      which is the rule; 7,000 was the illustration of where the band starts.

      The rule wins, because it is the one stated as a requirement and because
      rounding the other way sells ten real games at a loss against the
      owner's own floor.
    */
    expect(priceOf({ cost: 2_001, price: 5_000 })).toBe(8_000);
    expect(priceOf({ cost: 2_142.8, price: 7_000 })).toBe(8_000);
  });

  it("keeps the margin at or above 5,000 for every cost in the band", () => {
    for (const cost of [2_001, 2_142.8, 2_358.4, 2_574, 3_220.8, 3_652, 4_730, 5_808, 9_042]) {
      for (const price of [5_000, 7_000, 8_000, 10_250, 14_000]) {
        const decision = repriceOne(game({ cost, price }));
        expect(decision.skipped).toBeNull();
        expect(Number(decision.newPrice) - cost).toBeGreaterThanOrEqual(MIN_MARGIN);
      }
    }
  });

  it("does not cap the dear band at 12,000 — that ceiling was for cheap games", () => {
    // A cost of 9,042 cannot be sold at 12,000 and still earn 5,000.
    expect(priceOf({ cost: 9_042, price: 14_000 })).toBeGreaterThan(CHEAP_CEILING);
  });

  it("leaves a dear game alone when it already earns enough and reads well", () => {
    expect(repriceOne(game({ cost: 2_500, price: 10_000 })).changed).toBe(false);
  });
});

describe("what is not a game, and must not be repriced", () => {
  it("refuses the Nintendo eShop gift card by name, though its kind says game", () => {
    /*
      Cost 17,600, priced 18,500. The margin rule would make it 22,600 — a
      top-up card at a 28% premium over its own face value, which is not a
      product anybody buys. `kind` did not catch it: it reached the catalogue
      classified as a game, which is exactly why the name is checked too.
    */
    const decision = repriceOne(
      game({
        title: "Nintendo eShop Hong Kong Gift Card",
        kind: "game",
        cost: 17_600,
        price: 18_500,
      }),
    );
    expect(decision.skipped).toBeTruthy();
    expect(decision.newPrice).toBe(18_500);
    expect(decision.changed).toBe(false);
  });

  it("refuses the Arabic wordings of a top-up card too", () => {
    for (const title of ["بطاقة شحن نينتندو", "كروت تعبئة", "رصيد eShop", "شحن المحفظة"]) {
      expect(skipReason(game({ title }))).toBeTruthy();
    }
  });

  it("refuses a console, by kind and by the size of the number", () => {
    expect(skipReason(game({ kind: "hardware" }))).toBeTruthy();
    // The Switch 2: cost 590,000, priced 749,000, and `kind` did not say so.
    expect(skipReason(game({ kind: "game", cost: 590_000, price: 749_000 }))).toBeTruthy();
  });

  it("refuses every non-game kind", () => {
    for (const kind of [
      "hardware",
      "device",
      "accessory",
      "amiibo",
      "collectible",
      "bundle",
      "gift_card",
      "digital_code",
      "used",
    ]) {
      expect(skipReason(game({ kind }))).toBeTruthy();
    }
  });

  it("refuses a product with no cost or no price rather than guessing one", () => {
    expect(skipReason(game({ cost: null }))).toBeTruthy();
    expect(skipReason(game({ cost: 0 }))).toBeTruthy();
    expect(skipReason(game({ price: null }))).toBeTruthy();
  });

  it("leaves a skipped product's price exactly as it was", () => {
    const decision = repriceOne(game({ kind: "hardware", price: 749_000 }));
    expect(decision.newPrice).toBe(749_000);
    expect(decision.changed).toBe(false);
  });
});

describe("the gate before the write", () => {
  it("passes every decision the rules produce, across the real cost spread", () => {
    const COSTS = [
      1_250, 1_496, 1_500, 1_540, 1_650, 1_711.6, 1_750, 1_760, 1_927.2, 1_936, 1_980, 2_000,
      2_142.8, 2_200, 2_250, 2_358.4, 2_500, 2_574, 2_640, 2_750, 3_000, 3_005.2, 3_220.8, 3_250,
      3_300, 3_500, 3_652, 4_500, 4_514.4, 4_730, 4_750, 4_840, 5_500, 5_750, 5_808, 6_500, 6_886,
      7_000, 7_532.8, 7_964, 9_042, 9_500, 10_000, 10_340, 13_354,
    ];
    const PRICES = [
      5_000, 6_000, 7_000, 7_500, 8_000, 8_500, 9_000, 10_000, 10_250, 10_500, 11_000, 11_500,
      12_000, 12_500, 13_000, 14_000, 14_500, 14_750, 15_000, 16_000, 16_500, 17_500, 18_000,
      18_500, 20_000, 22_000, 23_000,
    ];
    const problems: string[] = [];
    for (const cost of COSTS) {
      for (const price of PRICES) {
        const problem = decisionProblem(repriceOne(game({ cost, price })));
        if (problem) problems.push(`cost ${cost} price ${price}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("catches a proposal that would sell below cost", () => {
    expect(
      decisionProblem({
        id: "x",
        title: "x",
        cost: 9_000,
        oldPrice: 12_000,
        newPrice: 8_000,
        changed: true,
        reason: "",
        skipped: null,
      }),
    ).toBeTruthy();
  });

  it("catches a proposal that is not a whole thousand", () => {
    expect(
      decisionProblem({
        id: "x",
        title: "x",
        cost: 1_496,
        oldPrice: 10_250,
        newPrice: 10_250,
        changed: false,
        reason: "",
        skipped: null,
      }),
    ).toBeTruthy();
  });

  it("says nothing about a product it was told to skip", () => {
    expect(
      decisionProblem({
        id: "x",
        title: "gift card",
        cost: 17_600,
        oldPrice: 18_500,
        newPrice: 18_500,
        changed: false,
        reason: "",
        skipped: "بطاقة شحن",
      }),
    ).toBeNull();
  });
});

describe("the rules are stable", () => {
  it("running them twice changes nothing the second time", () => {
    /*
      A repricing that is not idempotent is a repricing nobody can re-run, and
      this one will be re-run — the catalogue grows every week. Whatever comes
      out must be a fixed point of the same rules.
    */
    const cases: RepriceProduct[] = [];
    for (const cost of [1_250, 1_496, 2_000, 2_142.8, 3_500, 5_808, 9_042]) {
      for (const price of [5_000, 7_000, 8_500, 9_000, 10_250, 14_750, 17_500]) {
        cases.push(game({ cost, price }));
      }
    }
    for (const product of cases) {
      const first = repriceOne(product);
      const second = repriceOne({ ...product, price: first.newPrice });
      expect(second.newPrice).toBe(first.newPrice);
      expect(second.changed).toBe(false);
    }
  });
});
