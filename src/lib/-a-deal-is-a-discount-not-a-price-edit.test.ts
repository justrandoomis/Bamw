/**
 * Occasion deals: a discount on today's price, shown as old and new, charged
 * exactly as shown, never below cost, and gone the moment it is switched off.
 */
import { describe, expect, it } from "vitest";

import {
  applyDealToProduct,
  dealForProduct,
  dealPrice,
  liveDealOf,
  readDealsConfig,
  safePercent,
  type DealsConfig,
} from "./deals";
import { listingPricing, resolveUnitPrice } from "./productPricing";

const NOW = Date.parse("2026-11-27T12:00:00Z");

const game = () => ({
  id: "prd_mario",
  kind: "game",
  category: "Nintendo Switch Games",
  title: "Mario Kart World",
  price: 13_000,
  accountPrice: 13_000,
  cost: 8_000,
  options: [
    { id: "offline_account", name: "حساب أوفلاين", price: 13_000, cost: 8_000 },
    { id: "online_account", name: "حساب أونلاين", price: 55_000, cost: 40_000 },
  ],
});

const blackFriday = (over: Partial<DealsConfig["campaigns"][number]> = {}): DealsConfig =>
  readDealsConfig({
    deals: {
      enabled: true,
      campaigns: [
        {
          id: "bf26",
          occasion: "black_friday",
          percent: 15,
          startsAt: "2026-11-27T00:00:00+03:00",
          endsAt: "2026-11-30T00:00:00+03:00",
          scope: "games",
          active: true,
          ...over,
        },
      ],
    },
  });

describe("applyDealToProduct", () => {
  it("serves exactly what is stored when the deals are off", () => {
    const product = game();
    const off = readDealsConfig({ deals: { enabled: false, campaigns: blackFriday().campaigns } });
    expect(applyDealToProduct(product, off, NOW)).toBe(product);
  });

  it("lowers every price and keeps today's price as the struck-through one", () => {
    const dealt = applyDealToProduct(game(), blackFriday(), NOW) as ReturnType<typeof game> & {
      originalPrice: number;
      deal: { label: string; percent: number; occasion: string };
    };
    // 13,000 × 0.85 = 11,050 → the nearest 250.
    expect(dealt.price).toBe(11_000);
    expect(dealt.originalPrice).toBe(13_000);
    expect(dealt.options[0]).toMatchObject({ price: 11_000, originalPrice: 13_000 });
    expect(dealt.options[1]).toMatchObject({ price: 46_750, originalPrice: 55_000 });
    expect(dealt.deal).toMatchObject({ occasion: "black_friday", label: "الجمعة السوداء", percent: 15 });
  });

  it("charges at checkout the same price the card shows", () => {
    const dealt = applyDealToProduct(game(), blackFriday(), NOW);
    expect(listingPricing(dealt)).toMatchObject({ unitPrice: 11_000, originalUnitPrice: 13_000 });
    expect(resolveUnitPrice(dealt, { optionId: "online_account" })).toMatchObject({
      unitPrice: 46_750,
      originalUnitPrice: 55_000,
    });
  });

  it("shows nothing before the start or after the end", () => {
    const product = game();
    expect(applyDealToProduct(product, blackFriday(), Date.parse("2026-11-26T12:00:00Z"))).toBe(
      product,
    );
    expect(applyDealToProduct(product, blackFriday(), Date.parse("2026-12-01T12:00:00Z"))).toBe(
      product,
    );
  });

  it("never sells below cost — the percentage gives way instead", () => {
    const thin = { ...game(), price: 11_000, options: [{ id: "o", price: 11_000, cost: 10_000 }] };
    // Floor: 10,000 + max(500, 3%) = 10,500 (+125 for rounding) → at most 3%.
    expect(safePercent(thin, 15)).toBe(3);
    const dealt = applyDealToProduct(thin, blackFriday(), NOW) as typeof thin & {
      deal: { percent: number };
    };
    expect(dealt.options[0]!.price).toBeGreaterThanOrEqual(10_500);
    expect(dealt.deal.percent).toBe(3);

    const noRoom = { ...game(), price: 10_400, options: [{ id: "o", price: 10_400, cost: 10_000 }] };
    expect(applyDealToProduct(noRoom, blackFriday(), NOW)).toBe(noRoom);
  });

  it("leaves hardware out of a games-only campaign", () => {
    const console_ = { ...game(), id: "prd_hw", kind: "hardware", category: "hardware" };
    expect(applyDealToProduct(console_, blackFriday(), NOW)).toBe(console_);
    expect(applyDealToProduct(console_, blackFriday({ scope: "all" }), NOW)).not.toBe(console_);
  });

  it("lets a product sit the deals out, or carry its own occasion", () => {
    const excluded = { ...game(), occasionDeal: { mode: "exclude" } };
    expect(applyDealToProduct(excluded, blackFriday(), NOW)).toBe(excluded);

    const eid = {
      ...game(),
      occasionDeal: { mode: "custom", occasion: "eid_fitr", percent: 20, label: "" },
    };
    const deal = dealForProduct(eid, blackFriday(), NOW);
    expect(deal).toMatchObject({ occasion: "eid_fitr", label: "عيد الفطر", percent: 20 });
  });
});

describe("dealPrice", () => {
  it("rounds to the shop's 250 step and never reaches the regular price", () => {
    expect(dealPrice(9_000, 15)).toBe(7_750);
    expect(dealPrice(25_000, 15)).toBe(21_250);
    expect(dealPrice(1_000, 1)).toBe(1_000);
  });
});

describe("liveDealOf", () => {
  it("reads a deal only inside its window", () => {
    const dealt = applyDealToProduct(game(), blackFriday(), NOW);
    expect(liveDealOf(dealt, NOW)?.occasion).toBe("black_friday");
    expect(liveDealOf(dealt, Date.parse("2026-12-02T00:00:00Z"))).toBeNull();
  });
});
