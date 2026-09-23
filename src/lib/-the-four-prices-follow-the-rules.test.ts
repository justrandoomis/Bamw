/**
 * All four of a game's prices, against the owner's own worked example.
 *
 * The example, given in one message:
 *
 *   سعر اللعبه اوفلاين عادي ٨٠٠٠ تكلفه ٢٠٠٠
 *   سعر اللعبه اوفلاين مع الاضافات ١٥٠٠٠ تكلفه ٧٠٠٠ (فرق ٥٠٠٠)
 *   سعر اللعبه اونلاين عادي ٢٦٠٠٠ تكلفه ١٦٠٠٠
 *   سعر اللعبه اونلاين مع الاضافات ٣٠٠٠٠ تكلفه ١٨٠٠٠ (فرق ٢٠٠٠)
 *
 * Every one of those four lines is a test below, and the arithmetic was not
 * fitted to them afterwards — `dlcIncreaseFor` and `onlinePriceFor` were
 * derived from the sentences and then checked against these numbers.
 *
 * THE FIRST LINE HAS SINCE BEEN OVERRULED BY ITS AUTHOR — TWICE.
 *
 * FIRST, the ceiling and the four games he priced by name:
 *
 *   «اجعل السعر يعرض بحد اقصى ٩ الف بدلا من ١٢ ...
 *    مثلا لعبه زيلدا botw او totk تكون ٨ الف سويتش ٢ ،و ٧ الف سويتش ١»
 *
 * which was read as generation-only, because all four games he happened to name
 * were Switch 2 titles. That reading dropped half of his ladder — «٥ اغلبها
 * وأكثرها، ٧ متوسط، ٨ العاب قويه», which is fame, not generation — and
 * with fame gone the rungs had nothing left to sort by.
 *
 * SECOND, and this is the correction the numbers below carry, he said what that
 * cost him:
 *
 *   «أغلب الألعاب تكون غير معروفة وغير مشهورة لكن سعرها سبعة وثمانية بدل ٥،
 *    بينما هنالك ألعاب قوية وسعرها غالي وفي نفس الوقت مشهورة جدا لكن سعرها
 *    خمسة آلاف بدل ٨ و ٧.»
 *
 * So the cheap band's rung is now fame AND generation (`cheapRungFor`):
 *
 *   famous / known   7,000 on Switch 1   ·   8,000 on Switch 2
 *   obscure          5,000 on Switch 1   ·   7,000 on Switch 2
 *
 * The product these tests price is titled «Game»: on no worldwide-sales list
 * and in no demand table, so the shop calls it «غير مشهورة». It is exactly
 * the game of the first half of his complaint, so its plain offline row now
 * settles at 5,000 on Switch 1 and 7,000 on Switch 2 — not the 7,000 and 8,000
 * of the generation-only reading — and every add-ons edition built on it comes
 * down with it. The two online lines are untouched: «قاعده الاونلاين تبقى
 * كما هي».
 *
 * HIS OWN 8,000 AND 15,000 ARE NOT LOST. They are asserted below on
 * `famousGame` — a famous Switch 2 title, which is the one shape that rung was
 * ever about — where the example still passes line for line without a single
 * price moving. Each test that moved says above itself which sentence
 * superseded which.
 *
 * The rest of the file is about the cases the example does not cover, which
 * is where money is actually lost: a tier that cannot be identified, an
 * add-ons edition with no plain edition to build on, costs that say the
 * add-ons are cheaper than the plain game, and an online price that is
 * already where the owner put it.
 */
import { describe, expect, it } from "vitest";

import { repriceTiers, tierProblem } from "./tierRepricing";

/*
  «Game» is on no worldwide-sales list and in no demand table, so `fameTier`
  answers `low` and `fameBandFor` answers «غير مشهورة». That used to be an
  irrelevant detail and is now load-bearing: this is the game the owner was
  complaining about — «أغلب الألعاب تكون غير معروفة وغير مشهورة لكن
  سعرها سبعة وثمانية بدل ٥» — so its cheap-band rung is 5,000 on Switch 1
  and 7,000 on Switch 2.
*/
const game = (types: unknown) => ({ id: "p1", title: "Game", kind: "game", types });

/*
  The other half of the same sentence: «ألعاب قوية ... مشهورة جدا لكن
  سعرها خمسة آلاف بدل ٨ و ٧».

  Mario Kart 8 Deluxe is rank 1 on the shop's own worldwide-sales list, so
  `fameBandFor` answers «مشهورة» — and it is deliberately NOT one of the four
  games the owner priced by name, so nothing asserted through it is secretly
  testing `namedPriceFor` instead of the ladder. Its rung is 7,000 on Switch 1
  — his own figure «٧ الف سويتش ١» — and 8,000 on Switch 2.
*/
const famousGame = (types: unknown) => ({
  id: "p1",
  title: "Mario Kart 8 Deluxe",
  kind: "game",
  types,
});

/** The proposal for one kind, or undefined. */
const at = (result: ReturnType<typeof repriceTiers>, kind: string) =>
  result.proposals.find((p) => p.kind === kind);

const OWNERS_EXAMPLE = [
  { id: "offline_base", price: 8_000, cost: 2_000 },
  { id: "offline_extras", price: 15_000, cost: 7_000 },
  { id: "online_base", price: 26_000, cost: 16_000 },
  { id: "online_extras", price: 30_000, cost: 18_000 },
];

describe("the owner's worked example, line by line", () => {
  const result = repriceTiers(game(OWNERS_EXAMPLE));
  /* The same four rows on Switch 2, still on the obscure title. */
  const switch2 = repriceTiers({ ...game(OWNERS_EXAMPLE), isSwitch2: true });
  /*
    And the same four rows on the shape his 8,000 was always about: a famous
    Switch 2 title. This is where the example survives untouched, so his own
    numbers are still asserted somewhere rather than only explained away.
  */
  const famousSwitch2 = repriceTiers({ ...famousGame(OWNERS_EXAMPLE), isSwitch2: true });

  /*
    SUPERSEDED, AND BY WHOM.

    Was: 7,000, on «مثلا لعبه زيلدا botw او totk تكون ٨ الف سويتش ٢ ،و ٧
    الف سويتش ١» read as "Switch 1 is 7,000, whatever the game".

    Now: 5,000, on «أغلب الألعاب تكون غير معروفة وغير مشهورة لكن سعرها
    سبعة وثمانية بدل ٥». «Game» is one of those — unknown, Switch 1 — and 7,000
    on it is the precise complaint. His «٧ الف سويتش ١» is not contradicted:
    it was said about Breath of the Wild, a famous game, and a famous Switch 1
    game still gets exactly 7,000 — asserted two tests below.

    The INTENT is unchanged: this row is over-priced for what it is and comes
    down. Only how far it comes down moved.
  */
  it("brings the plain offline account down to 5,000 on a cost of 2,000", () => {
    const tier = at(result, "offline_base");
    expect(tier?.newPrice).toBe(5_000);
    expect(tier?.changed).toBe(true);
  });

  /*
    INVERTED, deliberately.

    This test's whole subject was the generation-only ladder: that being a
    Switch 2 title was by itself enough to hold a game at 8,000. It is not, and
    the owner said why — «أغلب الألعاب تكون غير معروفة ... لكن سعرها
    سبعة وثمانية بدل ٥». An unknown Switch 2 game sits on the obscure
    rung, which on Switch 2 is 7,000. So the test now pins the opposite and
    would fail the moment generation alone could reach 8,000 again.
  */
  it("does NOT hold an unknown game at 8,000 merely for being Switch 2", () => {
    const tier = at(switch2, "offline_base");
    expect(tier?.newPrice).toBe(7_000);
    expect(tier?.changed).toBe(true);
  });

  /* And his 8,000 is exactly where he put it: a famous Switch 2 title. */
  it("holds the very same example at 8,000 when the game is famous AND Switch 2", () => {
    const tier = at(famousSwitch2, "offline_base");
    expect(tier?.newPrice).toBe(8_000);
    expect(tier?.changed).toBe(false);
  });

  /* «٧ الف سويتش ١» — his own figure, on his own kind of game. */
  it("puts a famous SWITCH 1 title on his 7,000, not on the obscure 5,000", () => {
    const tier = at(repriceTiers(famousGame(OWNERS_EXAMPLE)), "offline_base");
    expect(tier?.newPrice).toBe(7_000);
  });

  /*
    Superseded by the row above it, and by nothing else: the add-ons edition is
    the plain price PLUS the increase for the cost gap, and the increase has not
    changed. Gap 5,000 → 7,000, exactly as «فرق ٥٠٠٠» always gave. What moved
    is the 7,000 it used to be added to, which is now 5,000.
  */
  it("brings the add-ons edition to 12,000 — 5,000 plus 7,000 for a 5,000 cost gap", () => {
    const tier = at(result, "offline_extras");
    expect(tier?.newPrice).toBe(12_000);
    expect(tier?.changed).toBe(true);
  });

  /* Same increase, on the Switch 2 obscure rung of 7,000. */
  it("brings it to 14,000 on an unknown Switch 2 title — 7,000 plus the same 7,000", () => {
    const tier = at(switch2, "offline_extras");
    expect(tier?.newPrice).toBe(14_000);
    expect(tier?.changed).toBe(true);
  });

  /* And his own 15,000, still standing, where his 8,000 stands. */
  it("holds the add-ons edition at 15,000 on a famous Switch 2 title — 8,000 plus 7,000", () => {
    const tier = at(famousSwitch2, "offline_extras");
    expect(tier?.newPrice).toBe(15_000);
    expect(tier?.changed).toBe(false);
  });

  it("leaves the plain online account at 26,000 — a profit of exactly 10,000", () => {
    const tier = at(result, "online_base");
    expect(tier?.newPrice).toBe(26_000);
    expect(tier!.newPrice - tier!.cost).toBe(10_000);
  });

  it("leaves the online add-ons at 30,000 — a profit of 12,000, inside the band", () => {
    const tier = at(result, "online_extras");
    expect(tier?.newPrice).toBe(30_000);
    expect(tier!.newPrice - tier!.cost).toBe(12_000);
  });

  it("moves the offline pair and leaves the two online lines exactly alone", () => {
    expect(result.proposals.filter((p) => p.changed).map((p) => p.kind)).toEqual([
      "offline_base",
      "offline_extras",
    ]);
  });

  /*
    INVERTED, same reason as the 8,000 row above.

    "No change on Switch 2" was the old ladder's own summary of itself: the
    example's numbers WERE the Switch 2 answer, for any game. The example is
    now the answer for a FAMOUS Switch 2 game, so that is where nothing moves —
    and on an unknown Switch 2 game the offline pair must move, because
    «سعرها سبعة وثمانية بدل ٥» is a complaint about exactly that price
    standing still. Both halves are asserted so neither can quietly return.
  */
  it("proposes no change at all on a famous Switch 2 title — the example intact", () => {
    expect(famousSwitch2.changed).toBe(false);
  });

  it("does move the offline pair of an unknown Switch 2 title, which is the complaint", () => {
    expect(switch2.changed).toBe(true);
    expect(switch2.proposals.filter((p) => p.changed).map((p) => p.kind)).toEqual([
      "offline_base",
      "offline_extras",
    ]);
  });

  it("passes its own last gate on every tier, on both generations and both fames", () => {
    for (const proposal of result.proposals) {
      expect(tierProblem(proposal, result), `${proposal.kind}`).toBeNull();
    }
    for (const proposal of switch2.proposals) {
      expect(tierProblem(proposal, switch2), `switch2 ${proposal.kind}`).toBeNull();
    }
    for (const proposal of famousSwitch2.proposals) {
      expect(tierProblem(proposal, famousSwitch2), `famous switch2 ${proposal.kind}`).toBeNull();
    }
  });
});

/*
  THE RUNG IS A TARGET IN BOTH DIRECTIONS NOW, NOT A CEILING.

  Two readings used to keep a cheap-band price from ever rising: «بحد اقصى»
  taken as a limit rather than a target, and «اذا كان سعر اللعبه ٥ او ٧
  اتركها» obeyed on every game rather than on the games those figures
  belong to. Between them they froze both halves of what the owner is now
  looking at:

    «أغلب الألعاب تكون غير معروفة وغير مشهورة لكن سعرها سبعة وثمانية
     بدل ٥، بينما هنالك ألعاب قوية ... مشهورة جدا لكن سعرها خمسة آلاف
     بدل ٨ و ٧.»

  A ceiling can lower the first half and can never raise the second, so as long
  as it was one, half that sentence had no answer at all. Both directions are
  asserted here, and this block would fail the moment the ceiling came back.
*/
describe("the cheap band's rung moves a price in BOTH directions", () => {
  it("RAISES a famous game that «اتركها» used to freeze at 5,000", () => {
    const result = repriceTiers(famousGame([{ id: "offline_base", price: 5_000, cost: 1_500 }]));
    expect(at(result, "offline_base")?.newPrice).toBe(7_000);
    expect(at(result, "offline_base")?.changed).toBe(true);
  });

  it("RAISES a famous Switch 2 game all the way to the 8,000 rung", () => {
    const result = repriceTiers({
      ...famousGame([{ id: "offline_base", price: 5_000, cost: 1_500 }]),
      isSwitch2: true,
    });
    expect(at(result, "offline_base")?.newPrice).toBe(8_000);
    expect(at(result, "offline_base")?.changed).toBe(true);
  });

  it("LOWERS an obscure game that the same sentence used to freeze at 7,000", () => {
    const result = repriceTiers(game([{ id: "offline_base", price: 7_000, cost: 1_500 }]));
    expect(at(result, "offline_base")?.newPrice).toBe(5_000);
    expect(at(result, "offline_base")?.changed).toBe(true);
  });

  it("still leaves 5,000 and 7,000 alone on the games whose rung they already are", () => {
    /*
      «اتركها» was NARROWED, not dropped. It still holds a price that is
      already its game's rung — which is what he meant by those two figures
      being fine — and it no longer holds one that is some other game's.
    */
    const obscure = repriceTiers(game([{ id: "offline_base", price: 5_000, cost: 1_500 }]));
    expect(at(obscure, "offline_base")?.changed).toBe(false);
    const famousSwitch1 = repriceTiers(
      famousGame([{ id: "offline_base", price: 7_000, cost: 1_500 }]),
    );
    expect(at(famousSwitch1, "offline_base")?.changed).toBe(false);
  });
});

describe("the add-ons edition is priced from the plain one AFTER it moves", () => {
  it("adds the increase to the NEW base price, not the old", () => {
    /*
      The base is 10,250 — a currency-conversion leftover — and the rules put it
      on its rung, which for this unknown Switch 1 game is 5,000. The add-ons
      edition must then be 5,000 + increase, not 10,250 + increase, or the two
      are inconsistent by exactly the amount the base moved. THAT is what this
      test is about, and it is untouched; only the rung under it moved, from the
      generation-only 7,000 to the 5,000 of «غير معروفة وغير مشهورة».

      The intermediate flooring to 10,000 is gone from the description because
      it is gone from the rule: the rung is an exact thousand, so rounding a
      price down before replacing it could never change the answer.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 10_250, cost: 2_000 },
        { id: "offline_extras", price: 99_000, cost: 4_000 },
      ]),
    );
    expect(at(result, "offline_base")?.newPrice).toBe(5_000);
    // gap 2,000 → increase max(1000, min(4000, 4000)) = 4,000. Unchanged.
    expect(at(result, "offline_extras")?.newPrice).toBe(9_000);
  });

  it("brings an over-priced add-ons edition DOWN, which is what was asked for", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "offline_extras", price: 40_000, cost: 2_300 },
      ]),
    );
    // gap 300 → increase 1,000. «اذا كان ١٧٠٠ عادي و ٢٠٠٠ مع الاضافات ... الزياده ١٠٠٠»
    // His increase is untouched. The base is now on the obscure 5,000 rung
    // rather than the generation-only 7,000, so 6,000 — and the point of the
    // test, that 40,000 comes DOWN, is only made harder.
    expect(at(result, "offline_extras")?.newPrice).toBe(6_000);
    expect(at(result, "offline_extras")?.changed).toBe(true);
  });

  it("never prices the add-ons at or below the plain edition", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "offline_extras", price: 8_500, cost: 2_100 },
      ]),
    );
    const extras = at(result, "offline_extras")!;
    expect(extras.newPrice).toBeGreaterThan(at(result, "offline_base")!.newPrice);
    expect(tierProblem(extras, result)).toBeNull();
  });
});

describe("the online band", () => {
  it("raises a price that earns less than 10,000", () => {
    const result = repriceTiers(game([{ id: "online_base", price: 20_000, cost: 16_000 }]));
    const tier = at(result, "online_base")!;
    expect(tier.newPrice).toBe(26_000);
    expect(tier.newPrice - tier.cost).toBe(10_000);
  });

  it("lowers a price that earns more than 15,000", () => {
    const result = repriceTiers(game([{ id: "online_base", price: 40_000, cost: 16_000 }]));
    const tier = at(result, "online_base")!;
    expect(tier.newPrice).toBe(31_000);
    expect(tier.newPrice - tier.cost).toBe(15_000);
  });

  it("leaves a price the owner already set inside the band exactly where it is", () => {
    /*
      The owner priced this catalogue by hand. A rule that nudged every price
      already inside the band to a computed value would be overwriting
      judgement with arithmetic for no gain.
    */
    for (const price of [27_000, 28_000, 29_000, 30_000, 31_000]) {
      const result = repriceTiers(game([{ id: "online_base", price, cost: 16_000 }]));
      expect(at(result, "online_base")?.newPrice).toBe(price);
      expect(at(result, "online_base")?.changed).toBe(false);
    }
  });

  it("applies the same band to the add-ons edition — «سواء كان عادي او مع الاضافات»", () => {
    const result = repriceTiers(game([{ id: "online_extras", price: 60_000, cost: 18_000 }]));
    const tier = at(result, "online_extras")!;
    expect(tier.newPrice - tier.cost).toBe(15_000);
  });
});

describe("what it refuses to price", () => {
  it("leaves a tier it cannot identify completely alone", () => {
    const result = repriceTiers(
      game([{ id: "t_7", name: "النسخة الكاملة", price: 99_000, cost: 1_000 }]),
    );
    const tier = result.proposals[0]!;
    expect(tier.kind).toBe("unknown");
    expect(tier.newPrice).toBe(99_000);
    expect(tier.changed).toBe(false);
    expect(tier.skipped).toBeTruthy();
  });

  it("refuses the add-ons edition when there is no plain edition to build on", () => {
    const result = repriceTiers(game([{ id: "offline_extras", price: 20_000, cost: 7_000 }]));
    const tier = result.proposals[0]!;
    expect(tier.changed).toBe(false);
    expect(tier.skipped).toContain("لا توجد طبقة أوفلاين عادية");
  });

  it("refuses to price add-ons that the costs say are cheaper than the plain game", () => {
    /*
      A data fault, not a discount. The dangerous wrong answer is "the same
      price as plain", which hands the richer edition over for nothing.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 7_000 },
        { id: "offline_extras", price: 15_000, cost: 2_000 },
      ]),
    );
    const extras = at(result, "offline_extras")!;
    expect(extras.changed).toBe(false);
    expect(extras.skipped).toContain("فرق تكلفة الإضافات غير موجب");
  });

  it("leaves a tier with no cost recorded alone", () => {
    const result = repriceTiers(game([{ id: "online_base", price: 30_000 }]));
    expect(result.proposals[0]?.changed).toBe(false);
    expect(result.proposals[0]?.skipped).toContain("بلا تكلفة");
  });

  it("leaves a product with no tiers at all alone", () => {
    expect(repriceTiers(game(undefined)).proposals).toEqual([]);
    expect(repriceTiers(game(undefined)).changed).toBe(false);
  });

  it("does not price the tiers of something that is not a game", () => {
    const result = repriceTiers({
      id: "hw",
      title: "Switch 2",
      kind: "hardware",
      types: [{ id: "offline_base", price: 8_000, cost: 2_000 }],
    });
    expect(result.proposals[0]?.changed).toBe(false);
    expect(result.proposals[0]?.skipped).toBeTruthy();
  });
});

describe("the gate that stops a run", () => {
  const ok = repriceTiers(game(OWNERS_EXAMPLE));

  it("rejects a price that is not a whole thousand", () => {
    const bad = { ...at(ok, "offline_base")!, newPrice: 8_500 };
    expect(tierProblem(bad, ok)).toContain("ليس مضاعفًا لألف");
  });

  it("rejects a price at or below its own cost", () => {
    const bad = { ...at(ok, "online_base")!, newPrice: 16_000 };
    expect(tierProblem(bad, ok)).toContain("لا يزيد على التكلفة");
  });

  it("rejects an online price outside the 10–15 band", () => {
    expect(tierProblem({ ...at(ok, "online_base")!, newPrice: 25_000 }, ok)).toContain("تحت");
    expect(tierProblem({ ...at(ok, "online_base")!, newPrice: 32_000 }, ok)).toContain("فوق");
  });

  it("rejects an add-ons edition that does not cost more than the plain one", () => {
    /*
      The check needs a plain row that settles ABOVE the add-ons row's own cost
      of 7,000, or the refusal it is testing is already handled by the
      cost check one line earlier and this rule is never reached.

      That used to be "any Switch 2 game", because generation alone put the
      plain row at 8,000. Under «أغلب الألعاب ... غير مشهورة لكن سعرها
      سبعة وثمانية بدل ٥» an unknown Switch 2 game settles at 7,000, so the
      8,000 rung now needs the fame the owner attached to it. Same product, same
      assertion, on the game that rung was always about — the subject here is
      the GATE, not the ladder.
    */
    const s2 = repriceTiers({ ...famousGame(OWNERS_EXAMPLE), isSwitch2: true });
    expect(at(s2, "offline_base")?.newPrice).toBe(8_000);
    const bad = { ...at(s2, "offline_extras")!, newPrice: 8_000 };
    expect(tierProblem(bad, s2)).toContain("لا يزيد على العادي");
  });

  it("says nothing about a tier that was skipped", () => {
    const skipped = { ...at(ok, "offline_base")!, skipped: "بلا تكلفة", newPrice: 3 };
    expect(tierProblem(skipped, ok)).toBeNull();
  });
});

describe("running the rules twice changes nothing the second time", () => {
  it("is idempotent, which is what makes a read-back gate meaningful", () => {
    /*
      The apply step verifies by re-running the rules over what the database
      returned and asserting nothing still wants to move. That check is only
      worth anything if a correct apply really does settle — so it is asserted
      here, on the shapes most likely to oscillate.
    */
    const messy = [
      { id: "offline_base", price: 10_250, cost: 2_000 },
      { id: "offline_extras", price: 40_000, cost: 9_000 },
      { id: "online_base", price: 18_000, cost: 16_000 },
      { id: "online_extras", price: 90_000, cost: 18_000 },
    ];
    const first = repriceTiers(game(messy));
    expect(first.changed).toBe(true);

    const settled = first.proposals.map((p, i) => ({
      ...(messy[i] as Record<string, unknown>),
      price: p.newPrice,
    }));
    const second = repriceTiers(game(settled));
    expect(second.changed).toBe(false);
    for (const proposal of second.proposals) {
      expect(tierProblem(proposal, second), `${proposal.kind}`).toBeNull();
    }
  });
});

/*
  The fault the pre-write gate caught on the live catalogue, before a byte was
  written. Kept as a test so it cannot come back.
*/
describe("every add-ons price is a whole thousand", () => {
  it("rounds down a price the cost gap would otherwise land on a five hundred", () => {
    /*
      The supplier's costs are quarter-thousands — 1,250, 2,750, 18,500 — so a
      real gap is very often 1,250, and `2 × gap` then gives 2,500. Mario Kart
      8 Deluxe was proposed at 14,500 on exactly this, and the gate refused
      the whole run.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 12_000, cost: 1_500 },
        { id: "offline_extras", price: 15_000, cost: 2_750 },
      ]),
    );
    const extras = at(result, "offline_extras")!;
    expect(extras.newPrice % 1_000).toBe(0);
    // Base 12,000 → cut to the obscure 5,000 rung (it was the generation-only
    // 7,000); gap 1,250 → increase 2,500 → 7,500 → 7,000. The five hundred the
    // test exists for is still there and is still rounded away.
    expect(extras.newPrice).toBe(7_000);
    expect(tierProblem(extras, result)).toBeNull();
  });

  it("is a whole thousand for every quarter-thousand gap there is", () => {
    for (const extrasCost of [1_250, 1_500, 1_750, 2_000, 2_250, 2_500, 2_750, 6_500, 9_250]) {
      const result = repriceTiers(
        game([
          { id: "offline_base", price: 8_000, cost: 1_000 },
          { id: "offline_extras", price: 30_000, cost: extrasCost },
        ]),
      );
      const extras = at(result, "offline_extras")!;
      expect(extras.newPrice % 1_000, `cost ${extrasCost} → ${extras.newPrice}`).toBe(0);
      expect(tierProblem(extras, result), `cost ${extrasCost}`).toBeNull();
    }
  });

  it("never rounds the add-ons back down to the plain edition's price", () => {
    /*
      The one way flooring could do harm. It cannot: the increase is at least
      1,000 and a plain price is itself a whole thousand, so what survives the
      rounding is at least a thousand above it.
    */
    for (const extrasCost of [1_050, 1_100, 1_250, 1_333]) {
      const result = repriceTiers(
        game([
          { id: "offline_base", price: 8_000, cost: 1_000 },
          { id: "offline_extras", price: 9_500, cost: extrasCost },
        ]),
      );
      const base = at(result, "offline_base")!;
      const extras = at(result, "offline_extras")!;
      expect(extras.newPrice, `cost ${extrasCost}`).toBeGreaterThanOrEqual(base.newPrice + 1_000);
    }
  });

  it("leaves all six of the owner's own anchors exactly where they were", () => {
    /*
      The rounding must not move a single number the owner has quoted. It does
      not: every gap they named is a whole thousand, so the sum already landed
      on one.
    */
    const anchors: Array<[number, number]> = [
      [300, 1_000],
      [1_000, 2_000],
      [2_000, 4_000],
      [3_000, 5_000],
      [5_000, 7_000],
      [10_000, 12_000],
    ];
    for (const [gap, increase] of anchors) {
      const result = repriceTiers(
        game([
          { id: "offline_base", price: 8_000, cost: 2_000 },
          { id: "offline_extras", price: 1, cost: 2_000 + gap },
        ]),
      );
      /*
        Every INCREASE above is exactly the figure the owner gave, and not one
        of them moved — which is the whole subject of this test. What moved is
        the base they are added to: «Game» is unknown and Switch 1, so its rung
        is 5,000 under «أغلب الألعاب ... غير مشهورة لكن سعرها سبعة
        وثمانية بدل ٥», where it used to be the generation-only 7,000.
      */
      expect(at(result, "offline_extras")?.newPrice, `gap ${gap}`).toBe(5_000 + increase);
    }
  });
});

/*
  Two faults an adversarial reviewer found in these rules, both reproduced
  before they were believed, both mine. They are the reason this file exists.
*/
describe("things that are not games keep their prices", () => {
  it("does not reprice a CONSOLE's online tier", () => {
    /*
      The worst of the two. `skipReason` — which refuses hardware, gift cards
      and anything over 100,000 — lives inside `repriceOne`, and only the
      plain offline branch called it. The online branch went straight to the
      margin band, so a Nintendo Switch 2 at 300,000 on a cost of 250,000 was
      proposed at 265,000: a thirty-five thousand dinar cut on a console, from
      a module documented as not pricing hardware.
    */
    const result = repriceTiers({
      id: "hw1",
      title: "Nintendo Switch 2",
      kind: "hardware",
      types: [{ id: "online_base", price: 300_000, cost: 250_000 }],
    });
    expect(result.changed).toBe(false);
    expect(result.proposals[0]?.newPrice).toBe(300_000);
    expect(result.proposals[0]?.skipped).toBeTruthy();
  });

  it("does not reprice a gift card, which is sold near its face value", () => {
    const result = repriceTiers({
      id: "gc1",
      title: "بطاقة شحن نينتندو 50 دولار",
      kind: "game",
      types: [
        { id: "offline_base", price: 70_000, cost: 65_000 },
        { id: "offline_extras", price: 75_000, cost: 68_000 },
        { id: "online_base", price: 80_000, cost: 70_000 },
      ],
    });
    expect(result.changed).toBe(false);
    for (const proposal of result.proposals) {
      expect(proposal.newPrice).toBe(proposal.oldPrice);
      expect(proposal.skipped).toBeTruthy();
    }
  });

  it("holds EVERY tier of an out-of-scope product, not just the offline one", () => {
    // The shape of the bug: three of four tiers escaped the check.
    const result = repriceTiers({
      id: "hw2",
      title: "Console bundle",
      kind: "hardware",
      types: [
        { id: "offline_base", price: 200_000, cost: 150_000 },
        { id: "offline_extras", price: 220_000, cost: 160_000 },
        { id: "online_base", price: 240_000, cost: 180_000 },
        { id: "online_extras", price: 260_000, cost: 190_000 },
      ],
    });
    expect(result.proposals).toHaveLength(4);
    expect(result.proposals.every((p) => p.skipped && !p.changed)).toBe(true);
  });
});

describe("each add-ons row is priced from its OWN cost gap", () => {
  it("does not price the second add-ons row from the first one's gap", () => {
    /*
      `tierOf` returns the FIRST match, and the gap was computed once outside
      the loop. A game with a small add-on at cost 2,300 and a full edition at
      cost 12,000 priced BOTH from the first gap of 300 — so the full edition
      came out at 9,000 against a cost of 12,000. Three thousand dinars lost
      on every sale.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "offline_extras", name: "اوفلاين مع إضافة صغيرة", price: 9_000, cost: 2_300 },
        {
          id: "offline_extras_2",
          name: "اوفلاين مع الاضافات الكاملة",
          price: 20_000,
          cost: 12_000,
        },
      ]),
    );

    const rows = result.proposals.filter((p) => p.kind === "offline_extras");
    expect(rows).toHaveLength(2);

    // Gap 300 → increase 1,000 → 6,000, on the base's obscure 5,000 rung.
    expect(rows[0]!.newPrice).toBe(6_000);
    // Gap 10,000 → increase 12,000 → 17,000. NOT 6,000 — which is the whole
    // point of the test, and the gap between the two answers only grew.
    expect(rows[1]!.newPrice).toBe(17_000);

    // And neither is ever priced below its own cost.
    for (const row of rows) {
      expect(row.newPrice, `${row.name}`).toBeGreaterThan(row.cost);
      expect(tierProblem(row, result), `${row.name}`).toBeNull();
    }
  });
});

describe("an online add-ons edition is never cheaper than the plain one", () => {
  it("is refused by the gate, the same as the offline pair", () => {
    /*
      The online tiers are priced by a band on the margin, and the band knows
      nothing about the other tier — so when the two costs are close the
      add-ons edition can land at or under the plain one. It was checked for
      the offline pair only.
    */
    const result = repriceTiers(
      game([
        { id: "online_base", price: 30_000, cost: 16_000 },
        { id: "online_extras", price: 30_000, cost: 16_000 },
      ]),
    );
    const extras = result.proposals.find((p) => p.kind === "online_extras")!;
    const bad = { ...extras, newPrice: 30_000 };
    expect(tierProblem(bad, result)).toContain("لا يزيد على العادي");
  });
});

/*
  «السعر في الsuper smash bros ultimate كان للاونلاين ، لكن التكلفه هي
  للاوفلاين» — the owner, on the largest move the first dry run proposed.
*/
describe("an online tier carrying the offline account's cost", () => {
  it("is held, not priced — the real Super Smash Bros. Ultimate numbers", () => {
    /*
      Its online tier records a cost of 1,750. That is an offline cost in the
      online tier's field. The PRICE of 32,000 is correct.

      Left to the band, 1,750 + a 10,000 floor gives 16,000 and every guard
      passes, because a 10,000 margin over 1,750 is a perfectly legal answer
      to the wrong question. A correct price halved on the strength of a wrong
      number is the exact failure «الدقه اهم شي» is about.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 12_000, cost: 2_000 },
        { id: "online_base", price: 32_000, cost: 1_750 },
        { id: "online_extras", price: 45_000, cost: 3_000 },
      ]),
    );

    const online = at(result, "online_base")!;
    expect(online.newPrice).toBe(32_000);
    expect(online.changed).toBe(false);
    expect(online.skipped).toContain("تكلفة الأوفلاين");

    // And the add-ons tier, whose 3,000 is also under the offline cost… no:
    // 3,000 IS above 2,000, so it is priced. The rule is the ordering, not a
    // guess at the amount, and it says nothing about a cost it cannot fault.
    expect(at(result, "online_extras")?.skipped).toBeNull();
  });

  it("holds an online cost EQUAL to the offline one", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "online_base", price: 30_000, cost: 2_000 },
      ]),
    );
    expect(at(result, "online_base")?.changed).toBe(false);
    expect(at(result, "online_base")?.skipped).toBeTruthy();
  });

  it("prices an online tier whose cost is properly above the offline one", () => {
    // The ordinary case must not be caught by the guard.
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "online_base", price: 20_000, cost: 16_000 },
      ]),
    );
    expect(at(result, "online_base")?.newPrice).toBe(26_000);
    expect(at(result, "online_base")?.skipped).toBeNull();
  });

  it("still prices an online tier when the product has no offline tier to compare with", () => {
    /*
      Nothing to check against is not the same as a fault. The guard is an
      ordering test between two real numbers; with only one of them it has
      nothing to say and must not invent a threshold.
    */
    const result = repriceTiers(game([{ id: "online_base", price: 20_000, cost: 16_000 }]));
    expect(at(result, "online_base")?.newPrice).toBe(26_000);
    expect(at(result, "online_base")?.skipped).toBeNull();
  });

  it("leaves the worked example's ONLINE rows untouched, as it always did", () => {
    // online 26,000 on cost 16,000, offline 8,000 on cost 2,000 — 16,000 > 2,000.
    // «قاعده الاونلاين تبقى كما هي» — the new offline ladder does not reach here.
    const result = repriceTiers(game(OWNERS_EXAMPLE));
    expect(at(result, "online_base")?.skipped).toBeNull();
    expect(at(result, "online_base")?.changed).toBe(false);
    expect(at(result, "online_extras")?.changed).toBe(false);
  });
});

/*
  Everything below was written from an adversarial review that reproduced each
  fault against the real module before it was believed. Each test names the
  money the fault would have moved.
*/

describe("a device is a device on all four rows, not just the offline one", () => {
  /*
    `skipReason`'s 100,000 backstop used to reach `offline_base` alone, so one
    product contradicted itself: the offline row held as «جهاز لا لعبة» while
    the online row was cut from 300,000 to 265,000 — a console, thirty-five
    thousand dinars off, with `tierProblem` clean because a 15,000 margin is
    inside the online band.
  */
  const console_ = repriceTiers(
    game([
      { id: "offline_base", name: "اوفلاين", price: 300_000, cost: 250_000 },
      { id: "online_base", name: "اونلاين", price: 300_000, cost: 250_000 },
    ]),
  );

  it("holds both rows, and for the same reason", () => {
    expect(at(console_, "offline_base")?.skipped).toContain("جهاز لا لعبة");
    expect(at(console_, "online_base")?.skipped).toContain("جهاز لا لعبة");
  });

  it("moves no price at all", () => {
    expect(console_.changed).toBe(false);
    expect(at(console_, "online_base")?.newPrice).toBe(300_000);
  });

  it("holds the add-ons rows of a device too", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", name: "اوفلاين", price: 300_000, cost: 250_000 },
        { id: "offline_extras", name: "اوفلاين مع الاضافات", price: 340_000, cost: 260_000 },
        { id: "online_extras", name: "اونلاين مع الاضافات", price: 380_000, cost: 280_000 },
      ]),
    );
    expect(result.changed).toBe(false);
    for (const proposal of result.proposals) expect(proposal.skipped).toBeTruthy();
  });
});

describe("the add-ons row is never built on a base the rules declined to price", () => {
  /*
    The base is out of scope but its own `tierSkip` says nothing, so the
    add-ons row used to be priced on top of the base's UNTOUCHED price — and
    `tierProblem`'s "add-ons must beat plain" check reads `base.skipped`, so it
    was disabled in exactly that case. The rule and its gate looked away
    together.
  */
  it("holds the add-ons when the plain offline row is out of scope", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", name: "اوفلاين", price: 150_000, cost: 120_000 },
        { id: "offline_extras", name: "اوفلاين مع الاضافات", price: 160_000, cost: 125_000 },
      ]),
    );
    expect(at(result, "offline_extras")?.skipped).toBeTruthy();
    expect(at(result, "offline_extras")?.newPrice).toBe(160_000);
  });
});

describe("a cost is read as it was written", () => {
  it("keeps a negative sign that arrived as a string", () => {
    const result = repriceTiers(
      game([{ id: "online_base", name: "اونلاين", price: "26,000", cost: "-5000" }]),
    );
    // Stripped, "-5000" used to become 5,000 and walk past the cost <= 0 guard.
    expect(at(result, "online_base")?.cost).toBe(-5_000);
    expect(at(result, "online_base")?.skipped).toBe("بلا تكلفة مسجّلة");
  });

  it("reads Arabic-Indic digits as the number they are", () => {
    const result = repriceTiers(
      game([{ id: "offline_base", name: "اوفلاين", price: "٨٥٠٠", cost: "٢٠٠٠" }]),
    );
    const tier = at(result, "offline_base");
    expect(tier?.cost).toBe(2_000);
    expect(tier?.oldPrice).toBe(8_500);
    /*
      8,500 → the game's rung, which for an unknown Switch 1 title is 5,000
      — «أغلب الألعاب ... غير مشهورة لكن سعرها سبعة وثمانية بدل ٥».
      There is no longer an intermediate floor to 8,000, because the rung is an
      exact thousand and rounding before replacing could never change it. What
      this test is actually about — that «٨٥٠٠» was READ as 8,500 and «٢٠٠٠»
      as 2,000 — is asserted above and untouched.
    */
    expect(tier?.newPrice).toBe(5_000);
  });

  it("does not read a dash inside a number as a minus sign", () => {
    const result = repriceTiers(
      game([{ id: "offline_base", name: "اوفلاين", price: "8-500", cost: "2000" }]),
    );
    expect(at(result, "offline_base")?.cost).toBe(2_000);
  });
});

describe("a plain account that merely mentions something is still plain", () => {
  const plain = (name: string) =>
    at(
      repriceTiers(game([{ id: "t1", name, price: 8_500, cost: 2_000 }])),
      "offline_base",
    );

  it("«حساب اوفلاين مع ضمان» is the plain account, not the add-ons edition", () => {
    expect(plain("حساب اوفلاين مع ضمان")).toBeDefined();
  });

  it("«حساب اوفلاين معتمد» is the plain account — «مع» inside a word is not «with»", () => {
    expect(plain("حساب اوفلاين معتمد")).toBeDefined();
  });

  it("«اوفلاين بدون اضافات» is the plain account, because it says so", () => {
    expect(plain("اوفلاين بدون اضافات")).toBeDefined();
  });

  it("«اوفلاين لا يشمل الإضافات» is the plain account", () => {
    expect(plain("اوفلاين لا يشمل الإضافات")).toBeDefined();
  });

  it("but «اوفلاين مع الاضافات» is still the add-ons edition", () => {
    const result = repriceTiers(
      game([
        { id: "t1", name: "اوفلاين", price: 8_000, cost: 2_000 },
        { id: "t2", name: "اوفلاين مع الاضافات", price: 15_000, cost: 7_000 },
      ]),
    );
    /*
      The subject here is the CLASSIFIER — that this row is recognised as the
      add-ons edition at all. Its price follows from that, and it is 5,000 (the
      obscure Switch 1 rung, under «أغلب الألعاب ... غير مشهورة لكن سعرها
      سبعة وثمانية بدل ٥») plus his unchanged 7,000 for a 5,000 cost gap,
      where it used to be the generation-only 7,000 plus the same 7,000.
    */
    expect(at(result, "offline_extras")?.newPrice).toBe(12_000);
  });

  it("and the singular «مع الاضافة» is too", () => {
    const result = repriceTiers(
      game([
        { id: "t1", name: "اوفلاين", price: 8_000, cost: 2_000 },
        { id: "t2", name: "اوفلاين مع الاضافة", price: 15_000, cost: 7_000 },
      ]),
    );
    expect(at(result, "offline_extras")).toBeDefined();
  });

  it("«مع الاضافات وبدون ضمان» is still the add-ons edition — the negator must touch the word", () => {
    const result = repriceTiers(
      game([
        { id: "t1", name: "اوفلاين", price: 8_000, cost: 2_000 },
        { id: "t2", name: "اوفلاين مع الاضافات وبدون ضمان", price: 15_000, cost: 7_000 },
      ]),
    );
    expect(at(result, "offline_extras")).toBeDefined();
  });
});

describe("the account is recognised however it is spelled", () => {
  const kindOf = (name: string) =>
    repriceTiers(game([{ id: "t1", name, price: 26_000, cost: 16_000 }])).proposals[0]?.kind;

  it("«أون لاين» — hamza and a space together — is the online account", () => {
    expect(kindOf("أون لاين")).toBe("online_base");
  });

  it("«أوف لاين» is the offline account", () => {
    expect(kindOf("أوف لاين")).toBe("offline_base");
  });

  it("the spellings already known still work", () => {
    for (const name of ["اونلاين", "أونلاين", "اون لاين", "online", "Online Account"]) {
      expect(kindOf(name)).toBe("online_base");
    }
    for (const name of ["اوفلاين", "أوفلاين", "اوف لاين", "offline"]) {
      expect(kindOf(name)).toBe("offline_base");
    }
  });
});

describe("a deluxe edition is not the ordinary offline account", () => {
  /*
    The owner gave the cheap band's ceiling to «الحساب الاوفلاين العادي» — the
    ORDINARY offline account — and to nothing else. The admin's own preset
    writes «النسخة الفاخرة Ultimate (خاص بالأوفلاين)», which names the offline
    account and carried no word this file called an add-on, so it was handed
    the plain account's rules and an Ultimate edition at 30,000 came out at
    12,000. `resolveTypeStandardDescription` has called that name the add-ons
    edition all along.
  */
  const ultimate = { id: "t_ult", name: "النسخة الفاخرة Ultimate (خاص بالأوفلاين)" };

  it("is not the plain offline account", () => {
    const result = repriceTiers(game([{ ...ultimate, price: 30_000, cost: 1_800 }]));
    expect(at(result, "offline_base")).toBeUndefined();
  });

  it("is not cut to the ordinary account's ceiling", () => {
    const result = repriceTiers(game([{ ...ultimate, price: 30_000, cost: 1_800 }]));
    expect(result.proposals[0]?.newPrice).toBe(30_000);
    expect(result.changed).toBe(false);
  });

  it("is priced from the cost gap when a plain offline row exists to build on", () => {
    const result = repriceTiers(
      game([
        { id: "t_std", name: "القياسية Standard (خاص بالأوفلاين)", price: 8_000, cost: 2_000 },
        { ...ultimate, price: 30_000, cost: 7_000 },
      ]),
    );
    /*
      The subject here is that «النسخة الفاخرة Ultimate» is the add-ons
      edition and is priced from the cost gap rather than handed the plain
      account's rules. Both numbers below follow from the rung the plain row
      lands on, and that rung moved from the generation-only 7,000 to the 5,000
      of «أغلب الألعاب ... غير مشهورة لكن سعرها سبعة وثمانية بدل ٥».
    */
    expect(at(result, "offline_base")?.newPrice).toBe(5_000);
    // 5,000 + 7,000 for a 5,000 cost gap — his increase, on the fame rung.
    expect(at(result, "offline_extras")?.newPrice).toBe(12_000);
  });

  it("reads the preset's description when the name alone is ambiguous", () => {
    const result = repriceTiers(
      game([
        { id: "a", name: "اوفلاين", price: 8_000, cost: 2_000 },
        { id: "b", name: "اوفلاين", description: "اللعبة مع الإضافات", price: 15_000, cost: 7_000 },
      ]),
    );
    /*
      The subject here is the CLASSIFIER — that this row is recognised as the
      add-ons edition at all. Its price follows from that, and it is 5,000 (the
      obscure Switch 1 rung, under «أغلب الألعاب ... غير مشهورة لكن سعرها
      سبعة وثمانية بدل ٥») plus his unchanged 7,000 for a 5,000 cost gap,
      where it used to be the generation-only 7,000 plus the same 7,000.
    */
    expect(at(result, "offline_extras")?.newPrice).toBe(12_000);
  });

  it("still says «بدون» means without, whatever the edition words say", () => {
    const result = repriceTiers(
      game([{ id: "t", name: "اوفلاين قياسي بدون الإضافات", price: 8_500, cost: 2_000 }]),
    );
    /*
      The subject is «بدون»: this row is the PLAIN account, so it is priced by
      the plain account's rule — the rung. The rung itself moved to 5,000 for an
      unknown Switch 1 game under «أغلب الألعاب ... غير مشهورة لكن سعرها
      سبعة وثمانية بدل ٥», and a 7,000 here would now be the add-ons
      edition's own answer — so this assertion tells the two apart more sharply
      than it did before, not less.
    */
    expect(at(result, "offline_base")?.newPrice).toBe(5_000);
  });
});
