/**
 * The owner's pricing rules, applied to a game's four prices.
 *
 * `repricing.ts` holds the rules and the sentences that produced them.
 * `tierPricing.ts` says which of a game's tiers is which. This module is the
 * join: for each tier, which rule owns it, what it should cost, and why.
 *
 * The four rules, in the owner's own words:
 *
 *   offline, plain    the discount rules — «هذا التخفيض هو فقط للحساب
 *                     الاوفلاين العادي او dlc». Cost ≤ 2,000 floors at 5,000
 *                     and ceilings at 12,000; above 2,000 the profit is never
 *                     under 5,000.
 *   offline, add-ons  the plain offline price PLUS what the add-ons are worth,
 *                     computed from the COST GAP: «انا اقصد تكون زياده ٢٠٠٠
 *                     فقط ... فرق التكلفه ١٠٠٠٠ يكون زياده السعر ١٢٠٠٠».
 *   online, plain     profit between 10,000 and 15,000.
 *   online, add-ons   the same band — «سواء كان عادي او مع الاضافات».
 *
 * Two things this module will not do, and both are deliberate.
 *
 * It will not price a tier it cannot identify. `classifyTier` returns
 * "unknown" for a row that names neither account type or both, and an unknown
 * tier is reported and left exactly as it is. A rule applied to the wrong
 * tier is worse than no rule, because it is applied confidently to a real
 * price on a live shop.
 *
 * And it will not price the add-ons edition without the plain one. The
 * add-ons price is a plain price plus an increase; with no plain tier there is
 * nothing to add to, and inventing a base from the product's headline price
 * would be guessing with the owner's margin.
 */
import {
  dlcPriceFor,
  onlinePriceFor,
  repriceOne,
  ONLINE_MAX_MARGIN,
  ONLINE_MIN_MARGIN,
  type RepriceProduct,
} from "./repricing";
import {
  classifyTiers,
  extrasCostGap,
  tierOf,
  type ClassifiedTier,
  type TierKind,
} from "./tierPricing";

export interface TierProposal {
  kind: TierKind | "unknown";
  /** Where the tier sits in the product's own `types` array. */
  index: number;
  id: string;
  name: string;
  cost: number;
  oldPrice: number;
  newPrice: number;
  changed: boolean;
  /** Why, in the owner's terms. Empty when the tier was skipped. */
  reason: string;
  /** Set when this tier is out of scope; `newPrice` then equals `oldPrice`. */
  skipped: string | null;
}

export interface TierRepriceResult {
  id: string;
  title: string;
  proposals: TierProposal[];
  /** True when any tier's price would move. */
  changed: boolean;
}

const isThousand = (value: number) => value % 1_000 === 0;

/** A tier with no cost or no price is not a tier this can reason about. */
function tierSkip(tier: ClassifiedTier): string | null {
  if (tier.kind === "unknown") return "طبقة غير معروفة — لا تُسعَّر";
  if (!Number.isFinite(tier.cost) || tier.cost <= 0) return "بلا تكلفة مسجّلة";
  if (!Number.isFinite(tier.price) || tier.price <= 0) return "بلا سعر مسجّل";
  return null;
}

function held(tier: ClassifiedTier, index: number, skipped: string): TierProposal {
  return {
    kind: tier.kind,
    index,
    id: tier.id,
    name: tier.name,
    cost: tier.cost,
    oldPrice: tier.price,
    newPrice: tier.price,
    changed: false,
    reason: "",
    skipped,
  };
}

/**
 * What each of a product's tiers should cost.
 *
 * `product` supplies only the fields the rules read — the kind and schema that
 * decide whether this is a game at all, and the title for the report.
 */
export function repriceTiers(product: {
  id: string;
  title: string;
  kind?: string;
  schemaId?: string;
  types?: unknown;
}): TierRepriceResult {
  const tiers = classifyTiers(product.types);
  const offlineBase = tierOf(tiers, "offline_base");
  const offlineExtras = tierOf(tiers, "offline_extras");

  /*
    The plain offline price is computed FIRST and once, because the add-ons
    edition is priced from it. Using the current base price for the add-ons
    while moving the base itself would leave the two inconsistent by exactly
    the amount the base moved.
  */
  let newOfflineBase = offlineBase?.price ?? 0;
  if (offlineBase && !tierSkip(offlineBase)) {
    const asProduct: RepriceProduct = {
      id: product.id,
      title: product.title,
      ...(product.kind !== undefined ? { kind: product.kind } : {}),
      ...(product.schemaId !== undefined ? { schemaId: product.schemaId } : {}),
      cost: offlineBase.cost,
      price: offlineBase.price,
    };
    const decision = repriceOne(asProduct);
    if (!decision.skipped && Number.isFinite(Number(decision.newPrice))) {
      newOfflineBase = Number(decision.newPrice);
    }
  }

  const proposals: TierProposal[] = tiers.map((tier, index) => {
    const skip = tierSkip(tier);
    if (skip) return held(tier, index, skip);

    if (tier.kind === "offline_base") {
      const decision = repriceOne({
        id: product.id,
        title: product.title,
        ...(product.kind !== undefined ? { kind: product.kind } : {}),
        ...(product.schemaId !== undefined ? { schemaId: product.schemaId } : {}),
        cost: tier.cost,
        price: tier.price,
      });
      if (decision.skipped) return held(tier, index, decision.skipped);
      const next = Number(decision.newPrice);
      return {
        kind: tier.kind,
        index,
        id: tier.id,
        name: tier.name,
        cost: tier.cost,
        oldPrice: tier.price,
        newPrice: next,
        changed: next !== tier.price,
        reason: decision.reason,
        skipped: null,
      };
    }

    if (tier.kind === "offline_extras") {
      /*
        No plain offline tier means nothing to add the increase to. Reported
        rather than invented: the product's headline `price` is not reliably
        the offline account's price on a template product, and guessing here
        would guess with the owner's margin.
      */
      if (!offlineBase || tierSkip(offlineBase)) {
        return held(tier, index, "لا توجد طبقة أوفلاين عادية تُبنى عليها");
      }
      const gap = extrasCostGap(offlineBase, offlineExtras);
      if (gap <= 0) {
        /*
          The add-ons cost the same as the plain edition, or less. That is a
          data fault in the costs, not a price to compute — and it must not
          become "the same price as plain", which would sell the add-ons for
          nothing.
        */
        return held(tier, index, "فرق تكلفة الإضافات غير موجب — راجع التكلفة");
      }
      /*
        Through `dlcPriceFor`, not `base + dlcIncreaseFor(gap)` spelled out
        again here. It is the same arithmetic plus the rounding to a whole
        thousand, and two copies of one rule is how they come to disagree.
      */
      const next = dlcPriceFor(newOfflineBase, gap);
      const increase = next - newOfflineBase;
      return {
        kind: tier.kind,
        index,
        id: tier.id,
        name: tier.name,
        cost: tier.cost,
        oldPrice: tier.price,
        newPrice: next,
        changed: next !== tier.price,
        reason: `أوفلاين عادي ${newOfflineBase.toLocaleString("en-US")} + زيادة ${increase.toLocaleString("en-US")} لفرق تكلفة ${gap.toLocaleString("en-US")}`,
        skipped: null,
      };
    }

    // online_base and online_extras — the same band, «سواء كان عادي او مع الاضافات».
    const next = onlinePriceFor(tier.cost, tier.price);
    return {
      kind: tier.kind,
      index,
      id: tier.id,
      name: tier.name,
      cost: tier.cost,
      oldPrice: tier.price,
      newPrice: next,
      changed: next !== tier.price,
      reason:
        next === tier.price
          ? "الربح داخل النطاق 10–15 ألف"
          : `ربح بين ${ONLINE_MIN_MARGIN.toLocaleString("en-US")} و${ONLINE_MAX_MARGIN.toLocaleString("en-US")} — التكلفة ${tier.cost.toLocaleString("en-US")}`,
      skipped: null,
    };
  });

  return {
    id: product.id,
    title: product.title,
    proposals,
    changed: proposals.some((p) => p.changed),
  };
}

/**
 * A proposal that would break one of the owner's own rules.
 *
 * The last gate before a write. Every one of these is a bug in the rules
 * above rather than a property of the catalogue, so hitting one must stop the
 * whole run — a pricing script that skips the products it cannot price
 * correctly and writes the rest has written an arbitrary subset.
 */
export function tierProblem(proposal: TierProposal, result: TierRepriceResult): string | null {
  if (proposal.skipped) return null;
  const price = Number(proposal.newPrice);
  const cost = Number(proposal.cost);

  if (!Number.isFinite(price) || price <= 0) return "سعر غير صالح";
  if (!isThousand(price)) return `${price} ليس مضاعفًا لألف`;
  if (price <= cost) return `${price} لا يزيد على التكلفة ${cost}`;

  if (proposal.kind === "online_base" || proposal.kind === "online_extras") {
    const margin = price - cost;
    if (margin < ONLINE_MIN_MARGIN) return `ربح الأونلاين ${margin} تحت ${ONLINE_MIN_MARGIN}`;
    if (margin > ONLINE_MAX_MARGIN) return `ربح الأونلاين ${margin} فوق ${ONLINE_MAX_MARGIN}`;
  }

  if (proposal.kind === "offline_extras") {
    /*
      An add-ons edition priced at or below the plain one is the one shape of
      this rule that would cost the shop money silently — the customer takes
      the richer edition for the same money.
    */
    const base = result.proposals.find((p) => p.kind === "offline_base");
    if (base && !base.skipped && price <= Number(base.newPrice)) {
      return `سعر الإضافات ${price} لا يزيد على العادي ${base.newPrice}`;
    }
  }

  return null;
}
