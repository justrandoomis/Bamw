/**
 * Cash on delivery, and the line it must not cross.
 *
 * The owner's decision: «القرار في الأجهزة والاكسسوارات اضف خيار لها دفع عند
 * الاستلام ابنيه». Hardware and accessories travel in a van, so there is a
 * door for the money to arrive at.
 *
 * A digital account has no door. It is handed over in the chat the moment the
 * order reads `paid`, so an unpaid digital order is either given away for
 * nothing or held for ever — and a MIXED cart is the same fault seen from the
 * other side: the game would sit undelivered, waiting on a courier who is
 * carrying a cable.
 *
 * Two things therefore have to hold, and the second is the one that costs
 * money if it slips:
 *
 *   1. The cart must not OFFER a choice the server would refuse.
 *   2. The server must not TRUST the choice the cart sent.
 *
 * Both read the same rule out of `payment-method.ts`, which imports nothing
 * from the server, so the two answers cannot drift apart.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cashOnDeliveryAllowed, isPaymentMethod, resolvePaymentMethod } from "./payment-method";

const orders = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
const cart = readFileSync(path.resolve(__dirname, "../routes/cart.tsx"), "utf8");
const ordersApi = readFileSync(path.resolve(__dirname, "../routes/api/orders.ts"), "utf8");

const line = (kind: string) => ({ kind });

describe("cash on delivery is offered only where a courier goes", () => {
  it("allows a cart of nothing but physical goods", () => {
    expect(cashOnDeliveryAllowed([line("hardware")])).toBe(true);
    expect(cashOnDeliveryAllowed([line("accessory"), line("device")])).toBe(true);
    expect(cashOnDeliveryAllowed([line("collectible"), line("physical"), line("used")])).toBe(true);
  });

  it("refuses a digital cart", () => {
    expect(cashOnDeliveryAllowed([line("game")])).toBe(false);
    expect(cashOnDeliveryAllowed([line("gift_card")])).toBe(false);
    expect(cashOnDeliveryAllowed([line("bundle")])).toBe(false);
  });

  /*
    The case worth having a test for. One cable among four games reads as a
    "shipped order" to every other question the checkout asks — and if it also
    bought the cash option, four game accounts would be held hostage to a van.
  */
  it("refuses a mixed cart, however small the physical part", () => {
    expect(cashOnDeliveryAllowed([line("game"), line("accessory")])).toBe(false);
    expect(cashOnDeliveryAllowed([line("hardware"), line("game")])).toBe(false);
  });

  it("refuses an empty cart, so `every` cannot answer true vacuously", () => {
    expect(cashOnDeliveryAllowed([])).toBe(false);
    expect(cashOnDeliveryAllowed(null)).toBe(false);
    expect(cashOnDeliveryAllowed(undefined)).toBe(false);
  });

  it("treats an unknown or missing kind as something it will not ship on trust", () => {
    expect(cashOnDeliveryAllowed([{}])).toBe(false);
    expect(cashOnDeliveryAllowed([line("")])).toBe(false);
    expect(cashOnDeliveryAllowed([line("something_new")])).toBe(false);
  });
});

describe("the method is resolved, never accepted", () => {
  it("only ever returns cash on delivery for a cart that may have it", () => {
    expect(resolvePaymentMethod("cash_on_delivery", [line("hardware")])).toBe("cash_on_delivery");
    expect(resolvePaymentMethod("cash_on_delivery", [line("game")])).toBe("wallet");
    expect(resolvePaymentMethod("cash_on_delivery", [line("game"), line("hardware")])).toBe("wallet");
  });

  it("falls back to the wallet for anything it does not recognise", () => {
    expect(resolvePaymentMethod(undefined, [line("hardware")])).toBe("wallet");
    expect(resolvePaymentMethod("", [line("hardware")])).toBe("wallet");
    expect(resolvePaymentMethod("free", [line("hardware")])).toBe("wallet");
    expect(resolvePaymentMethod({ toString: () => "cash_on_delivery" }, [line("hardware")])).toBe(
      "wallet",
    );
  });

  it("names the two methods and nothing else", () => {
    expect(isPaymentMethod("wallet")).toBe(true);
    expect(isPaymentMethod("cash_on_delivery")).toBe(true);
    expect(isPaymentMethod("cod")).toBe(false);
    expect(isPaymentMethod(null)).toBe(false);
    expect(isPaymentMethod(undefined)).toBe(false);
  });
});

describe("the checkout refuses rather than quietly charging", () => {
  /*
    Falling back to the wallet would be the worst possible answer: someone who
    had just pressed «الدفع عند الاستلام» would have the money taken anyway.
    The request is an error, and the coupon and the referral are handed back
    before it is thrown, exactly as the insufficient-balance path does.
  */
  it("throws on a cash request the cart cannot support", () => {
    expect(orders).toContain(
      'if (requestedPaymentMethod === "cash_on_delivery" && !cashOnDeliveryAllowed(items)) {',
    );
    expect(orders).toContain('throw new Error("cash_on_delivery_not_available")');
  });

  it("gives back the coupon use and the referral before throwing", () => {
    const refusal = orders.slice(
      orders.indexOf('if (requestedPaymentMethod === "cash_on_delivery"'),
      orders.indexOf('throw new Error("cash_on_delivery_not_available")'),
    );
    expect(refusal).toContain("releaseCouponUse");
    expect(refusal).toContain("releaseReferralDiscount(orderId)");
  });

  it("decides from the server's own rule, not from the request", () => {
    expect(orders).toContain('import { cashOnDeliveryAllowed, resolvePaymentMethod } from "./payment-method";');
    expect(orders).toContain("const paymentMethod = resolvePaymentMethod(requestedPaymentMethod, items);");
    expect(orders).toContain('const needsWalletPayment = paymentMethod === "wallet";');
  });

  it("records on the order which of the two it was", () => {
    expect(orders).toContain("paymentMethod,");
  });

  it("validates the field at the boundary before it reaches the checkout", () => {
    expect(ordersApi).toContain('import { isPaymentMethod } from "@/lib/payment-method";');
    expect(ordersApi).toContain("isPaymentMethod(data.paymentMethod) ? data.paymentMethod : undefined");
  });
});

describe("a cash order is not asked to pay twice", () => {
  /*
    The unpaid branch of the checkout opens the chat with a
    `payment_methods_card` — «أرسل المبلغ ثم ارفع صورة الإيصال هنا». For an
    order awaiting a ZainCash receipt that is right; for one the member elected
    to pay at the door it asks them to transfer money they have already decided
    to hand over in cash, and leaves an admin a receipt to approve that should
    never have been uploaded.
  */
  it("sends a cash confirmation instead of a transfer prompt", () => {
    expect(orders).toContain('} else if (paymentMethod === "cash_on_delivery") {');
    const branch = orders.slice(
      orders.indexOf('} else if (paymentMethod === "cash_on_delivery") {'),
      orders.indexOf('      const intro = store.adminPresence?.online'),
    );
    expect(branch).toContain("الدفع عند الاستلام");
    expect(branch).toContain("لم يُخصم من محفظتك شيء");
    // The branch's own comment names the card it is avoiding, so this asks
    // for the thing that would actually send one.
    expect(branch).not.toContain('kind: "payment_methods_card"');
  });
});

describe("the cart cannot offer what the server would refuse", () => {
  it("asks the same shared rule the server asks", () => {
    expect(cart).toContain('import { cashOnDeliveryAllowed } from "@/lib/payment-method";');
    expect(cart).toContain("const codAllowed = cashOnDeliveryAllowed(lines.map((l) => ({ kind: l.kind })));");
  });

  it("shows the choice only when the rule allows it", () => {
    expect(cart).toContain("{codAllowed && (");
    expect(cart).toContain('id="checkout-method-cod-btn"');
    expect(cart).toContain('id="checkout-method-wallet-btn"');
  });

  /*
    Removing the last accessory from a cart of games leaves `payAtDoor` true
    with nothing to justify it, and the next press would send a request the
    server throws on. The effect clears it the moment the rule stops holding.
  */
  it("drops a cash choice as soon as the cart stops qualifying", () => {
    expect(cart).toContain("if (!codAllowed && payAtDoor) setPayAtDoor(false);");
    expect(cart).toContain("}, [codAllowed, payAtDoor]);");
    expect(cart).toContain("const payFromWallet = !(codAllowed && payAtDoor);");
  });

  it("sends the choice with the checkout", () => {
    expect(cart).toContain('payFromWallet ? "wallet" : "cash_on_delivery"');
  });

  /*
    The balance gate is a wallet question. Holding a cash order to it would
    refuse the one kind of order that exists precisely because the member has
    no balance.
  */
  it("does not hold a cash order to a wallet balance", () => {
    expect(cart).toContain("const canPlaceOrder = payFromWallet ? isBalanceSufficient : true;");
    expect(cart).toContain("{canPlaceOrder ? (");
    expect(cart).not.toContain("{isBalanceSufficient ? (");
  });
});
