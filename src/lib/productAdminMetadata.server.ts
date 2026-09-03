/**
 * Admin-only facts about a product — the Chinese supplier name and its proof.
 *
 * ## Why a separate table and not a field on the product
 *
 * The supplier name is what an order is placed with at the Chinese storefront.
 * It must never reach a customer, a public API, the search index or a cached
 * page. It could have lived on the product document under a redacted key, and
 * that is the design that leaks: every public path then has to remember to
 * strip it, and the one that forgets is the one that ships it.
 *
 * Here it is excluded by construction. `getStore()` does not load this table,
 * so `toPublicProduct` never sees the field, so no public response can carry
 * it — including responses written by code that has never heard of it.
 *
 * ## The name itself
 *
 * Ranked exactly as the supplier rules require: the official Simplified
 * Chinese name first, an official Traditional name converted second, a trade
 * name confirmed against two sources third. A literal machine translation is
 * not a source and is never `verified` — which is why the status and the
 * source URL are stored with the name rather than beside it.
 */

import { d1All, d1First, d1Run } from "./d1.server";

export type ZhVerificationStatus = "verified" | "needs_review" | "missing";

export interface ProductAdminMetadata {
  productId: string;
  supplierNameZhCn: string;
  supplierNameZhSourceUrl: string;
  supplierNameZhVerificationStatus: ZhVerificationStatus;
  supplierNameZhVerifiedAt: string;
  updatedBy: string;
  updatedAt: string;
}

const STATUSES: readonly ZhVerificationStatus[] = ["verified", "needs_review", "missing"];

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toStatus(value: unknown): ZhVerificationStatus {
  const raw = text(value).trim();
  /*
    Anything unreadable is `missing`, never `verified`. A row nobody can
    interpret must not be able to publish a product.
  */
  return (STATUSES as readonly string[]).includes(raw) ? (raw as ZhVerificationStatus) : "missing";
}

function toRow(row: Record<string, unknown>): ProductAdminMetadata {
  return {
    productId: text(row["product_id"]),
    supplierNameZhCn: text(row["supplier_name_zh_cn"]),
    supplierNameZhSourceUrl: text(row["supplier_name_zh_source_url"]),
    supplierNameZhVerificationStatus: toStatus(row["supplier_name_zh_verification_status"]),
    supplierNameZhVerifiedAt: text(row["supplier_name_zh_verified_at"]),
    updatedBy: text(row["updated_by"]),
    updatedAt: text(row["updated_at"]),
  };
}

/*
  CJK Unified Ideographs, the Extension A block, and the compatibility block.
  Deliberately not "any non-Latin": the check exists to catch the two mistakes
  that actually happen — the English title pasted into the Chinese field, and
  an empty value dressed up as a name.
*/
const HAN = /[一-鿿㐀-䶿豈-﫿]/;

/**
 * Traditional-only characters that a Simplified name should not contain.
 *
 * A short list rather than a full conversion table: it is a guard, not a
 * converter. Its job is to make an admin look again at a name that was pasted
 * from a Traditional source without being converted, which the rules require.
 */
const TRADITIONAL_HINTS = /[個們來時體國學實這會傳點寶號龍戰劍靈險緣繫觀]/;

export interface ZhNameCheck {
  ok: boolean;
  /** Why it was refused, for the admin screen. Never shown to a customer. */
  reason?:
    | "empty"
    | "not_chinese"
    | "same_as_english_title"
    | "too_long"
    | "looks_traditional";
}

/**
 * Is this a usable Simplified Chinese supplier name?
 *
 * Called on import and on every admin write, because the field is typed by
 * hand and pasted from a browser — the two ways an English title ends up in a
 * Chinese column.
 */
export function checkSupplierNameZh(value: unknown, englishTitle = ""): ZhNameCheck {
  const name = text(value).trim();
  if (!name) return { ok: false, reason: "empty" };
  if (name.length > 120) return { ok: false, reason: "too_long" };
  if (!HAN.test(name)) return { ok: false, reason: "not_chinese" };

  const english = englishTitle.trim().toLowerCase();
  if (english && name.trim().toLowerCase() === english) {
    return { ok: false, reason: "same_as_english_title" };
  }
  if (TRADITIONAL_HINTS.test(name)) return { ok: false, reason: "looks_traditional" };
  return { ok: true };
}

/** One product's admin metadata, or undefined when none has been written. */
export async function readProductAdminMetadata(
  productId: string,
): Promise<ProductAdminMetadata | undefined> {
  if (!productId) return undefined;
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM product_admin_metadata WHERE product_id = ? LIMIT 1`,
    productId,
  );
  return row?.["product_id"] ? toRow(row) : undefined;
}

/** Every row, for the admin screen and the completion report. */
export async function listProductAdminMetadata(): Promise<ProductAdminMetadata[]> {
  const rows = await d1All<Record<string, unknown>>(
    `SELECT * FROM product_admin_metadata ORDER BY product_id`,
  );
  return rows.filter((row) => row["product_id"]).map(toRow);
}

export interface WriteSupplierNameInput {
  productId: string;
  supplierNameZhCn: string;
  sourceUrl?: string;
  status?: ZhVerificationStatus;
  englishTitle?: string;
  updatedBy?: string;
  now?: string;
}

/**
 * Record a Chinese name, its source and how well it is trusted.
 *
 * A name that fails the check is still stored — but as `needs_review`, never
 * as `verified`. Refusing to store it would lose the admin's work; marking it
 * verified would let an English title through as a supplier name.
 */
export async function writeSupplierNameZh(
  input: WriteSupplierNameInput,
): Promise<{ ok: boolean; status: ZhVerificationStatus; reason?: ZhNameCheck["reason"] }> {
  const productId = input.productId.trim();
  if (!productId) return { ok: false, status: "missing" };

  const check = checkSupplierNameZh(input.supplierNameZhCn, input.englishTitle ?? "");
  const now = input.now ?? new Date().toISOString();
  const name = text(input.supplierNameZhCn).trim();

  /*
    `verified` needs three things at once: a name that passes, a source to
    point at, and somebody asking for that status. Missing any of them, the
    row is `needs_review` — which is what keeps an unproven name from
    publishing a product.
  */
  const wants = input.status ?? "needs_review";
  const status: ZhVerificationStatus = !name
    ? "missing"
    : check.ok && wants === "verified" && Boolean(input.sourceUrl?.trim())
      ? "verified"
      : "needs_review";

  await d1Run(
    `INSERT INTO product_admin_metadata (
       product_id, supplier_name_zh_cn, supplier_name_zh_source_url,
       supplier_name_zh_verification_status, supplier_name_zh_verified_at,
       updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       supplier_name_zh_cn = excluded.supplier_name_zh_cn,
       supplier_name_zh_source_url = excluded.supplier_name_zh_source_url,
       supplier_name_zh_verification_status = excluded.supplier_name_zh_verification_status,
       supplier_name_zh_verified_at = excluded.supplier_name_zh_verified_at,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    productId,
    name,
    text(input.sourceUrl).trim(),
    status,
    status === "verified" ? now : "",
    text(input.updatedBy),
    now,
    now,
  );

  return check.ok
    ? { ok: true, status }
    : { ok: false, status, ...(check.reason ? { reason: check.reason } : {}) };
}

/**
 * May this product be published?
 *
 * The import rule: a game with no verified Chinese name stays hidden and shows
 * the admin a field that needs filling. Applied to products arriving through
 * import — never used to hide something that is already on sale, because
 * taking a live product off the shelf is not this function's decision to make.
 */
export function canPublishWithSupplierName(meta: ProductAdminMetadata | undefined): boolean {
  return meta?.supplierNameZhVerificationStatus === "verified";
}
