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

  /*
    REVERSED, AND ON PURPOSE.

    This read `const needsWalletPayment = true;` — every order charged, which
    is what closing the hole required while the wallet was the only way to pay.
    The owner then asked for a second one: «الأجهزة والاكسسوارات اضف خيار لها
    دفع عند الاستلام». So the answer is no longer a constant; it is the method
    the SERVER resolved, and the point that mattered is preserved exactly —
    what the cart CONTAINS still decides nothing about whether money is taken.
  */
  it("charges every order except one the member chose to pay at the door", () => {
    expect(orders).toContain('const needsWalletPayment = paymentMethod === "wallet";');
    expect(orders).toContain(
      "const paymentMethod = resolvePaymentMethod(requestedPaymentMethod, items);",
    );
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
    const debit = orders.slice(
      orders.indexOf("UPDATE users SET wallet_balance = wallet_balance - ?"),
    );
    expect(debit.slice(0, 400)).toContain("params: [total, user.id, total]");
  });

  it("records the same number in the statement", () => {
    expect(orders).toContain("params: [walletTxId, user.id, -total,");
  });

  it("checks the balance against the total, including delivery", () => {
    // Gated on `needsWalletPayment` since cash on delivery was added: a member
    // paying the courier is not asked to hold the money in the wallet first.
    expect(orders).toContain("if (needsWalletPayment && (user.walletBalance || 0) < total)");
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
  /*
    This used to assert the cart offered NO cash-on-delivery alternative — the
    evidence that a physical order silently going unpaid was a fault and not a
    feature. The owner has since asked for the alternative to exist, so the
    assertion that still matters is the narrower one: the wallet wording is
    shown only when the wallet is what will be charged. The cash-on-delivery
    rule itself is pinned in `-cash-at-the-door-only-where-there-is-a-door`.
  */
  it("promises the wallet only when the wallet is what pays", () => {
    expect(cart).toContain("إتمام الدفع عبر المحفظة");
    expect(cart).toContain("الرصيد المتبقي بعد الدفع");
    expect(cart).toContain("const payFromWallet = !(codAllowed && payAtDoor);");
    expect(cart).toContain("{payFromWallet ? (");
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
    expect(adminOrders).toContain(
      'order.paymentStatus === "paid" && Boolean(order.paymentReference)',
    );
  });
});

describe("a payment that did not happen gives back what it claimed", () => {
  /*
    Both the coupon use and the referral discount are claimed before the money
    is tried. The pre-flight balance check released both; the branch that finds
    the debit did not apply released only the coupon, and a thrown error
    released neither, because nothing wrapped the batch.

    `referral_discount_used_at` is what makes the discount once per account FOR
    EVER — so a member with two tabs open, whose second checkout lost the race
    for the balance, lost the one discount of their life to an order that was
    never created.
  */
  it("releases both claims from one place", () => {
    expect(orders).toContain("const releaseCheckoutClaims = async () => {");
    const helper = orders.slice(orders.indexOf("const releaseCheckoutClaims = async () => {"));
    expect(helper.slice(0, 400)).toContain("releaseCouponUse");
    expect(helper.slice(0, 400)).toContain("releaseReferralDiscount(orderId)");
  });

  it("calls it when the debit matched nothing", () => {
    const guard = orders.slice(orders.indexOf("if (Number(payment[0]?.meta?.changes ?? 0) !== 1)"));
    expect(guard.slice(0, 220)).toContain("await releaseCheckoutClaims();");
    expect(guard.slice(0, 220)).toContain('throw new Error("insufficient_balance")');
  });

  it("calls it when the batch threw instead of answering", () => {
    expect(orders).toContain("      await releaseCheckoutClaims();\n      throw err;");
  });
});
