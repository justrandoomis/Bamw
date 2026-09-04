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
 * The variant the details page should open on, when the variants are what
 * price this product.
 *
 * `initialOptionId` has always existed and looks only at options. Gift cards
 * price their denominations on `variants` — the import schema gives an option
 * no price field at all — so nothing was ever preselected for them: the page
 * opened with every denomination chip unset and the record's base price in the
 * header, while the card beside it printed the cheapest denomination. Two
 * numbers for one product, which reads as the shop changing its price between
 * two clicks. The module's own contract above says both surfaces must agree;
 * without this it could not hold for any product priced on its variants.
 *
 * Empty when the options carry prices, because then the options lead and
 * preselecting a variant would move the price off the option the page opened
 * on. Empty, too, when no variant is priced: there is nothing to agree with.
 */
export function initialVariantName(
  variants: readonly { name: string; price?: number | undefined }[],
  basePrice: number,
  options: readonly { price?: number | undefined }[] = [],
): string {
  if (options.some((option) => typeof option.price === "number" && option.price > 0)) return "";

  const priced = variants.filter(
    (variant) => typeof variant.price === "number" && variant.price > 0 && variant.name,
  ) as { name: string; price: number }[];
  if (priced.length === 0) return "";

  if (basePrice > 0) {
    const match = priced.find((variant) => variant.price === basePrice);
    if (match) return match.name;
  }
  return priced.reduce((min, variant) => (variant.price < min.price ? variant : min)).name;
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

/** A cart line's selection, as every surface records it. */
export interface UnitPriceSelection {
  optionId?: string | number | null;
  typeId?: string | number | null;
  editionId?: string | number | null;
  dlcIds?: readonly (string | number)[] | null;
}

export interface UnitPriceResult {
  /** What one copy costs, resolved from the product record. */
  unitPrice: number;
  /** Which part of the record decided it — for tests and the audit trail. */
  source: "type" | "option" | "edition" | "base";
  optionName: string | null;
  typeName: string | null;
  editionName: string | null;
  dlcNames: string[];
}

function rowById(value: unknown, id: unknown): Row | undefined {
  if (!Array.isArray(value) || id === undefined || id === null || id === "") return undefined;
  const wanted = String(id);
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Row;
    if (String(row["id"] ?? "") === wanted) return row;
  }
  return undefined;
}

function priceOf(row: Row | undefined): number {
  if (!row) return 0;
  const price = toAmount(row["price"]);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function nameOf(row: Row | undefined): string | null {
  if (!row) return null;
  const name = String(row["name"] ?? "").trim();
  return name || null;
}

/**
 * What one copy of this product actually costs, given what the buyer picked.
 *
 * ## Why this is shared rather than written twice
 *
 * It used to be written twice, and the two copies disagreed. The storefront
 * priced a line `type → option → edition → base`; checkout priced it
 * `edition → base` and never looked at the option or the type at all. So a
 * customer who chose a differently-priced option was shown one number and
 * charged another — the shop losing money on the dearer option and
 * overcharging on the cheaper one.
 *
 * The precedence here is the storefront's, because that is the number the
 * customer was shown and agreed to. Now both sides call this, so the two
 * cannot drift apart again: a change to the rule is a change to one function.
 *
 * The product record is always the source. Nothing a browser sends is read
 * except the *ids* of what was picked, and an id that names nothing on the
 * record resolves to nothing rather than to whatever was claimed.
 */
export function resolveUnitPrice(
  product: Row | null | undefined,
  selection: UnitPriceSelection = {},
): UnitPriceResult {
  const empty: UnitPriceResult = {
    unitPrice: 0,
    source: "base",
    optionName: null,
    typeName: null,
    editionName: null,
    dlcNames: [],
  };
  if (!product || typeof product !== "object") return empty;

  /*
    `types` is the current name and `variants` the older one. Both are read,
    the same way `validateLine` has always read them, so a record written by
    either generation of the editor prices correctly.
  */
  const typeRows = Array.isArray(product["types"]) ? product["types"] : product["variants"];
  const selectedType = rowById(typeRows, selection.typeId);
  const selectedOption = rowById(product["options"], selection.optionId);
  const selectedEdition = rowById(product["editions"], selection.editionId);

  const base = toAmount(product["price"]);
  let unitPrice = Number.isFinite(base) && base > 0 ? base : 0;
  let source: UnitPriceResult["source"] = "base";

  /*
    Most specific wins. A type belongs to an option, so a priced type overrides
    the option that contains it; a priced option overrides the record's
    headline price. An unpriced row is not a price of zero — it means "use
    whatever is above me", which is why `priceOf` returns 0 for one and the
    checks below are `> 0`.
  */
  if (priceOf(selectedEdition) > 0) {
    unitPrice = priceOf(selectedEdition);
    source = "edition";
  }
  if (priceOf(selectedOption) > 0) {
    unitPrice = priceOf(selectedOption);
    source = "option";
  }
  if (priceOf(selectedType) > 0) {
    unitPrice = priceOf(selectedType);
    source = "type";
  }

  // Add-ons are additive on top of whichever price won.
  const dlcNames: string[] = [];
  if (Array.isArray(selection.dlcIds)) {
    for (const dlcId of selection.dlcIds) {
      const dlc = rowById(product["dlcs"], dlcId);
      if (!dlc) continue;
      unitPrice += priceOf(dlc);
      const name = nameOf(dlc);
      if (name) dlcNames.push(name);
    }
  }

  return {
    unitPrice,
    source,
    optionName: nameOf(selectedOption),
    typeName: nameOf(selectedType),
    editionName: nameOf(selectedEdition),
    dlcNames,
  };
}

/** The fields a cart line carries that identify what was picked. */
export interface CartLineLike {
  price?: unknown;
  optionId?: string | number | null | undefined;
  typeId?: string | number | null | undefined;
  editionId?: string | number | null | undefined;
  meta?: Record<string, unknown> | undefined;
}

/**
 * What a cart line is worth **now**.
 *
 * A line lives in the browser's storage and survives restarts, so the price it
 * carries is whatever the catalogue said on the day it was added — sometimes
 * weeks ago. The rule used to be `line.price || product.price`, which made
 * that stored figure win outright: the admin raised a price, the cart went on
 * showing the old one, the wallet check used the old one, and the server
 * charged the new one. Three numbers for one purchase, and the customer only
 * ever saw the first.
 *
 * The catalogue wins here, through the same resolver checkout prices with. The
 * stored figure is kept only for a line whose product has left the catalogue
 * altogether: checkout refuses such a line anyway, and showing what it used to
 * cost says more than showing nothing.
 */
export function cartLinePrice(
  product: Row | null | undefined,
  line: CartLineLike,
): number {
  const stored = toAmount(line.price);
  if (!product) return stored;

  const meta = line.meta ?? {};
  const pick = (direct: unknown, key: string) =>
    direct !== undefined && direct !== null && direct !== ""
      ? direct
      : ((meta[key] as string | undefined) ?? null);

  const { unitPrice } = resolveUnitPrice(product, {
    optionId: pick(line.optionId, "optionId") as string | null,
    typeId: pick(line.typeId, "typeId") as string | null,
    editionId: pick(line.editionId, "editionId") as string | null,
    dlcIds: (meta["dlcIds"] as string[] | undefined) ?? null,
  });

  return unitPrice > 0 ? unitPrice : stored;
}
