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

/**
 * Delivered, which is not quite the same as completed.
 *
 * The owner's second trigger asks for the review thirty minutes after the last
 * OTP — before the sixty-minute timer has completed the order. At that point
 * the customer holds every code the order contained; asking them to rate the
 * delivery and then refusing the review because a timer has not elapsed would
 * be the shop arguing with its own message.
 *
 * `findCompletedPurchase` still insists on `completed`. That path publishes a
 * public star rating with no admin between it and the product page; this one
 * lands as `awaiting_admin` and a person decides.
 */
function isDelivered(row: OrderRow, order: Order): boolean {
  if (isCompleted(row, order)) return true;
  return (
    row.status === "awaiting_customer_confirmation" ||
    order.status === "awaiting_customer_confirmation"
  );
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

/** One product inside a submission, as the admin card and the sheet show it. */
export interface ReviewGroupProduct {
  reviewId: string;
  productId: string;
  title: string | null;
  imageUrl: string | null;
}

/**
 * A submission: one comment, one pair of attachments, every product in the
 * order. The owner's rule is that one review covers the whole order, so the
 * rows are written per product and read back as this.
 */
export interface ReviewGroupSummary {
  groupId: string;
  userId: string;
  userName: string | null;
  orderId: string | null;
  orderCode: string | null;
  rating: number;
  comment: string;
  screenshotUrl: string | null;
  instagramProofUrl: string | null;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  products: ReviewGroupProduct[];
}

type GroupRow = ProductReviewRow & {
  user_name?: string | null;
  order_code?: string | null;
  product_title?: string | null;
  product_image?: string | null;
};

/*
  The product's title as it was bought, not as the catalogue reads today.
  `order_items_snapshot` is written at checkout, so a game later renamed or
  removed still shows the admin what the customer actually reviewed.
*/
const GROUP_SELECT = `SELECT r.*, u.name AS user_name, o.code AS order_code,
    s.title AS product_title, s.image_url AS product_image
  FROM product_reviews r
  LEFT JOIN users u ON u.id = r.user_id
  LEFT JOIN orders o ON o.id = r.order_id
  LEFT JOIN order_items_snapshot s
    ON s.order_id = r.order_id AND s.product_id = r.product_id`;

function toGroups(rows: GroupRow[]): ReviewGroupSummary[] {
  const byGroup = new Map<string, ReviewGroupSummary>();
  for (const row of rows) {
    const groupId = String(row.review_group_id ?? "");
    if (!groupId) continue;
    let group = byGroup.get(groupId);
    if (!group) {
      group = {
        groupId,
        userId: row.user_id,
        userName: row.user_name ?? null,
        orderId: row.order_id,
        orderCode: row.order_code ?? null,
        rating: Number(row.rating) || 0,
        comment: row.comment || "",
        screenshotUrl: row.screenshot_url ?? null,
        instagramProofUrl: row.instagram_proof_url ?? null,
        status: row.status,
        rejectionReason: row.rejection_reason ?? null,
        createdAt: row.created_at,
        products: [],
      };
      byGroup.set(groupId, group);
    }
    /*
      A product can appear twice when the order has two lines of it. The card
      should list it once — the review is about the delivery, not the line.
    */
    if (!group.products.some((product) => product.productId === row.product_id)) {
      group.products.push({
        reviewId: row.id,
        productId: row.product_id,
        title: row.product_title ?? null,
        imageUrl: row.product_image ?? null,
      });
    }
  }
  return [...byGroup.values()];
}

/** Submissions waiting for an admin, oldest first — the order they are worked in. */
export async function listReviewGroupsAwaitingAdmin(limit = 50): Promise<ReviewGroupSummary[]> {
  await ensureReviewsSchema();
  const rows = await d1All<GroupRow>(
    `${GROUP_SELECT}
     WHERE r.status = 'awaiting_admin' AND r.review_group_id IS NOT NULL
     ORDER BY r.created_at ASC
     LIMIT ?`,
    /*
      Rows, not groups. An order of several products is several rows, so ask
      for enough of them that the cap counts submissions rather than lines.
    */
    Math.max(1, Math.min(500, limit * 10)),
  );
  return toGroups(rows).slice(0, limit);
}

/** How many submissions are waiting — the badge on the inbox filter. */
export async function countReviewGroupsAwaitingAdmin(): Promise<number> {
  await ensureReviewsSchema();
  const row = await d1First<{ n?: number }>(
    `SELECT COUNT(DISTINCT review_group_id) AS n FROM product_reviews
     WHERE status = 'awaiting_admin' AND review_group_id IS NOT NULL`,
  );
  return Number(row?.n ?? 0) || 0;
}

export async function getReviewGroup(groupId: string): Promise<ReviewGroupSummary | null> {
  await ensureReviewsSchema();
  if (!groupId) return null;
  const rows = await d1All<GroupRow>(
    `${GROUP_SELECT} WHERE r.review_group_id = ? ORDER BY r.created_at ASC LIMIT 100`,
    groupId,
  );
  return toGroups(rows)[0] ?? null;
}

export type ReviewGroupDecision =
  | {
      ok: true;
      group: ReviewGroupSummary;
      reward: { code: string; amountIqd: number; expiresAt: string } | null;
      /** Set when the review was approved but the customer's week was spent. */
      cooldown: { lastIssuedAt: string; nextEligibleAt: string } | null;
    }
  | { ok: false; reason: "not_found" | "already_decided" | "invalid" };

/**
 * Approve a submission: publish every product's row, then issue the code.
 *
 * The publish and the reward are deliberately separate. A customer who
 * already earned a code this week still gets their review published — the
 * review is a real one, and hiding it because of a reward rule would be
 * punishing them for reviewing twice. The caller is told about the cooldown
 * so the admin sees why no code went out.
 */
export async function approveReviewGroup(input: {
  groupId: string;
  adminId: string;
  now?: string;
}): Promise<ReviewGroupDecision> {
  await ensureReviewsSchema();
  const groupId = String(input.groupId ?? "").trim();
  if (!groupId) return { ok: false, reason: "invalid" };

  const before = await getReviewGroup(groupId);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.status !== "awaiting_admin") return { ok: false, reason: "already_decided" };

  const now = input.now ?? new Date().toISOString();

  /*
    Guarded on the status it was read at, so two admins opening the same card
    cannot both approve it — the second changes nothing and is told so.
  */
  const { d1RunChanges } = await import("./d1.server");
  const moved = await d1RunChanges(
    `UPDATE product_reviews
     SET status = 'approved', approved_at = ?, approved_by = ?, rejection_reason = NULL,
         updated_at = ?
     WHERE review_group_id = ? AND status = 'awaiting_admin'`,
    now,
    `admin:${input.adminId}`,
    now,
    groupId,
  );
  if (moved < 1) return { ok: false, reason: "already_decided" };

  const after = (await getReviewGroup(groupId)) ?? before;

  if (!before.orderId) {
    // Published, but there is no order to attach a reward to.
    return { ok: true, group: after, reward: null, cooldown: null };
  }

  const { getOrder } = await import("./db.server");
  const order = await getOrder(before.orderId);
  if (!order) return { ok: true, group: after, reward: null, cooldown: null };

  const { issueApprovedReviewReward } = await import("./review-reward.server");
  const outcome = await issueApprovedReviewReward(order, { now });
  if (outcome.ok) {
    return { ok: true, group: after, reward: outcome.reward, cooldown: null };
  }
  if (outcome.reason === "cooldown") {
    return {
      ok: true,
      group: after,
      reward: null,
      cooldown: { lastIssuedAt: outcome.lastIssuedAt, nextEligibleAt: outcome.nextEligibleAt },
    };
  }
  return { ok: true, group: after, reward: null, cooldown: null };
}

/**
 * Refuse a submission, with a reason.
 *
 * The rows are kept rather than deleted: the customer is told why, and an
 * admin who refused the wrong card can see what they refused.
 */
export async function rejectReviewGroup(input: {
  groupId: string;
  adminId: string;
  reason: string;
  now?: string;
}): Promise<ReviewGroupDecision> {
  await ensureReviewsSchema();
  const groupId = String(input.groupId ?? "").trim();
  const reason = String(input.reason ?? "")
    .trim()
    .slice(0, 300);
  if (!groupId || reason.length < 3) return { ok: false, reason: "invalid" };

  const before = await getReviewGroup(groupId);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.status !== "awaiting_admin") return { ok: false, reason: "already_decided" };

  const now = input.now ?? new Date().toISOString();
  const { d1RunChanges } = await import("./d1.server");
  const moved = await d1RunChanges(
    `UPDATE product_reviews
     SET status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL,
         updated_at = ?
     WHERE review_group_id = ? AND status = 'awaiting_admin'`,
    reason,
    now,
    groupId,
  );
  if (moved < 1) return { ok: false, reason: "already_decided" };

  // No reward, and no cooldown spent: a refused submission costs the customer
  // nothing but the attempt.
  return {
    ok: true,
    group: (await getReviewGroup(groupId)) ?? before,
    reward: null,
    cooldown: null,
  };
}

export type ReviewSubmissionResult =
  | { ok: true; groupId: string; products: number }
  | {
      ok: false;
      reason:
        | "order_not_found"
        | "order_not_completed"
        | "comment_too_short"
        | "invalid_rating"
        | "media_required"
        | "invalid_media"
        | "proof_required"
        | "invalid_proof"
        | "already_submitted"
        | "no_products";
    };

/** Shortest comment the shop will take. Three words is not a review. */
export const REVIEW_COMMENT_MIN = 10;
export const REVIEW_COMMENT_MAX = 1200;

/**
 * The two-step submission: one comment, one attachment, one Instagram proof,
 * written across every product in the order.
 *
 * Every check here is the server's own. The sheet checks the same things so
 * the customer is not made to guess, but a client check is a convenience and
 * this is the rule — the reward is money, and the only thing standing between
 * a crafted request and a coupon is this function and the admin who approves.
 */
export async function submitOrderReviewGroup(input: {
  userId: string;
  orderId: string;
  rating: number;
  comment: string;
  /** The customer's photo or clip of the delivery. */
  deliveryMediaUrl: string;
  /** Their screenshot of their own comment on the shop's Instagram post. */
  instagramProofUrl: string;
  now?: string;
}): Promise<ReviewSubmissionResult> {
  await ensureReviewsSchema();
  const { isOwnReviewImageUrl, isOwnReviewMediaUrl } = await import("./uploads");

  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, reason: "invalid_rating" };
  }

  const comment = String(input.comment ?? "").trim();
  if (comment.length < REVIEW_COMMENT_MIN) return { ok: false, reason: "comment_too_short" };

  const deliveryMediaUrl = String(input.deliveryMediaUrl ?? "").trim();
  if (!deliveryMediaUrl) return { ok: false, reason: "media_required" };
  if (!isOwnReviewMediaUrl(deliveryMediaUrl, input.userId)) {
    return { ok: false, reason: "invalid_media" };
  }

  const instagramProofUrl = String(input.instagramProofUrl ?? "").trim();
  if (!instagramProofUrl) return { ok: false, reason: "proof_required" };
  /*
    A still image, deliberately. The proof is a screenshot of the customer's
    own comment; a video here would be unreadable at card size and is not what
    was asked for.
  */
  if (!isOwnReviewImageUrl(instagramProofUrl, input.userId)) {
    return { ok: false, reason: "invalid_proof" };
  }

  const orderRow = await d1First<OrderRow & { code?: string | null }>(
    `SELECT id, user_id, status, doc, updated_at, code FROM orders WHERE id = ?`,
    input.orderId,
  );
  // `d1First` answers with a truthy empty object when there is no binding, so
  // test a field rather than the row.
  if (!orderRow?.id || orderRow.user_id !== input.userId) {
    return { ok: false, reason: "order_not_found" };
  }
  const order = readOrder(orderRow);
  if (!order || !isDelivered(orderRow, order)) {
    return { ok: false, reason: "order_not_completed" };
  }

  /*
    One live submission per order. A rejected one may be sent again — that is
    the point of telling the customer why — but a submission already waiting,
    or already approved, is not replaced.
  */
  const live = await d1First<{ status?: string; review_group_id?: string | null }>(
    `SELECT status, review_group_id FROM product_reviews
     WHERE order_id = ? AND user_id = ? AND review_group_id IS NOT NULL
       AND status IN ('awaiting_admin', 'approved')
     ORDER BY created_at DESC LIMIT 1`,
    input.orderId,
    input.userId,
  );
  if (live?.status) return { ok: false, reason: "already_submitted" };

  const productIds = await orderProductIds(orderRow, order);
  if (productIds.length === 0) return { ok: false, reason: "no_products" };

  const now = input.now ?? new Date().toISOString();
  const groupId = await stableReviewId(input.userId, input.orderId, `group:${now}`);

  /*
    Sequential, not parallel: `publishVerifiedReview` reads the existing row
    before writing it, and D1 gives no transaction across these. One at a time
    is slower by milliseconds and cannot interleave two reads of the same row.
  */
  for (const productId of productIds) {
    await publishVerifiedReview({
      userId: input.userId,
      orderId: input.orderId,
      productId,
      rating,
      comment: comment.slice(0, REVIEW_COMMENT_MAX),
      screenshotUrl: deliveryMediaUrl,
      instagramProofUrl,
      reviewGroupId: groupId,
      status: "awaiting_admin",
      now,
    });
  }

  return { ok: true, groupId, products: productIds.length };
}

/**
 * Every product the order actually contains, without repeats.
 *
 * The snapshot is the truth — it is written at checkout and survives a product
 * being renamed or removed — but an order placed before it existed has none,
 * so the document is the fallback.
 */
async function orderProductIds(row: OrderRow, order: Order): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  const snapshot = await d1All<{ product_id?: string }>(
    `SELECT product_id FROM order_items_snapshot WHERE order_id = ? ORDER BY created_at ASC`,
    row.id,
  );
  for (const item of snapshot) add(item.product_id);
  if (ids.length > 0) return ids;

  for (const item of order.items ?? []) add(item.productId);
  return ids;
}
