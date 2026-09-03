/**
 * The one function that decides what a customer is allowed to see of a product.
 *
 * ## Why this exists
 *
 * `/api/data` and `/api/product` each had their own inline
 * `Object.entries(...).filter(...)` plus a shared `redactPrivateKeys` walk. Two
 * copies of "what is private" is one copy too many — and neither of them knew
 * about the thing that actually leaked.
 *
 * A supplier cost rule was reaching the product page:
 *
 *     "Supplier Regular / 普通版 converted to IQD using 1 CNY = 220 IQD
 *      and rounded down to nearest 250 IQD"
 *
 * It was in `type.N.description`, because the import template offered that
 * field directly under `type.N.cost` with no guidance about who it was for.
 * `buildEditions` promotes a variant description with no `contents` into a row
 * of the editions comparison, so it was printed next to the price.
 *
 * Key-name redaction could never have caught it: the key was `description`,
 * which is exactly the field a customer *should* read. So this serializer does
 * two things key filtering cannot:
 *
 * 1. drops fields that are internal **by name** (`internalNote` and its
 *    spellings), anywhere in the tree;
 * 2. inspects customer-facing **text** on variants and drops values that are
 *    plainly supplier bookkeeping.
 *
 * The second is what makes existing production rows safe. The schema now has a
 * dedicated `internal_note`, but that only helps future imports — this session
 * cannot migrate D1, and read-time stripping needs no migration at all.
 */
import {
  CUSTOMER_TEXT_FIELDS,
  INTERNAL_FIELD_NAMES,
  customerSafeText,
} from "./internalMetadata";
import {
  resolveOptionStandardDescription,
  resolveTypeStandardDescription,
} from "./productOptionDescriptions";

/** Top-level product fields a customer never receives. */
export const PRIVATE_PRODUCT_FIELDS = new Set([
  "cost",
  "costPrice",
  "baseCost",
  "wholesalePrice",
  "supplier",
  "supplierId",
  "internalNotes",
  "credentials",
  "accountCredentials",
  "deliveryPasswordEnc",
  "dataConfidence",
  "modelInfo",
  "rawData",
  /*
    The Chinese supplier name and its provenance.

    These live in `product_admin_metadata` and are never loaded into a product
    document, so in the ordinary course of things this list never sees them.
    They are here as the second lock: an import that ever writes one of these
    onto the product itself would otherwise publish the name orders are placed
    with, and the shop's margin with it.
  */
  "supplier_name_zh_cn",
  "supplierNameZhCn",
  "supplier_name_zh_source_url",
  "supplierNameZhSourceUrl",
  "supplier_name_zh_verification_status",
  "supplierNameZhVerificationStatus",
  "supplier_name_zh_verified_at",
  "supplierNameZhVerifiedAt",
]);

/**
 * Key names that are private wherever they appear, at any depth.
 *
 * Matched against the key, so `supplierCost`, `wholesale_price` and
 * `internal_note` are all caught without being listed individually.
 */
const PRIVATE_KEY_PATTERN =
  /(?:password|passwd|secret|token|credential|service.?role|api.?key|private.?key|webhook|supplier|wholesale|internal|raw.?data|model.?info|data.?confidence|cost)/i;

/** Nested collections that describe purchasable variants of a product. */
const VARIANT_COLLECTIONS = ["types", "options", "variants", "editions", "editionsList"] as const;

function isPrivateKey(key: string): boolean {
  return INTERNAL_FIELD_NAMES.has(key) || PRIVATE_KEY_PATTERN.test(key);
}

/** Recursively drops private keys. Depth-bounded against cyclic-ish data. */
export function redactPrivateKeys(value: unknown, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(value)) return value.map((item) => redactPrivateKeys(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isPrivateKey(key))
      .map(([key, child]) => [key, redactPrivateKeys(child, depth + 1)]),
  );
}

/**
 * Cleans one variant row: internal fields gone, customer text checked.
 *
 * A field being *named* for customers does not mean an importer respected
 * that, which is the entire lesson of this bug.
 */
function publicVariant(row: unknown, collection?: string): unknown {
  if (!row || typeof row !== "object") return row;
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const name = String(source["name"] ?? source["title"] ?? source["id"] ?? "");
  const id = String(source["id"] ?? "");

  for (const [key, value] of Object.entries(source)) {
    if (isPrivateKey(key)) continue;

    if ((CUSTOMER_TEXT_FIELDS as readonly string[]).includes(key)) {
      let safe = customerSafeText(value);
      // If this is an option or type, resolve the standardized Arabic customer description
      if (key === "description" || key === "customerDescription") {
        if (collection === "options") {
          const std = resolveOptionStandardDescription(name || id, safe);
          if (std) safe = std;
        } else if (collection === "types" || collection === "variants" || collection === "editions" || collection === "editionsList") {
          const std = resolveTypeStandardDescription(name || id, safe);
          if (std) safe = std;
        }
      }
      // Omitted rather than emptied: an empty string still renders as a blank
      // row in the editions comparison.
      if (safe !== undefined) out[key] = safe;
      continue;
    }

    // `contents` rows carry their own labels, and those are printed too.
    if (key === "contents" && Array.isArray(value)) {
      const contents = value
        .map((item) => (item && typeof item === "object" ? publicVariant(item, "contents") : item))
        .filter((item) => {
          if (typeof item === "string") return customerSafeText(item) !== undefined;
          if (!item || typeof item !== "object") return Boolean(item);
          const record = item as Record<string, unknown>;
          // A content row with nothing left to say is not a row.
          return Object.keys(record).length > 0 && (record["label"] ?? record["value"]) !== undefined;
        });
      out[key] = contents;
      continue;
    }

    out[key] = redactPrivateKeys(value);
  }

  // Ensure options and types have their standard descriptions populated even if original was omitted or stripped
  if (!out["description"]) {
    if (collection === "options") {
      const std = resolveOptionStandardDescription(name || id);
      if (std) out["description"] = std;
    } else if (collection === "types" || collection === "variants" || collection === "editions") {
      const std = resolveTypeStandardDescription(name || id);
      if (std) out["description"] = std;
    }
  }

  return out;
}

/**
 * What the storefront is allowed to receive for one product.
 *
 * Not a filter bolted onto the database row — the row goes through here or it
 * does not leave the server.
 */
export function toPublicProduct(product: Record<string, unknown>): Record<string, unknown> {
  const withoutPrivateTop = Object.fromEntries(
    Object.entries(product).filter(([key]) => !PRIVATE_PRODUCT_FIELDS.has(key)),
  );

  const redacted = redactPrivateKeys(withoutPrivateTop) as Record<string, unknown>;

  for (const collection of VARIANT_COLLECTIONS) {
    const rows = redacted[collection];
    if (Array.isArray(rows)) {
      redacted[collection] = rows.map((row) => publicVariant(row, collection));
    }
  }

  return redacted;
}

/** Convenience for list payloads. */
export function toPublicProducts(products: readonly Record<string, unknown>[]) {
  return products.map(toPublicProduct);
}
