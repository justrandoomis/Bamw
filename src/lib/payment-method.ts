/**
 * How an order is paid for, and when the shop is willing to wait for it.
 *
 * Two ways, and the difference is not cosmetic: one takes the money at
 * checkout, the other takes it at the door. Everything downstream — whether
 * the wallet is debited, whether the order is `paid`, whether a digital line
 * may be handed over — follows from this one answer, so it is decided on the
 * server from the CART's contents and never from what the browser claims.
 *
 * No server imports, so the rule can be read by the cart screen and by the
 * checkout and cannot drift between them.
 */
import { isPhysicalKind } from "./coupons";

export type PaymentMethod = "wallet" | "cash_on_delivery";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["wallet", "cash_on_delivery"];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.includes(String(value ?? "") as PaymentMethod);
}

/**
 * Whether cash on delivery may be offered for this cart.
 *
 * ONLY when every line is something that goes in a box.
 *
 * The owner asked for it on «الأجهزة والاكسسوارات» — the things a courier
 * carries — and the limit is what makes the option safe as well as what makes
 * it honest. A digital account is handed over in the chat the moment the order
 * is paid; there is no door for the money to arrive at, so an unpaid digital
 * order is either given away or held indefinitely, and neither is a thing to
 * offer a customer.
 *
 * A MIXED cart is refused too, and that is the interesting case. Delivery of a
 * digital line is gated on the order being paid, so a game bought alongside a
 * cable on cash terms would sit unhanded-over until the courier arrived — the
 * customer would have paid the shop nothing and received nothing, waiting on a
 * van for a code that is sitting in a queue. Splitting the two is clearer than
 * explaining that.
 *
 * An empty cart is not eligible, so the `every` cannot answer true vacuously.
 */
export function cashOnDeliveryAllowed(
  items: ReadonlyArray<{ kind?: unknown }> | null | undefined,
): boolean {
  if (!items?.length) return false;
  return items.every((item) => isPhysicalKind(String(item?.kind ?? "")));
}

/**
 * The method this order will actually use.
 *
 * A request asking for cash on delivery on a cart that cannot have it does not
 * silently fall back to the wallet — the caller decides what to do about it —
 * but nothing here ever returns `cash_on_delivery` for a cart the rule above
 * refuses.
 */
export function resolvePaymentMethod(
  requested: unknown,
  items: ReadonlyArray<{ kind?: unknown }> | null | undefined,
): PaymentMethod {
  if (requested === "cash_on_delivery" && cashOnDeliveryAllowed(items)) {
    return "cash_on_delivery";
  }
  return "wallet";
}
