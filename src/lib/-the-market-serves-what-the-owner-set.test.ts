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
/*
  Both of those routes are redirects now — the redemption shelf and the sell
  sheet moved into `/banana_market` as sections of one page. The rules these
  tests hold did not move with them by accident: they are asserted against the
  components the behaviour actually landed in.
*/
const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");
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

  it("falls back to a category the screen can actually name", () => {
    /*
      This read the tab list off `/banana_redeem`. That page is a redirect now
      — the rewards moved into a section of the market — so the question is
      asked of the component that renders them: whatever category the server
      falls back to must be one this screen has a word for, or a member is
      shown a reward labelled with a raw database value.
    */
    const shelf = read("../components/market/RewardsShelf.tsx");
    const named = [...shelf.matchAll(/reward\.category === "([a-z_]+)"/g)].map((m) => m[1]);
    expect(named).toContain("vouchers");
    expect(named).toContain("wheel_ticket");
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

  it("no screen prints a refusal code at a member", () => {
    /*
      The buy screen is a redirect now, so the sentence a member reads when a
      refusal comes back is the market's. The rule is unchanged and so is the
      reason for it — a member must never be shown `price_above_max` — only
      the screen that has to honour it has moved.

      The market page shows the server's own Arabic message, which
      `/api/banana` now composes from the same vocabulary rather than sending a
      bare code, and the sell sheet prints whatever came back verbatim. So the
      guard is that no screen prints a raw code.
    */
    const market = read("../routes/banana_market.tsx");
    const sheet = read("../components/market/SellBananasSheet.tsx");
    for (const code of ["price_above_max", "quantity_below_min", "insufficient_balance"]) {
      expect(market, code).not.toContain(code);
      expect(sheet, code).not.toContain(code);
    }
  });

  it("leaves no screen at the old address to print one", () => {
    // The route that carried the raw-code bug is a redirect, with no state to
    // set and no message to get wrong.
    const buy = read("../routes/banana_buy.tsx");
    expect(buy).toContain("redirect");
    expect(buy).not.toContain("setError");
  });
});

describe("a bot's face is not a broken image", () => {
  /*
    ADAPTED, NOT DELETED — and the reason is the whole point.

    This used to assert that the home strip branched on `listing.avatar`
    starting with "http" before putting it in an `src`, because a bot's avatar
    is «🤖» and a member's can be empty, and feeding either straight into an
    `<img>` draws a broken-image icon on the front page.

    That test was right, and it was also pinning the deleted marketplace onto
    the home page. «احذف مفهوم Marketplace بين المستخدمين بالكامل» was carried
    out on `/banana_market` and never on `HomeBananaMarket`, so banan.to kept
    showing «أحدث العروض (Top 10)» and cards for «بوت 1 … بوت 4» — a market
    nobody is allowed to trade in, since `create_listing` answers «سوق العروض
    بين الأعضاء أُغلق». The owner reported it as fault one of five.

    So the assertion is inverted rather than removed: an avatar cannot be
    rendered wrongly by a screen that renders no avatars. What the check
    protects now is that the removal STAYS done — a future edit that puts a
    trader, a bot or an offer back on the home page fails here, and the message
    says which word gave it away.
  */
  it("draws no trader, bot or offer on the home page at all", () => {
    /*
      Comments stripped first, because the claim is about what the screen
      DRAWS, not about what the file may say. The replacement's own header
      explains what «متداول نشط» was and why it went — and the first version of
      this check failed on that explanation, which would have left the choice
      between a vaguer comment and a weaker test. Neither is necessary.
    */
    const drawn = homeStrip.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const gone of [
      "listing.avatar",
      "topListings",
      "snapshot?.listings",
      "متداول نشط",
      "أحدث العروض",
      "لا توجد عروض حالياً",
    ]) {
      expect(drawn, `«${gone}» belongs to the marketplace that was removed`).not.toContain(gone);
    }
  });

  /*
    And what replaced it is the market page's own opening, so the two cannot
    drift into telling a member two different prices.
  */
  it("leads with the live price instead, and links into the one market page", () => {
    expect(homeStrip).toContain("سعر موزة واحدة");
    expect(homeStrip).toContain("formatPrice(price)");
    expect(homeStrip).toContain('to="/banana_market"');
  });
});
