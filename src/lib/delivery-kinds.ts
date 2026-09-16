/**
 * Which order lines get a delivery slot, stated as what is *shipped* rather
 * than what is handed over.
 *
 * This used to be an allow-list of eight digital kinds living inside
 * `order-delivery-items.server.ts`, and "game" was not one of them — which is
 * the kind `buildListing` writes on every catalogue listing. So an order for
 * an imported game was recorded in `order_items`, then fell through
 * `if (!isDigitalItem(item)) continue` and had no slot created at all. The
 * admin's tool showed «تم تجهيز 0 من 0» and «0 خانة مستقلة» because it was
 * reporting an empty table honestly; the order genuinely had nothing to
 * prepare, and no amount of clicking could give it something.
 *
 * An allow-list fails silently towards zero, and zero is the one answer an
 * admin cannot work around. A deny-list fails towards a slot they can see and
 * ignore. So the question asked here is the narrow one — does this thing go in
 * a box? — and everything else is handed over.
 *
 * It lives in its own module, with no server imports, so the rule can be
 * tested without a database.
 */
import { isPhysicalKind } from "./coupons";

/**
 * True when an order line is handed over rather than shipped.
 *
 * The five kinds it excludes are the same five that decide an order needs a
 * shipping address (`needsAddress`) and the same five a digital-only coupon
 * refuses — one list, read from `isPhysicalKind`, so the answers cannot drift.
 */
export function isDigitalOrderKind(kind: string | undefined | null): boolean {
  return !isPhysicalKind(
    String(kind ?? "")
      .trim()
      .toLowerCase(),
  );
}
