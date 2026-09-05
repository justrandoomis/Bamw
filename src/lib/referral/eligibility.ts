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
import { resolveUnitPrice } from "../productPricing";
import { getProductCategory, type CategoryType } from "../productSection";
import type { ReferralSettings } from "./config";
import { percentToBps, toBps } from "./money";

/**
 * Product kinds that can never earn, whatever the settings say.
 *
 * Structural impossibilities only, and that is the point of the list. A wallet
 * top-up would pay a commission on money moving *into* the shop; a
 * subscription bills again next month with nobody to attribute it to; a
 * marketplace listing is somebody else's stock, so there is no margin of the
 * shop's to pay out of. None of those is a decision an admin should be able to
 * change, so none of them is a setting.
 *
 * It used to also carry `hardware`, `device`, `accessory`, `collectible`,
 * `amiibo`, `used`, `gift_card` and `digital_code` — every one of which is a
 * *category*, and every one of which the admin's own category whitelist
 * decides. Two locks reading the same question and answering it differently is
 * how the last change to that whitelist did nothing at all: it opened hardware,
 * amiibo, accessories and used stock to the programme, and this list went on
 * refusing all four by kind. A setting that cannot change the outcome is worse
 * than no setting, because it reads as a decision that has been made.
 *
 * The margin floor below is what protects the thin ones now, and it protects
 * them by arithmetic rather than by a list somebody has to remember to update.
 */
const EXCLUDED_KINDS = new Set([
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
  | "margin_too_thin"
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
  /*
    The edition and the add-ons, which decide the price as much as the option
    does — an offline account *with DLC* is the selection this programme was
    written for, and it does not cost the record's headline price.
  */
  editionId?: string | null;
  dlcIds?: readonly string[] | null;
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

/**
 * What one copy costs the shop, under any of the names the record uses.
 *
 * Unlike the price, there is one cost per product — no option or edition
 * carries its own — so a selection that is dearer than the base reads as a
 * wider margin, which is the safe direction to be wrong in.
 */
function productCost(product: Record<string, unknown>): number {
  for (const key of ["cost", "costPrice", "cost_price", "purchasePrice", "buyPrice", "unitCost"]) {
    const value = Number(product[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
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

  /*
    The shared-product rule, now a setting and off by default.

    A link shared from a game's page records that game, and this refused every
    other purchase — so a friend who followed a link, looked around, and bought
    something else was told the code could not be applied. A referral brings a
    customer to the shop, not to one shelf of it.
  */
  if (
    settings.restrictToSharedProduct &&
    params.sharedProductId &&
    String(params.sharedProductId) !== String(line.productId)
  ) {
    return { ...rated, reason: "not_the_shared_product" };
  }

  /*
    The offline-account rule, now a setting and off by default.

    This was the narrowest rule in the programme: every online account, every
    piece of hardware, every amiibo and every used item failed it, so the offer
    survived only on an offline-account line of the exact shared game. Left on,
    it is the single likeliest reason a referral code appears not to work.

    Read from the identifiers the line actually carries — never from text on
    the page — by the same resolver the offline-only coupons use, so the two
    features cannot disagree about what an offline account is.
  */
  if (
    settings.offlineAccountsOnly &&
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
    The price is the catalogue's, for what was actually chosen.

    Read from the product rather than the line on purpose: callers that reach
    here from a request deliberately zero the line's price so a browser cannot
    influence it, and judging eligibility on that zero would refuse every
    referral applied from the cart. Resolved through the same function that
    prices the quote and charges the order, so a product priced only on its
    options — nothing on the record's `price` field — is not read as having no
    price and refused.
  */
  const catalogPrice = resolveUnitPrice(product, {
    optionId: line.optionId ?? null,
    typeId: line.typeId ?? null,
    editionId: line.editionId ?? null,
    dlcIds: line.dlcIds ?? null,
  }).unitPrice;
  if (!(catalogPrice > 0) && !(Number(line.unitPriceIqd) > 0)) {
    return { ...rated, reason: "no_price" };
  }

  /*
    Never pay more away than the sale makes.

    A referred order gives up both halves at once — the friend's discount comes
    off the price and the referrer's reward comes out of what is left — so the
    shop parts with twenty per cent of a sale it still has to buy the stock
    for. Whether that is a promotion or a loss is a fact about the margin, and
    the margin is not the same across the catalogue. Measured against the live
    catalogue on 5 Sep: 141 games from 40.6% up to 91.5%, comfortably clear;
    eight gift cards at 2.9% or worse, every one of which would be sold at a
    loss; one console at 21.2%, which survives with 1.2% left.

    The gift cards were kept out by name, which worked exactly as long as
    somebody remembered to keep the list current. This is the same judgement as
    arithmetic, so it also covers the product added next month that nobody
    thought to exclude.

    A product with no cost on record is allowed through: refusing it would take
    the programme away from a whole catalogue the moment costs went unfilled,
    and "unknown" is not "thin". Every product live today has one.
  */
  const price = catalogPrice > 0 ? catalogPrice : Number(line.unitPriceIqd);
  const cost = productCost(product);
  if (cost > 0 && price > 0) {
    const marginBps = ((price - cost) / price) * 10_000;
    if (marginBps < buyerPercentBps + referrerPercentBps) {
      return { ...rated, reason: "margin_too_thin" };
    }
  }

  return { ...rated, eligible: true };
}
