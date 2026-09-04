import type { Coupon, DiscountType } from "./types";
import { isOfflineAccountSelection } from "./offlineAccount";

/**
 * Coupons live in D1 as snake_case columns and are used everywhere else as the
 * camelCase `Coupon` shape. Casting the raw row to `Coupon` — which is what the
 * validator did — type-checks against nothing and reads `undefined` at runtime,
 * so every limit on the coupon silently disappeared: no expiry, no usage cap,
 * no per-member cap, no minimum order. One mapper, used by every reader, is
 * what keeps those rules real.
 */
export interface CouponRow {
  id?: unknown;
  code?: unknown;
  discount_type?: unknown;
  discount_value?: unknown;
  start_at?: unknown;
  expiration_at?: unknown;
  usage_limit?: unknown;
  per_user_limit?: unknown;
  eligible_products?: unknown;
  eligible_categories?: unknown;
  eligible_users?: unknown;
  min_order_amount?: unknown;
  max_discount_amount?: unknown;
  is_active?: unknown;
  only_digital_products?: unknown;
  is_stackable?: unknown;
  once_per_user_lifetime?: unknown;
  offline_account_only?: unknown;
  created_at?: unknown;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

export function getCouponRemainingTime(expirationAt?: string): {
  isExpired: boolean;
  remainingMs: number;
  remainingText: string;
} {
  if (!expirationAt) {
    return { isExpired: false, remainingMs: Infinity, remainingText: "صلاحية غير محدودة" };
  }
  const expTime = new Date(expirationAt).getTime();
  if (isNaN(expTime)) {
    return { isExpired: false, remainingMs: Infinity, remainingText: "صلاحية غير محدودة" };
  }
  const diffMs = expTime - Date.now();
  if (diffMs <= 0) {
    return { isExpired: true, remainingMs: 0, remainingText: "منتهي الصلاحية" };
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return {
      isExpired: false,
      remainingMs: diffMs,
      remainingText: `متبقي ${days} يوم${hours > 0 ? ` و ${hours} ساعة` : ""}`,
    };
  }
  if (hours > 0) {
    return {
      isExpired: false,
      remainingMs: diffMs,
      remainingText: `متبقي ${hours} ساعة${minutes > 0 ? ` و ${minutes} دقيقة` : ""}`,
    };
  }
  return {
    isExpired: false,
    remainingMs: diffMs,
    remainingText: `متبقي ${Math.max(1, minutes)} دقيقة`,
  };
}

export function rowToCoupon(row: CouponRow | any): Coupon {
  const rawType = String(row.discount_type ?? row.discountType ?? "fixed").toLowerCase();
  let discountType: DiscountType = "fixed";
  if (rawType === "percentage") discountType = "percentage";
  else if (
    rawType === "single_item_percent" ||
    rawType === "single_item" ||
    rawType === "single_game_50"
  ) {
    discountType = "single_item_percent";
  }

  const startAt = row.start_at
    ? String(row.start_at)
    : row.startAt
      ? String(row.startAt)
      : undefined;
  const expiration = row.expiration_at
    ? String(row.expiration_at)
    : row.expires_at
      ? String(row.expires_at)
      : row.expirationAt
        ? String(row.expirationAt)
        : undefined;
  const usageLimit = optionalNumber(row.usage_limit ?? row.usageLimit);
  const maxDiscount = optionalNumber(row.max_discount_amount ?? row.maxDiscountAmount);
  const perUserLimit = optionalNumber(row.per_user_limit ?? row.perUserLimit) ?? 1;
  const oncePerUserLifetime =
    discountType === "single_item_percent" ||
    (row.once_per_user_lifetime !== undefined && row.once_per_user_lifetime !== null
      ? Boolean(Number(row.once_per_user_lifetime))
      : row.oncePerUserLifetime !== undefined
        ? Boolean(row.oncePerUserLifetime)
        : false);

  const offlineAccountOnly = Boolean(
    Number(row.offline_account_only ?? (row.offlineAccountOnly ? 1 : 0)),
  );

  return {
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    discountType,
    discountValue:
      optionalNumber(row.discount_value ?? row.discountValue) ??
      (discountType === "single_item_percent" ? 50 : 0),
    ...(startAt ? { startAt, start_at: startAt } : {}),
    ...(expiration
      ? { expirationAt: expiration, expiration_at: expiration, expires_at: expiration }
      : {}),
    ...(usageLimit !== undefined && usageLimit > 0 ? { usageLimit, usage_limit: usageLimit } : {}),
    perUserLimit,
    per_user_limit: perUserLimit,
    eligibleProducts: jsonList(row.eligible_products ?? row.eligibleProducts),
    eligibleCategories: jsonList(row.eligible_categories ?? row.eligibleCategories),
    eligibleUsers: jsonList(row.eligible_users ?? row.eligibleUsers),
    minOrderAmount: optionalNumber(row.min_order_amount ?? row.minOrderAmount) ?? 0,
    ...(maxDiscount !== undefined
      ? { maxDiscountAmount: maxDiscount, max_discount_amount: maxDiscount }
      : {}),
    isActive:
      row.is_active === undefined && row.isActive === undefined
        ? true
        : Boolean(Number(row.is_active ?? (row.isActive ? 1 : 0))),
    is_active:
      row.is_active === undefined && row.isActive === undefined
        ? 1
        : Number(Boolean(Number(row.is_active ?? (row.isActive ? 1 : 0)))),
    onlyDigitalProducts: Boolean(
      Number(row.only_digital_products ?? (row.onlyDigitalProducts ? 1 : 0)),
    ),
    only_digital_products: Number(
      Boolean(Number(row.only_digital_products ?? (row.onlyDigitalProducts ? 1 : 0))),
    ),
    isStackable: Boolean(Number(row.is_stackable ?? (row.isStackable ? 1 : 0))),
    is_stackable: Number(Boolean(Number(row.is_stackable ?? (row.isStackable ? 1 : 0)))),
    oncePerUserLifetime,
    once_per_user_lifetime: Number(oncePerUserLifetime),
    offlineAccountOnly,
    offline_account_only: Number(offlineAccountOnly),
    createdAt: String(row.created_at ?? row.createdAt ?? ""),
    created_at: String(row.created_at ?? row.createdAt ?? ""),
  };
}

/** Item kinds a digital-only coupon must refuse. */
const PHYSICAL_KINDS = ["hardware", "physical", "accessory", "device", "collectible"];

export function isPhysicalKind(kind: string | undefined): boolean {
  return PHYSICAL_KINDS.includes(String(kind ?? "").toLowerCase());
}

export interface CouponCheckItem {
  productId: string | number;
  categoryId?: string | number;
  kind?: string;
  unitPrice?: number;
  quantity?: number;
  title?: string;
  /*
    The selection the member actually made, as stored on the line. A coupon
    restricted to offline accounts is decided from these — never from the text
    shown in the cart, which the browser controls.
  */
  optionId?: string | number | null;
  optionName?: string | null;
  typeId?: string | number | null;
  typeName?: string | null;
  offerKind?: string | null;
}

export interface CouponCheckInput {
  coupon: Coupon;
  userId: string;
  orderAmount: number;
  items: CouponCheckItem[];
  globalUses: number;
  userUses: number;
  lifetimeSingleItemUses?: number;
  targetProductId?: string | number;
  now?: Date;
}

export type CouponRefusal =
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit"
  | "per_user_limit"
  | "lifetime_single_item_used"
  | "min_order"
  | "not_eligible"
  | "no_eligible_products"
  | "no_offline_account_item"
  | "digital_only"
  | "no_discount";

/**
 * Filter items in the cart that match the coupon eligibility constraints.
 */
export function getEligibleItems(coupon: Coupon, items: CouponCheckItem[]): CouponCheckItem[] {
  let list = items;
  /*
    Offline-account coupons.

    The restriction is on the *selection*, not on the product: the same Nintendo
    game bought as an online account is not eligible, and neither is hardware, a
    bundle or anything else that has no offline-account option to pick. Deciding
    it from `optionId`/`typeId` is what makes it hold — the label in the cart is
    the browser's to write.
  */
  if (coupon.offlineAccountOnly) {
    list = list.filter((it) => isOfflineAccountSelection(it));
  }
  if (coupon.onlyDigitalProducts) {
    list = list.filter((it) => !isPhysicalKind(it.kind));
  }
  if (coupon.eligibleProducts && coupon.eligibleProducts.length > 0) {
    const allowed = new Set(coupon.eligibleProducts.map(String));
    list = list.filter((it) => allowed.has(String(it.productId)));
  }
  if (coupon.eligibleCategories && coupon.eligibleCategories.length > 0) {
    const allowedCats = new Set(coupon.eligibleCategories.map(String));
    list = list.filter((it) => it.categoryId && allowedCats.has(String(it.categoryId)));
  }
  return list;
}

/**
 * Is this coupon restricted to *some* of a cart rather than all of it?
 *
 * `single_item_percent` and an offline-account coupon have always been
 * single-unit and are handled on their own path. These are the restrictions
 * that select a subset of lines and were then discounted as if they had
 * selected the whole cart.
 */
export function isProductScoped(coupon: Coupon): boolean {
  return (
    (coupon.eligibleProducts?.length ?? 0) > 0 ||
    (coupon.eligibleCategories?.length ?? 0) > 0 ||
    coupon.onlyDigitalProducts === true
  );
}

/** What the lines a coupon actually covers are worth, at cart prices. */
export function eligibleSubtotal(coupon: Coupon, items: CouponCheckItem[]): number {
  return getEligibleItems(coupon, items).reduce(
    (sum, item) => sum + Math.max(0, item.unitPrice ?? 0) * Math.max(1, item.quantity ?? 1),
    0,
  );
}

/**
 * The single set of rules a coupon has to pass, shared by the checkout path and
 * the "check this code" call so the two can never disagree about whether a
 * coupon applies.
 */
export function checkCoupon(
  input: CouponCheckInput,
): { ok: true; targetProduct?: CouponCheckItem } | { ok: false; reason: CouponRefusal } {
  const { coupon } = input;
  const now = input.now ?? new Date();

  if (!coupon.isActive) return { ok: false, reason: "inactive" };

  if (coupon.startAt && new Date(coupon.startAt).getTime() > now.getTime()) {
    return { ok: false, reason: "not_started" };
  }

  if (coupon.expirationAt && new Date(coupon.expirationAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  /*
    Global usage cap across all members.

    Only ever enforced when the admin actually set one. An empty "total uses"
    field means unlimited, so no number of redemptions by any number of members
    can exhaust the coupon — that is the difference between this rule and the
    per-member rule below, and conflating the two is what made a
    one-per-customer coupon stop working for everybody after its first use.
  */
  if (
    coupon.usageLimit !== undefined &&
    coupon.usageLimit !== null &&
    coupon.usageLimit > 0 &&
    input.globalUses >= coupon.usageLimit
  ) {
    return { ok: false, reason: "usage_limit" };
  }

  // Lifetime single-item restriction (50% single item discount)
  if (coupon.discountType === "single_item_percent") {
    if ((input.lifetimeSingleItemUses ?? 0) > 0) {
      return { ok: false, reason: "lifetime_single_item_used" };
    }
  }

  /*
    "Once per account, ever."

    The flag was read from the row, mapped, stored and shown in the admin list,
    but only ever *enforced* for `single_item_percent` — so ticking it on an
    ordinary percentage or fixed coupon did nothing at all. It caps the member
    at one use regardless of `perUserLimit`.
  */
  if (coupon.oncePerUserLifetime && input.userUses >= 1) {
    return { ok: false, reason: "per_user_limit" };
  }

  /*
    Per-member limit. This is the *only* limit a single member's usage can trip:
    member A exhausting their allowance says nothing about member B. The global
    cap above is a separate, optional rule.
  */
  const maxUserUses = coupon.perUserLimit && coupon.perUserLimit > 0 ? coupon.perUserLimit : 1;
  if (input.userUses >= maxUserUses) {
    return { ok: false, reason: "per_user_limit" };
  }

  if (input.orderAmount < coupon.minOrderAmount) {
    return { ok: false, reason: "min_order" };
  }

  if (coupon.eligibleUsers.length > 0 && !coupon.eligibleUsers.includes(input.userId)) {
    return { ok: false, reason: "not_eligible" };
  }

  if (coupon.onlyDigitalProducts && input.items.some((item) => isPhysicalKind(item.kind))) {
    return { ok: false, reason: "digital_only" };
  }

  // Check eligible products for single_item_percent, an offline-account
  // restriction, or a specific product restriction.
  if (
    coupon.discountType === "single_item_percent" ||
    coupon.offlineAccountOnly ||
    (coupon.eligibleProducts && coupon.eligibleProducts.length > 0)
  ) {
    const eligible = getEligibleItems(coupon, input.items);
    if (eligible.length === 0) {
      return {
        ok: false,
        reason: coupon.offlineAccountOnly ? "no_offline_account_item" : "no_eligible_products",
      };
    }

    // Determine target item: if user selected a specific productId, verify it's eligible
    let targetItem: CouponCheckItem | undefined;
    if (input.targetProductId) {
      targetItem = eligible.find((it) => String(it.productId) === String(input.targetProductId));
    }
    if (!targetItem) {
      // Default to highest priced eligible item
      targetItem = [...eligible].sort((a, b) => (b.unitPrice || 0) - (a.unitPrice || 0))[0];
    }

    if (worthNothing(input)) return { ok: false, reason: "no_discount" };
    return { ok: true, targetProduct: targetItem };
  }

  if (worthNothing(input)) return { ok: false, reason: "no_discount" };
  return { ok: true };
}

/**
 * A coupon that passes every rule and is worth zero.
 *
 * Checkout spent one of the member's uses for it anyway: the candidate was
 * built from `couponDiscount`, `useCoupon` was `Boolean(candidate)` rather
 * than anything about the amount, and `claimCouponUse` ran. The member lost
 * their one redemption of a "once per account" coupon and got nothing off —
 * and the cart had shown them a discount of 0 without saying why.
 *
 * Refusing it here means both surfaces agree: the cart explains it, and
 * checkout never reaches the claim.
 */
function worthNothing(input: CouponCheckInput): boolean {
  if (input.items.length === 0) return false;
  const { discount } = couponDiscount(
    input.coupon,
    input.orderAmount,
    input.items,
    input.targetProductId,
  );
  return discount <= 0;
}

/**
 * The discount a passing coupon is worth, capped and never larger than the order.
 * For `single_item_percent`: applies strictly to 1 single unit of the chosen/highest-price eligible game.
 */
export function couponDiscount(
  coupon: Coupon,
  orderAmount: number,
  items: CouponCheckItem[] = [],
  targetProductId?: string | number,
): {
  discount: number;
  targetProductId?: string | number;
  targetTitle?: string;
  singleUnitPrice?: number;
} {
  /*
    A single-unit discount, whatever the discount type.

    `single_item_percent` always worked this way. An offline-account coupon has
    to as well: the rule is "one eligible game, one copy", so a cart holding two
    offline games — or one offline game with quantity 3 — still gets the
    discount on a single unit of a single line. A percentage is therefore taken
    against that unit's price, never against the order total.
  */
  if (coupon.discountType === "single_item_percent" || coupon.offlineAccountOnly) {
    const eligible = getEligibleItems(coupon, items);
    if (eligible.length === 0) {
      return { discount: 0 };
    }

    let targetItem: CouponCheckItem | undefined;
    if (targetProductId) {
      targetItem = eligible.find((it) => String(it.productId) === String(targetProductId));
    }
    if (!targetItem) {
      // Sort by unit price descending so the user gets the best discount on 1 unit by default
      targetItem = [...eligible].sort((a, b) => (b.unitPrice || 0) - (a.unitPrice || 0))[0];
    }

    if (!targetItem) return { discount: 0 };

    const unitPrice = Math.max(0, targetItem.unitPrice || 0);

    // Strict 1-unit discount calculation. A fixed-amount coupon takes its
    // amount off that one unit; a percentage takes its share of it.
    let baseDiscount: number;
    if (coupon.discountType === "fixed") {
      baseDiscount = Math.min(Math.floor(coupon.discountValue), Math.floor(unitPrice));
    } else {
      const percent = coupon.discountValue > 0 ? coupon.discountValue : 50;
      baseDiscount = Math.floor(unitPrice * (percent / 100));
    }
    const capped =
      coupon.maxDiscountAmount !== undefined
        ? Math.min(baseDiscount, coupon.maxDiscountAmount)
        : baseDiscount;

    const discount = Math.min(Math.max(0, Math.floor(capped)), Math.floor(orderAmount));
    return {
      discount,
      targetProductId: targetItem.productId,
      targetTitle: targetItem.title,
      singleUnitPrice: unitPrice,
    };
  }

  /*
    A coupon for one product discounts that product, not the cart around it.

    `eligibleProducts`, `eligibleCategories` and `onlyDigitalProducts` were
    only ever a pass/fail gate: a cart containing one eligible line let the
    coupon through, and the discount was then taken against `orderAmount` —
    the whole basket. "20% off Mario Kart" took 20% off a gift card sitting
    beside it. The gate is unchanged; what moved is the amount the percentage
    is a percentage *of*.

    Only when the caller passed the cart. `couponDiscount` is also called with
    no items, and there is nothing to scope to then — the order total is the
    only figure in the room.
  */
  const scoped = items.length > 0 && isProductScoped(coupon);
  const base_amount = scoped ? Math.min(eligibleSubtotal(coupon, items), orderAmount) : orderAmount;

  const base =
    coupon.discountType === "percentage"
      ? Math.floor(base_amount * (coupon.discountValue / 100))
      : Math.min(coupon.discountValue, base_amount);
  const capped =
    coupon.maxDiscountAmount !== undefined ? Math.min(base, coupon.maxDiscountAmount) : base;

  if (!Number.isFinite(capped) || capped <= 0) return { discount: 0 };
  const discount = Math.min(Math.floor(capped), Math.floor(orderAmount));
  return { discount };
}

export const COUPON_REFUSAL_MESSAGE: Record<CouponRefusal, string> = {
  inactive: "الكوبون غير موجود أو غير فعال",
  not_started: "الكوبون غير متاح للاستخدام بعد",
  expired: "انتهت صلاحية الكوبون",
  usage_limit: "تم استنفاد عدد مرات استخدام الكوبون",
  per_user_limit: "لقد استخدمت هذا الكوبون مسبقاً",
  lifetime_single_item_used:
    "لقد استفدت مسبقاً من عرض الخصم 50% على لعبة واحدة (متاح مرة واحدة فقط لكل حساب)",
  min_order: "قيمة الطلب أقل من الحد الأدنى لاستخدام الكوبون",
  not_eligible: "هذا الكوبون غير مخصص لحسابك",
  no_eligible_products: "السلة لا تحتوي على أي لعبة مؤهلة لهذا الكوبون",
  no_offline_account_item:
    "هذا الكوبون يُطبَّق فقط على لعبة Nintendo مشتراة بخيار «حساب أوفلاين»، ولا توجد في سلتك لعبة بهذا الخيار",
  digital_only: "هذا الكوبون صالح فقط للمنتجات الرقمية.",
  no_discount: "هذا الكوبون لا يخصم شيئاً على محتويات سلتك الحالية",
};
