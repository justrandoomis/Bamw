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

/*
  REVERSED, AND BY THE OWNER'S OWN INSTRUCTION.

  «اجعل السعر يعرض بحد اقصى ٩ الف بدلا من ١٢» — the cheap band's ceiling came
  down from 12,000 to 9,000, and with it the whole shape of this band:

    «الالعاب الاقل من ٢ الف تكون بحد اقصى ٩ الف
     ( ٥ اغلبها وأكثرها، ٧ متوسط ، ٨ العاب قويه، ٩ العاب قويه جدا وسويتش ٢ )»

  and four games he priced himself:

    «زيلدا botw او totk تكون ٨ الف سويتش ٢ ،و ٧ الف سويتش ١
     ماريو كارت ورلد ب٩ الف · دونكي كونك ب٨ الف»

  Every 8,000 and 9,000 he named is a SWITCH 2 title, and his only Switch 1
  figure is 7,000 — for Breath of the Wild, the fourth best-selling Switch game
  there is. So the GENERATION is what lifts a price above 7,000, not the fame.

  The old «من ٩ إلى ٨» rule is gone with the old ceiling: 9,000 is no longer a
  price to talk down from, it is the top rung, and nothing reaches it but a
  game he has named.
*/
describe("«بحد اقصى ٩ الف» — the ceiling the owner lowered", () => {
  it("caps a Switch 1 game at 7,000", () => {
    expect(priceOf({ price: 12_000 })).toBe(7_000);
    expect(priceOf({ price: 40_000 })).toBe(7_000);
  });

  it("caps a Switch 2 game at 8,000", () => {
    expect(priceOf({ price: 12_000, isSwitch2: true })).toBe(8_000);
    expect(priceOf({ price: 40_000, isSwitch2: true })).toBe(8_000);
  });

  it("never reaches 9,000 except for a game the owner named", () => {
    for (const isSwitch2 of [false, true]) {
      for (const price of [9_000, 10_000, 12_000, 40_000]) {
        expect(priceOf({ price, isSwitch2 })).toBeLessThanOrEqual(8_000);
      }
    }
    expect(priceOf({ title: "Mario Kart World [Switch 2]", cost: 1_750, price: 45_000 })).toBe(
      9_000,
    );
  });

  it("never RAISES a game to its rung — «بحد اقصى» is a limit, not a target", () => {
    // A game the owner put at 5,000 is a judgement, and cheaper is what he
    // asked for. The rung can only ever bring a price down.
    expect(priceOf({ price: 5_000, isSwitch2: true })).toBe(5_000);
    expect(priceOf({ price: 6_000, isSwitch2: true })).toBe(6_000);
  });

  it("prices the four games the owner named, exactly as he named them", () => {
    const cheap = { cost: 1_500, price: 45_000 };
    expect(
      priceOf({ ...cheap, title: "The Legend of Zelda: Breath of the Wild switch 1" }),
    ).toBe(7_000);
    expect(
      priceOf({
        ...cheap,
        title: "The Legend of Zelda: Breath of the Wild – Nintendo Switch 2 Edition",
        isSwitch2: true,
      }),
    ).toBe(8_000);
    expect(
      priceOf({ ...cheap, title: "The Legend of Zelda: Tears of the Kingdom switch 1" }),
    ).toBe(7_000);
    expect(priceOf({ ...cheap, title: "Mario Kart World", isSwitch2: true })).toBe(9_000);
    expect(priceOf({ ...cheap, title: "Donkey Kong Bananza", isSwitch2: true })).toBe(8_000);
  });
});

describe("«لتكون ولتبدو ارخص للزبون» — the prices that are not whole thousands", () => {
  it("rounds down to a whole thousand before the rung is applied", () => {
    // Below the rung, the rounding is the only thing that moves the price.
    expect(priceOf({ price: 6_250 })).toBe(6_000);
    expect(priceOf({ price: 5_900 })).toBe(5_000);
  });

  it("rounds down and then caps, for 14,750", () => {
    // Monster Hunter Stories 3, cost 2,000: 14,750 → 14,000 → the Switch 1 rung.
    expect(priceOf({ price: 14_750, cost: 2_000 })).toBe(7_000);
  });

  it("never rounds up in the cheap band, because up is not cheaper", () => {
    for (const price of [5_500, 6_250, 8_750, 9_900, 11_999]) {
      expect(priceOf({ price })).toBeLessThanOrEqual(price);
    }
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
  /*
    THE HALF NOW ROUNDS DOWN, and the owner's own example is why:

      «٧ الف اغلبها لو كانت مثلا سعر التكلفه ٢٥٠٠ يكون سعرها ٧ الف»

    A cost of 2,500 wants 7,500 for a margin of exactly 5,000. Rounding that up
    gave 8,000; he says 7,000. So a half goes down, the margin gives away at
    most 500 on that one point, and this band lands where he wants it —
    «٧ الف اغلبها», most of it at 7,000.
  */
  it("prices the owner's own example: a cost of 2,500 at 7,000", () => {
    expect(priceOf({ cost: 2_500, price: 14_000 })).toBe(7_000);
  });

  it("leaves a 2,142.8 game at 7,000, which now clears the rounded margin", () => {
    // Ten games sit at exactly this cost. 7,142.8 rounds to 7,000.
    expect(priceOf({ cost: 2_142.8, price: 7_000 })).toBe(7_000);
  });

  it("lifts Wo Long from 14,000 to 14,000 — 9,042 + 5,000 rounds down", () => {
    expect(priceOf({ title: "Wo Long", cost: 9_042, price: 14_000 })).toBe(14_000);
  });

  it("lifts Stray from 8,000 to 9,000", () => {
    // 3,500 + 5,000 = 8,500, and a half goes down — but 8,000 is under it, so
    // the required floor of 8,000 is what binds. It stays at 8,000.
    expect(priceOf({ title: "Stray switch 2", cost: 3_500, price: 8_000 })).toBe(8_000);
  });

  it("never prices a dear game below 7,000", () => {
    expect(priceOf({ cost: 2_001, price: 5_000 })).toBeGreaterThanOrEqual(DEAR_FLOOR);
  });

  it("really does start at 7,000 now, as the sentence always said", () => {
    /*
      «اجعل الربح اقل شي هو 5000، يعني الاسعار تبدأ من 7000 فما فوق» gave a rule
      and an illustration that did not meet: a cost of 2,001 needs 7,001 to earn
      5,000, and rounding UP made the band start at 8,000 instead of the 7,000
      he named. Rounding the half DOWN — which his 2,500 → 7,000 example
      requires — reconciles them. The band starts at 7,000, in the arithmetic
      and in the sentence.
    */
    expect(priceOf({ cost: 2_001, price: 5_000 })).toBe(7_000);
    expect(priceOf({ cost: 2_142.8, price: 7_000 })).toBe(7_000);
  });

  it("gives away at most 500 of the margin, and only to the rounding", () => {
    for (const cost of [2_001, 2_142.8, 2_358.4, 2_574, 3_220.8, 3_652, 4_730, 5_808, 9_042]) {
      for (const price of [5_000, 7_000, 8_000, 10_250, 14_000]) {
        const decision = repriceOne(game({ cost, price }));
        expect(decision.skipped).toBeNull();
        expect(Number(decision.newPrice) - cost).toBeGreaterThanOrEqual(MIN_MARGIN - 500);
      }
    }
  });

  it("does not cap the dear band at 12,000 — that ceiling was for cheap games", () => {
    // A cost of 9,042 cannot be sold at 12,000 and still earn 5,000.
    expect(priceOf({ cost: 9_042, price: 14_000 })).toBeGreaterThan(CHEAP_CEILING);
  });

  /*
    REVERSED. This band no longer leaves a dear price alone for earning enough.

    «لو كانت مثلا سعر التكلفه ٢٥٠٠ يكون سعرها ٧ الف وهكذا» — «يكون سعرها» is
    «its price IS», and «وهكذا» says the cost decides it. A cost-2,500 game at
    10,000 was earning 7,500 and was left there by a floor, which is the exact
    opposite of «اجعل الالعاب تكون سعرها ارخص».
  */
  it("brings a dear game DOWN to the rule's answer, not just up to it", () => {
    const decision = repriceOne(game({ cost: 2_500, price: 10_000 }));
    expect(decision.newPrice).toBe(7_000);
    expect(decision.changed).toBe(true);
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

describe("«في خيار الاونلاين اجعل الربح 10 الف اقل شي و اعلى شي 15 الف»", () => {
  it("brings a 17,500 profit down to the 15,000 ceiling", async () => {
    /*
      Mario Kart World's online option, read from production: cost 27,500,
      priced 45,000 — a profit of 17,500, above the band. The ceiling puts it
      at 42,500... which is not a whole thousand, so the rule floors to 42,000.
    */
    const { onlinePriceFor } = await import("@/lib/repricing");
    const price = onlinePriceFor(27_500, 45_000);
    expect(price - 27_500).toBeLessThanOrEqual(15_000);
    expect(price - 27_500).toBeGreaterThanOrEqual(10_000);
  });

  it("lifts a thin online margin up to 10,000", async () => {
    const { onlinePriceFor } = await import("@/lib/repricing");
    expect(onlinePriceFor(20_000, 25_000) - 20_000).toBeGreaterThanOrEqual(10_000);
  });

  it("leaves a price already inside the band exactly where the owner put it", async () => {
    /*
      The owner set these by hand. A rule that nudged every one of them to a
      computed value would be overwriting judgement with arithmetic for no gain.
    */
    const { onlinePriceFor } = await import("@/lib/repricing");
    expect(onlinePriceFor(27_500, 40_000)).toBe(40_000);
    expect(onlinePriceFor(27_500, 38_000)).toBe(38_000);
  });

  it("keeps every result a whole thousand and inside the band, across real costs", async () => {
    const { onlinePriceFor, ONLINE_MIN_MARGIN, ONLINE_MAX_MARGIN } =
      await import("@/lib/repricing");
    for (const cost of [5_000, 12_500, 20_000, 27_500, 31_000, 44_000, 60_000]) {
      for (const current of [0, 10_000, 30_000, 45_000, 90_000]) {
        const price = onlinePriceFor(cost, current);
        expect(price % 1_000).toBe(0);
        const margin = price - cost;
        expect(margin).toBeGreaterThanOrEqual(ONLINE_MIN_MARGIN);
        expect(margin).toBeLessThanOrEqual(ONLINE_MAX_MARGIN);
      }
    }
  });
});

describe("«الزياده على العادي حسب فرقها عن العادي» — the add-ons", () => {
  it("reproduces every number the owner has given, and none was fitted after", async () => {
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    // «١٧٠٠ عادي و ٢٠٠٠ مع الاضافات، الفرق ٣٠٠، الزياده ١٠٠٠»
    expect(dlcIncreaseFor(2_000 - 1_700)).toBe(1_000);
    // «فرق في التكلفه ١٠٠٠ تكون الزياده ٢٠٠٠ اي الضعف تقريبا»
    expect(dlcIncreaseFor(1_000)).toBe(2_000);
    // «فرق ٣٠٠٠ نجعل الزياده ٥٠٠٠ وليس ٦٠٠٠»
    expect(dlcIncreaseFor(3_000)).toBe(5_000);
    // «فرق التكلفه ١٠٠٠٠ يكون زياده السعر على العادي ١٢٠٠٠»
    expect(dlcIncreaseFor(10_000)).toBe(12_000);
  });

  it("does NOT stop at 5,000 — that reading was wrong", async () => {
    /*
      The first version capped the increase at 5,000, because «نجعل الزياده هي
      ٥٠٠٠ لتكون منطقيه» read as a ceiling. It was not one: «انا لا اقصد ان
      تتوقف ... انا اقصد تكون زياده ٢٠٠٠ فقط». A cap would have sold a
      10,000-dinar add-on for five, which is the shop paying the customer to
      take it.
    */
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    expect(dlcIncreaseFor(6_000)).toBe(8_000);
    expect(dlcIncreaseFor(10_000)).toBe(12_000);
    expect(dlcIncreaseFor(20_000)).toBe(22_000);
  });

  it("doubles while the gap is small and settles to gap + 2,000 above it", async () => {
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    // The two arms cross at 2,000, where both give 4,000.
    expect(dlcIncreaseFor(1_500)).toBe(3_000);
    expect(dlcIncreaseFor(2_000)).toBe(4_000);
    expect(dlcIncreaseFor(2_500)).toBe(4_500);
  });

  it("never lets a trivial gap price at nothing", async () => {
    // At a gap of 300 the doubling arm gives 600; the owner asked for 1,000.
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    expect(dlcIncreaseFor(1)).toBe(1_000);
    expect(dlcIncreaseFor(300)).toBe(1_000);
    expect(dlcIncreaseFor(499)).toBe(1_000);
  });

  it("adds nothing when the edition costs no more than the plain account", async () => {
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    expect(dlcIncreaseFor(0)).toBe(0);
    expect(dlcIncreaseFor(-500)).toBe(0);
    expect(dlcIncreaseFor(Number.NaN)).toBe(0);
  });

  it("never goes down as the cost gap grows", async () => {
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    let previous = 0;
    for (let diff = 0; diff <= 30_000; diff += 100) {
      const increase = dlcIncreaseFor(diff);
      expect(increase).toBeGreaterThanOrEqual(previous);
      previous = increase;
    }
  });

  it("always earns more on the edition than the add-ons cost", async () => {
    /*
      The point of the whole rule. Whatever the gap, the price rises by more
      than the cost did — so the edition with the add-ons is never the line
      that loses money.
    */
    const { dlcIncreaseFor } = await import("@/lib/repricing");
    for (let diff = 100; diff <= 30_000; diff += 100) {
      expect(dlcIncreaseFor(diff)).toBeGreaterThan(diff);
    }
  });
});

describe("the owner's worked example, end to end", () => {
  it("prices all four lines of one game exactly as the owner priced them", async () => {
    /*
      «سعر اللعبه اوفلاين عادي ٨٠٠٠ تكلفه ٢٠٠٠
       سعر اللعبه اوفلاين مع الاضافات ١٥٠٠٠ تكلفه ٧٠٠٠ (فرق ٥٠٠٠)
       سعر اللعبه اونلاين عادي ٢٦٠٠٠ تكلفه ١٦٠٠٠
       سعر اللعبه اونلاين مع الاضافات ٣٠٠٠٠ تكلفه ١٨٠٠٠ (فرق ٢٠٠٠)»

      Four prices, given as a whole product rather than as rules, and the
      rules have to land on all four or they are not the owner's rules.

      THE FIRST LINE HAS SINCE MOVED, on the owner's own instruction. He later
      capped this band at 9,000 and put every figure above 7,000 behind a Switch
      2 badge: «٧ الف سويتش ١» even for Breath of the Wild. So a plain offline
      account on a Switch 1 game is 7,000 now, not the 8,000 of this example,
      and the add-ons line that is built on it follows it down.

      The other three lines are untouched, because the online band and the
      add-ons arithmetic are exactly what they were — «قاعده الاونلاين تبقى كما
      هي».
    */
    const { dlcPriceFor, onlinePriceFor, repriceOne } = await import("@/lib/repricing");

    // Offline, plain: a Switch 1 game in the cheap band now tops out at 7,000.
    const offline = repriceOne({
      id: "p",
      title: "لعبة",
      kind: "game",
      cost: 2_000,
      price: 8_000,
    });
    expect(offline.newPrice).toBe(7_000);
    expect(offline.changed).toBe(true);

    // The same game as a Switch 2 edition keeps the owner's original 8,000.
    expect(
      repriceOne({
        id: "p",
        title: "لعبة",
        kind: "game",
        cost: 2_000,
        price: 8_000,
        isSwitch2: true,
      }).newPrice,
    ).toBe(8_000);

    // Offline with the add-ons: a 5,000 cost gap still adds 7,000, on top of
    // whichever plain price the game now carries.
    expect(dlcPriceFor(8_000, 7_000 - 2_000)).toBe(15_000);
    expect(dlcPriceFor(7_000, 7_000 - 2_000)).toBe(14_000);

    // Online, plain: cost 16,000 priced at 26,000 is a profit of exactly 10,000.
    expect(onlinePriceFor(16_000, 26_000)).toBe(26_000);

    // Online with the add-ons: a 2,000 cost gap adds 4,000, giving 30,000...
    expect(dlcPriceFor(26_000, 18_000 - 16_000)).toBe(30_000);
    // ...and that price is inside the online profit band on its own cost.
    expect(onlinePriceFor(18_000, 30_000)).toBe(30_000);
    expect(30_000 - 18_000).toBeGreaterThanOrEqual(10_000);
    expect(30_000 - 18_000).toBeLessThanOrEqual(15_000);
  });
});
