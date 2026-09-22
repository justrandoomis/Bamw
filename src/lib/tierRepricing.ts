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
  skipReason,
  ONLINE_MAX_MARGIN,
  ONLINE_MIN_MARGIN,
  OUTLIER,
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
  /*
    THE HUNDRED-THOUSAND BACKSTOP, PER TIER.

    `skipReason` refuses anything priced or costed above 100,000 as a device
    rather than a game, and the product-level call below cannot ask it — a
    product has four prices, not one, so that call passes cost: 1, price: 1
    and only the kind, the schema and the title decide anything there.

    Which left the backstop reaching `offline_base` alone, through
    `repriceOne`. A product with `kind: "game"` and a harmless title carrying
    two tiers at cost 250,000 / price 300,000 contradicted itself inside one
    product: the offline row held as «جهاز لا لعبة», the online row cut to
    265,000 — thirty-five thousand dinars off a console — and `tierProblem`
    returned null, because a 15,000 margin is inside the online band.

    The backstop exists precisely because `kind` is unreliable: `repricing.ts`
    documents an eShop card that "came through the catalogue as a game". Asked
    here, it covers all four tiers, because `tierSkip` runs before every
    branch.
  */
  if (tier.cost >= OUTLIER || tier.price >= OUTLIER) {
    return "جهاز لا لعبة (سعر أو تكلفة فوق 100,000)";
  }
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

  /*
    IS THIS A GAME AT ALL? Asked once, for the whole product, before any tier
    is priced.

    This check used to reach only the plain offline tier, because it lives
    inside `repriceOne` and only that branch called it. The online and add-ons
    branches went straight to `onlinePriceFor` and `dlcPriceFor`. So a Nintendo
    Switch 2 console — `kind: "hardware"`, an online tier at 300,000 on a cost
    of 250,000 — was proposed at 265,000, because the online band says a profit
    of 50,000 is too much. A thirty-five thousand dinar cut on a console, from
    a module whose own documentation says it does not price hardware.

    Found by an adversarial reviewer and reproduced before it was believed. It
    is the exact shape of the owner's hard constraint: commercial data on
    things that are not games is not this script's to touch.

    `skipReason` also refuses gift cards, which are sold near face value, and
    anything priced or costed above 100,000 — a device, not a game.
  */
  const productSkip = skipReason({
    id: product.id,
    title: product.title,
    ...(product.kind !== undefined ? { kind: product.kind } : {}),
    ...(product.schemaId !== undefined ? { schemaId: product.schemaId } : {}),
    /*
      A cost and a price that cannot themselves fail the check, because at the
      product level there is no single one of either — a game has four. Only
      the kind, the schema and the title decide anything here, and the
      per-tier cost and price are checked by `tierSkip` below.
    */
    cost: 1,
    price: 1,
  });
  if (productSkip) {
    return {
      id: product.id,
      title: product.title,
      proposals: tiers.map((tier, index) => held(tier, index, productSkip)),
      changed: false,
    };
  }

  /*
    The plain offline price is computed FIRST and once, because the add-ons
    edition is priced from it. Using the current base price for the add-ons
    while moving the base itself would leave the two inconsistent by exactly
    the amount the base moved.
  */
  let newOfflineBase = offlineBase?.price ?? 0;
  /*
    Did the plain offline tier actually get a price from the rules?

    `tierSkip` and `repriceOne`'s own `skipReason` are two different refusals,
    and the add-ons branch used to consult only the first. When the second
    fired, `newOfflineBase` silently stayed at the tier's CURRENT price and the
    add-ons row was priced on top of a number the rules had declined to
    endorse — while `tierProblem`'s "add-ons must beat plain" check, which
    reads `base.skipped`, was disabled in exactly that case. Both the rule and
    its gate looked away together.
  */
  let offlineBasePriced = false;
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
      offlineBasePriced = true;
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
      if (!offlineBase || tierSkip(offlineBase) || !offlineBasePriced) {
        return held(tier, index, "لا توجد طبقة أوفلاين عادية تُبنى عليها");
      }
      /*
        THIS row's cost gap, not the first add-ons row's.

        `tierOf` returns the first match, and this used to compute one gap
        outside the loop and apply it to every add-ons row. A product with two
        — a small add-on at cost 2,300 and the full edition at cost 12,000 —
        priced BOTH from the first one's gap of 300, so the full edition came
        out at 9,000 against a cost of 12,000. Three thousand dinars lost on
        every sale, and the report would have printed the right cost beside
        the wrong price.

        The gate would have caught it (`price <= cost`) and stopped the run,
        which is the gate earning its place — but a rule that has to be caught
        by a gate is a broken rule.
      */
      const gap = extrasCostGap(offlineBase, tier);
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

    /*
      ONLINE, AND FIRST: is this cost even the online account's?

      The owner, on Super Smash Bros. Ultimate: «السعر في الsuper smash bros
      ultimate كان للاونلاين ، لكن التكلفه هي للاوفلاين». Its online tier
      carries a cost of 1,750 — which is an offline cost, put in the online
      tier's field. The price of 32,000 is correct; the cost is not.

      Left alone, the band does what it is told and lands the price at 16,000:
      a correct price halved on the strength of a wrong number, with every
      guard passing, because a 10,000 margin over 1,750 is a perfectly legal
      answer to the wrong question.

      An online account costs MORE than the offline one — that is what makes
      it the dearer tier. So a cost at or below the offline tier's cannot be
      this tier's own, and a price computed from it is a guess. Held, and
      reported, so the COST gets fixed and the price follows.

      The test is the ordering, deliberately, and not a threshold on the
      amount. «الدقه اهم شي», and "an online account should cost at least N"
      would be a number I made up.
    */
    if (offlineBase && !tierSkip(offlineBase) && tier.cost <= offlineBase.cost) {
      return held(
        tier,
        index,
        `تكلفة الأونلاين ${tier.cost.toLocaleString("en-US")} ليست أعلى من تكلفة الأوفلاين ${offlineBase.cost.toLocaleString("en-US")} — تبدو تكلفة الأوفلاين وُضعت هنا`,
      );
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

  /*
    An add-ons edition priced at or below its own plain edition is the one
    shape of these rules that costs the shop money silently — the customer
    takes the richer edition for the same money.

    Checked for BOTH accounts. It used to be checked for the offline pair
    only, and the online pair is priced by a band on the margin that knows
    nothing about the other tier: an online add-ons edition whose cost is
    close to the plain one's can land at or under it.
  */
  if (proposal.kind === "offline_extras" || proposal.kind === "online_extras") {
    const plainKind = proposal.kind === "offline_extras" ? "offline_base" : "online_base";
    const base = result.proposals.find((p) => p.kind === plainKind);
    if (base && !base.skipped && price <= Number(base.newPrice)) {
      return `سعر الإضافات ${price} لا يزيد على العادي ${base.newPrice}`;
    }
  }

  return null;
}
