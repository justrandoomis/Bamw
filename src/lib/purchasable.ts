/**
 * Internal acquisition cost is never sent to shoppers. Visibility therefore
 * depends only on customer-facing price and the explicit admin status flags.
 */

export function toAmount(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isProductPriced(product: unknown): boolean {
  const p = (product ?? {}) as Record<string, unknown>;
  const isDigital = [
    "account",
    "offline_account",
    "online_account",
    "preorder",
    "digital_code",
  ].includes(String(p["kind"] || ""));

  // Digital accounts might have 0 cost if supplier model is subscription-based,
  // but they MUST have a price > 0 for customers.
  const hasPrice = toAmount(p["price"]) > 0;

  // If explicitly marked active by admin, show.
  return (
    (hasPrice || p["isActive"] === true) && p["status"] !== "غير نشط" && p["isActive"] !== false
  );
}

/**
 * Hidden by an admin or system status, so no customer-facing surface may render it.
 *
 * Checks all known representations of hidden state:
 * - isHidden / is_hidden / hidden === true
 * - visibility === "hidden" | "private" | "draft"
 * - status === "مخفي" | "hidden"
 */
export function isProductHidden(product: unknown): boolean {
  if (!product || typeof product !== "object") return false;
  const p = product as Record<string, unknown>;
  if (
    p["isHidden"] === true ||
    p["is_hidden"] === true ||
    p["hidden"] === true ||
    p["isDeleted"] === true ||
    p["deleted"] === true ||
    p["is_deleted"] === true
  )
    return true;
  const vis = String(p["visibility"] ?? "").trim().toLowerCase();
  if (vis === "hidden" || vis === "private" || vis === "draft" || vis === "deleted") return true;
  const st = String(p["status"] ?? "").trim().toLowerCase();
  if (st === "مخفي" || st === "hidden" || st === "deleted" || st === "محذوف") return true;
  return false;
}

/**
 * What the admin's hide checkbox should show for this product.
 *
 * `isProductHidden` minus the deletion signals: a deleted product is not
 * "hidden by a toggle", and initialising the checkbox from the full check
 * would let an unhide save quietly resurrect it. The form used to read only
 * `isHidden`, so a product hidden through `is_hidden`, `hidden`, a hidden-ish
 * `visibility` or `status: "مخفي"` showed an unchecked box, the admin saved
 * "visible", and nothing changed — the legacy flag kept the product hidden.
 */
export function hiddenToggleState(product: unknown): boolean {
  if (!product || typeof product !== "object") return false;
  const p = product as Record<string, unknown>;
  if (p["isHidden"] === true || p["is_hidden"] === true || p["hidden"] === true) return true;
  const vis = String(p["visibility"] ?? "").trim().toLowerCase();
  if (vis === "hidden" || vis === "private" || vis === "draft") return true;
  const st = String(p["status"] ?? "").trim().toLowerCase();
  return st === "مخفي" || st === "hidden";
}

/**
 * Makes an explicit hide/unhide decision hold, whatever spelling the stored
 * record used.
 *
 * The visibility check honours five signals; the save wrote one. Unhiding a
 * product that was hidden through `is_hidden` or `status: "مخفي"` therefore
 * changed nothing the storefront could see. Both boolean spellings are kept in
 * step, the loose `hidden` flag follows, and — only when the stored value is
 * one of the hidden words — `visibility`/`status` are released. Deletion
 * markers are none of this function's business: unhiding must never
 * resurrect a deleted product.
 */
export function applyHiddenIntent(product: Record<string, unknown>, hiddenValue: boolean): void {
  product["isHidden"] = hiddenValue;
  product["is_hidden"] = hiddenValue;
  if ("hidden" in product) product["hidden"] = hiddenValue;
  if (!hiddenValue) {
    const vis = String(product["visibility"] ?? "").trim().toLowerCase();
    if (vis === "hidden" || vis === "private" || vis === "draft") delete product["visibility"];
    const st = String(product["status"] ?? "").trim().toLowerCase();
    if (st === "مخفي" || st === "hidden") product["status"] = "نشط";
  }
}

/**
 * Single source of truth for public storefront visibility.
 * Products that are hidden, inactive, disabled, or drafts are NOT visible to the public.
 */
export function isVisibleToPublic(product: unknown): boolean {
  if (!product || typeof product !== "object") return false;
  const p = product as Record<string, unknown>;
  if (isProductHidden(p)) return false;
  if (p["isActive"] === false || p["active"] === false) return false;
  const st = String(p["status"] ?? "").trim().toLowerCase();
  if (
    st === "غير نشط" ||
    st === "موقوف" ||
    st === "inactive" ||
    st === "disabled" ||
    st === "draft"
  ) {
    return false;
  }
  return true;
}

/** Visible + buyable in the storefront. */
export function isProductPurchasable(product: unknown): boolean {
  if (!isVisibleToPublic(product)) return false;
  return isProductPriced(product);
}

export function filterPurchasable<T>(products: T[] | undefined): T[] {
  return (products ?? []).filter((p) => isProductPurchasable(p));
}

export function filterVisibleToPublic<T>(products: T[] | undefined): T[] {
  return (products ?? []).filter((p) => isVisibleToPublic(p));
}
