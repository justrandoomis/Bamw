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
import { resolveBundleUnitPrice } from "@/lib/bundles";
import { classifyTier } from "@/lib/tierPricing";
import type { AccountBundle } from "@/lib/types";

type Row = Record<string, unknown>;

interface PricedRow {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  optionId: string;
}

function compareAtPrice(value: unknown, salePrice: number): number {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return 0;
  const original = toAmount(value);
  return Number.isFinite(original) && original > salePrice ? original : salePrice;
}

function storedCompareAtPrice(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Canonicalise display-only compare-at prices before storing a product document. */
export function normalizeProductCompareAtPrices<T extends Row>(product: T): T {
  const next: Row = { ...product };
  if (Object.prototype.hasOwnProperty.call(next, "originalPrice")) {
    next["originalPrice"] = storedCompareAtPrice(next["originalPrice"]);
  }

  for (const key of ["options", "types", "variants", "editions", "dlcs"] as const) {
    const rows = next[key];
    if (!Array.isArray(rows)) continue;
    next[key] = rows.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const row = { ...(entry as Row) };
      if (
        Object.prototype.hasOwnProperty.call(row, "originalPrice") ||
        Object.prototype.hasOwnProperty.call(row, "original_price")
      ) {
        row["originalPrice"] = storedCompareAtPrice(row["originalPrice"] ?? row["original_price"]);
        delete row["original_price"];
      }
      return row;
    });
  }

  return next as T;
}

/**
 * The ordinary offline account's row, when the product has one.
 *
 * «اجعل السعر الارخص يعرض افتراضيا في البطاقه ( حساب اوفلاين عادي ) المشكله
 * يعرض سعر حساب الاونلاين» — the owner, about /category/nintendo_games.
 *
 * The selection below was pure arithmetic: the row priced at the base, else the
 * cheapest row. Nothing in it knew what an account tier IS, and the catalogue
 * punishes that. Measured on the live shop: 65 games carry exactly ONE priced
 * row and it is an ONLINE account, while the ordinary offline account's price
 * sits in `price` — Zelda: Tears of the Kingdom (Switch 2 Edition) has a `price`
 * of 12,000 and one row at 42,000. "Cheapest row" has only the 42,000 to choose
 * from, so the card printed it.
 *
 * `classifyTier` is the shop's own vocabulary for this — the same function the
 * pricing rules use to decide which of the owner's four rules a tier follows —
 * so the question is asked of it rather than answered again here.
 */
export function ordinaryOfflineRow(value: unknown): Row | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Row;
    if (toAmount(row["price"]) <= 0) continue;
    if (classifyTier(row as Parameters<typeof classifyTier>[0]).kind === "offline_base") {
      return row;
    }
  }
  return undefined;
}

/**
 * What the ordinary offline account costs when it is NOT a row: the record's
 * own `price`, and deliberately NOT `accountPrice`.
 *
 * `readOffers` prices the «حساب أوفلاين» offer as `accountPrice || price`, and
 * copying that expression here was the first attempt. It is wrong, and wrong in
 * exactly the way this whole change exists to fix: `resolveUnitPrice` with no
 * tier selected returns `price`, so `price` is what checkout charges. A card
 * printing `accountPrice` while the till charged `price` would be a third
 * number in a story that already had two too many.
 *
 * So the card shows what the customer pays. Where the two fields disagree it is
 * `readOffers` that is out of step, which is a fault about the OFFER and not
 * about the card — worth measuring on its own rather than papering over here by
 * advertising a number nothing charges.
 */
function baseChargedPrice(product: Row): number {
  const base = toAmount(product["price"]);
  return Number.isFinite(base) && base > 0 ? base : 0;
}

function pricedRows(value: unknown): PricedRow[] {
  if (!Array.isArray(value)) return [];
  const rows: PricedRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Row;
    const price = toAmount(row["price"]);
    if (!Number.isFinite(price) || price <= 0) continue;
    rows.push({
      id: String(row["id"] ?? ""),
      name: String(row["name"] ?? ""),
      price,
      originalPrice: compareAtPrice(row["originalPrice"], price),
      optionId: String(row["optionId"] ?? row["option_id"] ?? ""),
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
 *
 * It follows `listingPricing` STEP FOR STEP — the ordinary offline account
 * first, then the variant priced at the base, then nothing at all when the base
 * undercuts every variant, and only then the cheapest. It used to jump straight
 * to "the variant priced at the base, else the cheapest", which on the 65 games
 * whose only priced row is an online account opened the page on that row while
 * the card beside it led with the cheaper account: «الشاشة تعرض سعر الأونلاين
 * بدل الأوفلاين».
 *
 * The empty answer is not a failure to choose. `resolveUnitPrice` with nothing
 * selected returns the base price, which is what the card printed and what
 * checkout charges — so an unset chip and the card agree, while any chip this
 * could have picked would not.
 */
export function initialVariantName(
  variants: readonly { name: string; id?: string; price?: number | undefined }[],
  basePrice: number,
  options: readonly { price?: number | undefined }[] = [],
): string {
  if (options.some((option) => typeof option.price === "number" && option.price > 0)) return "";
  const named = variants.filter((variant) => variant.name);
  return String(initialPricedRow(named, basePrice)?.["name"] ?? "");
}

/**
 * THE ONE SELECTION RULE, so the three surfaces cannot each have their own.
 *
 * THE CHEAPEST THING THE CUSTOMER CAN BUY. The owner, after seeing the first
 * version of this:
 *
 *   «اريد يعرض ارخص خيار ( ليش اجباري سعر اوفلاين )
 *    السعر الذي اريده ان يظهر على البطاقه يجب ان يكون سعر ارخص خيار في المنتج»
 *
 * The first version preferred the ordinary offline account BY TIER, whatever it
 * cost, because his earlier words named that tier — «اجعل السعر الارخص يعرض
 * افتراضيا في البطاقه ( حساب اوفلاين عادي )». Reading the parenthesis as the
 * rule rather than as an example was the mistake: what he wanted throughout was
 * «السعر الارخص», and the offline account was simply the cheapest one on the
 * games he was looking at. Where it is not, he wants the cheaper one shown.
 *
 * So: the cheapest priced row, and nothing else. The base price is compared
 * against it by `listingPricing`, which is where the base actually lives;
 * returning nothing here means the base wins.
 *
 * Returns the row itself, because one caller wants its id and another its name.
 */
function initialPricedRow(value: unknown, basePrice: number): Row | undefined {
  if (!Array.isArray(value)) return undefined;
  const priced: Row[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    if (toAmount((entry as Row)["price"]) > 0) priced.push(entry as Row);
  }
  if (!priced.length) return undefined;

  const priceOfRow = (row: Row) => toAmount(row["price"]);
  const cheapest = priced.reduce((min, row) => (priceOfRow(row) < priceOfRow(min) ? row : min));
  /*
    The base undercuts every row, so nothing is selected: `resolveUnitPrice`
    with no selection returns the base, which is then both the cheapest thing
    on the product and the thing checkout charges. Selecting a row here would
    advertise a price dearer than the product's own.
  */
  if (basePrice > 0 && basePrice < priceOfRow(cheapest)) return undefined;
  return cheapest;
}

/**
 * The tier id the buy sheet should open on, or "" for none.
 *
 * `rows` is the sheet's own option-filtered list; the product supplies the base
 * price. The sheet used to answer this itself with `ordinaryOfflineRow(rows)?.id
 * ?? rows[0]?.id ?? ""`, and the `??` chain never reached the empty string — so
 * on the 65 games whose only row is an online account it opened at 42,000 while
 * the card beside it said 12,000. Asking the shared rule is what stops a fourth
 * answer appearing the next time this is touched.
 */
export function initialTypeId(product: Row | null | undefined, rows?: unknown): string {
  const list = rows === undefined ? pricingTypeRows(product) : rows;
  const base = product && typeof product === "object" ? toAmount(product["price"]) : 0;
  return String(initialPricedRow(list, base)?.["id"] ?? "");
}

/**
 * The list that prices a product's sub-types, under either of its two names.
 *
 * `types` is the current name and `variants` the older one, and until now
 * three readers each had their own rule for choosing between them:
 *
 *   - {@link resolveUnitPrice}, which is what the server charges, read
 *     `types` when the key was an array and `variants` otherwise;
 *   - `buildProductView`, which the product page renders from, read
 *     `variants` first;
 *   - {@link listingPrice}, which prints the storefront card, read `variants`
 *     and never looked at `types` at all.
 *
 * A record carrying both therefore showed one price on the card, another on
 * the page, and was billed a third. One rule, in one place, is what stops
 * that: the rule is `resolveUnitPrice`'s, because the till is the one that
 * cannot be wrong, and the two displays now follow it rather than differ
 * from it.
 */
export function pricingTypeRows(product: Row | null | undefined): unknown {
  if (!product || typeof product !== "object") return undefined;
  return Array.isArray(product["types"]) ? product["types"] : product["variants"];
}

/**
 * The price a listing card prints for this product — the same amount the
 * details page shows the moment it opens.
 */
export function listingPrice(product: Row | null | undefined): number {
  return listingPricing(product).unitPrice;
}

/**
 * Both prices printed by a listing card.
 *
 * `unitPrice` remains the real amount checkout charges. `originalUnitPrice`
 * is only the valid compare-at price belonging to that same base/option/type;
 * it never participates in totals, coupons, referrals or wallet debits.
 */
export function listingPricing(
  product: Row | null | undefined,
): Pick<UnitPriceResult, "unitPrice" | "originalUnitPrice"> {
  if (!product || typeof product !== "object") {
    return { unitPrice: 0, originalUnitPrice: 0 };
  }

  const base = toAmount(product["price"]);
  const optionRows = pricedRows(product["options"]);
  const typeRows = pricingTypeRows(product);
  const rows = optionRows.length ? optionRows : pricedRows(typeRows);
  if (rows.length === 0) {
    return resolveUnitPrice(product);
  }

  /*
    THE CHEAPEST THING THE CUSTOMER CAN BUY, AND NOTHING ELSE.

      «اريد يعرض ارخص خيار ( ليش اجباري سعر اوفلاين )
       السعر الذي اريده ان يظهر على البطاقه يجب ان يكون سعر ارخص خيار في المنتج»

    The base price is one of the options: `resolveUnitPrice` with no selection
    charges it, so a product whose base undercuts every row is cheapest at the
    base and the card says so with nothing selected. Otherwise the cheapest row
    wins and the card resolves THROUGH it, so the number printed is the number
    that row is actually charged at.

    This used to prefer the ordinary offline account by tier, whatever it cost.
    That read his earlier parenthesis — «( حساب اوفلاين عادي )» — as the rule
    instead of as an example of the cheapest, and on a product where the
    offline account is not the cheapest it printed the dearer price. He has
    since said plainly which he meant.
  */
  if (!optionRows.length) {
    const base = baseChargedPrice(product);
    const cheapestRow = rows.reduce((min, row) => (row.price < min.price ? row : min));
    if (base > 0 && base < cheapestRow.price) return resolveUnitPrice(product);
  }

  /*
    The cheapest row. It used to prefer the row priced exactly at the base —
    which, on a product whose base is the dearer online price, printed the
    dearer one and is the fault being fixed. Where a row does sit at the base
    it is the cheapest anyway and nothing changes.
  */
  const selected = rows.reduce((min, row) => (row.price < min.price ? row : min));

  // Old `variants` rows sometimes have no id. They can still lead a listing,
  // even though checkout cannot select them by id; preserve that long-standing
  // display fallback while all current admin-created rows use stable ids.
  if (!selected.id) {
    const inheritedOriginal =
      selected.price === base
        ? compareAtPrice(product["originalPrice"], selected.price)
        : selected.price;
    return {
      unitPrice: selected.price,
      originalUnitPrice: Math.max(selected.originalPrice, inheritedOriginal),
    };
  }

  return resolveUnitPrice(product, {
    ...(optionRows.length
      ? { optionId: selected.id }
      : {
          typeId: selected.id,
          ...(selected.optionId ? { optionId: selected.optionId } : {}),
        }),
  });
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
  /** Valid compare-at price for that exact selection; never an amount to charge. */
  originalUnitPrice: number;
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

function pricePairOf(
  row: Row | undefined,
  inherited: { unitPrice: number; originalUnitPrice: number },
): { unitPrice: number; originalUnitPrice: number } {
  const unitPrice = priceOf(row);
  if (unitPrice <= 0) return inherited;

  const ownOriginal = compareAtPrice(row?.["originalPrice"], unitPrice);
  /*
    Imported Nintendo rows often repeat the product's base sale price. When
    that repeated row has no compare-at value, it inherits the base one's
    original price. A genuinely different row without an original price does
    not borrow an unrelated discount from another tier.
  */
  const originalUnitPrice =
    ownOriginal > unitPrice
      ? ownOriginal
      : inherited.unitPrice === unitPrice && inherited.originalUnitPrice > unitPrice
        ? inherited.originalUnitPrice
        : unitPrice;
  return { unitPrice, originalUnitPrice };
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
    originalUnitPrice: 0,
    source: "base",
    optionName: null,
    typeName: null,
    editionName: null,
    dlcNames: [],
  };
  if (!product || typeof product !== "object") return empty;

  // `types` under either of its names — see `pricingTypeRows`. This is the
  // rule; the two display readers follow it.
  const typeRows = pricingTypeRows(product);
  const selectedOption = rowById(product["options"], selection.optionId);
  const requestedType = rowById(typeRows, selection.typeId);
  const requestedTypeOptionId = String(
    requestedType?.["optionId"] ?? requestedType?.["option_id"] ?? "",
  ).trim();
  const selectedOptionId = String(selectedOption?.["id"] ?? "").trim();
  /*
    A type may be global (no option / `all`) or belong to the selected option.
    When checkout receives both ids, never let a valid type from a different
    option override the option's price. Older cart lines sometimes contain a
    type id without an option id, so that legacy shape remains valid.
  */
  const selectedType =
    requestedType &&
    (!selectedOptionId ||
      !requestedTypeOptionId ||
      requestedTypeOptionId === "all" ||
      requestedTypeOptionId === selectedOptionId)
      ? requestedType
      : undefined;
  const selectedEdition = rowById(product["editions"], selection.editionId);

  const base = toAmount(product["price"]);
  let pair = {
    unitPrice: Number.isFinite(base) && base > 0 ? base : 0,
    originalUnitPrice: 0,
  };
  pair.originalUnitPrice = compareAtPrice(product["originalPrice"], pair.unitPrice);
  let source: UnitPriceResult["source"] = "base";

  /*
    Most specific wins. A type belongs to an option, so a priced type overrides
    the option that contains it; a priced option overrides the record's
    headline price. An unpriced row is not a price of zero — it means "use
    whatever is above me", which is why `priceOf` returns 0 for one and the
    checks below are `> 0`.
  */
  if (priceOf(selectedEdition) > 0) {
    pair = pricePairOf(selectedEdition, pair);
    source = "edition";
  }
  if (priceOf(selectedOption) > 0) {
    pair = pricePairOf(selectedOption, pair);
    source = "option";
  }
  if (priceOf(selectedType) > 0) {
    pair = pricePairOf(selectedType, pair);
    source = "type";
  }

  // Add-ons are additive on top of whichever price won.
  const dlcNames: string[] = [];
  if (Array.isArray(selection.dlcIds)) {
    for (const dlcId of selection.dlcIds) {
      const dlc = rowById(product["dlcs"], dlcId);
      if (!dlc) continue;
      const dlcPrice = priceOf(dlc);
      if (dlcPrice > 0) {
        pair.unitPrice += dlcPrice;
        pair.originalUnitPrice += compareAtPrice(dlc["originalPrice"], dlcPrice);
      }
      const name = nameOf(dlc);
      if (name) dlcNames.push(name);
    }
  }

  return {
    unitPrice: pair.unitPrice,
    originalUnitPrice: Math.max(pair.unitPrice, pair.originalUnitPrice),
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
export function cartLinePrice(product: Row | null | undefined, line: CartLineLike): number {
  const stored = toAmount(line.price);
  if (!product) return stored;

  const meta = line.meta ?? {};
  const pick = (direct: unknown, key: string) =>
    direct !== undefined && direct !== null && direct !== ""
      ? direct
      : ((meta[key] as string | undefined) ?? null);

  /*
    A bundle prices by its own rule.

    `resolveUnitPrice` reads `options` and treats a priced one as a
    *replacement* for the record's price. A bundle's account options are a
    surcharge on top of it instead — an online account for a few thousand more
    than the offline one — so running them through the product rule would
    charge the surcharge as the whole price. `resolveBundleUnitPrice` is the
    rule for those, and it is the same function the till uses.
  */
  if (Array.isArray((product as Row)["accountOptions"])) {
    const { unitPrice: bundlePrice } = resolveBundleUnitPrice(product as unknown as AccountBundle, {
      optionId: pick(line.optionId, "optionId") as string | null,
    });
    return bundlePrice > 0 ? bundlePrice : stored;
  }

  const { unitPrice } = resolveUnitPrice(product, {
    optionId: pick(line.optionId, "optionId") as string | null,
    typeId: pick(line.typeId, "typeId") as string | null,
    editionId: pick(line.editionId, "editionId") as string | null,
    dlcIds: (meta["dlcIds"] as string[] | undefined) ?? null,
  });

  return unitPrice > 0 ? unitPrice : stored;
}
