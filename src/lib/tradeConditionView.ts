/**
 * A trade request's condition, in words the shop owner can read.
 *
 * ## Why this exists
 *
 * The customer answers seven questions about the disc — box, box condition,
 * cartridge and scratches, extras and manual, cleanliness, region, and how
 * they want to be paid — and every answer is stored. None of it ever reached
 * the person who has to price the trade.
 *
 * Two faults, one on top of the other:
 *
 * 1. The answers are stored as a JSON **string** in `disc_trades.selections`,
 *    the admin endpoint returns the row unparsed, and the admin card guarded
 *    its condition panel with `typeof trade.selections === "object"` — never
 *    true for a string. The whole panel was unreachable.
 * 2. Under that, the stored value is the rule's `key`. Even parsed, the card
 *    would have printed `cart_scratched` and `no_box`, because the Arabic text
 *    lives in `trade_rules.label_ar` and the card never loaded the rules.
 *
 * So the resolution happens here, on the server, where the rules already are.
 * The client receives finished labels rather than keys plus a lookup table it
 * would have to fetch and join itself.
 *
 * The percentage each answer moves the price is included, because that is the
 * number that explains a quote to whoever is deciding whether to accept it.
 */

import { CATEGORY_LABEL_AR, CATEGORY_ORDER, type TradeRule } from "./trade-calc";

export interface ConditionAnswer {
  category: string;
  categoryLabel: string;
  /** The stored rule key, kept so a mismatch is debuggable. */
  value: string;
  /** The rule's Arabic label, or the raw key when no rule matches it. */
  valueLabel: string;
  /** How much this answer moves the price, as a percentage. */
  percent: number;
  /** True when no active rule matched — the label is then the raw key. */
  unknown: boolean;
}

/** `selections` as stored: a JSON string on every row written by the form. */
export function parseSelections(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
    );
  }
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
    );
  } catch {
    /*
      A row whose selections cannot be parsed is a row with no condition
      information, which is exactly what the caller should show. Throwing here
      would take the whole trade list down with it.
    */
    return {};
  }
}

/**
 * The answers, ordered the way the form asks them.
 *
 * `CATEGORY_ORDER` is the same order the customer answered in, so the admin
 * reads the disc's story in the order it was told rather than in whatever
 * order the JSON happens to serialise.
 */
export function describeSelections(raw: unknown, rules: readonly TradeRule[]): ConditionAnswer[] {
  const selections = parseSelections(raw);
  const byCategoryKey = new Map<string, TradeRule>();
  for (const rule of rules) {
    byCategoryKey.set(`${rule.category} ${rule.key}`, rule);
  }

  const categories = Object.keys(selections).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    /* A category the order does not know about goes last, not first. */
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });

  return categories.map((category) => {
    const value = selections[category] ?? "";
    const rule = byCategoryKey.get(`${category} ${value}`);
    return {
      category,
      categoryLabel: CATEGORY_LABEL_AR[category] ?? category,
      value,
      valueLabel: rule?.label_ar || rule?.label_en || value,
      percent: typeof rule?.percent === "number" ? rule.percent : 0,
      unknown: !rule,
    };
  });
}

/**
 * How the customer asked to be paid.
 *
 * The form hardcodes `payout_type` to store credit and sends it regardless, so
 * the column says store credit for everyone. The real answer is the
 * `payout_method` the customer picked in the condition step, and it is the one
 * the quote was calculated from — settling a trade as store credit for someone
 * who asked for cash is a real mistake with the customer's money in it.
 */
export function payoutMethodOf(raw: unknown): "store_credit" | "cash" | null {
  const value = parseSelections(raw)["payout_method"];
  return value === "cash" || value === "store_credit" ? value : null;
}
