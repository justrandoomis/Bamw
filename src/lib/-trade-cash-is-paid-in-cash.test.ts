/**
 * A customer who asked for cash was being paid in store credit.
 *
 * The trade form holds `const payout = "store_credit"` and sends it for every
 * request, so `payout_type` has said store credit on every row ever written —
 * including the rows where the member chose cash in the condition step, and
 * where the quote they accepted was calculated from that choice. Completion
 * then credited the wallet unconditionally and told them the money was there.
 *
 * Store credit cannot leave the shop. Paying a cash request with it is the
 * customer's money in a form they did not agree to, announced as good news.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { payoutMethodOf } from "./tradeConditionView";

const route = readFileSync(resolve(process.cwd(), "src/routes/api/disc-trade.ts"), "utf8");
const settlement = route.slice(
  route.indexOf('if (next === "completed"'),
  route.indexOf("/* ---------------- submit"),
);

describe("how the payout method is decided", () => {
  it("reads the customer's own answer before the column", () => {
    expect(settlement).toContain("payoutMethodOf(trade.selections)");
    expect(settlement.indexOf("payoutMethodOf(trade.selections)")).toBeLessThan(
      settlement.indexOf('trade.payout_type === "cash"'),
    );
  });

  it("reads that answer out of the selections the quote was priced from", () => {
    expect(payoutMethodOf('{"payout_method":"cash"}')).toBe("cash");
    expect(payoutMethodOf('{"payout_method":"store_credit"}')).toBe("store_credit");
    expect(payoutMethodOf("{}")).toBeNull();
  });

  it("falls back to store credit only when nothing says otherwise", () => {
    expect(settlement).toContain('trade.payout_type === "cash" ? "cash" : "store_credit"');
  });

  it("selects the column it needs to decide", () => {
    expect(route).toContain("payout_credited, preferred_trade, payout_type, selections FROM");
  });
});

describe("a cash trade", () => {
  it("credits no wallet", () => {
    const branch = settlement.slice(
      settlement.indexOf('payoutMethod === "cash"'),
      settlement.indexOf("} else if (creditAmount > 0) {"),
    );
    expect(branch).not.toContain("wallet_transactions");
    expect(branch).not.toContain("wallet_balance");
  });

  it("still stops being payable, so a later status change cannot pay it twice", () => {
    const branch = settlement.slice(
      settlement.indexOf('payoutMethod === "cash"'),
      settlement.indexOf("} else if (creditAmount > 0) {"),
    );
    expect(branch).toContain("payout_credited = 1");
    expect(branch).toContain("payout_credited IS NULL OR payout_credited = 0");
  });

  it("records that it was settled in cash", () => {
    expect(settlement).toContain("payout_type = 'cash'");
    expect(settlement).toContain("تسوية نقدية");
  });

  it("tells the customer what to expect, in the words of their own choice", () => {
    expect(settlement).toContain("يُسلَّم نقداً حسب اختيارك، وليس رصيداً في المحفظة");
  });

  it("tells the shop somebody owes a payment", () => {
    expect(settlement).toContain("سلّم المبلغ نقداً");
    // The wallet topic, where the other money notices go.
    expect(settlement).toContain('sendAdminNotification(\n                      "wallet"');
  });

  it("does not let a Telegram outage undo a completed trade", () => {
    expect(settlement).toContain("[trade:cash_payout_notify_failed]");
  });
});

describe("a store-credit trade", () => {
  it("is unchanged: the wallet is credited and the member told", () => {
    const branch = settlement.slice(settlement.indexOf("} else if (creditAmount > 0) {"));
    expect(branch).toContain("wallet_transactions");
    expect(branch).toContain("disc_trade_payout");
    expect(branch).toContain("تم إيداع رصيد المقايضة");
  });

  it("still pays the price an admin approved, never the estimate first", () => {
    expect(settlement).toContain("data[\"approved_iqd\"] ??");
    expect(settlement.indexOf('trade.approved_iqd')).toBeLessThan(
      settlement.indexOf("trade.final_iqd"),
    );
  });
});

describe("what the member is told and asked", () => {
  const page = readFileSync(resolve(process.cwd(), "src/routes/disc_trade.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "");

  it("sends the answer they gave, not a constant", () => {
    expect(code).not.toContain('const payout = "store_credit";');
    expect(code).toContain('selections["payout_method"] === "cash" ? "cash" : "store_credit"');
  });

  it("announces a cash settlement as cash", () => {
    /*
      This said "credited to your wallet" for every settled trade, cash ones
      included — telling somebody their money is somewhere it is not, and
      sending them to a wallet page that would never show it.
    */
    expect(code).toContain("يُسلَّم نقداً حسب اختيارك");
    expect(code).toContain('tr.payoutMethod === "cash" || tr.payout_type === "cash"');
  });

  it("still announces a store-credit settlement as store credit", () => {
    expect(code).toContain("تم إيداع مبلغ المقايضة");
    expect(code).toContain('href="/wallet"');
  });

  it("offers the wallet link only where there is something in it", () => {
    const cashBranch = code.slice(
      code.indexOf("يُسلَّم نقداً حسب اختيارك"),
      code.indexOf("تم إيداع مبلغ المقايضة"),
    );
    expect(cashBranch).not.toContain('href="/wallet"');
  });
});
