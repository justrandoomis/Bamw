/**
 * The owner's price rise for the yuan at 280, as pure functions.
 *
 *   «دمج التعديل · رفع الاسعار التكلفه وسعر البيع · ارفع الاسعار كلها خصوصا
 *    التي ترى عليها طلب حتى لو قليل · مثلا mario kart world سعرها الحالي ٩ الف
 *    فبعد الزباده تصبح ١٢ الف · وهكذا مع البقيه»
 *
 * His one worked example fixes the rule: 9,000 → 12,000 is the 25% he named
 * in his first message («اليوان صعد بنسبه 25%»), rounded UP to the next
 * thousand — 11,250 → 12,000. Rounded to the nearest it would be 11,000, and
 * he wrote 12. So every selling price becomes ceil1000(price × 1.25), and
 * every supplier cost moves with the yuan, × 280 / 220.
 *
 * Kept apart from the script so a test can hold the rule against his example
 * and against every shape a product stores a price in.
 */

/** Product-level fields that carry a selling price. */
export const PRICE_KEYS = [
  "price",
  "basePrice",
  "accountPrice",
  "accountOnlinePrice",
  "originalPrice",
];
/** Product-level fields that carry the supplier cost. */
export const COST_KEYS = ["cost", "costPrice", "baseCost"];
/** Lists of rows a product prices through, under every name the catalogue uses. */
export const ROW_LISTS = ["types", "variants", "options", "editions", "dlcs"];
export const ROW_PRICE_KEYS = ["price", "originalPrice"];
export const ROW_COST_KEYS = ["cost"];
/** A compare-at price: shown struck through, never charged, never held against cost. */
const COMPARE_AT = "originalPrice";

/**
 * Prices this rise leaves alone on purpose, because they are not a yuan
 * account: a physical cartridge lent or sold inside Iraq, and what the shop
 * pays for a disc traded in. Named so the report can say so, rather than
 * listing them as fields nobody looked at.
 */
export const NOT_YUAN_PRICED = new Set(["lendPrice", "discPrice", "trade_value_iqd"]);

/** Written on every product this rise touched, so it can never touch it twice. */
export const MARK_KEY = "priceRevision";

export const markFor = (oldRate, newRate) => `yuan-${oldRate}-${newRate}`;

/** A positive amount, or null for anything that is not one — empty means «inherits». */
export function amountOf(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The new selling price: ×(1 + rise), rounded to the dinar first so floating
 * arithmetic cannot push an exact thousand over the edge, then UP to the next
 * whole thousand — the owner's 9,000 → 12,000.
 */
export function risePrice(price, rise) {
  const n = amountOf(price);
  if (n === null) return null;
  return Math.ceil(Math.round(n * (1 + rise)) / 1000) * 1000;
}

/** The new cost, × the rate, to the fil (two decimals): a cost is a yuan amount × the rate. */
export function moveCost(cost, factor) {
  const n = amountOf(cost);
  if (n === null) return null;
  return Math.round(n * factor * 100) / 100;
}

/** The lowest whole thousand that is at least 1,000 above a cost. */
const aboveCost = (cost) => Math.ceil((cost + 1000) / 1000) * 1000;

/** A value written back in the type it was read in: a price stored as text stays text. */
const sameType = (before, after) => (typeof before === "string" ? String(after) : after);

/** True when this rise has already been applied to the document. */
export const isRaised = (doc, mark) => Boolean(doc && doc[MARK_KEY] === mark);

/**
 * Everything one product's rise changes, and the product with it applied.
 *
 * Returns `{ next, changes, guarded }`. `changes` lists every path that moved
 * with its amount before and after; nothing else in `next` differs from `doc`
 * except the mark.
 *
 * THE COPIES OF ONE PRICE STAY ONE PRICE. A product carries its offline price
 * in `price`, `accountPrice`, the tier row and the variant row, and the shop
 * reads whichever its screen reads. The rise is one function of the old
 * amount, so copies that agreed before agree after — and the one exception,
 * a price lifted above its own new cost, is applied to every copy of that
 * same old amount in the product, not to the row that happened to carry the
 * cost. `guarded` lists each lifted copy and why.
 */
export function planProduct(doc, { rise, factor, mark }) {
  const next = { ...doc };
  const changes = [];
  const guarded = [];

  /* 1. Costs first, so every price can be held above its own new cost. */
  let productCost = null;
  for (const key of COST_KEYS) {
    if (!(key in doc)) continue;
    const after = moveCost(doc[key], factor);
    if (after === null) continue;
    changes.push({ path: key, kind: "cost", before: amountOf(doc[key]), after });
    next[key] = sameType(doc[key], after);
    if (productCost === null) productCost = after;
  }

  /* 2. Every selling price, with the cost it must stay above. */
  const prices = [];
  for (const key of PRICE_KEYS) {
    if (!(key in doc)) continue;
    const amount = amountOf(doc[key]);
    if (amount === null) continue;
    prices.push({
      path: key,
      raw: doc[key],
      amount,
      cost: key === COMPARE_AT ? null : productCost,
      compareAt: key === COMPARE_AT,
      write: (value) => {
        next[key] = value;
      },
    });
  }
  for (const list of ROW_LISTS) {
    if (!Array.isArray(doc[list])) continue;
    const rows = doc[list].map((row) => (row && typeof row === "object" ? { ...row } : row));
    let touched = false;
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      let rowCost = null;
      for (const key of ROW_COST_KEYS) {
        if (!(key in row)) continue;
        const after = moveCost(row[key], factor);
        if (after === null) continue;
        changes.push({
          path: `${list}[${index}].${key}`,
          kind: "cost",
          before: amountOf(row[key]),
          after,
        });
        row[key] = sameType(row[key], after);
        rowCost = after;
        touched = true;
      }
      for (const key of ROW_PRICE_KEYS) {
        if (!(key in row)) continue;
        const amount = amountOf(row[key]);
        if (amount === null) continue;
        touched = true;
        prices.push({
          path: `${list}[${index}].${key}`,
          raw: row[key],
          amount,
          cost: key === COMPARE_AT ? null : rowCost,
          compareAt: key === COMPARE_AT,
          write: (value) => {
            row[key] = value;
          },
        });
      }
    });
    if (touched) next[list] = rows;
  }

  /* 3. What each sale price needs: the rise, or the next thousand above its cost. */
  const need = new Map();
  for (const p of prices) {
    p.rose = risePrice(p.amount, rise);
    p.floor = !p.compareAt && p.cost !== null && p.rose <= p.cost ? aboveCost(p.cost) : p.rose;
    if (!p.compareAt) need.set(p.amount, Math.max(need.get(p.amount) ?? 0, p.floor));
  }

  /* 4. One answer per old amount, written to every copy of it. */
  for (const p of prices) {
    const after = p.compareAt ? p.rose : Math.max(p.rose, need.get(p.amount) ?? p.rose);
    if (after > p.rose) {
      guarded.push({
        path: p.path,
        before: p.amount,
        rose: p.rose,
        after,
        why: p.floor > p.rose ? "own-cost" : "copy",
      });
    }
    changes.push({ path: p.path, kind: "price", before: p.amount, after });
    p.write(sameType(p.raw, after));
  }

  if (changes.length) next[MARK_KEY] = mark;
  return { next, changes, guarded };
}

/** A bundle's own price and the add-ons on its account options, under the same rule. */
export function planBundle(bundle, { rise, mark }) {
  const next = { ...bundle };
  const changes = [];
  for (const key of ["price", "originalPrice"]) {
    if (!(key in bundle)) continue;
    const after = risePrice(bundle[key], rise);
    if (after === null) continue;
    changes.push({ path: key, kind: "price", before: amountOf(bundle[key]), after });
    next[key] = sameType(bundle[key], after);
  }
  if (Array.isArray(bundle.accountOptions)) {
    next.accountOptions = bundle.accountOptions.map((option, index) => {
      if (!option || typeof option !== "object" || !("extraPrice" in option)) return option;
      const after = risePrice(option.extraPrice, rise);
      if (after === null) return option;
      changes.push({
        path: `accountOptions[${index}].extraPrice`,
        kind: "price",
        before: amountOf(option.extraPrice),
        after,
      });
      return { ...option, extraPrice: sameType(option.extraPrice, after) };
    });
  }
  if (changes.length) next[MARK_KEY] = mark;
  return { next, changes };
}

/** Read a value back by one of the paths the planners report. */
export function valueAt(doc, path) {
  const match = /^(\w+)\[(\d+)\]\.(\w+)$/.exec(path);
  if (!match) return doc?.[path];
  const rows = doc?.[match[1]];
  return Array.isArray(rows) ? rows[Number(match[2])]?.[match[3]] : undefined;
}

/**
 * Every leaf path at which two documents differ, in the planners' path format.
 *
 * The rehearsal asks this of the real document and its planned successor, and
 * requires the answer to be exactly the planned paths plus the mark. Anything
 * else — a row the planner rebuilt differently, a key it dropped — is a change
 * nobody planned, and is found before it is written.
 */
export function diffPaths(a, b, prefix = "") {
  const out = [];
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const path = prefix ? `${prefix}.${key}` : key;
      const x = a[key];
      const y = b[key];
      if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
        x.forEach((row, i) => {
          if (isObj(row) && isObj(y[i])) out.push(...diffPaths(row, y[i], `${path}[${i}]`));
          else if (canonical(row) !== canonical(y[i])) out.push(`${path}[${i}]`);
        });
      } else if (isObj(x) && isObj(y)) {
        out.push(...diffPaths(x, y, path));
      } else if (!(key in a) || !(key in b) || canonical(x) !== canonical(y)) {
        out.push(path);
      }
    }
    return out;
  }
  return canonical(a) === canonical(b) ? [] : [prefix || "(root)"];
}

/** JSON with every object's keys sorted: two documents equal in content print the same. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * The patterns of every price-like field a document carries, with counts:
 * `price`, `types[].cost`, `regions[].offer.price`.
 *
 * The planners know a fixed list of fields. This is how a run finds out
 * whether the catalogue agrees with that list — a price kept somewhere the
 * list does not name would otherwise stay at the old rate, silently, beside
 * copies that moved.
 */
export function priceLikePatterns(doc, prefix = "", depth = 0, out = new Map()) {
  if (!doc || typeof doc !== "object" || depth > 3) return out;
  for (const [key, value] of Object.entries(doc)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          priceLikePatterns(row, `${prefix}${key}[].`, depth + 1, out);
        }
      }
    } else if (value && typeof value === "object") {
      priceLikePatterns(value, `${prefix}${key}.`, depth + 1, out);
    } else if (/price|cost|amount|fee|iqd/i.test(key) && amountOf(value) !== null) {
      const pattern = `${prefix}${key}`;
      out.set(pattern, (out.get(pattern) ?? 0) + 1);
    }
  }
  return out;
}

/** The patterns `planProduct` moves. Anything else `priceLikePatterns` finds is reported. */
export const HANDLED_PATTERNS = new Set([
  ...PRICE_KEYS,
  ...COST_KEYS,
  ...ROW_LISTS.flatMap((list) =>
    [...ROW_PRICE_KEYS, ...ROW_COST_KEYS].map((key) => `${list}[].${key}`),
  ),
]);
