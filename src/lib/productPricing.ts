/**
 * The one price a listing surface shows for a product that sells through
 * options (gift-card denominations, account tiers).
 *
 * The details page lands with an option already selected, so the number the
 * buyer sees there is that option's price — not necessarily the record's base
 * `price`. A card that prints the base price while the details page opens on a
 * differently-priced option reads as the store changing its price between two
 * clicks. Both surfaces therefore agree on one contract, implemented here:
 *
 * - the base price wins when a priced option carries the same amount (the
 *   admin's table price is then a real denomination, and the page opens on it);
 * - otherwise the cheapest priced option leads, which is also the option the
 *   details page preselects;
 * - a product with no priced options keeps its base price.
 */

import { toAmount } from "@/lib/purchasable";

type Row = Record<string, unknown>;

function pricedRows(value: unknown): { id: string; name: string; price: number }[] {
  if (!Array.isArray(value)) return [];
  const rows: { id: string; name: string; price: number }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Row;
    const price = toAmount(row["price"]);
    if (!Number.isFinite(price) || price <= 0) continue;
    rows.push({
      id: String(row["id"] ?? ""),
      name: String(row["name"] ?? ""),
      price,
    });
  }
  return rows;
}

/**
 * The option id the details page should open on: the option priced exactly at
 * the base price when one exists, the cheapest priced option otherwise, and
 * the first option as the legacy fallback when none carry a price.
 */
export function initialOptionId(
  options: readonly { id: string; price?: number | undefined }[],
  basePrice: number,
): string {
  if (!options.length) return "";
  const priced = options.filter((o) => typeof o.price === "number" && o.price > 0) as {
    id: string;
    price: number;
  }[];
  if (priced.length === 0) return options[0]!.id;
  if (basePrice > 0) {
    const match = priced.find((o) => o.price === basePrice);
    if (match) return match.id;
  }
  return priced.reduce((min, o) => (o.price < min.price ? o : min)).id;
}

/**
 * The price a listing card prints for this product — the same amount the
 * details page shows the moment it opens.
 */
export function listingPrice(product: Row | null | undefined): number {
  if (!product || typeof product !== "object") return 0;
  const base = toAmount(product["price"]);
  const optionRows = pricedRows(product["options"]);
  const rows = optionRows.length ? optionRows : pricedRows(product["variants"]);
  if (rows.length === 0) return base > 0 ? base : 0;
  if (base > 0 && rows.some((row) => row.price === base)) return base;
  return rows.reduce((min, row) => (row.price < min.price ? row : min)).price;
}
