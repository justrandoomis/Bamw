/**
 * The shop must take the money it says it is taking.
 *
 * The owner's report: «عند شراء المنتج لا يخصم من المحفظة».
 *
 * `createOrderForUser` decided whether to charge from
 * `isFullyDigitalOrder(items)`. One physical line — a console, an accessory, a
 * used disc — made the cart "not fully digital", and that single boolean then
 * decided three separate things: whether to take the money, what
 * `paymentStatus` to write, and whether the referral reward was owed. So an
 * order with any physical item was written `unpaid` and nothing was taken.
 *
 * Meanwhile the cart screen has no branch for a physical cart and offers no
 * cash-on-delivery anywhere: it shows «رصيدك الحالي», «الرصيد المتبقي بعد
 * الدفع», a button reading «إتمام الدفع عبر المحفظة», and on success «تم تأكيد
 * الطلب والدفع بنجاح». Add one cheap accessory to a cart of games and the games
 * went with it.
 *
 * These read the source rather than run a checkout, because the faults are in
 * which expression a decision is made from and which number is bound to a
 * statement — a database would let both back in without failing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const orders = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
const cart = readFileSync(path.resolve(__dirname, "../routes/cart.tsx"), "utf8");
const adminOrders = readFileSync(path.resolve(__dirname, "../routes/api/admin.orders.ts"), "utf8");

describe("payment is not decided by what the order contains", () => {
  it("does not read whether the cart is digital to decide whether to charge", () => {
    expect(orders).not.toContain("const needsWalletPayment = isFullyDigitalOrder");
  });

  it("charges every order", () => {
    expect(orders).toContain("const needsWalletPayment = true;");
  });

  it("still uses the digital question for fulfilment, where it belongs", () => {
    expect(orders).toContain("isFullyDigitalOrder(order.items)");
  });
});

describe("the amount taken is the amount the cart showed", () => {
  /*
    `total` is `finalItemsTotal + delivery`. The debit was `finalItemsTotal`,
    which was harmless only while digital-only orders were charged — those have
    no delivery fee. Charging a shipped order the items alone means the shop
    pays the courier on every delivery.
  */
  it("debits the order total, not the items subtotal", () => {
    const debit = orders.slice(orders.indexOf("UPDATE users SET wallet_balance = wallet_balance - ?"));
    expect(debit.slice(0, 400)).toContain("params: [total, user.id, total]");
  });

  it("records the same number in the statement", () => {
    expect(orders).toContain("params: [walletTxId, user.id, -total,");
  });

  it("checks the balance against the total, including delivery", () => {
    expect(orders).toContain("if ((user.walletBalance || 0) < total)");
    expect(orders).not.toContain("(user.walletBalance || 0) < finalItemsTotal");
  });
});

describe("the insufficient-funds guard can actually fire", () => {
  /*
    It was `SET wallet_balance = CASE WHEN wallet_balance >= ? THEN ... ELSE
    NULL END`, which leans on the column's NOT NULL constraint to abort — so an
    overdraw surfaced as a raw database error rather than «رصيد المحفظة غير
    كافٍ», and `changes() !== 1` could never fire, because SQLite counts a row
    as changed whenever the UPDATE matched it, whichever CASE branch ran.
  */
  it("puts the condition in the WHERE clause", () => {
    expect(orders).toContain(
      "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ? AND wallet_balance >= ?",
    );
  });

  it("no longer relies on writing NULL to abort the batch", () => {
    const checkout = orders.slice(orders.indexOf("if (needsWalletPayment) {"));
    expect(checkout).not.toContain("ELSE NULL END WHERE id = ?");
  });

  it("still refuses the whole run when the debit did not apply", () => {
    expect(orders).toContain('throw new Error("insufficient_balance")');
    expect(orders).toContain("Number(payment[0]?.meta?.changes ?? 0) !== 1");
  });
});

describe("the cart's promise is the one the server keeps", () => {
  it("offers a wallet payment with no cash-on-delivery alternative", () => {
    expect(cart).toContain("إتمام الدفع عبر المحفظة");
    expect(cart).toContain("الرصيد المتبقي بعد الدفع");
  });

  it("refreshes the balance it just spent", () => {
    // `["auth"]` is registered by no query; the balance lives under `["me"]`.
    expect(cart).not.toContain('invalidateQueries({ queryKey: ["auth"] })');
    expect(cart).toContain("void refreshMe()");
  });
});

describe("a cancellation gives back only what the wallet paid", () => {
  it("does not credit the total merely because the order says paid", () => {
    expect(adminOrders).not.toMatch(
      /else if \(order\.paymentStatus === "paid"\) \{\s*wasPaidByWallet = true;/,
    );
  });

  it("requires a payment row, or a payment reference without a ledger", () => {
    expect(adminOrders).toContain("paid without a wallet payment row — no automatic wallet refund");
    expect(adminOrders).toContain('order.paymentStatus === "paid" && Boolean(order.paymentReference)');
  });
});
