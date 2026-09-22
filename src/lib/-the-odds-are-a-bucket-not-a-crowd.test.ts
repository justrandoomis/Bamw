import { describe, expect, it } from "vitest";

import {
  BASE_ODDS,
  BUCKET_LABELS,
  DEFAULT_PRICE_BOUNDARY,
  MAX_TICKETS_PER_SPIN,
  MIN_TICKETS_PER_SPIN,
  PRIZE_BUCKETS,
  bandOfPrice,
  bucketOf,
  losePercentFor,
  oddsForTickets,
  oddsRows,
  pickBucket,
  resolveOdds,
  validTicketCount,
  type BucketKey,
  type BucketPopulation,
  type PrizeBucketKey,
} from "./roulette-odds";

/** Every ticket count the roulette accepts. */
const ALL_TICKETS = Array.from(
  { length: MAX_TICKETS_PER_SPIN - MIN_TICKETS_PER_SPIN + 1 },
  (_, i) => MIN_TICKETS_PER_SPIN + i,
);

const sum = (odds: Record<BucketKey, number>) =>
  Object.values(odds).reduce((total, value) => total + value, 0);

const full: BucketPopulation = {
  low_cheap: 400,
  medium_cheap: 90,
  high_cheap: 20,
  low_premium: 300,
  medium_premium: 60,
  high_premium: 8,
};

describe("one ticket is exactly what the owner wrote", () => {
  /*
    «20% لعبة غير مشهورة بسعر حتى 5,000 · 4% شبه مشهورة · 0.5% مشهورة ·
     0.4% غير مشهورة 6,000 فما فوق · 0.09% شبه مشهورة · 0.01% مشهورة ·
     المجموع 100%.»

    Read back off the engine rather than off the constant, so a curve that
    happens to pass near these numbers cannot pass for one that starts on them.
  */
  const odds = oddsForTickets(1);

  it("loses three quarters of the time", () => {
    expect(odds.lose).toBeCloseTo(75, 10);
  });

  it("pays each of the six exactly its stated percent", () => {
    expect(odds.low_cheap).toBeCloseTo(20, 10);
    expect(odds.medium_cheap).toBeCloseTo(4, 10);
    expect(odds.high_cheap).toBeCloseTo(0.5, 10);
    expect(odds.low_premium).toBeCloseTo(0.4, 10);
    expect(odds.medium_premium).toBeCloseTo(0.09, 10);
    expect(odds.high_premium).toBeCloseTo(0.01, 10);
  });

  it("adds to one hundred", () => {
    expect(sum(odds)).toBeCloseTo(100, 10);
  });
});

describe("the three points the owner fixed on the curve", () => {
  it("five tickets lose about a quarter of the time", () => {
    // «5 Tickets: حظ أوفر تقريباً = 25%». Solved, not fitted — so it is exact.
    expect(losePercentFor(5)).toBeCloseTo(25, 9);
    expect(oddsForTickets(5).lose).toBeCloseTo(25, 9);
  });

  it("ten tickets cannot lose at all", () => {
    // «10 Tickets: حظ أوفر = 0%» — zero, not nearly zero.
    expect(losePercentFor(10)).toBe(0);
    expect(oddsForTickets(10).lose).toBe(0);
  });

  it("ten tickets put the rarest prize at about one percent", () => {
    /*
      «الفئة النادرة جداً: لعبة مشهورة وسعرها 6,000+ تبدأ 0.01% وعند 10 تذاكر
       استهدف تقريباً 1%» — a hundredfold, which is why the blend is geometric.
    */
    expect(oddsForTickets(10).high_premium).toBeCloseTo(1, 9);
    expect(oddsForTickets(10).high_premium / oddsForTickets(1).high_premium).toBeCloseTo(100, 6);
  });
});

describe("the curve behaves for every ticket count, not just the three", () => {
  it("always adds to one hundred", () => {
    for (const tickets of ALL_TICKETS) {
      expect(sum(oddsForTickets(tickets))).toBeCloseTo(100, 9);
    }
  });

  it("never produces a negative, a NaN or an infinity", () => {
    for (const tickets of ALL_TICKETS) {
      for (const [key, value] of Object.entries(oddsForTickets(tickets))) {
        expect(Number.isFinite(value), `${key} at ${tickets}`).toBe(true);
        expect(value, `${key} at ${tickets}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never makes losing more likely than one ticket fewer", () => {
    // «LOSE لا يزيد عند زيادة التذاكر».
    for (let t = MIN_TICKETS_PER_SPIN + 1; t <= MAX_TICKETS_PER_SPIN; t += 1) {
      expect(losePercentFor(t)).toBeLessThan(losePercentFor(t - 1));
    }
  });

  it("never makes a rare bucket rarer than one ticket fewer", () => {
    /*
      «Rare probability لا تنخفض». The four rarer buckets, each checked against
      its own predecessor rather than against the first — a curve can rise
      overall and still dip in the middle, and a dip is the thing this forbids.
    */
    const rare: PrizeBucketKey[] = [
      "high_cheap",
      "low_premium",
      "medium_premium",
      "high_premium",
    ];
    for (let t = MIN_TICKETS_PER_SPIN + 1; t <= MAX_TICKETS_PER_SPIN; t += 1) {
      const now = oddsForTickets(t);
      const before = oddsForTickets(t - 1);
      for (const key of rare) {
        expect(now[key], `${key} at ${t} vs ${t - 1}`).toBeGreaterThan(before[key]);
      }
    }
  });

  it("never makes winning at all worse than one ticket fewer", () => {
    // «كل تذكرة إضافية يجب ألا تجعل فرصة الفوز أسوأ من التذكرة السابقة».
    for (let t = MIN_TICKETS_PER_SPIN + 1; t <= MAX_TICKETS_PER_SPIN; t += 1) {
      const winNow = 100 - oddsForTickets(t).lose;
      const winBefore = 100 - oddsForTickets(t - 1).lose;
      expect(winNow).toBeGreaterThan(winBefore);
    }
  });

  it("has no step between four and five, or nine and ten, unlike its neighbours", () => {
    /*
      «لا أريد قفزات غير منطقية بين 4 و5 أو 9 و10». A smooth curve has no
      single gap that dwarfs the others, so the two the owner named are
      measured against the largest gap anywhere on the curve rather than
      against a number somebody chose.
    */
    const gaps: number[] = [];
    for (let t = MIN_TICKETS_PER_SPIN + 1; t <= MAX_TICKETS_PER_SPIN; t += 1) {
      gaps.push(losePercentFor(t - 1) - losePercentFor(t));
    }
    const biggest = Math.max(...gaps);
    const fourToFive = losePercentFor(4) - losePercentFor(5);
    const nineToTen = losePercentFor(9) - losePercentFor(10);
    expect(fourToFive).toBeLessThanOrEqual(biggest);
    expect(nineToTen).toBeLessThanOrEqual(biggest);
    // And no gap is more than twice the average, which is what a jump would be.
    const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(biggest).toBeLessThan(average * 2);
  });

  it("refuses a ticket count it is not allowed to run", () => {
    /*
      Every value in the owner's own list — «0، negative، fraction، 11+، NaN
      أو أي قيمة غير صالحة» — plus the two that slip through a bare `Number()`
      and were the reason this is a type check and not a range check:
      `Number([5])` is 5 and `Number(true)` is 1.
    */
    const refused: unknown[] = [
      0,
      -1,
      11,
      100,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      null,
      undefined,
      "",
      "abc",
      "5.5",
      "-3",
      "1e1",
      true,
      [5],
      { valueOf: () => 5 },
    ];
    for (const bad of refused) {
      expect(validTicketCount(bad), JSON.stringify(bad) ?? String(bad)).toBeNull();
    }
    for (const good of ALL_TICKETS) expect(validTicketCount(good)).toBe(good);
    // A digits-only string is what a posted form actually carries, so it is
    // accepted deliberately rather than by accident.
    expect(validTicketCount("7")).toBe(7);
    expect(validTicketCount(" 7 ")).toBe(7);
  });
});

describe("a bucket's chance does not depend on how crowded it is", () => {
  /*
    This is the architectural change, and the reason the module exists. The old
    `wheel-odds.ts` weights one GAME and multiplies by the population, so the
    shop's import decisions moved the odds. Here the number is the number.
  */
  it("is identical for two games in a bucket and two hundred", () => {
    const thin: BucketPopulation = { ...full, high_premium: 2 };
    const fat: BucketPopulation = { ...full, high_premium: 200 };
    for (const tickets of ALL_TICKETS) {
      const a = resolveOdds(tickets, thin).probabilities;
      const b = resolveOdds(tickets, fat).probabilities;
      for (const key of PRIZE_BUCKETS) expect(b[key]).toBeCloseTo(a[key], 12);
      expect(b.lose).toBeCloseTo(a.lose, 12);
    }
  });

  it("is identical when the cheap bucket is flooded, which is the real case", () => {
    // 984 cheap games is the production number quoted in wheel-odds.ts.
    const flooded: BucketPopulation = { ...full, low_cheap: 984 };
    const base = resolveOdds(1, full).probabilities;
    const after = resolveOdds(1, flooded).probabilities;
    expect(after.low_cheap).toBeCloseTo(base.low_cheap, 12);
    expect(after.high_premium).toBeCloseTo(base.high_premium, 12);
  });
});

describe("an empty bucket gives its share away, declared", () => {
  it("hands it to the buckets that can pay, in proportion", () => {
    const population: BucketPopulation = { ...full, high_premium: 0 };
    const resolved = resolveOdds(1, population);

    expect(resolved.emptied).toEqual(["high_premium"]);
    expect(resolved.probabilities.high_premium).toBe(0);
    expect(sum(resolved.probabilities)).toBeCloseTo(100, 9);

    // Losing keeps exactly what it had: it is not a drain for shortfalls.
    expect(resolved.probabilities.lose).toBeCloseTo(BASE_ODDS.lose, 9);

    // And the survivors keep their shape relative to each other.
    const base = oddsForTickets(1);
    const ratioBefore = base.low_cheap / base.medium_cheap;
    const ratioAfter = resolved.probabilities.low_cheap / resolved.probabilities.medium_cheap;
    expect(ratioAfter).toBeCloseTo(ratioBefore, 9);
  });

  it("never silently pays out of a bucket the member was not offered", () => {
    /*
      «لا تعطِ لعبة من فئة غير مقصودة بصمت». An emptied bucket is zero, so the
      picker can never return it however the draw falls.
    */
    const population: BucketPopulation = { ...full, high_premium: 0, medium_premium: 0 };
    const { probabilities } = resolveOdds(10, population);
    for (const unit of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const picked = pickBucket(probabilities, () => unit);
      expect(picked).not.toBe("high_premium");
      expect(picked).not.toBe("medium_premium");
    }
  });

  it("reports a pool with nothing in it rather than inventing a winner", () => {
    const empty: BucketPopulation = {
      low_cheap: 0,
      medium_cheap: 0,
      high_cheap: 0,
      low_premium: 0,
      medium_premium: 0,
      high_premium: 0,
    };
    const resolved = resolveOdds(10, empty);
    expect(resolved.emptied).toHaveLength(PRIZE_BUCKETS.length);
    expect(resolved.probabilities.lose).toBe(100);
    expect(sum(resolved.probabilities)).toBeCloseTo(100, 9);
    expect(pickBucket(resolved.probabilities, () => 0.99)).toBe("lose");
  });

  it("still adds to one hundred for every ticket count with holes in the pool", () => {
    const holes: BucketPopulation = { ...full, high_cheap: 0, medium_premium: 0 };
    for (const tickets of ALL_TICKETS) {
      const resolved = resolveOdds(tickets, holes);
      expect(sum(resolved.probabilities), `tickets ${tickets}`).toBeCloseTo(100, 9);
      expect(resolved.probabilities.high_cheap).toBe(0);
      expect(resolved.probabilities.medium_premium).toBe(0);
    }
  });
});

describe("the draw lands where the numbers say", () => {
  it("returns losing for a draw inside the losing share", () => {
    const odds = oddsForTickets(1);
    expect(pickBucket(odds, () => 0)).toBe("lose");
    expect(pickBucket(odds, () => 0.7499)).toBe("lose");
  });

  it("returns a prize for a draw past it", () => {
    const odds = oddsForTickets(1);
    expect(pickBucket(odds, () => 0.7501)).toBe("low_cheap");
    // The very top of the range is the rarest bucket, which sits last.
    expect(pickBucket(odds, () => 0.999999)).toBe("high_premium");
  });

  it("lands on each bucket about as often as its percent, over many draws", () => {
    /*
      A deterministic sweep rather than a random sample: the draw walks the
      unit interval in a hundred thousand equal steps, so the share of steps
      that land in a bucket IS its probability, measured through the real
      picker.
    */
    const odds = oddsForTickets(10);
    const steps = 100_000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < steps; i += 1) {
      const key = pickBucket(odds, () => i / steps);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const key of PRIZE_BUCKETS) {
      const measured = ((counts[key] ?? 0) / steps) * 100;
      expect(measured, key).toBeCloseTo(odds[key], 1);
    }
    expect(counts["lose"] ?? 0).toBe(0);
  });

  it("survives a broken draw rather than paying out on it", () => {
    const odds = oddsForTickets(1);
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2]) {
      const picked = pickBucket(odds, () => broken);
      expect(Object.keys(odds)).toContain(picked);
    }
    // A draw that cannot be read is treated as the bottom of the range, which
    // is losing — never as a win the member did not earn.
    expect(pickBucket(odds, () => Number.NaN)).toBe("lose");
  });
});

describe("price and popularity decide the bucket, with no gap between them", () => {
  it("puts every price on one side of the line", () => {
    expect(bandOfPrice(1, DEFAULT_PRICE_BOUNDARY)).toBe("cheap");
    expect(bandOfPrice(5_000, DEFAULT_PRICE_BOUNDARY)).toBe("cheap");
    // The owner's own warning: 5,500 is between «حتى 5,000» and «6,000 فما فوق»
    // and must not be undefined.
    expect(bandOfPrice(5_001, DEFAULT_PRICE_BOUNDARY)).toBe("premium");
    expect(bandOfPrice(5_500, DEFAULT_PRICE_BOUNDARY)).toBe("premium");
    expect(bandOfPrice(6_000, DEFAULT_PRICE_BOUNDARY)).toBe("premium");
    expect(bandOfPrice(75_000, DEFAULT_PRICE_BOUNDARY)).toBe("premium");
  });

  it("moves with the boundary the admin sets", () => {
    expect(bandOfPrice(8_000, 9_000)).toBe("cheap");
    expect(bandOfPrice(8_000, 7_000)).toBe("premium");
  });

  it("crosses the two axes into the six buckets", () => {
    expect(bucketOf("low", 3_000)).toBe("low_cheap");
    expect(bucketOf("medium", 3_000)).toBe("medium_cheap");
    expect(bucketOf("high", 3_000)).toBe("high_cheap");
    expect(bucketOf("low", 45_000)).toBe("low_premium");
    expect(bucketOf("medium", 45_000)).toBe("medium_premium");
    expect(bucketOf("high", 45_000)).toBe("high_premium");
  });
});

describe("what the member is shown", () => {
  it("puts losing first and the rest by how likely they are", () => {
    const rows = oddsRows(resolveOdds(1, full).probabilities, full);
    expect(rows[0].label).toBe(BUCKET_LABELS.lose);
    expect(rows[0].percent).toBeCloseTo(75, 9);
    for (let i = 2; i < rows.length; i += 1) {
      expect(rows[i].percent).toBeLessThanOrEqual(rows[i - 1].percent);
    }
  });

  it("prints a real chance, not an internal weight", () => {
    // Every row is a percentage of the same hundred, and they add up to it.
    const rows = oddsRows(oddsForTickets(5));
    const total = rows.reduce((acc, row) => acc + row.percent, 0);
    expect(total).toBeCloseTo(100, 9);
  });

  it("carries the eligible count beside each chance, for the admin", () => {
    const rows = oddsRows(resolveOdds(1, full).probabilities, full);
    const rare = rows.find((row) => row.key === "high_premium");
    expect(rare?.games).toBe(8);
  });
});
