/**
 * Which order lines are handed over rather than shipped, and therefore belong
 * in the account-delivery queue.
 *
 * Two branches fixed the same fault here and named the file the same thing, so
 * this is the merge of both — and the rule below is the deny-list, on purpose.
 *
 * The fault: `buildListing` writes `kind: "game"` on every catalogue listing,
 * and the fulfilment code decided which lines need a delivery slot from an
 * allow-list that did not contain it. An order for an imported game was
 * recorded in `order_items`, fell through `if (!isDigitalItem(item)) continue`,
 * and had no slot created at all. The admin's tool showed «تم تجهيز 0 من 0»
 * because it was reporting an empty table honestly.
 *
 * Adding "game" to the allow-list fixes that one case and leaves the shape of
 * the bug in place: the next kind somebody invents is silently excluded again,
 * and an allow-list fails towards zero — the one answer an admin cannot work
 * around. Asking the opposite question fails towards a slot they can see and
 * ignore. So the question here is the narrow one — does this thing go in a
 * box? — and everything else is handed over.
 *
 * `DIGITAL_ORDER_KINDS` is kept because callers read it (the delivery query
 * binds it as a JSON list), and a test holds it in step with the rule.
 *
 * No server imports, so the rule can be tested without a database.
 */
import { isPhysicalKind } from "./coupons";

/**
 * The kinds that are handed over, named.
 *
 * This is a *description* of what `isDigitalOrderKind` answers yes to, not the
 * definition of it — an unlisted kind is still digital. Callers that need a
 * concrete list for a SQL `IN (...)` use this; callers deciding about one line
 * ask the function.
 */
export const DIGITAL_ORDER_KINDS = [
  "account",
  "offline_account",
  "online_account",
  "bundle",
  "preorder",
  "digital_code",
  "code",
  "gift_card",
  "game",
] as const;

/**
 * True when an order line is handed over rather than shipped.
 *
 * The five kinds it excludes are the same five that decide an order needs a
 * shipping address (`needsAddress`) and the same five a digital-only coupon
 * refuses — read from `isPhysicalKind`, so the answers cannot drift.
 *
 * A missing kind reads as an account: legacy account purchases predate the
 * field, and the delivery subsystem has always interpreted it that way.
 */
export function isDigitalOrderKind(kind: unknown): boolean {
  return !isPhysicalKind(
    String(kind ?? "account")
      .trim()
      .toLowerCase(),
  );
}

/** True when every line in the order is handed over, so nothing has to ship. */
export function isFullyDigitalOrder(items: ReadonlyArray<{ kind?: unknown }> | null | undefined) {
  return Boolean(items?.length) && items!.every((item) => isDigitalOrderKind(item.kind));
}
