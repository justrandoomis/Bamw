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
 * The rest of the file is about the cases the example does not cover, which
 * is where money is actually lost: a tier that cannot be identified, an
 * add-ons edition with no plain edition to build on, costs that say the
 * add-ons are cheaper than the plain game, and an online price that is
 * already where the owner put it.
 */
import { describe, expect, it } from "vitest";

import { repriceTiers, tierProblem } from "./tierRepricing";

const game = (types: unknown) => ({ id: "p1", title: "Game", kind: "game", types });

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

  it("leaves the plain offline account at 8,000 on a cost of 2,000", () => {
    const tier = at(result, "offline_base");
    expect(tier?.newPrice).toBe(8_000);
    expect(tier?.changed).toBe(false);
  });

  it("holds the add-ons edition at 15,000 — 8,000 plus 7,000 for a 5,000 cost gap", () => {
    const tier = at(result, "offline_extras");
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

  it("proposes no change at all to the example, which is the point of it", () => {
    expect(result.changed).toBe(false);
  });

  it("passes its own last gate on every tier", () => {
    for (const proposal of result.proposals) {
      expect(tierProblem(proposal, result), `${proposal.kind}`).toBeNull();
    }
  });
});

describe("the add-ons edition is priced from the plain one AFTER it moves", () => {
  it("adds the increase to the NEW base price, not the old", () => {
    /*
      The base is 10,250 — a currency-conversion leftover — and the rules floor
      it to 10,000. The add-ons edition must then be 10,000 + increase, not
      10,250 + increase, or the two are inconsistent by exactly the amount the
      base moved.
    */
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 10_250, cost: 2_000 },
        { id: "offline_extras", price: 99_000, cost: 4_000 },
      ]),
    );
    expect(at(result, "offline_base")?.newPrice).toBe(10_000);
    // gap 2,000 → increase max(1000, min(4000, 4000)) = 4,000.
    expect(at(result, "offline_extras")?.newPrice).toBe(14_000);
  });

  it("brings an over-priced add-ons edition DOWN, which is what was asked for", () => {
    const result = repriceTiers(
      game([
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "offline_extras", price: 40_000, cost: 2_300 },
      ]),
    );
    // gap 300 → increase 1,000. «اذا كان ١٧٠٠ عادي و ٢٠٠٠ مع الاضافات ... الزياده ١٠٠٠»
    expect(at(result, "offline_extras")?.newPrice).toBe(9_000);
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
    const bad = { ...at(ok, "offline_extras")!, newPrice: 8_000 };
    expect(tierProblem(bad, ok)).toContain("لا يزيد على العادي");
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
