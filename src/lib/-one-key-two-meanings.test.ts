/**
 * The mint rate, and the key that meant two things.
 *
 * I made `bananaPerDinar` the first key the earn rate reads. Before that it
 * was inert on this path and the collision cost nothing; after it, it decided
 * how many bananas every purchase created.
 *
 * Two admin screens write that key and they mean OPPOSITE things. The banana
 * panel's «معدل كسب الموز لكل 1 دينار» means bananas earned per dinar — the
 * mint rate — and its save writes `banana_reward_rate` alongside. The pricing
 * screen's «سعر الموزة مقابل الدينار (للمستخدم)» meant the dinar VALUE of one
 * banana, the inverse, defaulted the field to 1, and wrote the whole settings
 * document back on every save.
 *
 * Against a shop holding 13.9 million bananas across 60 wallets, that is not
 * a tidiness problem. These tests hold the repair.
 */
import { describe, expect, it } from "vitest";

import { bananaRewardRate } from "@/lib/orders.server";

describe("which key decides the mint", () => {
  it("obeys the banana panel's rate, which is the one that means the mint", () => {
    expect(bananaRewardRate({ banana_reward_rate: 6.8 })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: 10 })).toBe(10);
  });

  it("prefers it over the colliding key, whatever the other screen wrote", () => {
    /*
      The whole finding in one assertion. An admin saves the pricing screen,
      `bananaPerDinar` lands as 1, and the mint must not follow it.
    */
    expect(bananaRewardRate({ banana_reward_rate: 6.8, bananaPerDinar: 1 })).toBe(6.8);
  });

  it("still honours the legacy key for a shop that only ever had that one", () => {
    expect(bananaRewardRate({ bananaPerDinar: 6.8 })).toBe(6.8);
  });

  it("falls back to the shop's default when nothing is set", () => {
    expect(bananaRewardRate({})).toBe(6.8);
    expect(bananaRewardRate(undefined)).toBe(6.8);
  });
});

describe("a rate that cannot be obeyed", () => {
  it("steps over a stored zero, which `??` did not", () => {
    /*
      This is what made the change worse than what it replaced. `||` had
      stepped over 0; `??` does not, so a settings document holding 0 — which
      `Number("")` produces from a cleared input — minted nothing at all.
    */
    expect(bananaRewardRate({ banana_reward_rate: 0 })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: 0, bananaPerDinar: 0 })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: "" })).toBe(6.8);
  });

  it("steps over nonsense rather than minting NaN", () => {
    expect(bananaRewardRate({ banana_reward_rate: "abc" })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: null })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: -5 })).toBe(6.8);
  });

  it("refuses a rate big enough to mint the whole supply on one order", () => {
    /*
      Nothing between an admin's text input and `users.banana_balance` checked
      the SIZE of the number. A per-banana price of 1,000 typed into the wrong
      box would have minted 50,000,000 bananas on a single 50,000-dinar order —
      more than three times every banana in existence.
    */
    expect(bananaRewardRate({ banana_reward_rate: 1_000 })).toBe(6.8);
    expect(bananaRewardRate({ bananaPerDinar: 1_000 })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: 101 })).toBe(6.8);
  });

  it("allows a generous but plausible rate, so the ceiling is not a straitjacket", () => {
    expect(bananaRewardRate({ banana_reward_rate: 100 })).toBe(100);
    expect(bananaRewardRate({ banana_reward_rate: 50 })).toBe(50);
  });

  it("falls through from a refused first key to a usable second one", () => {
    // A rejected rate must not become the shop's rate by being first in line.
    expect(bananaRewardRate({ banana_reward_rate: 0, bananaPerDinar: 6.8 })).toBe(6.8);
    expect(bananaRewardRate({ banana_reward_rate: 99_999, bananaPerDinar: 7 })).toBe(7);
  });
});

describe("what a real order would mint", () => {
  it("pays the owner's rate on a 50,000 dinar order", () => {
    const rate = bananaRewardRate({ banana_reward_rate: 6.8, bananaPerDinar: 1 });
    expect(Math.floor(50_000 * rate)).toBe(340_000);
  });

  it("does not pay 50,000 — which is what the colliding default would have done", () => {
    const rate = bananaRewardRate({ banana_reward_rate: 6.8, bananaPerDinar: 1 });
    expect(Math.floor(50_000 * rate)).not.toBe(50_000);
  });
});
