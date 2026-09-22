/**
 * Which of the owner's four rules owns which of a game's four prices.
 *
 * A Nintendo game does not have one price. It has up to four, and the owner's
 * instructions are different for each — the discount is «فقط للحساب الاوفلاين
 * العادي او dlc», the online band is 10,000–15,000 «سواء كان عادي او مع
 * الاضافات», and the add-ons edition is priced from the COST GAP.
 *
 * So the dangerous mistake here is not arithmetic. It is applying the right
 * rule to the wrong tier — confidently, to a real price, on a live shop. These
 * tests are mostly about the cases where a row does NOT clearly say what it
 * is, because that is where a classifier is tempted to guess.
 */
import { describe, expect, it } from "vitest";

import { classifyTier, classifyTiers, extrasCostGap, tierOf } from "./tierPricing";

const kind = (row: Record<string, unknown>) => classifyTier(row).kind;

describe("reading a tier's id", () => {
  it("knows the four the importer writes", () => {
    expect(kind({ id: "offline_base" })).toBe("offline_base");
    expect(kind({ id: "offline_extras" })).toBe("offline_extras");
    expect(kind({ id: "online_base" })).toBe("online_base");
    expect(kind({ id: "online_extras" })).toBe("online_extras");
  });
});

describe("reading a tier's Arabic name", () => {
  it("knows what an admin types", () => {
    expect(kind({ name: "حساب اوفلاين" })).toBe("offline_base");
    expect(kind({ name: "حساب أوفلاين مع الإضافات" })).toBe("offline_extras");
    expect(kind({ name: "حساب اونلاين" })).toBe("online_base");
    expect(kind({ name: "حساب أونلاين مع الاضافات" })).toBe("online_extras");
  });

  it("reads the id and the name together, not one or the other", () => {
    // The importer's id with an admin's rewritten Arabic name.
    expect(kind({ id: "t_1", name: "اونلاين مع الاضافات" })).toBe("online_extras");
    expect(kind({ id: "online_base", name: "" })).toBe("online_base");
  });
});

describe("what it refuses to guess", () => {
  it("calls a row that says neither unknown, rather than assuming offline", () => {
    /*
      The tempting default. Most tiers are offline, so defaulting there would
      be right most of the time — and the times it was wrong it would put a
      10,000-margin online account on the discount rules, silently.
    */
    expect(kind({ id: "t_7", name: "النسخة الكاملة" })).toBe("unknown");
    expect(kind({})).toBe("unknown");
  });

  it("calls a row that says BOTH unknown, rather than picking one", () => {
    expect(kind({ name: "اوفلاين او اونلاين" })).toBe("unknown");
    expect(kind({ id: "offline_online_combo" })).toBe("unknown");
  });

  it("does not treat an unrecognised row as an extras row either", () => {
    const tier = classifyTier({ name: "مع الاضافات" });
    // «مع الاضافات» says extras but not which account. That is still unknown.
    expect(tier.kind).toBe("unknown");
  });
});

describe("the numbers on a tier", () => {
  it("reads a price and a cost written as strings", () => {
    const tier = classifyTier({ id: "offline_base", price: "8,000", cost: "2000" });
    expect(tier.price).toBe(8_000);
    expect(tier.cost).toBe(2_000);
  });

  it("reads a missing price or cost as zero rather than NaN", () => {
    const tier = classifyTier({ id: "online_base" });
    expect(tier.price).toBe(0);
    expect(tier.cost).toBe(0);
  });
});

describe("the gap the add-ons edition is priced from", () => {
  const tiers = classifyTiers([
    { id: "offline_base", price: 8_000, cost: 2_000 },
    { id: "offline_extras", price: 15_000, cost: 7_000 },
    { id: "online_base", price: 26_000, cost: 16_000 },
    { id: "online_extras", price: 30_000, cost: 18_000 },
  ]);

  it("is the gap between what they COST, never what they sell for", () => {
    /*
      The owner's own worked example. Offline: costs 2,000 and 7,000 — a gap
      of 5,000, NOT the 7,000 between 8,000 and 15,000. Pricing off the
      selling gap would compound whatever the last pass did.
    */
    expect(extrasCostGap(tierOf(tiers, "offline_base"), tierOf(tiers, "offline_extras"))).toBe(
      5_000,
    );
    expect(extrasCostGap(tierOf(tiers, "online_base"), tierOf(tiers, "online_extras"))).toBe(2_000);
  });

  it("is zero when either side is missing", () => {
    expect(extrasCostGap(undefined, tierOf(tiers, "offline_extras"))).toBe(0);
    expect(extrasCostGap(tierOf(tiers, "offline_base"), undefined)).toBe(0);
  });

  it("is zero, not negative, when the add-ons cost less", () => {
    // A data fault, not a discount. It must not become a price reduction.
    const odd = classifyTiers([
      { id: "offline_base", cost: 7_000 },
      { id: "offline_extras", cost: 2_000 },
    ]);
    expect(extrasCostGap(tierOf(odd, "offline_base"), tierOf(odd, "offline_extras"))).toBe(0);
  });
});

describe("a product's whole tier list", () => {
  it("keeps the product's own order, so nothing is re-sorted by a report", () => {
    const tiers = classifyTiers([{ id: "online_base" }, { id: "offline_base" }]);
    expect(tiers.map((t) => t.kind)).toEqual(["online_base", "offline_base"]);
  });

  it("answers an empty list for a product with no tiers at all", () => {
    expect(classifyTiers(undefined)).toEqual([]);
    expect(classifyTiers("not an array")).toEqual([]);
  });
});
