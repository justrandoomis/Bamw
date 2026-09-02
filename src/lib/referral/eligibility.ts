/**
 * Which purchase a referral may be paid on.
 *
 * Kept pure and separate from everything that touches the database, because it
 * is the rule the whole programme's cost depends on and it has to be readable
 * on its own. Two independent gates have to agree before a line qualifies:
 * the **product** must be in the programme, and the **selection** must be an
 * offline account — the store's owner set the discount on offline accounts
 * only, plain or with add-ons.
 */

import { isOfflineAccountSelection } from "../offlineAccount";
import { getProductCategory, type CategoryType } from "../productSection";
import type { ReferralSettings } from "./config";
import { percentToBps, toBps } from "./money";

/**
 * Product kinds that can never earn, whatever category they are filed under.
 *
 * A wallet top-up would pay a commission on money moving into the shop, and a
 * subscription bills again next month with nobody to attribute it to. The
 * category whitelist already excludes most of these; this is the second lock,
 * for a product filed under the wrong category.
 */
const EXCLUDED_KINDS = new Set([
  "hardware",
  "device",
  "accessory",
  "collectible",
  "amiibo",
  "used",
  "gift_card",
  "digital_code",
  "topup",
  "wallet_topup",
  "recharge",
  "subscription",
  "membership",
  "marketplace",
  "external",
  "service",
]);

/** Every reason a line can fail, so the admin log can say which one it was. */
export type ReferralIneligibleReason =
  | "programme_disabled"
  | "product_excluded"
  | "category_excluded"
  | "kind_excluded"
  | "marketplace_item"
  | "not_offline_account"
  | "no_price"
  | "not_the_shared_product";

export interface ReferralLineSelection {
  productId: string | number;
  kind?: string | null;
  quantity?: number;
  unitPriceIqd: number;
  optionId?: string | null;
  optionName?: string | null;
  typeId?: string | null;
  typeName?: string | null;
  offerKind?: string | null;
}

export interface ReferralEligibility {
  eligible: boolean;
  reason?: ReferralIneligibleReason;
  /** Rate for this product, after any per-product override. */
  buyerPercentBps: number;
  referrerPercentBps: number;
}

/** Read a per-product rate override, in whole percent or basis points. */
function productRate(product: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = product[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const bps = /bps$/i.test(key) ? toBps(raw) : percentToBps(raw);
    if (bps !== undefined) return bps;
  }
  return fallback;
}

/** Has the admin taken this product out of the programme by hand? */
export function isProductReferralExcluded(product: Record<string, unknown> | undefined): boolean {
  if (!product) return true;
  for (const key of ["referralEligible", "referral_eligible"]) {
    const raw = product[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw === "boolean") return !raw;
    const text = String(raw).trim().toLowerCase();
    if (["0", "false", "no", "off", "لا"].includes(text)) return true;
    if (["1", "true", "yes", "on", "نعم"].includes(text)) return false;
  }
  return false;
}

/** Is this product from an outside marketplace rather than the shop's stock? */
function isMarketplaceProduct(product: Record<string, unknown>): boolean {
  for (const key of ["isMarketplace", "is_marketplace", "isExternal", "is_external", "isUsed", "is_used"]) {
    const raw = product[key];
    if (raw === true || raw === 1 || String(raw ?? "").toLowerCase() === "true") return true;
  }
  const source = String(product["source"] ?? product["listingSource"] ?? "").toLowerCase();
  return source === "marketplace" || source === "external" || source === "used_marketplace";
}

/**
 * Decide one cart line.
 *
 * Returns the rates alongside the verdict so a caller never has to work out
 * which override applied — the same numbers are then written onto the order,
 * which is what makes a reward auditable months later.
 */
export function evaluateReferralLine(params: {
  settings: ReferralSettings;
  product: Record<string, unknown> | undefined;
  line: ReferralLineSelection;
  /** The product the share link was for, when the attribution names one. */
  sharedProductId?: string | null;
}): ReferralEligibility {
  const { settings, product, line } = params;
  const fallback: ReferralEligibility = {
    eligible: false,
    buyerPercentBps: settings.buyerPercentBps,
    referrerPercentBps: settings.referrerPercentBps,
  };

  if (!settings.enabled) return { ...fallback, reason: "programme_disabled" };
  if (!product) return { ...fallback, reason: "product_excluded" };

  const buyerPercentBps = productRate(
    product,
    ["referralBuyerPercentBps", "referralBuyerPercent", "referral_buyer_percent"],
    settings.buyerPercentBps,
  );
  const referrerPercentBps = productRate(
    product,
    [
      "referralOwnerPercentBps",
      "referralOwnerPercent",
      "referral_owner_percent",
      "referralReferrerPercent",
    ],
    settings.referrerPercentBps,
  );
  const rated: ReferralEligibility = { eligible: false, buyerPercentBps, referrerPercentBps };

  if (isProductReferralExcluded(product)) return { ...rated, reason: "product_excluded" };
  if (isMarketplaceProduct(product)) return { ...rated, reason: "marketplace_item" };

  const category: CategoryType = getProductCategory(product);
  if (!settings.eligibleCategories.includes(category)) {
    return { ...rated, reason: "category_excluded" };
  }

  const kind = String(line.kind ?? product["kind"] ?? "").trim().toLowerCase();
  if (kind && EXCLUDED_KINDS.has(kind)) return { ...rated, reason: "kind_excluded" };

  if (
    params.sharedProductId &&
    String(params.sharedProductId) !== String(line.productId)
  ) {
    return { ...rated, reason: "not_the_shared_product" };
  }

  /*
    The offline-account rule.

    Read from the identifiers the line actually carries — never from text on
    the page — by the same resolver the offline-only coupons use, so the two
    features cannot disagree about what an offline account is.
  */
  if (
    !isOfflineAccountSelection({
      optionId: line.optionId ?? null,
      optionName: line.optionName ?? null,
      typeId: line.typeId ?? null,
      typeName: line.typeName ?? null,
      kind: line.kind ?? (product["kind"] as string | undefined) ?? null,
      offerKind: line.offerKind ?? null,
    })
  ) {
    return { ...rated, reason: "not_offline_account" };
  }

  /*
    The price is the catalogue's.

    Read from the product rather than the line on purpose: callers that reach
    here from a request deliberately zero the line's price so a browser cannot
    influence it, and judging eligibility on that zero would refuse every
    referral applied from the cart.
  */
  const catalogPrice = Number(product["price"] ?? 0);
  if (!(catalogPrice > 0) && !(Number(line.unitPriceIqd) > 0)) {
    return { ...rated, reason: "no_price" };
  }

  return { ...rated, eligible: true };
}
