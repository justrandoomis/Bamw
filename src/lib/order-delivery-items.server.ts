import { DELIVERY_OTP_TTL_MINUTES, deliveryOtpExpiry } from "./delivery-otp";
import {
  readOrderItemSelection,
  selectionSummary,
  type OrderItemSelection,
} from "./orderItemSelection";

/**
 * How many products one supplier-name lookup may ask about.
 *
 * D1 refuses a statement carrying more than a hundred bound parameters, and a
 * placeholder list built from an array is exactly how that limit gets found in
 * production rather than in a test. Checkout already caps a cart at fifty
 * lines, so this is never reached — it is here so the bound is a property of
 * this statement rather than a property of a rule somewhere else.
 */
const MAX_SUPPLIER_NAME_LOOKUPS = 50;
import {
  ACCOUNT_GAME_MATCH_MIN_CONFIDENCE,
  matchAccountsToOrder,
  parseAccountPaste,
  type OrderItemMatchTarget,
  type ParsedAccountLine,
} from "./account-paste";
import { decryptSecretValue, encryptSecretValue, randomId } from "./crypto.server";
import {
  allExpectedDeliveryItemsDelivered,
  autoCompleteAtFromLastOtp,
  calculateDeliveryProgress,
  deliveryDraftStatus,
  nextReadyDeliveryItemId,
  type DeliveryItemStatus,
  type DeliveryProgress,
} from "./digital-delivery-state";
import { d1All, d1First, d1Run, d1RunChanges, getD1 } from "./d1.server";
import { appendMessage, d1Batch, getOrder, getThread, saveOrder, saveThread } from "./db.server";
import type { Order, OrderItem } from "./types";

const DIGITAL_KINDS = new Set([
  "account",
  "offline_account",
  "online_account",
  "bundle",
  "preorder",
  "digital_code",
  "code",
  "gift_card",
]);

const CODE_KINDS = new Set(["digital_code", "code", "gift_card"]);

const DELIVERY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
    product_title TEXT NOT NULL CHECK (length(trim(product_title)) > 0),
    kind TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
    unit_price REAL NOT NULL DEFAULT 0, image_url TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id, id)`,
  `CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id, order_id)`,
  `CREATE TABLE IF NOT EXISTS order_delivery_items (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_item_id TEXT, product_id TEXT,
    slot_number INTEGER, kind TEXT NOT NULL DEFAULT 'account',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
      status IN ('draft','needs_mapping','ready','sent','proof_received','otp_sent','completed')
    ),
    username TEXT, password_enc TEXT, detected_game TEXT, match_confidence REAL,
    source_fingerprint TEXT, sent_at TEXT, proof_received_at TEXT, proof_url TEXT,
    otp_sent_at TEXT, completed_at TEXT, revision INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS order_delivery_items_slot_idx
    ON order_delivery_items (order_id, order_item_id, slot_number)
    WHERE archived_at IS NULL AND order_item_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS order_delivery_items_source_idx
    ON order_delivery_items (order_id, source_fingerprint)
    WHERE archived_at IS NULL AND source_fingerprint IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS order_delivery_items_order_status_idx
    ON order_delivery_items (order_id, status, archived_at)`,
  `CREATE INDEX IF NOT EXISTS order_delivery_items_due_idx
    ON order_delivery_items (otp_sent_at, order_id)`,
  `CREATE TABLE IF NOT EXISTS order_delivery_issues (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, delivery_item_id TEXT,
    opened_by_user_id TEXT NOT NULL, reason TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_at TEXT NOT NULL, resolved_at TEXT, resolved_by_user_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS order_delivery_issues_open_idx
    ON order_delivery_issues (order_id, status, created_at)`,
] as const;

const ORDER_DELIVERY_COLUMNS = [
  "last_otp_sent_at TEXT",
  "auto_complete_at TEXT",
  "customer_confirmed_at TEXT",
  "auto_completed_at TEXT",
  "delivery_issue_opened_at TEXT",
] as const;

let deliverySchemaPromise: Promise<void> | undefined;

function requireD1() {
  if (!getD1()) throw new Error("D1_REQUIRED_FOR_DIGITAL_DELIVERY");
}

export async function ensureDigitalDeliverySchema(): Promise<void> {
  requireD1();
  if (!deliverySchemaPromise) {
    deliverySchemaPromise = (async () => {
      for (const sql of DELIVERY_SCHEMA_STATEMENTS) await d1Run(sql);
      const orderColumns = await d1All<{ name: string }>(`PRAGMA table_info(orders)`);
      const existing = new Set(orderColumns.map((column) => column.name));
      for (const definition of ORDER_DELIVERY_COLUMNS) {
        const name = definition.slice(0, definition.indexOf(" "));
        if (existing.has(name)) continue;
        try {
          await d1Run(`ALTER TABLE orders ADD COLUMN ${definition}`);
          existing.add(name);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/duplicate column|already exists/i.test(message)) throw error;
        }
      }
    })().catch((error) => {
      deliverySchemaPromise = undefined;
      throw error;
    });
  }
  await deliverySchemaPromise;
}

function isDigitalItem(item: OrderItem): boolean {
  return DIGITAL_KINDS.has(String(item.kind || "account"));
}

function validCanonicalTitle(title: unknown): title is string {
  const value = typeof title === "string" ? title.trim() : "";
  return Boolean(value && value !== "undefined" && value !== "null");
}

async function resolveCanonicalTitle(order: Order, item: OrderItem): Promise<string> {
  // Once created, the canonical relation itself is the source of truth. Check
  // both order_id and product_id so an unrelated/stale row can never supply a
  // title merely because an identifier happened to collide.
  const canonical = await d1First<{
    product_id: string;
    product_title: string | null;
  }>(
    `SELECT product_id, product_title FROM order_items
     WHERE id = ? AND order_id = ? LIMIT 1`,
    item.id,
    order.id,
  );
  if (canonical) {
    if (String(canonical.product_id) !== String(item.productId)) {
      console.error("[delivery:canonical_product_relation_mismatch]", {
        orderId: order.id,
        orderItemId: item.id,
        expectedProductId: item.productId,
        persistedProductId: canonical.product_id,
      });
      throw new Error("DELIVERY_PRODUCT_RELATION_MISSING");
    }
    if (validCanonicalTitle(canonical.product_title)) return canonical.product_title.trim();
    console.error("[delivery:canonical_title_invalid]", {
      orderId: order.id,
      orderItemId: item.id,
      productId: item.productId,
    });
    throw new Error("DELIVERY_PRODUCT_TITLE_MISSING");
  }

  // `order_items_snapshot` is written at checkout from the validated product
  // relation. Read it directly from D1; neither chat text nor the catalogue
  // cache participates in fulfillment.
  try {
    const snapshot = await d1First<{ title: string | null }>(
      `SELECT title FROM order_items_snapshot
       WHERE order_id = ? AND CAST(product_id AS TEXT) = CAST(? AS TEXT)
         AND length(trim(title)) > 0
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      order.id,
      String(item.productId),
    );
    if (validCanonicalTitle(snapshot?.title)) return snapshot.title.trim();
  } catch (error) {
    console.error("[delivery:order_item_snapshot_lookup_failed]", {
      orderId: order.id,
      orderItemId: item.id,
      productId: item.productId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Do not fall back to chat text, a cached catalogue, the last message, or the
  // order document. A missing product snapshot is a data-integrity error and
  // the admin UI receives an explicit error instead of an empty/wrong title.
  console.error("[delivery:canonical_product_snapshot_missing]", {
    orderId: order.id,
    orderItemId: item.id,
    productId: item.productId,
  });
  throw new Error("DELIVERY_PRODUCT_TITLE_MISSING");
}

/**
 * Persist the checkout-validated order relation and expand quantity into slots.
 * Existing canonical titles are never overwritten from a later JSON/cache copy.
 */
export async function ensureOrderDeliveryRecords(order: Order): Promise<void> {
  await ensureDigitalDeliverySchema();
  for (const item of order.items) {
    if (item.productId === undefined || item.productId === null || item.productId === "") {
      console.error("[delivery:canonical_product_relation_missing]", {
        orderId: order.id,
        orderItemId: item.id,
      });
      throw new Error("DELIVERY_PRODUCT_RELATION_MISSING");
    }
    const canonicalTitle = await resolveCanonicalTitle(order, item);

    const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)));
    await d1Run(
      `INSERT OR IGNORE INTO order_items (
        id, order_id, product_id, product_title, kind, quantity, unit_price,
        image_url, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      order.id,
      String(item.productId),
      canonicalTitle,
      String(item.kind || "account"),
      quantity,
      Number(item.unitPrice || 0),
      item.image || null,
      JSON.stringify(item.meta || {}),
      order.createdAt,
      order.updatedAt,
    );

    if (!isDigitalItem(item)) continue;
    // Seed at most the first slot from the one account represented by the old
    // shared OrderItem fields. Putting the seed in INSERT OR IGNORE makes this
    // a one-time migration operation: subsequent reads can never copy a later
    // legacy value into another independent delivery slot.
    const legacyStatus: DeliveryItemStatus = item.completedAt
      ? "completed"
      : item.verificationCodeSentAt
        ? "otp_sent"
        : item.loginProofAt
          ? "proof_received"
          : item.credsSentAt
            ? "sent"
            : item.deliveryEmail && item.deliveryPasswordEnc
              ? "ready"
              : "draft";
    for (let slot = 1; slot <= quantity; slot += 1) {
      const deliveryItemId = `${item.id}:delivery:${slot}`;
      const seedLegacy = slot === 1;
      await d1Run(
        `INSERT OR IGNORE INTO order_delivery_items (
          id, order_id, order_item_id, product_id, slot_number, kind, status,
          username, password_enc, sent_at, proof_received_at, proof_url,
          otp_sent_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        deliveryItemId,
        order.id,
        item.id,
        String(item.productId),
        slot,
        String(item.kind || "account"),
        seedLegacy ? legacyStatus : "draft",
        seedLegacy ? item.deliveryEmail || null : null,
        seedLegacy ? item.deliveryPasswordEnc || null : null,
        seedLegacy ? item.credsSentAt || null : null,
        seedLegacy ? item.loginProofAt || null : null,
        seedLegacy ? item.loginProofUrl || null : null,
        seedLegacy ? item.verificationCodeSentAt || null : null,
        seedLegacy ? item.completedAt || null : null,
        order.createdAt,
        order.updatedAt,
      );
    }
  }

  // A partial relation must fail loudly; silently returning fewer tabs makes a
  // multi-game order look complete before every real order item is handled.
  const persisted = await d1All<{ id: string }>(
    `SELECT id FROM order_items WHERE order_id = ?`,
    order.id,
  );
  const persistedIds = new Set(persisted.map((row) => row.id));
  const missing = order.items.filter((item) => !persistedIds.has(item.id));
  if (missing.length) {
    console.error("[delivery:canonical_order_items_incomplete]", {
      orderId: order.id,
      missing: missing.map((item) => ({
        orderItemId: item.id,
        productId: item.productId,
      })),
    });
    throw new Error("DELIVERY_PRODUCT_RELATION_MISSING");
  }
}

interface DeliveryRow {
  id: string;
  order_id: string;
  order_item_id: string | null;
  product_id: string | null;
  canonical_product_id: string | null;
  product_title: string | null;
  slot_number: number | null;
  kind: string;
  status: DeliveryItemStatus;
  username: string | null;
  password_enc: string | null;
  detected_game: string | null;
  match_confidence: number | null;
  source_fingerprint: string | null;
  sent_at: string | null;
  proof_received_at: string | null;
  proof_url: string | null;
  otp_sent_at: string | null;
  completed_at: string | null;
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CanonicalOrderItemRow {
  id: string;
  product_id: string;
  product_title: string;
  kind: string;
  quantity: number;
  /*
    The selection, which this query has always stored and never read back.
    `order_items.metadata_json` holds the option, the type, the edition and the
    add-ons exactly as they were at checkout — and until now the delivery
    screen selected five columns that did not include it, so an admin
    preparing an account could not tell an offline account from an online one.
  */
  metadata_json: string | null;
}

export interface AdminDeliveryItem {
  id: string;
  orderId: string;
  orderItemId: string | null;
  productId: string | null;
  /** Null only while the supplier line explicitly needs manual mapping. */
  productTitle: string | null;
  slotNumber: number | null;
  kind: string;
  status: DeliveryItemStatus;
  username: string;
  password: string;
  detectedGame: string | null;
  matchConfidence: number | null;
  sentAt: string | null;
  proofReceivedAt: string | null;
  proofUrl: string | null;
  otpSentAt: string | null;
  completedAt: string | null;
  revision: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface DeliveryOrderState {
  orderId: string;
  orderCode: string;
  orderStatus: Order["status"];
  lastOtpSentAt: string | null;
  autoCompleteAt: string | null;
  deliveryIssueOpenedAt: string | null;
  orderItems: Array<{
    id: string;
    productId: string;
    productTitle: string;
    kind: string;
    quantity: number;
    /** What was actually bought — read from the checkout snapshot. */
    selection: OrderItemSelection;
    /**
     * The Chinese supplier name, for the silent copy on the fulfilment card.
     *
     * This state is only ever built behind `requireAdmin`, and the field is
     * read from `product_admin_metadata` rather than from the product, so it
     * cannot travel on any public response. Empty when nobody has recorded
     * one yet — and the copy is then refused rather than falling back to the
     * English title, which would place the wrong order.
     */
    supplierNameZhCn: string;
  }>;
  deliveryItems: AdminDeliveryItem[];
  progress: DeliveryProgress;
}

async function deliveryRows(orderId: string): Promise<DeliveryRow[]> {
  return d1All<DeliveryRow>(
    `SELECT di.*, oi.product_id AS canonical_product_id, oi.product_title
     FROM order_delivery_items AS di
     LEFT JOIN order_items AS oi
       ON oi.id = di.order_item_id AND oi.order_id = di.order_id
     WHERE di.order_id = ? AND di.archived_at IS NULL
     ORDER BY
       CASE WHEN di.order_item_id IS NULL THEN 1 ELSE 0 END,
       oi.created_at ASC, di.slot_number ASC, di.created_at ASC`,
    orderId,
  );
}

async function rowToAdminItem(row: DeliveryRow): Promise<AdminDeliveryItem> {
  if (row.order_item_id && !validCanonicalTitle(row.product_title)) {
    console.error("[delivery:canonical_title_missing]", {
      orderId: row.order_id,
      deliveryItemId: row.id,
      orderItemId: row.order_item_id,
      productId: row.canonical_product_id || row.product_id,
    });
    throw new Error("DELIVERY_PRODUCT_TITLE_MISSING");
  }

  let password = "";
  if (row.password_enc) {
    try {
      password = await decryptSecretValue(row.password_enc);
    } catch (error) {
      console.error("[delivery:password_decrypt_failed]", {
        orderId: row.order_id,
        deliveryItemId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("DELIVERY_PASSWORD_DECRYPT_FAILED");
    }
  }

  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    productId: row.canonical_product_id || row.product_id,
    productTitle: row.order_item_id ? row.product_title : null,
    slotNumber: row.slot_number,
    kind: row.kind,
    status: row.status,
    username: row.username || "",
    password,
    detectedGame: row.detected_game,
    matchConfidence: row.match_confidence,
    sentAt: row.sent_at,
    proofReceivedAt: row.proof_received_at,
    proofUrl: row.proof_url,
    otpSentAt: row.otp_sent_at,
    completedAt: row.completed_at,
    revision: Number(row.revision || 0),
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}

export async function getDeliveryOrderState(
  orderOrId: Order | string,
): Promise<DeliveryOrderState> {
  const order = typeof orderOrId === "string" ? await getOrder(orderOrId) : orderOrId;
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);

  const [canonicalItems, rows] = await Promise.all([
    d1All<CanonicalOrderItemRow>(
      `SELECT id, product_id, product_title, kind, quantity, metadata_json
       FROM order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC`,
      order.id,
    ),
    deliveryRows(order.id),
  ]);

  /*
    The Chinese names for everything on this order, in one query.

    Read here rather than per card so the fulfilment screen makes one round
    trip, and read from the admin table rather than the catalogue so there is
    no path by which it could reach a customer.
  */
  const productIds = [
    ...new Set(canonicalItems.map((item) => item.product_id).filter(Boolean)),
  ].slice(0, MAX_SUPPLIER_NAME_LOOKUPS);
  const supplierNames = new Map<string, string>();
  if (productIds.length) {
    const placeholders = productIds.map(() => "?").join(", ");
    const metaRows = await d1All<Record<string, unknown>>(
      `SELECT product_id, supplier_name_zh_cn FROM product_admin_metadata
        WHERE product_id IN (${placeholders})`,
      ...productIds,
    ).catch(() => []);
    for (const row of metaRows) {
      const name = String(row["supplier_name_zh_cn"] ?? "").trim();
      if (name) supplierNames.set(String(row["product_id"]), name);
    }
  }

  for (const item of canonicalItems) {
    if (!validCanonicalTitle(item.product_title)) {
      console.error("[delivery:canonical_order_item_title_missing]", {
        orderId: order.id,
        orderItemId: item.id,
        productId: item.product_id,
      });
      throw new Error("DELIVERY_PRODUCT_TITLE_MISSING");
    }
  }

  const deliveryItems = await Promise.all(rows.map(rowToAdminItem));
  return {
    orderId: order.id,
    orderCode: order.code,
    orderStatus: order.status,
    lastOtpSentAt: order.lastOtpSentAt || null,
    autoCompleteAt: order.autoCompleteAt || null,
    deliveryIssueOpenedAt: order.deliveryIssueOpenedAt || null,
    orderItems: canonicalItems.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productTitle: item.product_title,
      kind: item.kind,
      quantity: Number(item.quantity || 1),
      selection: readOrderItemSelection(item.metadata_json),
      supplierNameZhCn: supplierNames.get(item.product_id) ?? "",
    })),
    deliveryItems,
    progress: calculateDeliveryProgress(deliveryItems),
  };
}

async function fingerprintSupplierLine(
  orderId: string,
  account: ParsedAccountLine,
): Promise<string> {
  const normalized = `${orderId}\n${account.raw.trim().replace(/\s+/g, " ")}\n${account.username.toLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface QuickPasteResult {
  state: DeliveryOrderState;
  extracted: number;
  mapped: number;
  needsMapping: number;
  skipped: { line: number; raw: string }[];
  duplicates: string[];
}

export async function saveQuickPaste(orderId: string, rawText: string): Promise<QuickPasteResult> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);

  const parsed = parseAccountPaste(rawText);
  if (!parsed.accounts.length) throw new Error("NO_CREDENTIALS_EXTRACTED");

  const canonicalItems = await d1All<CanonicalOrderItemRow>(
    `SELECT id, product_id, product_title, kind, quantity
     FROM order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC`,
    order.id,
  );
  const targets: OrderItemMatchTarget[] = canonicalItems
    .filter((item) => DIGITAL_KINDS.has(item.kind))
    .map((item) => ({
      id: item.id,
      title: item.product_title,
      quantity: Number(item.quantity || 1),
      kind: item.kind,
      selectionLabel: selectionSummary(readOrderItemSelection(item.metadata_json)),
    }));
  const matches = matchAccountsToOrder(parsed.accounts, targets);
  const rows = await deliveryRows(order.id);
  const used = new Set<string>();
  let mapped = 0;
  let needsMapping = 0;
  const now = new Date().toISOString();

  for (const result of matches) {
    const account = result.account;
    const fingerprint = await fingerprintSupplierLine(order.id, account);
    const passwordEnc = await encryptSecretValue(account.password);
    let candidate: DeliveryRow | undefined;

    if (
      result.matchStatus === "matched" &&
      result.matchedItemId &&
      result.confidence >= ACCOUNT_GAME_MATCH_MIN_CONFIDENCE
    ) {
      const candidates = rows.filter(
        (row) =>
          row.order_item_id === result.matchedItemId &&
          !row.archived_at &&
          !used.has(row.id) &&
          (row.status === "draft" || row.status === "ready") &&
          (!row.username || row.username.toLowerCase() === account.username.toLowerCase()),
      );
      candidate =
        candidates.find((row) => row.username?.toLowerCase() === account.username.toLowerCase()) ??
        candidates.find((row) => !row.username);
    }

    if (candidate) {
      const changed = await d1RunChanges(
        `UPDATE order_delivery_items
         SET username = ?, password_enc = ?, detected_game = ?, match_confidence = ?,
             source_fingerprint = ?, status = 'ready', updated_at = ?, revision = revision + 1
         WHERE id = ? AND order_id = ? AND archived_at IS NULL
           AND status IN ('draft','ready')
           AND (username IS NULL OR trim(username) = '' OR lower(username) = lower(?))`,
        account.username,
        passwordEnc,
        account.label || null,
        result.confidence,
        fingerprint,
        now,
        candidate.id,
        order.id,
        account.username,
      );
      if (changed > 0) {
        used.add(candidate.id);
        mapped += 1;
        continue;
      }
    }

    // Never fall through to another game or the first slot. A repeated paste
    // updates its existing unmapped row; a new ambiguous line gets a new row.
    const existing = await d1First<{ id: string }>(
      `SELECT id FROM order_delivery_items
       WHERE order_id = ? AND source_fingerprint = ? AND archived_at IS NULL LIMIT 1`,
      order.id,
      fingerprint,
    );
    if (existing?.id) {
      await d1Run(
        `UPDATE order_delivery_items
         SET username = ?, password_enc = ?, detected_game = ?, match_confidence = ?,
             status = 'needs_mapping', order_item_id = NULL, product_id = NULL,
             slot_number = NULL, updated_at = ?, revision = revision + 1
         WHERE id = ? AND order_id = ? AND status = 'needs_mapping'`,
        account.username,
        passwordEnc,
        account.label || null,
        result.confidence,
        now,
        existing.id,
        order.id,
      );
    } else {
      await d1Run(
        `INSERT INTO order_delivery_items (
          id, order_id, kind, status, username, password_enc, detected_game,
          match_confidence, source_fingerprint, created_at, updated_at
        ) VALUES (?, ?, 'account', 'needs_mapping', ?, ?, ?, ?, ?, ?, ?)`,
        randomId("dlv"),
        order.id,
        account.username,
        passwordEnc,
        account.label || null,
        result.confidence,
        fingerprint,
        now,
        now,
      );
    }
    needsMapping += 1;
  }

  return {
    state: await getDeliveryOrderState(order),
    extracted: parsed.accounts.length,
    mapped,
    needsMapping,
    skipped: parsed.skipped,
    duplicates: parsed.duplicates,
  };
}

export async function saveDeliveryDraft(input: {
  orderId: string;
  deliveryItemId: string;
  username: string;
  password: string;
}): Promise<DeliveryOrderState> {
  const order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const row = await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  if (!["draft", "ready"].includes(row.status)) throw new Error("DELIVERY_DRAFT_NOT_EDITABLE");
  const username = input.username.trim();
  const password = input.password.trim();
  const passwordEnc = password ? await encryptSecretValue(password) : null;
  const status = CODE_KINDS.has(row.kind)
    ? username
      ? "ready"
      : "draft"
    : deliveryDraftStatus(username, password);
  const now = new Date().toISOString();
  const changes = await d1RunChanges(
    `UPDATE order_delivery_items
     SET username = ?, password_enc = ?, status = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND order_id = ? AND order_item_id IS NOT NULL
       AND archived_at IS NULL AND status IN ('draft','ready')`,
    username || null,
    passwordEnc,
    status,
    now,
    input.deliveryItemId,
    order.id,
  );
  if (changes !== 1) throw new Error("DELIVERY_DRAFT_NOT_EDITABLE");
  return getDeliveryOrderState(order);
}

export async function mapUnmatchedDeliveryItem(input: {
  orderId: string;
  sourceDeliveryItemId: string;
  targetDeliveryItemId: string;
}): Promise<DeliveryOrderState> {
  const order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const now = new Date().toISOString();

  const source = await d1First<{
    username: string | null;
    password_enc: string | null;
    detected_game: string | null;
    match_confidence: number | null;
  }>(
    `SELECT username, password_enc, detected_game, match_confidence
     FROM order_delivery_items
     WHERE id = ? AND order_id = ? AND status = 'needs_mapping' AND archived_at IS NULL`,
    input.sourceDeliveryItemId,
    order.id,
  );
  if (!source) throw new Error("UNMAPPED_DELIVERY_ITEM_NOT_FOUND");
  const nextStatus = source.username && source.password_enc ? "ready" : "draft";

  await d1Batch([
    {
      sql: `UPDATE order_delivery_items
            SET username = ?, password_enc = ?, detected_game = ?, match_confidence = ?,
                status = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND order_id = ? AND order_item_id IS NOT NULL
              AND archived_at IS NULL AND status IN ('draft','ready')
              AND (username IS NULL OR trim(username) = '')`,
      params: [
        source.username,
        source.password_enc,
        source.detected_game,
        source.match_confidence,
        nextStatus,
        now,
        input.targetDeliveryItemId,
        order.id,
      ],
    },
    {
      sql: `UPDATE order_delivery_items
            SET archived_at = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND order_id = ? AND status = 'needs_mapping'
              AND archived_at IS NULL
              AND EXISTS (
                SELECT 1 FROM order_delivery_items AS target
                WHERE target.id = ? AND target.order_id = ?
                  AND target.updated_at = ? AND target.username = ?
              )`,
      params: [
        now,
        now,
        input.sourceDeliveryItemId,
        order.id,
        input.targetDeliveryItemId,
        order.id,
        now,
        source.username,
      ],
    },
  ]);

  const target = await d1First<{ updated_at: string }>(
    `SELECT updated_at FROM order_delivery_items WHERE id = ? AND order_id = ?`,
    input.targetDeliveryItemId,
    order.id,
  );
  if (target?.updated_at !== now) throw new Error("TARGET_DELIVERY_SLOT_NOT_AVAILABLE");
  // Idempotent repair for REST/local adapters that do not expose native batch.
  await d1Run(
    `UPDATE order_delivery_items SET archived_at = COALESCE(archived_at, ?), updated_at = ?
     WHERE id = ? AND order_id = ? AND status = 'needs_mapping'`,
    now,
    now,
    input.sourceDeliveryItemId,
    order.id,
  );
  return getDeliveryOrderState(order);
}

async function loadMappedDeliveryRow(
  orderId: string,
  deliveryItemId: string,
): Promise<DeliveryRow> {
  const rows = await d1All<DeliveryRow>(
    `SELECT di.*, oi.product_id AS canonical_product_id, oi.product_title
     FROM order_delivery_items AS di
     JOIN order_items AS oi ON oi.id = di.order_item_id AND oi.order_id = di.order_id
     WHERE di.id = ? AND di.order_id = ? AND di.archived_at IS NULL LIMIT 1`,
    deliveryItemId,
    orderId,
  );
  const row = rows[0];
  if (!row) throw new Error("DELIVERY_ITEM_NOT_FOUND");
  if (!validCanonicalTitle(row.product_title)) {
    console.error("[delivery:send_title_missing]", {
      orderId,
      deliveryItemId,
      orderItemId: row.order_item_id,
      productId: row.product_id,
    });
    throw new Error("DELIVERY_PRODUCT_TITLE_MISSING");
  }
  return row;
}

export interface DeliveryActionResult {
  state: DeliveryOrderState;
  orderFinished: boolean;
  nextReadyDeliveryItemId?: string;
  nextOrder?: {
    orderId: string;
    threadId?: string;
    code?: string;
    userName?: string;
  };
}

export async function sendDeliveryCredentials(input: {
  orderId: string;
  deliveryItemId: string;
  adminId: string;
  adminName: string;
  threadId?: string;
}): Promise<DeliveryActionResult> {
  let order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const row = await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  if (row.status !== "ready" || !row.username || !row.password_enc) {
    throw new Error("DELIVERY_ITEM_NOT_READY");
  }
  const password = await decryptSecretValue(row.password_enc);
  const now = new Date().toISOString();
  const changed = await d1RunChanges(
    `UPDATE order_delivery_items
     SET status = 'sent', sent_at = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND order_id = ? AND status = 'ready' AND archived_at IS NULL`,
    now,
    now,
    row.id,
    order.id,
  );
  if (changed !== 1) throw new Error("DELIVERY_ITEM_NOT_READY");

  try {
    const threadId = input.threadId || order.threadId;
    if (!threadId) throw new Error("ORDER_THREAD_NOT_FOUND");
    await appendMessage(threadId, {
      senderRole: "admin",
      senderName: input.adminName,
      kind: "item_credentials",
      clientMessageId: `delivery-credentials-${row.id}`,
      body: {
        deliveryItemId: row.id,
        itemId: row.order_item_id,
        productId: row.canonical_product_id || row.product_id,
        title: row.product_title,
        email: row.username,
        password,
        slot: row.slot_number,
      },
    });
  } catch (error) {
    await d1Run(
      `UPDATE order_delivery_items
       SET status = 'ready', sent_at = NULL, updated_at = ?, revision = revision + 1
       WHERE id = ? AND order_id = ? AND status = 'sent' AND sent_at = ?`,
      new Date().toISOString(),
      row.id,
      order.id,
      now,
    );
    throw error;
  }

  order = {
    ...order,
    status: order.status === "processing" ? "delivering" : order.status,
    events: [
      ...(order.events || []),
      {
        type: "delivery_credentials_sent",
        at: now,
        payload: { deliveryItemId: row.id },
      },
    ],
  };
  await saveOrder(order);

  const state = await getDeliveryOrderState(order);
  await syncThreadToDeliveryState(order, state, now);
  const nextReady = nextReadyDeliveryItemId(state.deliveryItems, row.id);
  return {
    state,
    orderFinished: false,
    ...(nextReady ? { nextReadyDeliveryItemId: nextReady } : {}),
  };
}

export async function recordDeliveryProof(input: {
  orderId: string;
  deliveryItemId: string;
  imageUrl: string;
  userId: string;
}): Promise<DeliveryOrderState> {
  let order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const row = await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  if (row.status !== "sent" && row.status !== "proof_received") {
    throw new Error("DELIVERY_ITEM_NOT_SENT");
  }
  if (row.status === "proof_received" && row.proof_url === input.imageUrl) {
    return getDeliveryOrderState(order);
  }
  const now = new Date().toISOString();
  const changed = await d1RunChanges(
    `UPDATE order_delivery_items
     SET status = 'proof_received', proof_received_at = ?, proof_url = ?,
         updated_at = ?, revision = revision + 1
     WHERE id = ? AND order_id = ? AND status = 'sent' AND archived_at IS NULL`,
    now,
    input.imageUrl,
    now,
    row.id,
    order.id,
  );
  if (changed !== 1) throw new Error("DELIVERY_ITEM_NOT_SENT");

  try {
    if (!order.threadId) throw new Error("ORDER_THREAD_NOT_FOUND");
    await appendMessage(order.threadId, {
      senderRole: "user",
      kind: "login_proof",
      clientMessageId: `delivery-proof-${row.id}-${now}`,
      body: {
        deliveryItemId: row.id,
        itemId: row.order_item_id,
        productId: row.canonical_product_id || row.product_id,
        title: row.product_title,
        imageUrl: input.imageUrl,
        text: "📸 صورة إثبات تسجيل الدخول",
      },
    });
  } catch (error) {
    await d1Run(
      `UPDATE order_delivery_items
       SET status = 'sent', proof_received_at = NULL, proof_url = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND order_id = ? AND proof_received_at = ?`,
      new Date().toISOString(),
      row.id,
      order.id,
      now,
    );
    throw error;
  }

  /*
    Tell somebody the member has proved the sign-in.

    This is the step the shop is waiting for: the verification code cannot be
    sent until it arrives. The proof was posted to the order thread as a
    message from the *member*, and `appendMessage` pushes to Telegram only for
    admin-authored messages — so the one action that unblocks the order
    notified nobody, and the customer sat looking at a screen that said the
    code was coming.

    After the record is written, and swallowing its own failure: a Telegram
    outage must not undo a proof the member has already sent.
  */
  try {
    const { sendAdminNotification } = await import("./telegram-notifications.server");
    const { escapeHtml } = await import("./telegram.server");
    await sendAdminNotification(
      "order",
      `📸 <b>وصلت صورة إثبات تسجيل الدخول</b>\n\n` +
        `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(String(order.code ?? order.id))}</code>\n` +
        `🎮 <b>المنتج:</b> ${escapeHtml(String(row.product_title ?? ""))}\n` +
        `\n▶️ العميل بانتظار رمز التحقق.`,
    );
  } catch (error) {
    console.warn("[delivery:proof_notify_failed]", { orderId: order.id, error });
  }

  order = {
    ...order,
    updatedAt: now,
    events: [
      ...(order.events || []),
      {
        type: "delivery_proof_received",
        at: now,
        payload: { deliveryItemId: row.id },
      },
    ],
  };
  await saveOrder(order);
  const thread = order.threadId ? await getThread(order.threadId) : undefined;
  if (thread) {
    await saveThread({
      ...thread,
      mode: "WAITING_FOR_ADMIN",
      needsAdmin: true,
      lastMessageAt: now,
      lastUserMessageAt: now,
      lastMessagePreview: `إثبات دخول: ${row.product_title}`,
    });
  }
  return getDeliveryOrderState(order);
}

async function hasOpenDeliveryIssue(orderId: string): Promise<boolean> {
  const issue = await d1First<{ id: string }>(
    `SELECT id FROM order_delivery_issues
     WHERE order_id = ? AND status = 'open' LIMIT 1`,
    orderId,
  );
  return Boolean(issue?.id);
}

async function strictDeliveryIsComplete(orderId: string): Promise<boolean> {
  const rows = await deliveryRows(orderId);
  return allExpectedDeliveryItemsDelivered(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      orderItemId: row.order_item_id,
      archivedAt: row.archived_at,
    })),
  );
}

function deliveryStateNeedsAdmin(state: DeliveryOrderState): boolean {
  return state.deliveryItems.some(
    (item) =>
      !item.archivedAt &&
      (item.status === "needs_mapping" ||
        (Boolean(item.orderItemId) && ["draft", "ready", "proof_received"].includes(item.status))),
  );
}

async function syncThreadToDeliveryState(
  order: Order,
  state: DeliveryOrderState,
  now: string,
): Promise<void> {
  if (!order.threadId) return;
  const thread = await getThread(order.threadId);
  if (!thread) return;
  const needsAdmin = deliveryStateNeedsAdmin(state);
  const hasProof = state.deliveryItems.some(
    (item) => !item.archivedAt && item.status === "proof_received",
  );
  await saveThread({
    ...thread,
    mode: needsAdmin ? (hasProof ? "WAITING_FOR_ADMIN" : "ORDER_PREPARATION") : "WAITING_FOR_USER",
    needsAdmin,
    lastAdminMessageAt: now,
    lastMessageAt: now,
  });
}

export async function getNextActionableQueuedOrder(
  excludeOrderId?: string,
  staffId?: string,
): Promise<{ orderId: string; threadId?: string; code?: string; userName?: string } | undefined> {
  const rows = await d1All<{
    order_id: string;
    assigned_staff_id: string | null;
  }>(
    `SELECT q.order_id, q.assigned_staff_id
     FROM order_queue AS q
     JOIN orders AS o ON o.id = q.order_id
     WHERE q.status IN ('waiting','processing')
       AND json_extract(o.doc, '$.status') NOT IN (
         'awaiting_customer_confirmation','delivery_issue','completed','cancelled'
       )
     ORDER BY q.created_at ASC LIMIT 500`,
  );
  for (const row of rows) {
    if (excludeOrderId && row.order_id === excludeOrderId) continue;
    if (row.assigned_staff_id && staffId && row.assigned_staff_id !== staffId) continue;
    const order = await getOrder(row.order_id);
    if (!order) continue;
    if (
      order.status === "awaiting_customer_confirmation" ||
      order.status === "delivery_issue" ||
      order.status === "completed" ||
      order.status === "cancelled"
    ) {
      continue;
    }
    await ensureOrderDeliveryRecords(order);
    if (await strictDeliveryIsComplete(order.id)) continue;
    return {
      orderId: order.id,
      ...(order.threadId ? { threadId: order.threadId } : {}),
      ...(order.code ? { code: order.code } : {}),
      ...(order.userName ? { userName: order.userName } : {}),
    };
  }
  return undefined;
}

async function moveOrderToAwaitingConfirmation(
  order: Order,
  actorId: string,
  lastOtpSentAt: string,
): Promise<{
  order: Order;
  nextOrder?: Awaited<ReturnType<typeof getNextActionableQueuedOrder>>;
}> {
  if (await hasOpenDeliveryIssue(order.id)) throw new Error("ORDER_HAS_OPEN_DELIVERY_ISSUE");
  if (!(await strictDeliveryIsComplete(order.id))) return { order };
  const finalOtp = await d1First<{ value: string | null }>(
    `SELECT MAX(otp_sent_at) AS value
     FROM order_delivery_items
     WHERE order_id = ? AND archived_at IS NULL AND otp_sent_at IS NOT NULL`,
    order.id,
  );
  const effectiveLastOtpSentAt = finalOtp?.value || lastOtpSentAt;
  const autoCompleteAt = autoCompleteAtFromLastOtp(effectiveLastOtpSentAt);
  const transitionAt = new Date().toISOString();
  const event = JSON.stringify({
    type: "delivery_completed",
    at: effectiveLastOtpSentAt,
    payload: { by: actorId, autoCompleteAt },
  });
  const claimed = await d1RunChanges(
    `UPDATE orders
     SET doc = json_set(
           doc,
           '$.status', 'awaiting_customer_confirmation',
           '$.lastOtpSentAt', ?,
           '$.autoCompleteAt', ?,
           '$.deliveryIssueOpenedAt', NULL,
           '$.updatedAt', ?,
           '$.events', json_insert(
             CASE
               WHEN json_type(doc, '$.events') = 'array' THEN json_extract(doc, '$.events')
               ELSE json('[]')
             END,
             '$[#]', json(?)
           )
         ),
         status = 'awaiting_customer_confirmation',
         last_otp_sent_at = ?, auto_complete_at = ?, delivery_issue_opened_at = NULL,
         updated_at = ?
     WHERE id = ?
       AND json_extract(doc, '$.status') NOT IN (
         'awaiting_customer_confirmation','delivery_issue','completed','cancelled'
       )
       AND delivery_issue_opened_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM order_delivery_issues AS issue
         WHERE issue.order_id = orders.id AND issue.status = 'open'
       )`,
    effectiveLastOtpSentAt,
    autoCompleteAt,
    transitionAt,
    event,
    effectiveLastOtpSentAt,
    autoCompleteAt,
    transitionAt,
    order.id,
  );
  if (claimed !== 1) {
    const latest = await getOrder(order.id);
    if (!latest) throw new Error("ORDER_NOT_FOUND");
    if (latest.status === "delivery_issue") throw new Error("ORDER_HAS_OPEN_DELIVERY_ISSUE");
    return {
      order: latest,
      ...(latest.status === "awaiting_customer_confirmation"
        ? { nextOrder: await getNextActionableQueuedOrder(order.id, actorId) }
        : {}),
    };
  }
  await d1Run(
    `UPDATE order_queue SET status = 'completed', updated_at = ? WHERE order_id = ?`,
    transitionAt,
    order.id,
  );
  try {
    await d1Run(
      `INSERT INTO order_status_history
        (id, order_id, old_status, new_status, changed_by, note, created_at)
       VALUES (?, ?, ?, 'awaiting_customer_confirmation', ?, ?, ?)`,
      randomId("osh"),
      order.id,
      order.status,
      actorId,
      "اكتمل إرسال OTP لجميع عناصر التسليم؛ بانتظار تأكيد العميل لمدة 60 دقيقة",
      transitionAt,
    );
  } catch (error) {
    console.error("[delivery:awaiting_history_failed]", {
      orderId: order.id,
      error,
    });
  }
  const thread = order.threadId ? await getThread(order.threadId) : undefined;
  if (thread) {
    try {
      await saveThread({
        ...thread,
        mode: "WAITING_FOR_USER",
        needsAdmin: false,
        queueStatus: "completed",
        lastMessageAt: transitionAt,
      });
    } catch (error) {
      console.error("[delivery:awaiting_thread_update_failed]", {
        orderId: order.id,
        error,
      });
    }
  }
  const next = (await getOrder(order.id)) || {
    ...order,
    status: "awaiting_customer_confirmation" as const,
    lastOtpSentAt: effectiveLastOtpSentAt,
    autoCompleteAt,
    updatedAt: transitionAt,
  };
  return {
    order: next,
    nextOrder: await getNextActionableQueuedOrder(order.id, actorId),
  };
}

export async function sendDeliveryOtp(input: {
  orderId: string;
  deliveryItemId: string;
  code: string;
  adminId: string;
  adminName: string;
  threadId?: string;
}): Promise<DeliveryActionResult> {
  let order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const row = await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  const code = input.code.trim();
  if (!code) throw new Error("OTP_REQUIRED");
  if (row.status !== "proof_received") throw new Error("DELIVERY_PROOF_REQUIRED");
  const now = new Date().toISOString();
  const changed = await d1RunChanges(
    `UPDATE order_delivery_items
     SET status = 'otp_sent', otp_sent_at = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND order_id = ? AND status = 'proof_received' AND archived_at IS NULL`,
    now,
    now,
    row.id,
    order.id,
  );
  if (changed !== 1) throw new Error("DELIVERY_PROOF_REQUIRED");

  try {
    const threadId = input.threadId || order.threadId;
    if (!threadId) throw new Error("ORDER_THREAD_NOT_FOUND");
    await appendMessage(threadId, {
      senderRole: "admin",
      senderName: input.adminName,
      kind: "item_verification_code",
      clientMessageId: `delivery-otp-${row.id}`,
      body: {
        deliveryItemId: row.id,
        itemId: row.order_item_id,
        productId: row.canonical_product_id || row.product_id,
        title: row.product_title,
        code,
        verificationCode: code,
        expiresInMinutes: DELIVERY_OTP_TTL_MINUTES,
        expiresAt: deliveryOtpExpiry(now),
        sentAt: now,
      },
    });
  } catch (error) {
    await d1Run(
      `UPDATE order_delivery_items
       SET status = 'proof_received', otp_sent_at = NULL, updated_at = ?, revision = revision + 1
       WHERE id = ? AND order_id = ? AND status = 'otp_sent' AND otp_sent_at = ?`,
      new Date().toISOString(),
      row.id,
      order.id,
      now,
    );
    throw error;
  }

  order = {
    ...order,
    updatedAt: now,
    events: [
      ...(order.events || []),
      {
        type: "delivery_otp_sent",
        at: now,
        payload: { deliveryItemId: row.id },
      },
    ],
  };
  await saveOrder(order);

  let orderFinished = false;
  let nextOrder: Awaited<ReturnType<typeof getNextActionableQueuedOrder>>;
  const allDelivered = await strictDeliveryIsComplete(order.id);
  if (allDelivered) {
    const completion = await moveOrderToAwaitingConfirmation(order, input.adminId, now);
    order = completion.order;
    nextOrder = completion.nextOrder;
    orderFinished = order.status === "awaiting_customer_confirmation";
  }
  const state = await getDeliveryOrderState(order);
  if (!orderFinished) await syncThreadToDeliveryState(order, state, now);
  const nextReady = nextReadyDeliveryItemId(state.deliveryItems, row.id);
  return {
    state,
    orderFinished,
    ...(nextReady ? { nextReadyDeliveryItemId: nextReady } : {}),
    ...(nextOrder ? { nextOrder } : {}),
  };
}

export async function sendDigitalDeliveryCode(input: {
  orderId: string;
  deliveryItemId: string;
  code: string;
  pin?: string;
  adminId: string;
  adminName: string;
  threadId?: string;
}): Promise<DeliveryActionResult> {
  let order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  const row = await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  if (!CODE_KINDS.has(row.kind)) throw new Error("DELIVERY_ITEM_NOT_CODE");
  if (row.status !== "ready" || !row.username) throw new Error("DELIVERY_ITEM_NOT_READY");
  const code = row.username.trim();
  const storedPin = row.password_enc ? await decryptSecretValue(row.password_enc) : "";
  if (input.code.trim() !== code || String(input.pin ?? "").trim() !== storedPin) {
    throw new Error("DELIVERY_DRAFT_OUT_OF_SYNC");
  }
  const now = new Date().toISOString();
  const changed = await d1RunChanges(
    `UPDATE order_delivery_items
     SET status = 'otp_sent', sent_at = ?, otp_sent_at = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND order_id = ? AND status = 'ready' AND archived_at IS NULL`,
    now,
    now,
    now,
    row.id,
    order.id,
  );
  if (changed !== 1) throw new Error("DELIVERY_ITEM_NOT_EDITABLE");
  try {
    const threadId = input.threadId || order.threadId;
    if (!threadId) throw new Error("ORDER_THREAD_NOT_FOUND");
    await appendMessage(threadId, {
      senderRole: "admin",
      senderName: input.adminName,
      kind: "item_credentials",
      clientMessageId: `delivery-code-${row.id}`,
      body: {
        deliveryItemId: row.id,
        itemId: row.order_item_id,
        productId: row.canonical_product_id || row.product_id,
        title: row.product_title,
        cardType: row.product_title,
        code,
        ...(storedPin ? { pin: storedPin } : {}),
      },
    });
  } catch (error) {
    await d1Run(
      `UPDATE order_delivery_items
       SET status = 'ready', sent_at = NULL, otp_sent_at = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND order_id = ? AND otp_sent_at = ?`,
      new Date().toISOString(),
      row.id,
      order.id,
      now,
    );
    throw error;
  }

  order = {
    ...order,
    updatedAt: now,
    events: [
      ...(order.events || []),
      {
        type: "delivery_code_sent",
        at: now,
        payload: { deliveryItemId: row.id },
      },
    ],
  };
  await saveOrder(order);
  let orderFinished = false;
  let nextOrder: Awaited<ReturnType<typeof getNextActionableQueuedOrder>>;
  if (await strictDeliveryIsComplete(order.id)) {
    const completion = await moveOrderToAwaitingConfirmation(order, input.adminId, now);
    order = completion.order;
    nextOrder = completion.nextOrder;
    orderFinished = order.status === "awaiting_customer_confirmation";
  }
  const state = await getDeliveryOrderState(order);
  if (!orderFinished) await syncThreadToDeliveryState(order, state, now);
  const nextReady = nextReadyDeliveryItemId(state.deliveryItems, row.id);
  return {
    state,
    orderFinished,
    ...(nextReady ? { nextReadyDeliveryItemId: nextReady } : {}),
    ...(nextOrder ? { nextOrder } : {}),
  };
}

async function appendRatingRequest(order: Order, now: string): Promise<void> {
  if (!order.threadId || order.ratingCardSentAt) return;
  await appendMessage(order.threadId, {
    senderRole: "assistant",
    senderName: "الدعم الآلي",
    kind: "review_request",
    clientMessageId: `delivery-review-${order.id}`,
    body: {
      orderId: order.id,
      orderCode: order.code,
      items: order.items.map((item) => ({
        id: item.id,
        title: item.title,
        image: item.image,
        productId: item.productId,
      })),
      text: "نسعد جداً بتقييمك لتجربة الشراء وجودة الخدمة ⭐",
    },
  });
}

async function completeDeliveredOrder(
  order: Order,
  mode: "customer" | "auto",
  actorId: string,
  now = new Date().toISOString(),
): Promise<Order> {
  if (order.status === "completed") return order;
  if (await hasOpenDeliveryIssue(order.id)) throw new Error("ORDER_HAS_OPEN_DELIVERY_ISSUE");
  if (!(await strictDeliveryIsComplete(order.id))) throw new Error("ITEMS_NOT_FULLY_DELIVERED");
  if (order.threadId) {
    await appendMessage(order.threadId, {
      senderRole: mode === "customer" ? "user" : "system",
      kind: "order_completed",
      clientMessageId: `delivery-completed-${mode}-${order.id}`,
      body: {
        code: order.code,
        confirmedByCustomer: mode === "customer",
        autoCompleted: mode === "auto",
        text:
          mode === "customer"
            ? "✅ تم استلام الطلب وتأكيده بنجاح من قبل العميل."
            : "✅ تم إكمال الطلب تلقائياً بعد انتهاء مهلة التأكيد البالغة 60 دقيقة.",
      },
    });
  }
  await appendRatingRequest(order, now);
  await d1Run(
    `UPDATE order_delivery_items
     SET status = 'completed', completed_at = COALESCE(completed_at, ?),
         updated_at = ?, revision = revision + 1
     WHERE order_id = ? AND archived_at IS NULL AND status = 'otp_sent'`,
    now,
    now,
    order.id,
  );
  await d1Run(
    `UPDATE order_queue SET status = 'completed', updated_at = ? WHERE order_id = ?`,
    now,
    order.id,
  );
  const next: Order = {
    ...order,
    status: "completed",
    completedAt: now,
    autoCompleteAt: undefined,
    customerConfirmedAt: mode === "customer" ? now : order.customerConfirmedAt,
    autoCompletedAt: mode === "auto" ? now : order.autoCompletedAt,
    ratingCardSentAt: order.ratingCardSentAt || now,
    items: order.items.map((item) => ({
      ...item,
      completedAt: item.completedAt || now,
      deliveredAt: item.deliveredAt || now,
    })),
    updatedAt: now,
    events: [
      ...(order.events || []),
      {
        type: mode === "customer" ? "customer_confirmed" : "order_auto_completed",
        at: now,
        payload: {
          by: actorId,
          reason: mode === "auto" ? "60_minute_timeout" : undefined,
        },
      },
    ],
  };
  await saveOrder(next);
  try {
    await d1Run(
      `UPDATE orders
       SET customer_confirmed_at = ?, auto_completed_at = ?, auto_complete_at = NULL,
           updated_at = ? WHERE id = ?`,
      next.customerConfirmedAt || null,
      next.autoCompletedAt || null,
      now,
      order.id,
    );
  } catch (error) {
    console.warn("[delivery:normalized_completion_timestamps_failed]", error);
  }
  try {
    await d1Run(
      `INSERT INTO order_status_history
        (id, order_id, old_status, new_status, changed_by, note, created_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      randomId("osh"),
      order.id,
      order.status,
      actorId,
      mode === "customer" ? "تم تأكيد الاستلام من العميل" : "إكمال تلقائي بعد 60 دقيقة من آخر OTP",
      now,
    );
  } catch (error) {
    console.error("[delivery:completion_history_failed]", {
      orderId: order.id,
      error,
    });
  }

  /*
    The one message a finished digital order ever sends the customer.

    This whole module — the path every account and code purchase takes — had
    no notification of any kind. Both ways in end here: the customer pressing
    confirm, and the timer completing it for them an hour later. Either way
    they were told nothing, and the rating card posted just above went into a
    conversation they had already closed.

    Best-effort and last, so a Telegram outage cannot undo a completion that
    has already been written.
  */
  try {
    const { sendReviewInvitation } = await import("./review-reward.server");
    await sendReviewInvitation(next, { now });
  } catch (error) {
    console.warn("[delivery:review_invite_failed]", { orderId: order.id, error });
  }

  return next;
}

export async function confirmDeliveredOrder(orderId: string, userId: string): Promise<Order> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  if (order.status !== "awaiting_customer_confirmation") {
    if (order.status === "completed") return order;
    throw new Error("ORDER_NOT_AWAITING_CONFIRMATION");
  }
  const claimAt = new Date().toISOString();
  const claimed = await d1RunChanges(
    `UPDATE orders
     SET auto_complete_at = NULL, customer_confirmed_at = ?, updated_at = ?
     WHERE id = ? AND auto_complete_at IS NOT NULL
       AND delivery_issue_opened_at IS NULL
       AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'`,
    claimAt,
    claimAt,
    order.id,
  );
  if (claimed !== 1) {
    const latest = await getOrder(order.id);
    if (latest?.status === "completed") return latest;
    throw new Error("ORDER_CONFIRMATION_ALREADY_CLAIMED_OR_PAUSED");
  }
  try {
    return await completeDeliveredOrder(order, "customer", userId, claimAt);
  } catch (error) {
    await d1Run(
      `UPDATE orders
       SET auto_complete_at = ?, customer_confirmed_at = NULL, updated_at = ?
       WHERE id = ? AND auto_complete_at IS NULL AND delivery_issue_opened_at IS NULL
         AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'`,
      order.autoCompleteAt || null,
      new Date().toISOString(),
      order.id,
    );
    throw error;
  }
}

export async function openDeliveryIssue(input: {
  orderId: string;
  userId: string;
  deliveryItemId?: string;
  reason?: string;
}): Promise<Order> {
  const order = await getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  await ensureOrderDeliveryRecords(order);
  if (order.status !== "awaiting_customer_confirmation") {
    throw new Error("ORDER_NOT_AWAITING_CONFIRMATION");
  }
  if (input.deliveryItemId) await loadMappedDeliveryRow(order.id, input.deliveryItemId);
  const now = new Date().toISOString();
  const claimed = await d1RunChanges(
    `UPDATE orders
     SET auto_complete_at = NULL, delivery_issue_opened_at = ?, updated_at = ?
     WHERE id = ? AND auto_complete_at IS NOT NULL
       AND delivery_issue_opened_at IS NULL
       AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'`,
    now,
    now,
    order.id,
  );
  if (claimed !== 1) throw new Error("ORDER_CONFIRMATION_ALREADY_CLAIMED_OR_COMPLETED");
  try {
    await d1Run(
      `INSERT INTO order_delivery_issues
        (id, order_id, delivery_item_id, opened_by_user_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      randomId("dli"),
      order.id,
      input.deliveryItemId || null,
      input.userId,
      input.reason?.trim() || null,
      now,
    );
  } catch (error) {
    await d1Run(
      `UPDATE orders
       SET auto_complete_at = ?, delivery_issue_opened_at = NULL, updated_at = ?
       WHERE id = ? AND delivery_issue_opened_at = ?`,
      order.autoCompleteAt || null,
      new Date().toISOString(),
      order.id,
      now,
    );
    throw error;
  }
  const issueEvent = JSON.stringify({
    type: "delivery_issue_opened",
    at: now,
    payload: { by: input.userId },
  });
  await d1Run(
    `UPDATE orders
     SET doc = json_set(
           doc,
           '$.status', 'delivery_issue',
           '$.autoCompleteAt', NULL,
           '$.deliveryIssueOpenedAt', ?,
           '$.updatedAt', ?,
           '$.events', json_insert(
             CASE
               WHEN json_type(doc, '$.events') = 'array' THEN json_extract(doc, '$.events')
               ELSE json('[]')
             END,
             '$[#]', json(?)
           )
         ),
         status = 'delivery_issue', auto_complete_at = NULL,
         delivery_issue_opened_at = ?, updated_at = ?
     WHERE id = ? AND delivery_issue_opened_at = ?`,
    now,
    now,
    issueEvent,
    now,
    now,
    order.id,
    now,
  );
  const next = (await getOrder(order.id)) || {
    ...order,
    status: "delivery_issue" as const,
    autoCompleteAt: undefined,
    deliveryIssueOpenedAt: now,
    updatedAt: now,
  };
  if (order.threadId) {
    try {
      await appendMessage(order.threadId, {
        senderRole: "user",
        kind: "system",
        clientMessageId: `delivery-issue-${order.id}-${now}`,
        body: {
          type: "delivery_issue",
          text: input.reason?.trim()
            ? `⚠️ فتح العميل بلاغ تسليم: ${input.reason.trim()}`
            : "⚠️ فتح العميل بلاغاً بخصوص التسليم. تم إيقاف الإكمال التلقائي.",
        },
      });
      const thread = await getThread(order.threadId);
      if (thread) {
        await saveThread({
          ...thread,
          mode: "ESCALATED",
          needsAdmin: true,
          escalatedAt: now,
          queueStatus: "completed",
          lastMessageAt: now,
        });
      }
    } catch (error) {
      console.error("[delivery:issue_thread_update_failed]", {
        orderId: order.id,
        error,
      });
    }
  }

  /*
    Tell the admins a customer has raised a problem.

    This function stops the auto-complete clock, marks the thread escalated and
    sets `needsAdmin` — and told nobody. Until now that was academic, because
    the route reaching it was unreachable: an unconditional `completeOrder`
    above it meant "the code does not work" completed the order instead. With
    that door closed, the report actually happens, and an order sitting in
    `delivery_issue` with the timer stopped is precisely the state that needs a
    person and will otherwise sit there indefinitely.

    Best-effort and last: the issue is already recorded, and a Telegram outage
    must not undo a customer's report.
  */
  try {
    const { sendAdminNotification } = await import("./telegram-notifications.server");
    const { escapeHtml } = await import("./telegram.server");
    const { redactSecrets } = await import("./telegram-admin-routing.server");
    const reason = input.reason?.trim();
    await sendAdminNotification(
      "order",
      `⚠️ <b>بلاغ مشكلة في التسليم</b>\n\n` +
        `🔖 <b>رقم الطلب:</b> <code>${escapeHtml(String(next.code ?? order.code ?? ""))}</code>\n` +
        (reason ? `📝 <b>السبب:</b> <i>${escapeHtml(redactSecrets(reason))}</i>\n` : "") +
        `\n⏸️ تم إيقاف الإكمال التلقائي — الطلب بانتظار تدخل الإدارة.`,
    );
  } catch (error) {
    console.warn("[delivery:issue_notify_failed]", { orderId: order.id, error });
  }

  return next;
}

export async function maybeAutoCompleteDeliveredOrder(
  orderId: string,
  now = new Date().toISOString(),
): Promise<Order | undefined> {
  const order = await getOrder(orderId);
  if (!order) return undefined;
  await ensureOrderDeliveryRecords(order);
  if (order.status !== "awaiting_customer_confirmation" || !order.autoCompleteAt) return order;
  if (Date.parse(order.autoCompleteAt) > Date.parse(now)) return order;
  if (order.deliveryIssueOpenedAt || (await hasOpenDeliveryIssue(order.id))) return order;
  const claimed = await d1RunChanges(
    `UPDATE orders
     SET auto_complete_at = NULL, updated_at = ?
     WHERE id = ? AND auto_complete_at IS NOT NULL AND auto_complete_at <= ?
       AND delivery_issue_opened_at IS NULL
       AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'`,
    now,
    order.id,
    now,
  );
  if (claimed !== 1) return (await getOrder(order.id)) || order;
  try {
    return await completeDeliveredOrder(order, "auto", "system:auto_complete", now);
  } catch (error) {
    await d1Run(
      `UPDATE orders SET auto_complete_at = ?, updated_at = ?
       WHERE id = ? AND auto_complete_at IS NULL AND delivery_issue_opened_at IS NULL
         AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'`,
      order.autoCompleteAt,
      new Date().toISOString(),
      order.id,
    );
    throw error;
  }
}

export async function processDueDeliveryAutoCompletions(
  now = new Date().toISOString(),
  limit = 100,
): Promise<{ completed: number; reconciled: number; errors: number }> {
  await ensureDigitalDeliverySchema();
  let completed = 0;
  let reconciled = 0;
  let errors = 0;
  // Repair queue visibility independently of the completion deadline. This
  // also covers a Worker retry after the atomic order transition succeeded but
  // the follow-up queue write was interrupted.
  await d1Run(
    `UPDATE order_queue
     SET status = 'completed', updated_at = ?
     WHERE status != 'completed'
       AND order_id IN (
         SELECT id FROM orders
         WHERE json_extract(doc, '$.status') IN (
           'awaiting_customer_confirmation','delivery_issue','completed','cancelled'
         )
       )`,
    now,
  );
  const due = await d1All<{ id: string }>(
    `SELECT id FROM orders
     WHERE auto_complete_at IS NOT NULL
       AND auto_complete_at <= ?
       AND delivery_issue_opened_at IS NULL
       AND json_extract(doc, '$.status') = 'awaiting_customer_confirmation'
     ORDER BY auto_complete_at ASC LIMIT ?`,
    now,
    limit,
  );
  for (const row of due) {
    try {
      const before = await getOrder(row.id);
      const after = await maybeAutoCompleteDeliveredOrder(row.id, now);
      if (before?.status !== "completed" && after?.status === "completed") completed += 1;
    } catch (error) {
      errors += 1;
      console.error("[delivery:auto_complete_failed]", {
        orderId: row.id,
        error,
      });
    }
  }

  // Repair legacy orders that already have a final OTP but never received the
  // explicit awaiting/timer transition. Strict per-slot completion is required.
  const stuck = await d1All<{ id: string }>(
    `SELECT id FROM orders
     WHERE json_extract(doc, '$.status') IN ('waiting_for_user','delivering','processing')
     ORDER BY updated_at ASC LIMIT ?`,
    limit,
  );
  for (const row of stuck) {
    try {
      let order = await getOrder(row.id);
      if (!order) continue;
      await ensureOrderDeliveryRecords(order);
      if (await hasOpenDeliveryIssue(order.id)) continue;
      if (!(await strictDeliveryIsComplete(order.id))) continue;
      const last = await d1First<{ last_otp_sent_at: string | null }>(
        `SELECT MAX(otp_sent_at) AS last_otp_sent_at FROM order_delivery_items
         WHERE order_id = ? AND archived_at IS NULL`,
        order.id,
      );
      if (!last?.last_otp_sent_at) continue;
      const transition = await moveOrderToAwaitingConfirmation(
        order,
        "system:legacy_reconcile",
        last.last_otp_sent_at,
      );
      order = transition.order;
      reconciled += 1;
      if (order.autoCompleteAt && Date.parse(order.autoCompleteAt) <= Date.parse(now)) {
        const after = await maybeAutoCompleteDeliveredOrder(order.id, now);
        if (after?.status === "completed") completed += 1;
      }
    } catch (error) {
      errors += 1;
      console.error("[delivery:legacy_reconcile_failed]", {
        orderId: row.id,
        error,
      });
    }
  }
  return { completed, reconciled, errors };
}
