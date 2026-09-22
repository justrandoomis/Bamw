/**
 * What the courier costs, from the one place both sides read.
 *
 * The shop keeps a base fee and a list of cities that cost something else.
 * The checkout applied the list; the cart never did — it showed
 * `deliveryBase` for every address — so a member ordering to a city the owner
 * had priced differently was shown one number and charged another. Which is
 * the same fault as a product showing one price and charging another, in the
 * one line of the bill nobody thinks to check.
 *
 * No server imports, so the screen and the till cannot drift apart.
 */
export const DEFAULT_DELIVERY_BASE = 5000;

export type DeliveryException = { city?: unknown; price?: unknown };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function readDeliveryExceptions(
  settings: Record<string, unknown> | null | undefined,
): DeliveryException[] {
  const raw = settings?.["deliveryExceptions"];
  return Array.isArray(raw) ? (raw as DeliveryException[]) : [];
}

export function readDeliveryBase(settings: Record<string, unknown> | null | undefined): number {
  return num(settings?.["deliveryBase"] || DEFAULT_DELIVERY_BASE);
}

/**
 * The fee for one address.
 *
 * An exact city match wins; anything else pays the base. Matching is exact
 * because that is what the checkout has always done and what the admin screen
 * writes — loosening it here would change what existing orders cost.
 */
export function resolveDeliveryPrice(
  settings: Record<string, unknown> | null | undefined,
  city?: string | null,
): number {
  const base = readDeliveryBase(settings);
  const wanted = String(city ?? "").trim();
  if (!wanted) return base;
  const exception = readDeliveryExceptions(settings).find((e) => String(e?.city ?? "") === wanted);
  return exception ? num(exception.price) : base;
}
