/**
 * What this batch sells for.
 *
 * Deliberately separate from `nintendoPricing`, which prices the existing
 * catalogue. Two of the owner's rules for this batch disagree with it — an
 * offline band reaching 18,000 rather than 15,000, and a floor of 10,000 profit
 * on online rather than a multiplier — and editing the shared engine to satisfy
 * them would reprice games that are already selling.
 */

/** Where a tier sits between the floor and the ceiling of the offline band. */
const POSITION = { flagship: 1, major: 0.65, standard: 0.35, niche: 0.12 };

/**
 * How far above the 10,000 floor an online account is priced.
 *
 * A multiplier was the obvious thing and is the wrong thing: 1.28x pays 1,692
 * on Shovel Knight's 5,808 line and 23,310 on Atelier Ryza's 82,940 one, which
 * is a ranking by supplier cost rather than by how well either game sells.
 */
const DEMAND_BONUS = { flagship: 9000, major: 5000, standard: 2000, niche: 0 };

export const OFFLINE_BAND = { min: 5000, max: 18000 };
export const MIN_ONLINE_PROFIT = 10000;

export const round250 = (v) => Math.round(v / 250) * 250;

/**
 * Up to the next 250, never down.
 *
 * The online price is a floor plus a margin, and rounding it to the nearest
 * step rounds *through* the floor whenever the total is not already a multiple
 * of 250: a 12,540 cost plus 10,000 is 22,540, which rounds to 22,500 and pays
 * 9,960. Six of this batch's lines landed just under the floor that way.
 */
export const ceil250 = (v) => Math.ceil(v / 250) * 250;

/**
 * Split a game's variants into offline and online by the owner's mapping:
 * with two, the cheaper is offline; with four, the cheaper two are.
 *
 * Ordering is by cost, not by the order they were written, because the rule is
 * about which is cheaper. Edition names are carried through untouched.
 */
export function splitByAccount(variants) {
  const ordered = [...variants].sort((a, b) => a.cost - b.cost);
  const offlineCount = ordered.length >= 4 ? 2 : 1;
  return ordered.map((v, i) => ({ ...v, account: i < offlineCount ? "offline" : "online" }));
}

/**
 * Price one game's variants.
 *
 * Offline sits in the band by demand. Where a pair of offline variants exists,
 * the dearer one is lifted above the cheaper by what the extra content actually
 * cost, so the ladder reflects content rather than a flat step.
 */
export function priceVariants(variants, tier) {
  const split = splitByAccount(variants);
  const position = POSITION[tier];
  if (position === undefined) throw new Error(`unknown demand tier: ${tier}`);
  const bonus = DEMAND_BONUS[tier];

  const offline = split.filter((v) => v.account === "offline");
  const online = split.filter((v) => v.account === "online");
  const out = [];

  let basePrice;
  offline.forEach((v, i) => {
    let price;
    let reason;
    if (i === 0) {
      price = round250(OFFLINE_BAND.min + (OFFLINE_BAND.max - OFFLINE_BAND.min) * position);
      reason = `${tier}, placed in the ${OFFLINE_BAND.min.toLocaleString()}–${OFFLINE_BAND.max.toLocaleString()} offline band`;
      if (price <= v.cost) {
        price = round250(v.cost * 1.6);
        reason += `; lifted clear of the ${v.cost.toLocaleString()} cost`;
      }
      basePrice = price;
    } else {
      const extra = Math.max(0, v.cost - offline[0].cost);
      price = round250(basePrice + extra * 2);
      reason = `offline base plus ${extra.toLocaleString()} of extra content at twice its cost`;
    }
    /* The band is a rule, not a suggestion. */
    if (price > OFFLINE_BAND.max) {
      price = OFFLINE_BAND.max;
      reason += `; capped at the ${OFFLINE_BAND.max.toLocaleString()} ceiling`;
    }
    out.push({ ...v, price, margin: price - v.cost, reason });
  });

  online.forEach((v) => {
    const price = ceil250(v.cost + MIN_ONLINE_PROFIT + bonus);
    out.push({
      ...v,
      price,
      margin: price - v.cost,
      reason: `${MIN_ONLINE_PROFIT.toLocaleString()} floor plus ${bonus.toLocaleString()} for a ${tier} title, on a ${v.cost.toLocaleString()} cost`,
    });
  });

  return out;
}

/** Every rule this batch is held to, checked on the result rather than assumed. */
export function checkPricing(priced) {
  const problems = [];
  for (const v of priced) {
    if (!Number.isFinite(v.price) || v.price <= 0) problems.push(`${v.name}: price is not a positive number`);
    if (!Number.isFinite(v.cost) || v.cost <= 0) problems.push(`${v.name}: cost is not a positive number`);
    if (v.price <= v.cost) problems.push(`${v.name}: price ${v.price} does not clear cost ${v.cost}`);
    if (v.account === "offline") {
      if (v.price < OFFLINE_BAND.min || v.price > OFFLINE_BAND.max) {
        problems.push(`${v.name}: offline ${v.price} is outside ${OFFLINE_BAND.min}–${OFFLINE_BAND.max}`);
      }
    } else if (v.margin < MIN_ONLINE_PROFIT) {
      problems.push(`${v.name}: online profit ${v.margin} is under ${MIN_ONLINE_PROFIT}`);
    }
  }
  return problems;
}
