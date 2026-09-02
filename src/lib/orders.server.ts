import { randomId } from "./crypto.server";
import {
  appendMessage,
  findUserById,
  getStore,
  saveOrder,
  saveThread,
  d1Run,
  d1First,
  getOrder,
  d1Batch,
  d1All,
  createAuditLog,
} from "./db.server";
import { sendTelegramMessage } from "./telegram.server";
import {
  checkCoupon,
  couponDiscount,
  rowToCoupon,
  type CouponCheckItem,
  type CouponRow,
} from "./coupons";
import { claimCouponUse, readCouponUsage, releaseCouponUse } from "./coupon-usage.server";
import { isAwaitingRelease, releaseDayISO } from "./release";
import type {
  Address,
  Order,
  OrderItem,
  ProductKind,
  User,
  Product,
  AccountBundle,
  WalletTransactionKind,
  WalletTransaction,
  WalletRechargeRequest,
  BananCode,
  Thread,
  ChatMessage,
  Coupon,
} from "./types";

export interface CheckoutLine {
  productId: string | number;
  quantity: number;
  editionId?: string;
  dlcIds?: string[];
  /*
    Which option and type the member picked — the offline or the online account,
    the standard or the DLC edition. The cart has always known this; it simply
    never travelled, so the server could not tell an offline purchase from an
    online one and a coupon restricted to offline accounts had nothing to read.
    Only the *id* is accepted: names are resolved from the catalogue below.
  */
  optionId?: string;
  typeId?: string;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const digits = String(value ?? "").replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInvalidTitle(title: string | undefined | null): boolean {
  if (!title || typeof title !== "string" || !title.trim()) return true;
  const clean = title.trim();
  return (
    UUID_REGEX.test(clean) ||
    clean.toLowerCase() === "undefined" ||
    clean.toLowerCase() === "null" ||
    clean.toLowerCase() === "nan"
  );
}

/**
 * Thrown when a checkout line names a product that has not been released.
 *
 * A distinct type rather than a dropped line: dropping it would empty the cart
 * and report "cart_empty", which tells the customer nothing about why. The
 * order endpoint turns this into a message naming the game and its date.
 */
export class AwaitingReleaseError extends Error {
  readonly productId: string;
  readonly productTitle: string;
  readonly releaseDate: string | null;

  constructor(productId: string, productTitle: string, releaseDate: string | null) {
    super("product_not_released");
    this.name = "AwaitingReleaseError";
    this.productId = productId;
    this.productTitle = productTitle;
    this.releaseDate = releaseDate;
  }
}

/**
 * Server-side validation of a cart line to ensure price and availability are real.
 */
async function validateLine(
  line: CheckoutLine,
  store: { products: Product[]; bundles?: AccountBundle[] },
): Promise<OrderItem | null> {
  if (!line || !line.productId) return null;
  const product = store.products.find((p) => String(p.id) === String(line.productId));
  const bundle = store.bundles?.find((b) => String(b.id) === String(line.productId));

  if (!product && bundle) {
    if (bundle.isActive === false) return null;
    const unitPrice = toNumber(bundle.price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || isInvalidTitle(bundle.title)) {
      return null;
    }

    /*
      A bundle is only as available as the games in it. This branch returns
      before the product gate below, so without this a bundle carrying an
      unreleased game would sell that game anyway — the same order the gate
      exists to refuse, one indirection further out.
    */
    const unreleasedInBundle = (bundle.gameIds ?? [])
      .map((gameId) => store.products.find((p) => String(p.id) === String(gameId)))
      .find((game) => game && isAwaitingRelease(game));
    if (unreleasedInBundle) {
      throw new AwaitingReleaseError(
        String(unreleasedInBundle.id),
        unreleasedInBundle.title,
        releaseDayISO(unreleasedInBundle),
      );
    }

    return {
      id: randomId("itm"),
      productId: bundle.id,
      title: bundle.title.trim(),
      ...(bundle.image ? { image: String(bundle.image) } : {}),
      kind: "bundle",
      quantity: Math.max(1, Math.min(99, Math.floor(Number(line.quantity) || 1))),
      unitPrice,
      // Snapshot the cost with the price. See `OrderItem.unitCost`.
      unitCost: toNumber((bundle as any).cost),
      meta: {
        bundleGameIds: bundle.gameIds,
      } as any,
    };
  }

  if (!product || product.isActive === false || (product as any).status === "غير نشط") return null;

  /*
    A game that is not out yet cannot be sold, whatever the cart says.

    Pre-orders are ordinary priced products with a future release date, and the
    only thing standing between one and a completed order used to be the
    storefront choosing not to draw a buy button. The cart is client state and
    a checkout request names product ids, so the refusal has to live here —
    every order line, from every surface, is resolved through this function.
    The customer registers for a release alert instead; the moment the date
    passes this stops matching and the same product sells itself.
  */
  if (isAwaitingRelease(product)) {
    throw new AwaitingReleaseError(String(product.id), product.title, releaseDayISO(product));
  }

  let unitPrice = toNumber(product.price);
  let title = product.title;

  // Handle Editions
  if (line.editionId && product.editions) {
    const edition = product.editions.find((e) => e.id === line.editionId);
    if (edition) {
      unitPrice = toNumber(edition.price);
      title = `${title} (${edition.name})`;
    }
  }

  // Handle DLCs
  const selectedDlcs: string[] = [];
  if (line.dlcIds && product.dlcs) {
    for (const dlcId of line.dlcIds) {
      const dlc = product.dlcs.find((d) => d.id === dlcId);
      if (dlc) {
        unitPrice += toNumber(dlc.price);
        selectedDlcs.push(dlc.name);
      }
    }
  }
  if (selectedDlcs.length > 0) {
    title = `${title} + ${selectedDlcs.join(", ")}`;
  }

  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || isInvalidTitle(title)) {
    return null;
  }

  const kind: ProductKind = (product.kind as ProductKind) ?? "account";

  /*
    Resolve the selection against the catalogue, never against the request. The
    client sends an id; the name, and therefore whether this is an offline
    account, is read from the stored product. A line naming an option the
    product does not have resolves to nothing rather than to whatever the
    browser claimed.
  */
  const options = Array.isArray((product as any).options) ? (product as any).options : [];
  const types = Array.isArray((product as any).types)
    ? (product as any).types
    : Array.isArray((product as any).variants)
      ? (product as any).variants
      : [];
  const selectedOption = line.optionId
    ? options.find((option: any) => String(option?.id) === String(line.optionId))
    : undefined;
  const selectedType = line.typeId
    ? types.find((type: any) => String(type?.id) === String(line.typeId))
    : undefined;

  /*
    The cost is snapshotted alongside the price, and resolved the same way: a
    variant that carries its own cost is what this line actually cost us, not
    the product's headline figure. Recording it here is what stops a later
    supplier re-price rewriting the margin on orders already placed — see
    `OrderItem.unitCost`.
  */
  const unitCost =
    toNumber((selectedType as any)?.cost) ||
    toNumber((selectedOption as any)?.cost) ||
    toNumber((product as any).cost);

  return {
    id: randomId("itm"),
    productId: product.id,
    title: title.trim(),
    ...(product.image ? { image: String(product.image) } : {}),
    kind,
    quantity: Math.max(1, Math.min(99, Math.floor(Number(line.quantity) || 1))),
    unitPrice,
    unitCost,
    meta: {
      editionId: line.editionId ?? null,
      dlcIds: line.dlcIds ?? null,
      optionId: selectedOption ? String(selectedOption.id) : null,
      optionName: selectedOption ? String(selectedOption.name ?? "") : null,
      typeId: selectedType ? String(selectedType.id) : null,
      typeName: selectedType ? String(selectedType.name ?? "") : null,
    },
  };
}

const idempotencyCache = new Map<string, { order: Order; at: number }>();

function getCachedOrder(key?: string): Order | null {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > 60_000) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.order;
}

function setCachedOrder(key: string | undefined, order: Order) {
  if (!key) return;
  idempotencyCache.set(key, { order, at: Date.now() });
  // Clean old entries
  if (idempotencyCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of idempotencyCache.entries()) {
      if (now - v.at > 60_000) idempotencyCache.delete(k);
    }
  }
}

export async function createOrderForUser(
  user: User,
  lines: CheckoutLine[],
  address?: Address,
  couponCode?: string,
  acceptedTerms?: boolean,
  idempotencyKey?: string,
  targetProductId?: string | number,
  source = "checkout_web",
  checkoutSessionId?: string,
): Promise<Order> {
  if (!user || !user.id || typeof user.id !== "string") {
    throw new Error("missing_user");
  }

  if (acceptedTerms === false) {
    throw new Error("terms_required");
  }

  const cleanIdempotencyKey = idempotencyKey?.trim() || undefined;

  if (cleanIdempotencyKey) {
    // 1. Check in-memory cache
    const existingMem = getCachedOrder(cleanIdempotencyKey);
    if (existingMem) return existingMem;

    // 2. Check D1 for existing order with this idempotency_key
    try {
      const existingRow = await d1First<{ doc: string }>(
        `SELECT doc FROM orders WHERE idempotency_key = ? LIMIT 1`,
        cleanIdempotencyKey,
      );
      if (existingRow) {
        const parsed = JSON.parse(existingRow.doc) as Order;
        if (parsed && parsed.id) {
          setCachedOrder(cleanIdempotencyKey, parsed);
          return parsed;
        }
      }
    } catch {
      // Ignored if query fails
    }
  }

  const store = await getStore();
  const items: OrderItem[] = [];

  for (const line of lines) {
    const validated = await validateLine(line, store);
    if (validated) items.push(validated);
  }

  if (!items.length) throw new Error("cart_empty");

  const itemsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  if (!Number.isFinite(itemsTotal) || itemsTotal <= 0 || itemsTotal > 1_000_000_000) {
    throw new Error("invalid_total");
  }

  const now = new Date().toISOString();
  let discountAmount = 0;
  let appliedCoupon: Coupon | null = null;
  let appliedTargetProductId: string | null = null;
  /** The option the discounted copy was bought with, for the audit trail. */
  let appliedVariantId: string | null = null;
  // Set once a coupon use has actually been claimed, so it can be handed back
  // if a later step of checkout fails.
  let couponClaimed: { couponId: string; userId: string } | null = null;

  if (couponCode) {
    const row = await d1First<CouponRow>(
      "SELECT * FROM coupons WHERE code = ? AND is_active = 1",
      couponCode.trim().toUpperCase(),
    );
    if (!row) throw new Error("coupon_invalid");

    // Mapped through the same reader the validator uses, so what the member was
    // told at the cart is exactly what checkout applies.
    const coupon = rowToCoupon(row);

    /*
      The coupon rules read the *server's* view of the cart: prices taken from
      the catalogue and the option resolved from the product record, not the
      values the browser sent. That is what makes an offline-account
      restriction unspoofable.
    */
    const couponItems: CouponCheckItem[] = items.map((item) => ({
      productId: item.productId,
      kind: item.kind,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      title: item.title,
      optionId: (item.meta as any)?.optionId ?? null,
      optionName: (item.meta as any)?.optionName ?? null,
      typeId: (item.meta as any)?.typeId ?? null,
      typeName: (item.meta as any)?.typeName ?? null,
    }));
    const [usage, lifetimeSingleItem] = await Promise.all([
      readCouponUsage(coupon.id, user.id),
      d1First<{ total: number }>(
        "SELECT COUNT(*) as total FROM coupon_redemptions WHERE user_id = ? AND (coupon_type = 'single_item_percent' OR coupon_type = 'single_game_50')",
        user.id,
      ),
    ]);

    const verdict = checkCoupon({
      coupon,
      userId: user.id,
      orderAmount: itemsTotal,
      items: couponItems,
      globalUses: usage.globalUses,
      userUses: usage.userUses,
      lifetimeSingleItemUses: Number(lifetimeSingleItem?.total ?? 0),
      targetProductId,
    });
    if (!verdict.ok) throw new Error("coupon_invalid");

    /*
      The read above is advisory; this is the decision.

      Between reading the counters and writing the order, another checkout by
      the same member can pass the same read. Claiming the use atomically is
      what makes "one per customer" actually mean one — and it is also where a
      global cap, when one is set, is spent.
    */
    const claim = await claimCouponUse({
      couponId: coupon.id,
      userId: user.id,
      perUserLimit: coupon.perUserLimit,
      totalLimit: coupon.usageLimit,
      now,
    });
    if (!claim.ok) throw new Error("coupon_invalid");
    couponClaimed = { couponId: coupon.id, userId: user.id };

    const discountRes = couponDiscount(coupon, itemsTotal, couponItems, targetProductId);
    const discountedLine = discountRes.targetProductId
      ? couponItems.find((item) => String(item.productId) === String(discountRes.targetProductId))
      : undefined;
    appliedVariantId = discountedLine?.optionId ? String(discountedLine.optionId) : null;
    discountAmount = discountRes.discount;
    appliedCoupon = coupon;
    appliedTargetProductId = discountRes.targetProductId
      ? String(discountRes.targetProductId)
      : null;
  }

  const finalItemsTotal = Math.max(0, itemsTotal - discountAmount);
  const needsWalletPayment = items.every((item) =>
    ["account", "offline_account", "online_account", "bundle", "preorder", "digital_code"].includes(
      item.kind,
    ),
  );

  if (needsWalletPayment && (user.walletBalance || 0) < finalItemsTotal) {
    // The coupon use was claimed a moment ago; give it back rather than
    // burning a member's single use on an order that never happened.
    if (couponClaimed) {
      await releaseCouponUse({ ...couponClaimed, releaseGlobal: true }).catch(() => {});
    }
    throw new Error("insufficient_balance");
  }

  const deliveryBase = toNumber(store.settings?.["deliveryBase"] || 5000);
  const deliveryExceptions = (
    Array.isArray(store.settings?.["deliveryExceptions"])
      ? store.settings["deliveryExceptions"]
      : []
  ) as { city: string; price: number }[];

  let deliveryPrice = deliveryBase;
  if (address?.city) {
    const exception = deliveryExceptions.find((e) => e.city === address.city);
    if (exception) deliveryPrice = toNumber(exception.price);
  }

  const needsAddress = items.some((item) =>
    ["hardware", "physical", "accessory", "device", "collectible"].includes(item.kind),
  );
  const total = finalItemsTotal + (needsAddress ? deliveryPrice : 0);

  const orderId = randomId("ord");
  const threadId = randomId("thr");
  const code = `BN-${Date.now().toString().slice(-6)}`;
  const walletTxId = needsWalletPayment ? randomId("wlt") : undefined;
  const activeSessionId = checkoutSessionId || randomId("chk");

  const order: Order = {
    discountAmount: discountAmount || undefined,
    couponCode: appliedCoupon && couponCode ? couponCode.trim().toUpperCase() : undefined,
    // Which line the coupon actually came off, when it was restricted to one.
    // Resolved above to compute the discount; recording it is what lets
    // per-product profit attribute it to the right product.
    ...(appliedTargetProductId ? { couponTargetProductId: appliedTargetProductId } : {}),
    ...(appliedVariantId ? { couponTargetVariantId: appliedVariantId } : {}),
    id: orderId,
    code,
    userId: user.id,
    userName: user.name,
    items,
    total,
    currency: "IQD",
    status: needsWalletPayment ? "processing" : "pending",
    paymentStatus: needsWalletPayment ? "paid" : "unpaid",
    needsAddress,
    ...(address ? { address } : {}),
    threadId,
    createdAt: now,
    updatedAt: now,
    events: [{ type: "order_created", at: now }],
    source,
    checkoutSessionId: activeSessionId,
    paymentReference: walletTxId,
    idempotencyKey: cleanIdempotencyKey,
    createdBy: user.id,
  };

  if (needsWalletPayment) {
    const payment = await d1Batch([
      {
        sql: `UPDATE users SET wallet_balance = CASE WHEN wallet_balance >= ? THEN wallet_balance - ? ELSE NULL END WHERE id = ?`,
        params: [finalItemsTotal, finalItemsTotal, user.id],
      },
      {
        sql: `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
               SELECT ?, ?, 'payment', ?, ?, ?, ? WHERE changes() = 1`,
        params: [walletTxId, user.id, -finalItemsTotal, `شراء طلب ${code}`, orderId, now],
      },
      {
        sql: `INSERT INTO orders (
                id, code, user_id, doc, status, payment_status, total, created_at, updated_at,
                idempotency_key, checkout_session_id, payment_reference, source, created_by
              ) SELECT ?, ?, ?, ?, 'processing', 'paid', ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        params: [
          order.id,
          order.code,
          order.userId,
          JSON.stringify(order),
          order.total,
          now,
          now,
          order.idempotencyKey || null,
          order.checkoutSessionId || null,
          order.paymentReference || null,
          order.source || "checkout_web",
          order.createdBy || user.id,
        ],
      },
    ]);
    if (Number(payment[0]?.meta?.changes ?? 0) !== 1) {
      if (couponClaimed) {
        await releaseCouponUse({ ...couponClaimed, releaseGlobal: true }).catch(() => {});
      }
      throw new Error("insufficient_balance");
    }
  }

  // Record Coupon Redemption in D1
  if (appliedCoupon) {
    try {
      await d1Run(
        `INSERT INTO coupon_redemptions (id, coupon_id, coupon_type, user_id, order_id, discount_amount, target_product_id, variant_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomId("cpr"),
        appliedCoupon.id,
        appliedCoupon.discountType,
        user.id,
        orderId,
        discountAmount,
        appliedTargetProductId,
        appliedVariantId,
        now,
      );
    } catch (err) {
      console.error("[order:coupon_redemption_failed]", err);
    }
  }

  try {
    await saveOrder(order);
  } catch (err) {
    console.error("[order:save_fallback]", err);
  }

  // Record Audit Trail
  try {
    await createAuditLog(user.id, "order_created", "order", order.id, null, null, {
      source: order.source,
      checkoutSessionId: order.checkoutSessionId,
      paymentReference: order.paymentReference,
      idempotencyKey: order.idempotencyKey,
      createdBy: user.id,
      total: order.total,
      itemsCount: order.items.length,
      items: order.items.map((i) => ({
        productId: i.productId,
        title: i.title,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        kind: i.kind,
      })),
    });
  } catch (err) {
    console.error("[order:audit_log_failed]", err);
  }

  if (cleanIdempotencyKey) {
    setCachedOrder(cleanIdempotencyKey, order);
  }

  // Snapshot Order Items (Safe)
  try {
    for (const item of items) {
      await d1Run(
        `INSERT INTO order_items_snapshot (
          id, order_id, product_id, title, price_iqd, quantity, options_json, image_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomId("snap"),
        orderId,
        item.productId,
        item.title,
        item.unitPrice,
        item.quantity,
        JSON.stringify(item.meta || {}),
        item.image || null,
        now,
      );
    }
  } catch (err) {
    console.error("[order:snapshot_failed]", err);
  }

  // Create the canonical order_items relation and one independent D1 delivery
  // row per quantity slot. The admin API retries this idempotently if checkout
  // was interrupted after payment, so a paid order is never dependent on a
  // browser-side draft or a chat message.
  try {
    const { ensureOrderDeliveryRecords } = await import("./order-delivery-items.server");
    await ensureOrderDeliveryRecords(order);
  } catch (err) {
    console.error("[order:delivery_records_create_failed]", {
      orderId: order.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Reward Banana Calculation (Safe)
  try {
    const bananaEligible = items.every((item) => !["hardware", "device"].includes(item.kind));
    if (bananaEligible && order.paymentStatus === "paid") {
      const rewardRate = toNumber(store.settings?.["banana_reward_rate"] || 6.8);
      const bananaReward = Math.floor(itemsTotal * rewardRate);

      const existingReward = await d1First(
        `SELECT id FROM banana_ledger WHERE user_id = ? AND reference_id = ? AND type = 'reward'`,
        user.id,
        orderId,
      );

      if (bananaReward > 0 && !existingReward) {
        await d1Batch([
          {
            sql: `UPDATE users SET banana_balance = banana_balance + ? WHERE id = ?`,
            params: [bananaReward, user.id],
          },
          {
            sql: `INSERT INTO banana_ledger (id, user_id, amount, type, direction, balance_before, balance_after, reference_type, reference_id, created_at)
                  SELECT ?, ?, ?, 'reward', 'in', ?, ?, 'order', ?, ? WHERE changes() = 1`,
            params: [
              randomId("blg"),
              user.id,
              bananaReward,
              user.bananaBalance || 0,
              (user.bananaBalance || 0) + bananaReward,
              orderId,
              now,
            ],
          },
        ]);
      }
    }
  } catch (err) {
    console.error("[order:banana_ledger_failed]", err);
  }

  // Create Review Placeholder (Safe)
  try {
    const reviewDueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    for (const item of items) {
      await d1Run(
        `INSERT INTO product_reviews (id, product_id, user_id, order_id, status, is_auto_review, review_due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        randomId("rev"),
        item.productId,
        user.id,
        orderId,
        reviewDueAt,
        now,
        now,
      );
    }
  } catch (err) {
    console.error("[order:review_placeholder_failed]", err);
  }

  // Initial status history (Safe)
  try {
    await d1Run(
      `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
       VALUES (?, ?, null, 'pending', 'system', 'Order created', ?)`,
      randomId("osh"),
      orderId,
      now,
    );

    await d1Run(
      `INSERT INTO order_status_history_v2 (
        id, order_id, old_status, new_status, changed_by_user_id, changed_by_role, reason, created_at
      ) VALUES (?, ?, null, 'pending', ?, 'SYSTEM', 'Order created', ?)`,
      randomId("oshv2"),
      orderId,
      user.id,
      now,
    );
  } catch (err) {
    console.error("[order:status_history_failed]", err);
  }

  // If digital, add to queue (Safe)
  if (needsWalletPayment) {
    try {
      await d1Run(
        `INSERT INTO order_queue (id, order_id, status, created_at, updated_at)
         VALUES (?, ?, 'waiting', ?, ?)`,
        randomId("que"),
        orderId,
        now,
        now,
      );
    } catch (err) {
      console.error("[order:queue_failed]", err);
    }
  }

  // Save Support Thread
  try {
    await saveThread({
      id: threadId,
      userId: user.id,
      userName: user.name,
      orderId,
      chatType: "ORDER_SUPPORT",
      subject: `طلب ${code}`,
      status: "open",
      mode: "ADMIN_ACTIVE",
      lastMessageAt: now,
      createdAt: now,
    });

    // For paid digital orders, send the digital order card directly (no generic welcome message or payment prompt)
    if (needsWalletPayment) {
      await appendMessage(threadId, {
        senderRole: "system",
        kind: "system",
        body: {
          type: "digital_order_card",
          orderId: order.id,
          code: order.code,
          items: order.items.map((it) => ({
            id: it.id,
            productId: it.productId,
            title: it.title,
            unitPrice: it.unitPrice,
            quantity: it.quantity,
            image: it.image || "",
            kind: it.kind,
          })),
          total: order.total,
          currency: order.currency,
          paymentStatus: "paid",
          text: `🎮 تم تأكيد طلبك الرقمي (${order.code}) بنجاح!\nالمبلغ المدفوع من المحفظة: ${order.total.toLocaleString()} د.ع\nيقوم فريق الدعم حالياً بتجهيز بيانات الحساب والرمز وإرسالها لك في هذه المحادثة.`,
        },
      });
    } else {
      const intro = store.adminPresence?.online
        ? (store.autoReplies?.onlineIntro ?? "")
        : (store.autoReplies?.offlineIntro ?? "");

      await appendMessage(threadId, {
        senderRole: "system",
        kind: "system",
        body: { text: intro || `تم إنشاء الطلب ${code}. سيتم متابعة طلبك هنا.` },
      });

      await appendMessage(threadId, {
        senderRole: "system",
        kind: "payment_methods_card",
        body: {
          total,
          currency: "IQD",
          code,
          methods: store.paymentMethods?.length
            ? store.paymentMethods
            : [
                {
                  id: "zaincash",
                  name: "ZainCash",
                  details: "أرسل المبلغ ثم ارفع صورة الإيصال هنا",
                },
              ],
        },
      });
    }
  } catch (err) {
    console.error("[order:thread_message_failed]", err);
  }

  // Notify Telegram Admin and User (Safe)
  try {
    const { notifyAdminNewOrder } = await import("./telegram-notifications.server");
    await notifyAdminNewOrder({
      order,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("[order:admin_telegram_notify_failed]", err);
  }

  if (user.telegramId) {
    try {
      const { telegramMiniAppDeepLink } = await import("./telegram.server");
      await sendTelegramMessage(
        user.telegramId,
        `✅ <b>تم إنشاء طلبك بنجاح</b>\n\nرقم الطلب: <code>${code}</code>\nالإجمالي: <b>${total.toLocaleString()} د.ع</b>\n\nاضغط أدناه لمتابعة طلبك مباشرة في تليكرام 👇`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎮 متابعة الطلب والمحادثة",
                  url: telegramMiniAppDeepLink(`order_${order.id}`),
                },
              ],
            ],
          },
        },
      );
    } catch (err) {
      console.error("[order:telegram_notify_failed]", err);
    }
  }

  setCachedOrder(idempotencyKey, order);

  return order;
}

export async function claimOrderTask(orderId: string, staffId: string): Promise<boolean> {
  const now = new Date().toISOString();
  await d1Run(
    `UPDATE order_queue 
     SET assigned_staff_id = ?, status = 'processing', updated_at = ? 
     WHERE order_id = ? AND (status = 'waiting' OR assigned_staff_id = ?)`,
    staffId,
    now,
    orderId,
    staffId,
  );

  await createAuditLog(staffId, "claim_order", "order", orderId, { action: "claimed" });
  return true;
}

export async function completeOrderTask(orderId: string, staffId: string): Promise<boolean> {
  const now = new Date().toISOString();

  const task = await d1First<{ assigned_staff_id: string }>(
    `SELECT assigned_staff_id FROM order_queue WHERE order_id = ?`,
    orderId,
  );

  if (!task || task.assigned_staff_id !== staffId) {
    throw new Error("Task not assigned to this staff member");
  }

  const order = await getOrder(orderId);
  if (order) {
    const { getDeliveryOrderState } = await import("./order-delivery-items.server");
    const delivery = await getDeliveryOrderState(order);
    if (delivery.progress.total > 0) {
      throw new Error("digital_orders_complete_only_after_customer_confirmation_or_server_timeout");
    }
    await updateOrderStatus({
      orderId,
      newStatus: "completed",
      changedByUserId: staffId,
      changedByRole: "ADMIN",
      reason: "Order completed by staff",
    });
  }

  await d1Run(
    `UPDATE order_queue SET status = 'completed', updated_at = ? WHERE order_id = ?`,
    now,
    orderId,
  );

  return true;
}

export async function updateOrderStatus(params: {
  orderId: string;
  newStatus: string;
  changedByUserId: string;
  changedByRole: "USER" | "ADMIN" | "SUPPORT_AGENT" | "SYSTEM";
  reason?: string;
  metadata?: Record<string, any>;
}) {
  const { orderId, newStatus, changedByUserId, changedByRole, reason, metadata } = params;
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");

  const oldStatus = order.status;
  const now = new Date().toISOString();

  const next: Order = {
    ...order,
    status: newStatus as any,
    updatedAt: now,
    events: [
      ...order.events,
      { type: "status_changed", at: now, payload: { oldStatus, newStatus, reason } },
    ],
  };
  await saveOrder(next);

  await d1Run(
    `INSERT INTO order_status_history (id, order_id, old_status, new_status, changed_by, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomId("osh"),
    orderId,
    oldStatus,
    newStatus,
    changedByUserId,
    reason || null,
    now,
  );

  await d1Run(
    `INSERT INTO order_status_history_v2 (
      id, order_id, old_status, new_status, changed_by_user_id, changed_by_role, reason, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomId("oshv2"),
    orderId,
    oldStatus,
    newStatus,
    changedByUserId,
    changedByRole,
    reason || null,
    JSON.stringify(metadata || {}),
    now,
  );

  await createAuditLog(changedByUserId, "update_order_status", "order", orderId, {
    oldStatus,
    newStatus,
    reason,
  });

  return next;
}

/**
 * Checks whether all delivery items in the order have been fulfilled/sent.
 * For orders with multiple games/accounts, every item must be fulfilled.
 */
export function areAllOrderItemsDelivered(order: Order): boolean {
  if (!order.items || order.items.length === 0) return false;
  return order.items.every((item) => {
    if (item.completedAt || item.deliveredAt) return true;
    if (item.kind === "hardware") return Boolean(item.shippedAt || item.deliveredAt);
    // Shared legacy OrderItem fields cannot prove delivery of quantity > 1.
    // This compatibility helper is intentionally conservative; the canonical
    // async decision lives in order_delivery_items.
    if (Math.max(1, Number(item.quantity) || 1) > 1) return false;
    return Boolean(item.verificationCodeSentAt || item.completedAt);
  });
}

/**
 * Auto-completion moved to `order-completion.server.ts`, which owns every way
 * an order can finish — the admin's button, the customer's confirmation and
 * the hour-long timer — so they cannot disagree and none of them can run twice.
 *
 * Re-exported here because the API routes already import it from this module.
 */
export { evaluateOrderAutoCompletion } from "./order-completion.server";
