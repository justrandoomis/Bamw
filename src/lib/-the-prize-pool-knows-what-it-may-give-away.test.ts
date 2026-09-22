import { describe, expect, it } from "vitest";

import {
  DEFAULT_POPULARITY,
  asPopularity,
  buildPool,
  isPrizeEligible,
  pickFromBucket,
  populationOf,
  prizePriceOf,
  squareImageOf,
  type GameFlags,
} from "./roulette-pool.server";
import { PRIZE_BUCKETS } from "./roulette-odds";

const game = (over: Record<string, unknown> = {}) => ({
  id: "prd_a",
  title: "A Game",
  price: 3_000,
  kind: "game",
  ...over,
});

const noFlags = new Map<string, GameFlags>();

describe("what may be given away", () => {
  it("takes an ordinary priced game", () => {
    expect(isPrizeEligible(game())).toEqual({ ok: true });
  });

  it("refuses a hidden product, however it is marked hidden", () => {
    // Hidden is the owner's decision not to publish. A prize would publish it.
    expect(isPrizeEligible(game({ hidden: true }))).toMatchObject({ reason: "hidden" });
    expect(isPrizeEligible(game({ isHidden: true }))).toMatchObject({ reason: "hidden" });
    expect(isPrizeEligible(game({ status: "hidden" }))).toMatchObject({ reason: "hidden" });
  });

  it("refuses hardware, accessories and gift cards", () => {
    for (const kind of ["hardware", "device", "accessory", "amiibo", "collectible", "gift_card", "used"]) {
      expect(isPrizeEligible(game({ kind })), kind).toMatchObject({ reason: "not_a_game" });
    }
    expect(isPrizeEligible(game({ kind: "game", schemaId: "gift_card" }))).toMatchObject({
      reason: "not_a_game",
    });
  });

  it("refuses a bare listing, which has no account behind it to deliver", () => {
    expect(isPrizeEligible(game({ isBareListing: true }))).toMatchObject({
      reason: "bare_listing",
    });
  });

  it("refuses a game the admin took out of the pool, without it being deleted", () => {
    // «استبعاد لعبة من Prize Pool بدون حذفها من المتجر».
    const flags: GameFlags = { popularity: "high", excluded: true };
    expect(isPrizeEligible(game(), flags)).toMatchObject({ reason: "excluded" });
  });
});

describe("the picture on a prize card", () => {
  it("is the square one, and only the square one", () => {
    expect(squareImageOf(game({ nintendoCardImage: "/api/img/sq.png" }))).toBe("/api/img/sq.png");
    expect(squareImageOf(game({ nintendoMedia: { nintendoCardImage: "/api/img/n.png" } }))).toBe(
      "/api/img/n.png",
    );
  });

  it("is null rather than another picture of the same game", () => {
    /*
      «لا تستخدم Hero portrait لمجرد أن الصورة المربعة ناقصة». A portrait in a
      square slot is a broken card; a different game's art is a lie. Null is
      the card's instruction to print the name, which is the only honest
      fallback.
    */
    const withHeroOnly = game({
      image: "/api/img/hero.png",
      coverImage: "https://assets.nintendo.com/hero.jpg",
      heroImage: "/api/img/hero2.png",
    });
    expect(squareImageOf(withHeroOnly)).toBeNull();
  });

  it("ignores an empty string, which is not a picture", () => {
    expect(squareImageOf(game({ nintendoCardImage: "   " }))).toBeNull();
  });
});

describe("the price a prize is worth", () => {
  it("is the account price when there is one, and the base price otherwise", () => {
    expect(prizePriceOf(game({ accountPrice: 9_000, price: 7_000 }))).toBe(9_000);
    expect(prizePriceOf(game({ price: 7_000 }))).toBe(7_000);
    expect(prizePriceOf(game({ price: "12500" }))).toBe(12_500);
  });

  it("is zero when there is no usable price, so the pool can drop it", () => {
    expect(prizePriceOf(game({ price: 0 }))).toBe(0);
    expect(prizePriceOf(game({ price: "غير محدد" }))).toBe(0);
  });
});

describe("an unclassified game defaults safely", () => {
  it("is «غير مشهورة», which is the cheap side of the odds", () => {
    /*
      The default has to be wrong in the direction that costs the shop least.
      A thousand unclassified games defaulting to «مشهورة» would put the best
      titles on the rarest odds — meaning the roulette would give them away.
    */
    expect(DEFAULT_POPULARITY).toBe("low");
    expect(asPopularity(undefined)).toBe("low");
    expect(asPopularity("")).toBe("low");
    expect(asPopularity("famous")).toBe("low");
    expect(asPopularity("HIGH")).toBe("high");
    expect(asPopularity(" medium ")).toBe("medium");
  });

  it("never breaks the pool for want of a tier", () => {
    // «يجب ألا يؤدي عدم وجود popularity إلى حذف اللعبة أو كسر Prize Pool».
    const { games } = buildPool([game({ id: "prd_untiered" })], noFlags);
    expect(games).toHaveLength(1);
    expect(games[0].popularity).toBe("low");
    expect(games[0].bucket).toBe("low_cheap");
  });
});

describe("the pool, built", () => {
  const catalogue = [
    game({ id: "cheap_low", price: 3_000 }),
    game({ id: "cheap_high", price: 4_000 }),
    game({ id: "dear_high", price: 45_000 }),
    game({ id: "dear_low", price: 12_000 }),
    game({ id: "hidden", price: 3_000, hidden: true }),
    game({ id: "console", price: 400_000, kind: "hardware" }),
    game({ id: "priceless", price: 0 }),
    game({ id: "banned", price: 9_000 }),
  ];
  const flags = new Map<string, GameFlags>([
    ["cheap_high", { popularity: "high", excluded: false }],
    ["dear_high", { popularity: "high", excluded: false }],
    ["banned", { popularity: "medium", excluded: true }],
  ]);

  it("keeps what may be given away and says why it dropped the rest", () => {
    const { games, skipped } = buildPool(catalogue, flags);
    expect(games.map((g) => g.id).sort()).toEqual(
      ["cheap_high", "cheap_low", "dear_high", "dear_low"].sort(),
    );
    expect(skipped).toMatchObject({
      hidden: 1,
      not_a_game: 1,
      no_price: 1,
      excluded: 1,
    });
  });

  it("puts each game in the bucket its two axes name", () => {
    const { games } = buildPool(catalogue, flags);
    const bucketOfId = Object.fromEntries(games.map((g) => [g.id, g.bucket]));
    expect(bucketOfId["cheap_low"]).toBe("low_cheap");
    expect(bucketOfId["cheap_high"]).toBe("high_cheap");
    expect(bucketOfId["dear_high"]).toBe("high_premium");
    expect(bucketOfId["dear_low"]).toBe("low_premium");
  });

  it("re-buckets when the admin moves the price boundary", () => {
    const { games } = buildPool(catalogue, flags, 20_000);
    const bucketOfId = Object.fromEntries(games.map((g) => [g.id, g.bucket]));
    // 12,000 is now on the cheap side of a 20,000 line.
    expect(bucketOfId["dear_low"]).toBe("low_cheap");
    expect(bucketOfId["dear_high"]).toBe("high_premium");
  });

  it("counts a population for every bucket, including the empty ones", () => {
    const population = populationOf(buildPool(catalogue, flags).games);
    for (const key of PRIZE_BUCKETS) expect(population).toHaveProperty(key);
    expect(population.low_cheap).toBe(1);
    expect(population.high_cheap).toBe(1);
    expect(population.high_premium).toBe(1);
    expect(population.low_premium).toBe(1);
    expect(population.medium_cheap).toBe(0);
    expect(population.medium_premium).toBe(0);
  });
});

describe("choosing a game once the bucket has won", () => {
  const games = buildPool(
    [
      game({ id: "a", price: 1_000 }),
      game({ id: "b", price: 1_000 }),
      game({ id: "c", price: 1_000 }),
      game({ id: "d", price: 40_000 }),
    ],
    noFlags,
  ).games;

  it("only ever returns a game from the bucket that won", () => {
    for (let i = 0; i < 50; i += 1) {
      const picked = pickFromBucket(games, "low_cheap", () => i / 50);
      expect(picked?.bucket).toBe("low_cheap");
    }
  });

  it("spreads evenly inside the bucket, because any other rule is a second weighting", () => {
    const seen = new Map<string, number>();
    const steps = 3_000;
    for (let i = 0; i < steps; i += 1) {
      const picked = pickFromBucket(games, "low_cheap", () => i / steps);
      seen.set(picked!.id, (seen.get(picked!.id) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual(["a", "b", "c"]);
    for (const count of seen.values()) expect(count / steps).toBeCloseTo(1 / 3, 2);
  });

  it("returns nothing for a bucket with nothing in it, rather than something else", () => {
    expect(pickFromBucket(games, "high_premium", () => 0.5)).toBeNull();
    expect(pickFromBucket(games, "medium_cheap", () => 0.5)).toBeNull();
  });

  it("stays inside the bucket for a broken draw", () => {
    for (const broken of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
      const picked = pickFromBucket(games, "low_cheap", () => broken);
      expect(picked?.bucket).toBe("low_cheap");
    }
  });

  it("carries the square image, or null, on the game it returns", () => {
    const withImage = buildPool(
      [game({ id: "img", price: 1_000, nintendoCardImage: "/api/img/x.png" })],
      noFlags,
    ).games;
    expect(pickFromBucket(withImage, "low_cheap", () => 0)?.squareImage).toBe("/api/img/x.png");
    expect(pickFromBucket(games, "low_cheap", () => 0)?.squareImage).toBeNull();
  });
});
