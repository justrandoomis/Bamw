/**
 * The banana market shows what the owner configured, and its controls work.
 *
 * «سوق الموز اصلحها». The four money faults are in
 * `-one-listing-one-sale.test.ts`. These are the other half of what was wrong:
 * screens that ran, rendered, and quietly showed something other than what the
 * admin had saved.
 *
 * Every one of these is the same shape — a writer and a reader that disagree
 * about a name — and that shape is invisible to any test that only asks whether
 * the page rendered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { marketErrorText } from "./banana-market-errors";

const server = readFileSync(path.resolve(__dirname, "banana.server.ts"), "utf8");
const cron = readFileSync(path.resolve(__dirname, "scheduled-jobs.server.ts"), "utf8");
const config = readFileSync(path.resolve(__dirname, "banana-market-config.server.ts"), "utf8");
const redeem = readFileSync(path.resolve(__dirname, "../routes/banana_redeem.tsx"), "utf8");
const buy = readFileSync(path.resolve(__dirname, "../routes/banana_buy.tsx"), "utf8");
const homeStrip = readFileSync(
  path.resolve(__dirname, "../components/HomeBananaMarket.tsx"),
  "utf8",
);

describe("the redemption catalogue is the one the admin saved", () => {
  /*
    The admin writes `icon` and `category`. The reader selected neither: it read
    `image_url`, a column the admin panel never writes, and replaced the
    category with the literal «reward». The screen's tabs are `wheel_ticket`,
    `vouchers`, `digital`, `physical`, `perks` — so four of the six could never
    match anything, and every non-ticket reward showed 🎁.
  */
  it("reads the two columns the admin writes", () => {
    expect(server).toContain(
      "SELECT id, title, description, image_url, icon, category, banana_price, stock",
    );
  });

  it("no longer overwrites the category with a word no tab carries", () => {
    expect(server).not.toContain('category: ticketQuantity ? "wheel_ticket" : "reward"');
    expect(server).toContain(
      'category: ticketQuantity ? "wheel_ticket" : row.category || "vouchers"',
    );
  });

  it("prefers the admin's icon and keeps the old fallbacks", () => {
    expect(server).toContain('icon: row.icon || row.image_url || (ticketQuantity ? "🎟️" : "🎁")');
  });

  it("falls back to a category the screen actually has a tab for", () => {
    const tabs = [...redeem.matchAll(/\{ id: "([a-z_]+)", label:/g)].map((m) => m[1]);
    expect(tabs).toContain("vouchers");
    expect(tabs).toContain("wheel_ticket");
    // The default the server falls back to has to be one of them.
    expect(tabs).toContain("vouchers");
  });
});

describe("the bot limits the admin sets are the limits the bot obeys", () => {
  /*
    Four limits are stored, mapped onto the bot object and shown in the panel.
    Exactly one was enforced. The other three bounded nothing, so the numbers
    the owner typed into «أقصى سعر شراء», «الحد اليومي» and «الحد الأقصى الكلي»
    were decoration.
  */
  it("still enforces the one that always worked", () => {
    expect(cron).toContain(
      "if (bot.maxTradeBanana && offer.quantity > bot.maxTradeBanana) return;",
    );
  });

  it("refuses an offer dearer per banana than the bot may pay", () => {
    expect(cron).toContain(
      "const unitPrice = offer.quantity > 0 ? offer.priceIqd / offer.quantity : Infinity;",
    );
    expect(cron).toContain(
      "if (bot.maxPurchasePriceIqd && unitPrice > bot.maxPurchasePriceIqd) return;",
    );
  });

  it("counts what the bot has already bought, today and in total", () => {
    expect(cron).toContain("if (bot.dailyLimitBanana || bot.maxTotalBanana) {");
    expect(cron).toContain("WHERE buyer_id = ? AND status = 'sold'");
    expect(cron).toContain(
      "if (bot.dailyLimitBanana && today + offer.quantity > bot.dailyLimitBanana) return;",
    );
    expect(cron).toContain(
      "if (bot.maxTotalBanana && total + offer.quantity > bot.maxTotalBanana) return;",
    );
  });

  /*
    A bot with no limits set must not pay for a query it does not need — this
    runs on a Worker the repo documents as CPU-bound.
  */
  it("asks the database nothing when no volume limit is set", () => {
    const at = cron.indexOf("if (bot.dailyLimitBanana || bot.maxTotalBanana) {");
    const before = cron.slice(at - 400, at);
    expect(before).not.toContain("SELECT COALESCE(SUM(");
  });
});

describe("every chart range draws its own chart", () => {
  /*
    The buttons read 1H · 4H · 12H · 1D · 7D; the engine knew 1H · 1D · 1W · 1M
    · 1Y and falls back to 1D for anything else. Three of the five redrew the
    same chart silently, which reads as a price that has not moved.
  */
  it("knows every range the screen offers", () => {
    const offered = ["1H", "4H", "12H", "1D", "7D"];
    for (const range of offered) {
      expect(config, range).toContain(`"${range}": { hours:`);
    }
  });

  it("keeps the ranges only the engine had", () => {
    for (const range of ["1W", "1M", "1Y"]) {
      expect(config, range).toContain(`"${range}": { hours:`);
    }
  });

  it("gives the week the same shape under both its names", () => {
    expect(config).toContain('"7D": { hours: 24 * 7, points: 56 }');
    expect(config).toContain('"1W": { hours: 24 * 7, points: 56 }');
  });
});

describe("a refusal reads as a sentence on every screen", () => {
  it("translates the codes the server actually throws", () => {
    const limits = { minPrice: 0.2, maxPrice: 0.9, minQty: 100, maxQty: 50_000 };
    for (const code of [
      "insufficient_funds",
      "listing_not_found",
      "listing_expired",
      "cannot_buy_own_listing",
      "out_of_stock",
    ]) {
      const text = marketErrorText(new Error(code), limits);
      expect(text, code).not.toContain(code);
      expect(text.length, code).toBeGreaterThan(8);
    }
  });

  it("names the number when the refusal is about a bound", () => {
    const limits = { minPrice: 0.2, maxPrice: 0.9, minQty: 100, maxQty: 50_000 };
    expect(marketErrorText(new Error("price_above_max"), limits)).toContain("0.9");
    expect(marketErrorText(new Error("quantity_below_min"), limits)).toContain("100");
  });

  it("still says something for a code it has never seen", () => {
    const limits = { minPrice: 0, maxPrice: 0, minQty: 0, maxQty: 0 };
    expect(marketErrorText(new Error("brand_new_code"), limits)).toContain("تعذّر");
    expect(marketErrorText(null, limits)).toContain("تعذّر");
  });

  it("the buy screen uses the shared map instead of printing the code", () => {
    expect(buy).toContain('import { marketErrorText } from "@/lib/banana-market-errors";');
    expect(buy).toContain("setError(\n        marketErrorText(e, {");
    expect(buy).not.toContain('setError(e instanceof Error ? e.message : "تعذّر إكمال الشراء")');
  });
});

describe("a bot's face is not a broken image", () => {
  /*
    A bot's avatar is «🤖» and a member's can be empty. Both full-screen market
    pages branch on that; the home strip fed either straight into `src`.
  */
  it("renders an emoji as text on the home strip", () => {
    expect(homeStrip).toContain('listing.avatar?.startsWith("http") ? (');
    expect(homeStrip).toContain('{listing.avatar || "🍌"}');
  });
});
