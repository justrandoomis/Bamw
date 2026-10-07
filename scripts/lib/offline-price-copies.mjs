/**
 * One ordinary offline price per game — the highest of its stored copies.
 *
 *   «هنالك العاب لم تتأثر بالصعود او صعودها قليل حل المشكلة، بقيت على الاسعار
 *    القديمه بالرغم السعر صعد مثل zelda و lego batman و بعض اجزاء ماريو وغيرها
 *    او اصلا الاسعار صعدت بشكل قليل»
 *
 * The yuan rise moved every copy of every price by the same rule, so copies
 * that DISAGREED before still disagree after. And they did disagree: Mario
 * Tennis Aces carried a base price of 5,000 beside an offline account row of
 * 7,000; LEGO Batman a base of 16,000 beside an account price of 12,000. The
 * card prints the cheapest buyable copy — the stale low one — so after the
 * rise it printed 7,000 where the owner's own offline price had been 7,000
 * before. A game that rose looked like a game that had not.
 *
 * So every stored copy of a game's ordinary offline price — `price`,
 * `accountPrice`, and each row the shop's own `classifyTier` calls the
 * ordinary offline account — is lifted to the highest of them. Never lowered:
 * the owner asked for prices to go up, and a stale copy is always the lower.
 *
 * Copies further apart than `MAX_SPREAD`, or a top copy above
 * `OFFLINE_CEILING`, are not one price that drifted; they are two different
 * prices filed in the same place (an online price in `accountPrice`, say). Those
 * are held for the owner, never guessed at.
 */
import { amountOf } from "./yuan-reprice.mjs";

/** Lists a game's ordinary offline account can be a priced row in. */
export const OFFLINE_ROW_LISTS = ["types", "variants", "options"];
/** The widest gap between copies that is still one price that drifted. */
export const MAX_SPREAD = 1.6;
/** No ordinary offline account in this shop costs more than this. */
export const OFFLINE_CEILING = 40_000;

/** Every stored copy of the ordinary offline price, with where it lives. */
export function offlineCopies(doc, isOrdinaryOffline) {
  const copies = [];
  for (const key of ["price", "accountPrice"]) {
    const amount = amountOf(doc?.[key]);
    if (amount !== null) copies.push({ path: key, amount, raw: doc[key] });
  }
  for (const list of OFFLINE_ROW_LISTS) {
    if (!Array.isArray(doc?.[list])) continue;
    doc[list].forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      const amount = amountOf(row.price);
      if (amount === null || !isOrdinaryOffline(row)) return;
      copies.push({ path: `${list}[${index}].price`, amount, raw: row.price });
    });
  }
  return copies;
}

/**
 * The plan for one game: every lower copy lifted to the highest.
 *
 * Returns `{ next, changes, held, target }`. `changes` lists each copy moved,
 * with its amount before and after; nothing else in `next` differs from `doc`.
 * `held` is the reason the game was left alone, or null.
 */
export function planOfflineSync(doc, isOrdinaryOffline) {
  const copies = offlineCopies(doc, isOrdinaryOffline);
  const amounts = [...new Set(copies.map((c) => c.amount))];
  if (amounts.length <= 1)
    return { next: doc, changes: [], held: null, target: amounts[0] ?? null };

  const hi = Math.max(...amounts);
  const lo = Math.min(...amounts);
  if (hi > OFFLINE_CEILING) {
    return {
      next: doc,
      changes: [],
      held: `أعلى نسخة ${hi.toLocaleString("en-US")} فوق سقف الأوفلاين`,
      target: null,
    };
  }
  if (hi / lo > MAX_SPREAD) {
    return {
      next: doc,
      changes: [],
      held: `نسختان متباعدتان (${lo.toLocaleString("en-US")} و${hi.toLocaleString("en-US")})`,
      target: null,
    };
  }

  const next = { ...doc };
  const changes = [];
  const rows = new Map();
  for (const copy of copies) {
    if (copy.amount >= hi) continue;
    const value = typeof copy.raw === "string" ? String(hi) : hi;
    const match = /^(\w+)\[(\d+)\]\.price$/.exec(copy.path);
    if (match) {
      const list = match[1];
      if (!rows.has(list)) {
        rows.set(
          list,
          doc[list].map((row) => (row && typeof row === "object" ? { ...row } : row)),
        );
      }
      rows.get(list)[Number(match[2])].price = value;
    } else {
      next[copy.path] = value;
    }
    changes.push({ path: copy.path, before: copy.amount, after: hi });
  }
  for (const [list, copied] of rows) next[list] = copied;
  return { next, changes, held: null, target: hi };
}
