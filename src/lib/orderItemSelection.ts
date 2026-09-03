/**
 * What was actually bought on one order line, as text an admin can read.
 *
 * ## Why this exists
 *
 * The option, the type and the platform are already recorded three times over
 * — on `orders.doc`, in `order_items_snapshot.options_json` and in
 * `order_items.metadata_json` — and the delivery screen showed none of them,
 * because the query that feeds it selects `id, product_id, product_title,
 * kind, quantity` and nothing else. The data was never missing; it was never
 * projected. So an admin preparing an account saw a game name and had to guess
 * whether it was the offline or the online one.
 *
 * ## Why it coerces so carefully
 *
 * `meta` is written from the checkout request. The checkout endpoint validates
 * that `items` is an array of at most fifty and casts; no field inside a line
 * is type-checked. So `optionName` can be an object, and `String(value)` on an
 * object is the string `"[object Object]"` — which is not a crash, not a blank,
 * and not something anyone notices until it is printed on a fulfilment card.
 *
 * Every reader here therefore accepts a string and nothing else. A number
 * arrives as its digits, because a numeric id is a reasonable thing to store;
 * anything else becomes empty, and an empty field simply does not render.
 *
 * ## Why it reads a snapshot and not the product
 *
 * A product edited today must not change what an order from last month says
 * was sold. Everything here comes from what was written at checkout.
 */

/** The selection as the fulfilment screens need it: all strings, never null. */
export interface OrderItemSelection {
  /** "حساب أوفلاين" / "حساب أونلاين" — what the customer chose. */
  optionName: string;
  /** "عادي" / "ديلوكس" / "مع الإضافات" — the variant. */
  typeName: string;
  /** "Nintendo Switch" / "Nintendo Switch 2". */
  platform: string;
  /** The edition id, only when there is no better name for it. */
  editionId: string;
  /** How many add-ons were bought with it. */
  dlcCount: number;
}

export const EMPTY_SELECTION: OrderItemSelection = {
  optionName: "",
  typeName: "",
  platform: "",
  editionId: "",
  dlcCount: 0,
};

/**
 * A stored value as a display string, or nothing.
 *
 * The whole `[object Object]` defence is this function. Objects, arrays,
 * booleans and null all become empty rather than their stringification.
 */
function displayable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** `Nintendo Switch 2` and `Nintendo Switch`, however they were recorded. */
export function platformLabel(value: unknown): string {
  const raw = displayable(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!raw) return "";
  if (raw === "switch2" || raw === "nintendoswitch2" || raw === "ns2") return "Nintendo Switch 2";
  if (raw === "switch" || raw === "nintendoswitch" || raw === "ns") return "Nintendo Switch";
  // An unrecognised platform is shown as recorded rather than dropped: an
  // admin can act on a value they do not recognise, but not on a blank.
  return displayable(value);
}

/**
 * Read one order item's selection out of its stored metadata.
 *
 * Accepts the `meta` object itself or the JSON string the two snapshot tables
 * hold, because the three call sites have it in different shapes and none of
 * them should have to know which.
 */
export function readOrderItemSelection(meta: unknown): OrderItemSelection {
  let source: Record<string, unknown> | undefined;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        source = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable metadata is no metadata. Never a reason to fail a screen.
    }
  } else if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    source = meta as Record<string, unknown>;
  }
  if (!source) return EMPTY_SELECTION;

  const dlcIds = source["dlcIds"];
  return {
    optionName: displayable(source["optionName"]),
    typeName: displayable(source["typeName"]),
    platform: platformLabel(source["platform"]),
    editionId: displayable(source["editionId"]),
    dlcCount: Array.isArray(dlcIds) ? dlcIds.filter((id) => displayable(id)).length : 0,
  };
}

/**
 * The selection on one line, for a card that has room for a single line.
 *
 * Joined with a middle dot and never trailing a separator on an absent part,
 * because most orders carry two of the four and a card that reads
 * "حساب أوفلاين • • " looks broken.
 */
export function selectionSummary(selection: OrderItemSelection): string {
  const parts = [
    selection.optionName,
    selection.typeName,
    selection.platform,
    selection.dlcCount > 0 ? `+${selection.dlcCount} إضافة` : "",
  ].filter(Boolean);
  return parts.join(" • ");
}
