import type { ReviewStatus } from "./types";
import { d1All, d1First, d1Run, getD1 } from "./d1.server";
import type { Order } from "./types";

export interface ProductReviewRow {
  id: string;
  product_id: string;
  user_id: string;
  order_id: string | null;
  rating: number;
  comment: string;
  screenshot_url: string | null;
  instagram_proof_url: string | null;
  status: string;
  /** The submission this row belongs to; one per product, shared across them. */
  review_group_id: string | null;
  /** Why an admin refused it. A rejection keeps the row rather than deleting it. */
  rejection_reason: string | null;
  is_auto_review: number | boolean;
  review_due_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string | null;
  user_name?: string | null;
}

const REVIEW_TABLE = `CREATE TABLE IF NOT EXISTS product_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  order_id TEXT,
  rating INTEGER NOT NULL DEFAULT 5,
  comment TEXT NOT NULL DEFAULT '',
  screenshot_url TEXT,
  instagram_proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  is_auto_review INTEGER NOT NULL DEFAULT 0,
  review_due_at TEXT,
  approved_at TEXT,
  approved_by TEXT,
  review_group_id TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
)`;

const REVIEW_COLUMNS: Record<string, string> = {
  order_id: "TEXT",
  rating: "INTEGER NOT NULL DEFAULT 5",
  comment: "TEXT NOT NULL DEFAULT ''",
  screenshot_url: "TEXT",
  instagram_proof_url: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'approved'",
  is_auto_review: "INTEGER NOT NULL DEFAULT 0",
  review_due_at: "TEXT",
  approved_at: "TEXT",
  approved_by: "TEXT",
  /*
    The submission a row belongs to.

    One review submission covers every product in the order — the owner's rule
    is that the same comment appears on all of them — so the rows are written
    one per product and tied together by this id. It is what lets an admin
    approve a three-game order with one statement instead of three, and what
    tells the auto-publish cron that a row is not its business.
  */
  review_group_id: "TEXT",
  /** Why an admin refused it. Kept, so a rejection is never a silent delete. */
  rejection_reason: "TEXT",
  created_at: "TEXT NOT NULL DEFAULT ''",
  updated_at: "TEXT",
};

let reviewsSchemaPromise: Promise<void> | undefined;

/** A focused repair for databases created before review media and moderation fields existed. */
export function ensureReviewsSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.resolve();
  if (!reviewsSchemaPromise) {
    reviewsSchemaPromise = (async () => {
      await db.prepare(REVIEW_TABLE).run();
      const columns = (await db.prepare(`PRAGMA table_info(product_reviews)`).all()).results ?? [];
      const names = new Set(columns.map((column) => String(column["name"] ?? "")));
      for (const [name, definition] of Object.entries(REVIEW_COLUMNS)) {
        if (names.has(name)) continue;
        try {
          await db.prepare(`ALTER TABLE product_reviews ADD COLUMN ${name} ${definition}`).run();
        } catch {
          // A concurrent cold start may have added it first.
        }
      }
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS product_reviews_product_status_idx
           ON product_reviews (product_id, status, created_at DESC)`,
        )
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS product_reviews_order_idx
           ON product_reviews (order_id, product_id, user_id)`,
        )
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS product_reviews_group_idx
           ON product_reviews (review_group_id)`,
        )
        .run();
      /*
        The admin queue asks a status-only question — which submissions are
        waiting for me — and neither index above can answer it:
        `product_reviews_product_status_idx` leads with the product and
        `product_reviews_order_idx` with the order.
      */
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS product_reviews_status_created_idx
           ON product_reviews (status, created_at DESC)`,
        )
        .run();
    })().catch((error) => {
      reviewsSchemaPromise = undefined;
      throw error;
    });
  }
  return reviewsSchemaPromise;
}

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  doc: string;
  updated_at: string;
}

function readOrder(row: OrderRow): Order | null {
  try {
    const parsed = JSON.parse(row.doc) as Partial<Order>;
    return {
      ...parsed,
      id: String(parsed.id ?? row.id),
      userId: String(parsed.userId ?? row.user_id),
      status: (parsed.status ?? row.status) as Order["status"],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    } as Order;
  } catch {
    return null;
  }
}

function isCompleted(row: OrderRow, order: Order): boolean {
  return row.status === "completed" || order.status === "completed";
}

async function orderContainsProduct(row: OrderRow, order: Order, productId: string) {
  try {
    const snapshot = await d1First<{ found: number }>(
      `SELECT 1 AS found FROM order_items_snapshot
       WHERE order_id = ? AND product_id = ? LIMIT 1`,
      row.id,
      productId,
    );
    if (snapshot?.found) return true;
  } catch {
    // Old orders may predate the immutable snapshot table; their document is
    // still an exact, server-written purchase record.
  }

  return order.items.some((item) => String(item.productId ?? "") === productId);
}

export type CompletedPurchaseResult =
  | { ok: true; order: Order }
  | { ok: false; reason: "order_not_found" | "order_not_completed" | "product_not_in_order" };

/**
 * Resolve the completed purchase that authorises a public, verified review.
 *
 * The old route searched `orders.doc` with LIKE and then trusted a caller's
 * `orderId` when the search failed. That let an arbitrary id turn a review into
 * a "verified buyer" review, matched `prd_1` inside `prd_10`, and accepted
 * orders that had never completed. This uses the immutable item relation first
 * and an exact parsed-document comparison only for legacy orders.
 */
export async function findCompletedPurchase(
  userId: string,
  productId: string,
  requestedOrderId?: string,
): Promise<CompletedPurchaseResult> {
  const rows = requestedOrderId
    ? await d1All<OrderRow>(
        `SELECT id, user_id, status, doc, updated_at FROM orders
         WHERE id = ? AND user_id = ? LIMIT 1`,
        requestedOrderId,
        userId,
      )
    : await d1All<OrderRow>(
        `SELECT id, user_id, status, doc, updated_at FROM orders
         WHERE user_id = ? ORDER BY updated_at DESC`,
        userId,
      );

  if (requestedOrderId && rows.length === 0) return { ok: false, reason: "order_not_found" };

  let foundIncomplete = false;
  let foundCompletedWithoutProduct = false;
  for (const row of rows) {
    const order = readOrder(row);
    if (!order) continue;
    if (!isCompleted(row, order)) {
      if (requestedOrderId) foundIncomplete = true;
      continue;
    }
    if (!(await orderContainsProduct(row, order, productId))) {
      if (requestedOrderId) foundCompletedWithoutProduct = true;
      continue;
    }
    return { ok: true, order: { ...order, status: "completed" } };
  }

  if (foundIncomplete) return { ok: false, reason: "order_not_completed" };
  if (foundCompletedWithoutProduct) return { ok: false, reason: "product_not_in_order" };
  return { ok: false, reason: "order_not_found" };
}

async function stableReviewId(userId: string, orderId: string, productId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}\n${orderId}\n${productId}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `rev_${Array.from(hash.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function publishVerifiedReview(input: {
  userId: string;
  orderId: string;
  productId: string;
  rating: number;
  comment: string;
  /** Undefined preserves existing media; null explicitly removes it. */
  screenshotUrl?: string | null;
  /**
   * The customer's screenshot of their own Instagram comment.
   *
   * It was missing from the INSERT and from the conflict update, so a fresh
   * row wrote NULL over it — the admin's only evidence disappearing at the
   * moment the row was written.
   */
  instagramProofUrl?: string | null;
  /** The submission this row belongs to. One per product, shared across them. */
  reviewGroupId?: string | null;
  /**
   * Where the row lands. Defaults to the published state this function has
   * always written, so every existing caller behaves exactly as before; the
   * two-step submission passes `awaiting_admin` and no approver.
   */
  status?: ReviewStatus;
  approvedBy?: string | null;
  isAutoReview?: boolean;
  now?: string;
}): Promise<ProductReviewRow> {
  await ensureReviewsSchema();
  const now = input.now ?? new Date().toISOString();
  const existing = await d1First<ProductReviewRow>(
    `SELECT * FROM product_reviews
     WHERE user_id = ? AND product_id = ?
       AND (
         order_id = ?
         OR (order_id IS NULL AND status = 'pending' AND review_due_at IS NULL)
       )
     ORDER BY CASE WHEN order_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    input.userId,
    input.productId,
    input.orderId,
    input.orderId,
  );
  const id = existing?.id || (await stableReviewId(input.userId, input.orderId, input.productId));
  const screenshotUrl =
    input.screenshotUrl === undefined ? (existing?.screenshot_url ?? null) : input.screenshotUrl;
  const instagramProofUrl =
    input.instagramProofUrl === undefined
      ? (existing?.instagram_proof_url ?? null)
      : input.instagramProofUrl;
  const reviewGroupId =
    input.reviewGroupId === undefined ? (existing?.review_group_id ?? null) : input.reviewGroupId;
  const status: ReviewStatus = input.status ?? "approved";
  const published = status === "approved";
  /*
    An approver is only stamped on a row that is actually approved. A row that
    is waiting for an admin must carry no approval timestamp at all, or the
    admin queue and the customer's own view would both read it as settled.
  */
  const approvedBy = published ? (input.approvedBy ?? "system:verified_purchase") : null;
  const approvedAt = published ? now : null;
  const isAutoReview = input.isAutoReview === true ? 1 : 0;

  await d1Run(
    `INSERT INTO product_reviews (
       id, product_id, user_id, order_id, rating, comment, screenshot_url,
       instagram_proof_url, review_group_id, status, is_auto_review, review_due_at,
       approved_at, approved_by, rejection_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id = excluded.product_id,
       user_id = excluded.user_id,
       order_id = excluded.order_id,
       rating = excluded.rating,
       comment = excluded.comment,
       screenshot_url = excluded.screenshot_url,
       instagram_proof_url = excluded.instagram_proof_url,
       review_group_id = excluded.review_group_id,
       status = excluded.status,
       is_auto_review = excluded.is_auto_review,
       review_due_at = NULL,
       approved_at = excluded.approved_at,
       approved_by = excluded.approved_by,
       /* A resubmission clears the old refusal rather than carrying it. */
       rejection_reason = NULL,
       updated_at = excluded.updated_at`,
    id,
    input.productId,
    input.userId,
    input.orderId,
    input.rating,
    input.comment,
    screenshotUrl,
    instagramProofUrl,
    reviewGroupId,
    status,
    isAutoReview,
    approvedAt,
    approvedBy,
    existing?.created_at || now,
    now,
  );

  // Clean up only duplicate placeholders/rows for this exact purchase after
  // the canonical row is safely committed. Never delete first.
  await d1Run(
    `DELETE FROM product_reviews
     WHERE user_id = ? AND order_id = ? AND product_id = ? AND id != ?`,
    input.userId,
    input.orderId,
    input.productId,
    id,
  );

  const saved = await d1First<ProductReviewRow>(`SELECT * FROM product_reviews WHERE id = ?`, id);
  if (!saved) throw new Error("REVIEW_SAVE_FAILED");
  return saved;
}

/**
 * Promote genuine reviews left pending by the previous moderation flow.
 * Checkout placeholders carry `review_due_at` and are deliberately excluded;
 * every remaining row is still re-verified against an exact completed order
 * before it can become public or earn a reward.
 */
export async function reconcilePendingVerifiedReviews(
  limit = 25,
): Promise<{ scanned: number; published: number; errors: number }> {
  await ensureReviewsSchema();
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 25));
  const rows = await d1All<ProductReviewRow>(
    /*
      Legacy rows only.

      This runs every minute, publishes what it finds as approved, and used to
      mint a 1,000 IQD coupon for it. A review submitted through the two-step
      popup matches neither predicate — it carries `awaiting_admin` and a
      `review_group_id` — and the two guards are deliberately redundant: each
      one holds if the other is ever edited away. Without them the admin's
      approval queue empties itself within sixty seconds, with the coupons
      already spent and nothing on screen explaining why.
    */
    `SELECT * FROM product_reviews
     WHERE status = 'pending' AND review_due_at IS NULL AND review_group_id IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    boundedLimit,
  );
  const result = { scanned: rows.length, published: 0, errors: 0 };

  for (const row of rows) {
    try {
      const purchase = await findCompletedPurchase(
        row.user_id,
        row.product_id,
        row.order_id || undefined,
      );
      if (!purchase.ok) continue;
      const rating = Math.max(1, Math.min(5, Math.round(Number(row.rating) || 0)));
      await publishVerifiedReview({
        userId: row.user_id,
        orderId: purchase.order.id,
        productId: row.product_id,
        rating,
        comment: String(row.comment || "").slice(0, 1200),
        screenshotUrl: row.screenshot_url || null,
      });
      /*
        No reward here. A code is the admin's decision now, taken on a
        submission that carries proof — never something a cron hands out for a
        row it happened to find.
      */
      result.published += 1;
    } catch (error) {
      result.errors += 1;
      console.warn("[reviews:legacy_reconciliation_failed]", {
        reviewId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
