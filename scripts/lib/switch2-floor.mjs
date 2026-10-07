/**
 * A price floor for the Switch 2 games people actually want.
 *
 *   «ليس كل نسخ سويتش ٢ لكن الاسعار الغاليه والتي عليها طلب عالي تبدأ من ١٠
 *    الف للسويتش ٢ · ركز على سويتش ٢ · مثلا زيلدا سويتش ٢ بسعر ١٢ الف ·
 *    دونكي كونك بنانزا ب١٢ الف وغيرها · يعني الاسعار تكون منطقيه اكثر»
 *
 * Not every Switch 2 game — the ones in demand, or dear to buy. The owner's
 * examples fix the two levels: Zelda's Switch 2 editions and Donkey Kong Bananza at
 * 12,000 are the shop's own FLAGSHIP titles (`nintendoDemandTiers.ts`, «reasons
 * to own the console»), so flagship Switch 2 games are 12,000; and the rest of
 * what is in high demand or expensive «starts from 10,000».
 *
 * Only the ordinary offline account moves, every stored copy of it, and only
 * ever UP: a game already dearer than its floor keeps its price. Online prices
 * are left as the yuan rise set them. An add-ons edition that would end up
 * barely above — or below — the new base is lifted to base + 2,000, the step
 * the owner gave for add-ons («تكون زياده ٢٠٠٠»).
 *
 * The one way down is `planCorrection`: a price THIS rule wrote, taken back to
 * the step it should have been — and only while every copy still carries
 * exactly what the rule wrote, so no later edit is ever undone.
 */
import { offlineCopies } from "./offline-price-copies.mjs";
import { amountOf } from "./yuan-reprice.mjs";

/** «زيلدا سويتش ٢ بسعر ١٢ الف · دونكي كونك بنانزا ب١٢ الف». */
export const FLAGSHIP_PRICE = 12_000;
/** «الاسعار الغاليه والتي عليها طلب عالي تبدأ من ١٠ الف للسويتش ٢». */
export const IN_DEMAND_FLOOR = 10_000;
/** The add-ons edition's step above the base. */
export const EXTRAS_STEP = 2_000;

/**
 * The floor one Switch 2 game is held to, and why — or null for a game the
 * rule leaves alone. `tier` is the shop's own demand tier for the game,
 * `inDemand` whether its orders put it among the most-ordered Switch 2 games,
 * `expensive` whether it is dear to buy.
 */
export function floorFor({ isSwitch2, tier, inDemand = false, expensive = false }) {
  if (!isSwitch2) return null;
  if (tier === "flagship") return { target: FLAGSHIP_PRICE, why: "flagship" };
  if (tier === "major") return { target: IN_DEMAND_FLOOR, why: "major" };
  if (inDemand) return { target: IN_DEMAND_FLOOR, why: "orders" };
  if (expensive) return { target: IN_DEMAND_FLOOR, why: "cost" };
  return null;
}

/**
 * `doc` with each `{ path, raw, after }` written — `path` either a top-level
 * key or `list[index].price` — kept the type each price was stored in.
 * Returns `{ next, changes }`; nothing else in `next` differs from `doc`.
 */
function rewrite(doc, edits) {
  const next = { ...doc };
  const changes = [];
  const rows = new Map();
  const rowsOf = (list) => {
    if (!rows.has(list)) {
      rows.set(
        list,
        doc[list].map((row) => (row && typeof row === "object" ? { ...row } : row)),
      );
    }
    return rows.get(list);
  };
  for (const { path: pathText, before, raw, after } of edits) {
    const value = typeof raw === "string" ? String(after) : after;
    const match = /^(\w+)\[(\d+)\]\.price$/.exec(pathText);
    if (match) rowsOf(match[1])[Number(match[2])].price = value;
    else next[pathText] = value;
    changes.push({ path: pathText, before, after });
  }
  for (const [list, copied] of rows) next[list] = copied;
  return { next, changes };
}

/**
 * One game held to `target`: every copy of its ordinary offline price lifted
 * to the target (never lowered), and an add-ons edition kept a step above.
 *
 * Returns `{ next, changes, base }`; `changes` lists each price moved with its
 * amount before and after, and nothing else in `next` differs from `doc`.
 */
export function planFloor(doc, { target, isOrdinaryOffline, isOfflineExtras }) {
  const copies = offlineCopies(doc, isOrdinaryOffline);
  if (!copies.length) return { next: doc, changes: [], base: null };
  const current = Math.max(...copies.map((c) => c.amount));
  const base = Math.max(current, target);
  if (base === current) return { next: doc, changes: [], base };

  const edits = copies
    .filter((copy) => copy.amount < base)
    .map((copy) => ({ path: copy.path, before: copy.amount, raw: copy.raw, after: base }));

  /* The add-ons edition, a step above the new base — never pulled down. */
  for (const list of ["types", "variants", "options"]) {
    if (!Array.isArray(doc[list])) continue;
    doc[list].forEach((row, index) => {
      if (!row || typeof row !== "object" || !isOfflineExtras(row)) return;
      const amount = amountOf(row.price);
      if (amount === null || amount >= base + EXTRAS_STEP) return;
      edits.push({
        path: `${list}[${index}].price`,
        before: amount,
        raw: row.price,
        after: base + EXTRAS_STEP,
      });
    });
  }

  const { next, changes } = rewrite(doc, edits);
  return { next, changes, base };
}

/**
 * A price this rule wrote, taken back to `to`: every ordinary offline copy,
 * all of them at exactly `from`, set to `to`. The add-ons edition is left as
 * it is — it stands a step above `from`, so above `to` too.
 *
 * Returns `{ next, changes, base }` like `planFloor`, with nothing to change
 * once every copy is already at `to` — or null when any copy carries a price
 * other than `from` or `to`: somebody has priced the game since, and a
 * correction never undoes that.
 */
export function planCorrection(doc, { from, to, isOrdinaryOffline }) {
  const copies = offlineCopies(doc, isOrdinaryOffline);
  if (!copies.length) return null;
  if (copies.every((c) => c.amount === to)) return { next: doc, changes: [], base: to };
  if (copies.some((c) => c.amount !== from)) return null;
  const { next, changes } = rewrite(
    doc,
    copies.map((copy) => ({ path: copy.path, before: copy.amount, raw: copy.raw, after: to })),
  );
  return { next, changes, base: to };
}
