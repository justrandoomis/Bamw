/**
 * Three ways a coupon cost the shop, or the member, more than it said.
 *
 * ## A coupon for one product discounted everything beside it
 *
 * `eligible_products`, `eligible_categories` and `only_digital_products` were
 * a gate and nothing more: a cart holding one covered line let the coupon
 * through, and the percentage was then taken against `orderAmount` — the whole
 * basket. "20% off Mario Kart" took 20% off a 98,000 IQD gift card sitting in
 * the same cart. `single_item_percent` and the offline-account coupon were
 * already single-unit and are untouched; it is the ordinary percentage and
 * fixed coupons, the ones an admin reaches for first, that were unscoped.
 *
 * ## A coupon worth nothing still spent a use
 *
 * `useCoupon` was `Boolean(couponCandidate)` — the candidate's *existence*,
 * never its amount. A coupon that passed every rule and came out at zero was
 * claimed anyway, so a member's one lifetime redemption went on a discount of
 * nothing, and the cart had shown them 0 without saying why.
 *
 * ## The stackable checkbox did nothing
 *
 * `is_stackable` was written to the row, mapped into the shape, and shown back
 * in the admin list. Checkout read a *referral* setting and never the coupon's
 * own flag, so ticking it changed nothing. Either switch now allows stacking:
 * the shop-wide setting keeps whatever behaviour it has, and a coupon ticked
 * on its own finally does what the tick says.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCoupon, couponDiscount, eligibleSubtotal, rowToCoupon } from "./coupons";

const ROW = {
  id: "cpn_1",
  code: "SAVE20",
  discount_type: "percentage",
  discount_value: 20,
  per_user_limit: 1,
  eligible_products: "[]",
  eligible_categories: "[]",
  eligible_users: "[]",
  min_order_amount: 0,
  is_active: 1,
  created_at: "2026-01-01T00:00:00.000Z",
};

/** A game the coupon covers, and a gift card it does not. */
const GAME = { productId: "p_game", kind: "account", unitPrice: 40000, quantity: 1 };
const CARD = { productId: "p_card", kind: "account", unitPrice: 98000, quantity: 1 };
const CART = [GAME, CARD];
const CART_TOTAL = 138000;

const check = (coupon: ReturnType<typeof rowToCoupon>, items = CART, orderAmount = CART_TOTAL) =>
  checkCoupon({
    coupon,
    userId: "usr_1",
    orderAmount,
    items,
    globalUses: 0,
    userUses: 0,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

describe("a percentage coupon restricted to one product", () => {
  const coupon = rowToCoupon({ ...ROW, eligible_products: '["p_game"]' });

  it("discounts that product, not the cart around it", () => {
    // 20% of the 40,000 game — not of the 138,000 basket.
    expect(couponDiscount(coupon, CART_TOTAL, CART).discount).toBe(8000);
  });

  it("still lets the coupon through when the cart holds a covered line", () => {
    expect(check(coupon).ok).toBe(true);
  });

  it("counts quantity, so two copies are covered twice", () => {
    const two = [{ ...GAME, quantity: 2 }, CARD];
    expect(eligibleSubtotal(coupon, two)).toBe(80000);
    expect(couponDiscount(coupon, 178000, two).discount).toBe(16000);
  });
});

describe("a fixed coupon restricted to one product", () => {
  const coupon = rowToCoupon({
    ...ROW,
    discount_type: "fixed",
    discount_value: 50000,
    eligible_products: '["p_game"]',
  });

  it("can never take more off than the covered lines are worth", () => {
    expect(couponDiscount(coupon, CART_TOTAL, CART).discount).toBe(40000);
  });
});

describe("a category restriction", () => {
  const coupon = rowToCoupon({ ...ROW, eligible_categories: '["cat_games"]' });
  const cart = [
    { ...GAME, categoryId: "cat_games" },
    { ...CARD, categoryId: "cat_cards" },
  ];

  it("scopes the percentage the same way", () => {
    expect(couponDiscount(coupon, CART_TOTAL, cart).discount).toBe(8000);
  });
});

describe("a digital-only coupon", () => {
  /*
    `checkCoupon` refuses the whole coupon when any line is physical, so a
    mixed cart never reaches the discount. The scoping matters for the cart
    that passes — every line digital — where it must behave exactly as before.
  */
  const coupon = rowToCoupon({ ...ROW, only_digital_products: 1 });

  it("still discounts the whole of an all-digital cart", () => {
    expect(couponDiscount(coupon, CART_TOTAL, CART).discount).toBe(27600);
  });
});

describe("an unrestricted coupon", () => {
  const coupon = rowToCoupon(ROW);

  it("is unchanged: the percentage is of the order", () => {
    expect(couponDiscount(coupon, CART_TOTAL, CART).discount).toBe(27600);
  });

  it("is unchanged when the caller passes no items at all", () => {
    expect(couponDiscount(coupon, CART_TOTAL).discount).toBe(27600);
  });
});

describe("a coupon that is worth nothing on this cart", () => {
  it("is refused rather than accepted at zero", () => {
    // 20% of a 3 IQD line floors to 0.
    const coupon = rowToCoupon({ ...ROW, eligible_products: '["p_tiny"]' });
    const cart = [{ productId: "p_tiny", kind: "account", unitPrice: 3, quantity: 1 }];
    const verdict = check(coupon, cart, 3);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("no_discount");
  });

  it("is refused when a zero cap makes it worthless", () => {
    const coupon = rowToCoupon({ ...ROW, max_discount_amount: 0 });
    const verdict = check(coupon);
    expect(verdict.ok === false && verdict.reason).toBe("no_discount");
  });

  it("does not refuse a coupon checked with no cart", () => {
    /*
      `checkCoupon` is also called before a cart exists. Refusing there would
      turn "we cannot tell yet" into "your coupon is bad".
    */
    expect(check(rowToCoupon(ROW), [], 0).ok).toBe(true);
  });

  it("has a message a member can act on", async () => {
    const { COUPON_REFUSAL_MESSAGE } = await import("./coupons");
    expect(COUPON_REFUSAL_MESSAGE.no_discount).toContain("لا يخصم");
  });
});

describe("checkout", () => {
  const orders = readFileSync(resolve(process.cwd(), "src/lib/orders.server.ts"), "utf8");

  it("spends a coupon only when it is worth something", () => {
    expect(orders).toContain("let useCoupon = (couponCandidate?.discount ?? 0) > 0");
    expect(orders).not.toContain("let useCoupon = Boolean(couponCandidate)");
  });

  it("reads the coupon's own stackable flag, not only the referral setting", () => {
    expect(orders).toContain("couponCandidate?.coupon.isStackable");
    expect(orders).toContain("const stackingAllowed");
  });

  it("still prefers the larger discount when neither switch allows stacking", () => {
    expect(orders).toContain("if (useCoupon && useReferral && !stackingAllowed)");
  });
});

describe("the admin coupon form", () => {
  const manager = readFileSync(
    resolve(process.cwd(), "src/components/admin/CouponsManager.tsx"),
    "utf8",
  );

  it("puts local wall-clock time into a datetime-local input, not UTC", () => {
    /*
      `toISOString().slice(0, 16)` is UTC, and the input speaks local time —
      so every save of an existing coupon moved its expiry by the offset.
    */
    const code = manager.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("toISOString().slice(0, 16)");
    expect(manager).toContain("value={toDateTimeLocal(form.startAt)}");
    expect(manager).toContain("value={toDateTimeLocal(form.expirationAt)}");
  });

  it("can restrict a coupon to products, which nothing in this dialog could do", () => {
    expect(manager).toContain("المنتجات المشمولة");
    expect(manager).toContain("eligibleProducts: e.target.checked");
  });

  it("can restrict a coupon to accounts, the field the rule already enforced", () => {
    expect(manager).toContain("الحسابات المسموح لها");
    expect(manager).toContain("eligibleUsers: e.target.checked");
  });

  it("describes what the stackable box actually does", () => {
    expect(manager).toContain("خصم دعوة صديق");
    expect(manager).not.toContain("يمنع تطبيق كوبونات أخرى في نفس الطلب");
  });
});
