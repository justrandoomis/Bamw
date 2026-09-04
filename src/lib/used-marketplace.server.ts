/**
 * Used & returned marketplace — storage, money, and the one gate every status
 * change goes through.
 *
 * Two rules shape this file:
 *
 *  1. `transitionListing` is the only way a listing's status ever changes.
 *     Fee charging, expiry stamping and the audit trail hang off that single
 *     function, so there is no second path that can move a listing without
 *     also doing the bookkeeping.
 *  2. The listing fee is taken in one atomic D1 batch whose guard is a NOT NULL
 *     violation, not a row count — a batch that matched no rows still commits,
 *     so a `WHERE balance >= ?` guard would have written the ledger row without
 *     taking the money. Setting `wallet_balance` to NULL aborts the batch
 *     instead, which is the same shape the banana market already relies on.
 */

import { d1All, d1BatchRun, d1First, d1Run, d1RunChanges, getD1 } from "./d1.server";
import { createAuditLog, createNotification, getStore, randomId, updateStore } from "./db.server";
import { isOwnUploadUrl } from "./uploads";
import {
  ACTIVE_STATUSES,
  DEFAULT_USED_CONFIG,
  canTransition,
  expiryFrom,
  feeIsDue,
  readUsedConfig,
  validateForSubmission,
  type Actor,
  type UsedListingStatus,
  type UsedMarketplaceConfig,
  type ValidationIssue,
} from "./used-marketplace";

export class UsedMarketError extends Error {
  readonly issues: ValidationIssue[];
  constructor(code: string, issues: ValidationIssue[] = []) {
    super(code);
    this.name = "UsedMarketError";
    this.issues = issues;
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS used_listings (
    id TEXT PRIMARY KEY,
    seller_user_id TEXT NOT NULL,
    canonical_product_id TEXT,
    title TEXT NOT NULL,
    title_en TEXT,
    used_type TEXT,
    platform TEXT,
    condition_grade TEXT,
    packaging TEXT,
    guarantee TEXT,
    is_returned INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    condition_notes TEXT,
    defects_json TEXT NOT NULL DEFAULT '[]',
    price_iqd REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    media_json TEXT NOT NULL DEFAULT '[]',
    contact_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
      status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_CHANGES','APPROVED','REJECTED','EXPIRED','SOLD','PAUSED')
    ),
    review_notes TEXT,
    reviewed_by_user_id TEXT,
    reviewed_at TEXT,
    policy_version TEXT,
    policy_accepted_at TEXT,
    fee_cycle INTEGER NOT NULL DEFAULT 0,
    fee_paid_cycle INTEGER,
    fee_amount REAL,
    fee_paid_at TEXT,
    published_at TEXT,
    expires_at TEXT,
    sold_at TEXT,
    sold_order_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS used_listings_seller_idx ON used_listings (seller_user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS used_listings_status_idx ON used_listings (status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS used_listings_public_idx ON used_listings (status, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS used_listings_expiry_idx ON used_listings (status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS used_listings_canonical_idx ON used_listings (canonical_product_id, status)`,
  `CREATE TABLE IF NOT EXISTS used_listing_events (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_user_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS used_listing_events_listing_idx ON used_listing_events (listing_id, created_at)`,
] as const;

let schemaPromise: Promise<void> | undefined;

function requireD1() {
  if (!getD1()) throw new UsedMarketError("D1_REQUIRED_FOR_USED_MARKETPLACE");
}

export async function ensureUsedMarketplaceSchema(): Promise<void> {
  requireD1();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const sql of SCHEMA_STATEMENTS) await d1Run(sql);
    })().catch((error) => {
      // A failed bootstrap must not be cached as done, or every later request
      // in this isolate would query tables that were never created.
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

/* ------------------------------- config ---------------------------------- */

export async function getUsedConfig(): Promise<UsedMarketplaceConfig> {
  const store = await getStore();
  const settings = (store.settings ?? {}) as Record<string, unknown>;
  return readUsedConfig(settings["usedMarketplace"]);
}

export async function saveUsedConfig(
  patch: Partial<UsedMarketplaceConfig>,
): Promise<UsedMarketplaceConfig> {
  const current = await getUsedConfig();
  const next = readUsedConfig({ ...current, ...patch });
  await updateStore((store: any) => ({
    ...store,
    settings: { ...(store.settings ?? {}), usedMarketplace: next },
  }));
  return next;
}

/* -------------------------------- rows ----------------------------------- */

export interface UsedListing {
  id: string;
  sellerUserId: string;
  canonicalProductId: string | null;
  title: string;
  titleEn: string | null;
  usedType: string | null;
  platform: string | null;
  conditionGrade: string | null;
  packaging: string | null;
  guarantee: string | null;
  isReturned: boolean;
  description: string | null;
  conditionNotes: string | null;
  defects: string[];
  priceIqd: number;
  quantity: number;
  photos: string[];
  contact: Record<string, string>;
  status: UsedListingStatus;
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  policyVersion: string | null;
  policyAcceptedAt: string | null;
  feeCycle: number;
  feePaidCycle: number | null;
  feeAmount: number | null;
  feePaidAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  soldAt: string | null;
  soldOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    // A row whose JSON column got corrupted must not take the whole page down;
    // the listing still renders with that field empty.
    return fallback;
  }
}

function mapListing(row: Record<string, any>): UsedListing {
  return {
    id: String(row.id),
    sellerUserId: String(row.seller_user_id),
    canonicalProductId: row.canonical_product_id ? String(row.canonical_product_id) : null,
    title: String(row.title ?? ""),
    titleEn: row.title_en ? String(row.title_en) : null,
    usedType: row.used_type ? String(row.used_type) : null,
    platform: row.platform ? String(row.platform) : null,
    conditionGrade: row.condition_grade ? String(row.condition_grade) : null,
    packaging: row.packaging ? String(row.packaging) : null,
    guarantee: row.guarantee ? String(row.guarantee) : null,
    isReturned: Number(row.is_returned ?? 0) === 1,
    description: row.description ? String(row.description) : null,
    conditionNotes: row.condition_notes ? String(row.condition_notes) : null,
    defects: parseJson<string[]>(row.defects_json, []),
    priceIqd: Number(row.price_iqd ?? 0),
    quantity: Number(row.quantity ?? 1),
    photos: parseJson<string[]>(row.media_json, []),
    contact: parseJson<Record<string, string>>(row.contact_json, {}),
    status: String(row.status ?? "DRAFT") as UsedListingStatus,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    policyVersion: row.policy_version ? String(row.policy_version) : null,
    policyAcceptedAt: row.policy_accepted_at ? String(row.policy_accepted_at) : null,
    feeCycle: Number(row.fee_cycle ?? 0),
    feePaidCycle: row.fee_paid_cycle == null ? null : Number(row.fee_paid_cycle),
    feeAmount: row.fee_amount == null ? null : Number(row.fee_amount),
    feePaidAt: row.fee_paid_at ? String(row.fee_paid_at) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    soldAt: row.sold_at ? String(row.sold_at) : null,
    soldOrderId: row.sold_order_id ? String(row.sold_order_id) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function getListing(id: string): Promise<UsedListing | undefined> {
  await ensureUsedMarketplaceSchema();
  const row = await d1First<Record<string, any>>(`SELECT * FROM used_listings WHERE id = ?`, id);
  return row && row.id ? mapListing(row) : undefined;
}

export async function listSellerListings(sellerUserId: string): Promise<UsedListing[]> {
  await ensureUsedMarketplaceSchema();
  const rows = await d1All<Record<string, any>>(
    `SELECT * FROM used_listings WHERE seller_user_id = ? ORDER BY updated_at DESC LIMIT 200`,
    sellerUserId,
  );
  return rows.map(mapListing);
}

/** The admin queue: everything waiting on a decision, oldest submission first. */
export async function listReviewQueue(status?: UsedListingStatus): Promise<UsedListing[]> {
  await ensureUsedMarketplaceSchema();
  const rows = status
    ? await d1All<Record<string, any>>(
        `SELECT * FROM used_listings WHERE status = ? ORDER BY updated_at ASC LIMIT 200`,
        status,
      )
    : await d1All<Record<string, any>>(
        `SELECT * FROM used_listings
          WHERE status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_CHANGES')
          ORDER BY updated_at ASC LIMIT 200`,
      );
  return rows.map(mapListing);
}

/**
 * The storefront list.
 *
 * Expiry is enforced in the query as well as by the sweeper, so a listing whose
 * window ran out is invisible the moment it runs out — a customer never sees an
 * item that is only still APPROVED because the sweeper has not run yet.
 */
export async function listPublicListings(
  options: {
    canonicalProductId?: string;
    limit?: number;
  } = {},
): Promise<UsedListing[]> {
  await ensureUsedMarketplaceSchema();
  const limit = Math.min(Math.max(Number(options.limit ?? 60), 1), 200);
  const now = new Date().toISOString();
  const rows = options.canonicalProductId
    ? await d1All<Record<string, any>>(
        `SELECT * FROM used_listings
          WHERE status = 'APPROVED' AND canonical_product_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY published_at DESC LIMIT ?`,
        options.canonicalProductId,
        now,
        limit,
      )
    : await d1All<Record<string, any>>(
        `SELECT * FROM used_listings
          WHERE status = 'APPROVED' AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY published_at DESC LIMIT ?`,
        now,
        limit,
      );
  return rows.map(mapListing);
}

export async function listListingEvents(listingId: string) {
  await ensureUsedMarketplaceSchema();
  return d1All<Record<string, any>>(
    `SELECT * FROM used_listing_events WHERE listing_id = ? ORDER BY created_at ASC LIMIT 200`,
    listingId,
  );
}

/* ------------------------------- drafting -------------------------------- */

export interface DraftFields {
  canonicalProductId?: string | null;
  title?: string;
  titleEn?: string | null;
  usedType?: string | null;
  platform?: string | null;
  conditionGrade?: string | null;
  packaging?: string | null;
  guarantee?: string | null;
  description?: string | null;
  conditionNotes?: string | null;
  defects?: string[];
  priceIqd?: number;
  quantity?: number;
  photos?: string[];
  contact?: Record<string, string>;
}

/**
 * Keeps only the photos this seller actually uploaded.
 *
 * Without this a listing body could point at any URL on the internet — or at
 * another member's private upload — and the storefront would render it.
 */
function ownPhotos(photos: unknown, sellerUserId: string, max: number): string[] {
  if (!Array.isArray(photos)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of photos) {
    const url = String(entry ?? "").trim();
    if (!url || seen.has(url)) continue;
    if (!isOwnUploadUrl(url, sellerUserId)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export async function createDraft(sellerUserId: string, fields: DraftFields): Promise<UsedListing> {
  await ensureUsedMarketplaceSchema();
  const config = await getUsedConfig();
  if (!config.enabled) throw new UsedMarketError("USED_MARKETPLACE_DISABLED");

  // A draft costs nothing, so it does not count against the cap; what the cap
  // protects is review attention and storefront slots.
  const now = new Date().toISOString();
  const id = randomId("uls");
  await d1Run(
    `INSERT INTO used_listings (
       id, seller_user_id, canonical_product_id, title, title_en, used_type, platform,
       condition_grade, packaging, guarantee, description, condition_notes, defects_json,
       price_iqd, quantity, media_json, contact_json, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
    id,
    sellerUserId,
    clean(fields.canonicalProductId),
    String(fields.title ?? "").trim(),
    clean(fields.titleEn),
    clean(fields.usedType),
    clean(fields.platform),
    clean(fields.conditionGrade),
    clean(fields.packaging),
    clean(fields.guarantee),
    clean(fields.description),
    clean(fields.conditionNotes),
    JSON.stringify((fields.defects ?? []).map((d) => String(d)).filter(Boolean)),
    Number(fields.priceIqd ?? 0),
    Number(fields.quantity ?? 1),
    JSON.stringify(ownPhotos(fields.photos, sellerUserId, config.maxPhotos)),
    JSON.stringify(fields.contact ?? {}),
    now,
    now,
  );
  const created = await getListing(id);
  if (!created) throw new UsedMarketError("DRAFT_NOT_STORED");
  return created;
}

/** Statuses whose body a seller is still allowed to edit. */
const EDITABLE: readonly UsedListingStatus[] = ["DRAFT", "NEEDS_CHANGES"];

export async function updateDraft(
  sellerUserId: string,
  listingId: string,
  fields: DraftFields,
): Promise<UsedListing> {
  await ensureUsedMarketplaceSchema();
  const config = await getUsedConfig();
  const listing = await getListing(listingId);
  if (!listing) throw new UsedMarketError("LISTING_NOT_FOUND");
  if (listing.sellerUserId !== sellerUserId) throw new UsedMarketError("NOT_YOUR_LISTING");
  if (!EDITABLE.includes(listing.status)) throw new UsedMarketError("LISTING_NOT_EDITABLE");

  const now = new Date().toISOString();
  const photos =
    fields.photos === undefined
      ? listing.photos
      : ownPhotos(fields.photos, sellerUserId, config.maxPhotos);

  await d1Run(
    `UPDATE used_listings SET
       canonical_product_id = ?, title = ?, title_en = ?, used_type = ?, platform = ?,
       condition_grade = ?, packaging = ?, guarantee = ?, description = ?, condition_notes = ?,
       defects_json = ?, price_iqd = ?, quantity = ?, media_json = ?, contact_json = ?,
       updated_at = ?
     WHERE id = ? AND seller_user_id = ?`,
    fields.canonicalProductId === undefined
      ? listing.canonicalProductId
      : clean(fields.canonicalProductId),
    fields.title === undefined ? listing.title : String(fields.title).trim(),
    fields.titleEn === undefined ? listing.titleEn : clean(fields.titleEn),
    fields.usedType === undefined ? listing.usedType : clean(fields.usedType),
    fields.platform === undefined ? listing.platform : clean(fields.platform),
    fields.conditionGrade === undefined ? listing.conditionGrade : clean(fields.conditionGrade),
    fields.packaging === undefined ? listing.packaging : clean(fields.packaging),
    fields.guarantee === undefined ? listing.guarantee : clean(fields.guarantee),
    fields.description === undefined ? listing.description : clean(fields.description),
    fields.conditionNotes === undefined ? listing.conditionNotes : clean(fields.conditionNotes),
    JSON.stringify(
      fields.defects === undefined
        ? listing.defects
        : fields.defects.map((d) => String(d)).filter(Boolean),
    ),
    fields.priceIqd === undefined ? listing.priceIqd : Number(fields.priceIqd),
    fields.quantity === undefined ? listing.quantity : Number(fields.quantity),
    JSON.stringify(photos),
    JSON.stringify(fields.contact === undefined ? listing.contact : fields.contact),
    now,
    listingId,
    sellerUserId,
  );

  const updated = await getListing(listingId);
  if (!updated) throw new UsedMarketError("LISTING_NOT_FOUND");
  return updated;
}

/* --------------------------------- fee ----------------------------------- */

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

function isNotNullViolation(error: unknown): boolean {
  return /NOT NULL constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Takes the listing fee out of the seller's wallet, once per paid cycle.
 *
 * The whole charge is one batch: balance, ledger row, and the listing's paid
 * marker either all land or none do. The two ways it can fail are told apart by
 * which constraint complained — a NOT NULL on the balance means the seller
 * could not afford it, a UNIQUE on the ledger reference means this cycle was
 * already paid for and the caller should simply carry on.
 */
async function chargeListingFee(
  listing: UsedListing,
  amount: number,
  now: string,
): Promise<"charged" | "already_paid"> {
  if (amount <= 0) return "already_paid";
  const reference = `${listing.id}#${listing.feeCycle}`;

  try {
    const results = await d1BatchRun([
      {
        sql: `UPDATE users SET wallet_balance =
                CASE WHEN wallet_balance >= ? THEN wallet_balance - ? ELSE NULL END
              WHERE id = ?`,
        binds: [amount, amount, listing.sellerUserId],
      },
      {
        sql: `INSERT INTO wallet_transactions
                (id, user_id, kind, amount, description, order_id, created_at, reference_type, reference_id)
              VALUES (?, ?, 'purchase', ?, ?, '', ?, 'used_listing_fee', ?)`,
        binds: [
          randomId("wtx"),
          listing.sellerUserId,
          -amount,
          `رسوم عرض قطعة مستعملة: ${listing.title}`.slice(0, 180),
          now,
          reference,
        ],
      },
      {
        sql: `UPDATE used_listings SET fee_paid_cycle = fee_cycle, fee_amount = ?, fee_paid_at = ?, updated_at = ?
              WHERE id = ?`,
        binds: [amount, now, now, listing.id],
      },
    ]);
    // A driver without batch support returns nothing; that environment has no
    // D1 at all, and `requireD1` has already refused before we get here.
    if (!results.length) throw new UsedMarketError("FEE_BATCH_UNSUPPORTED");
    return "charged";
  } catch (error) {
    if (error instanceof UsedMarketError) throw error;
    if (isUniqueViolation(error)) return "already_paid";
    if (isNotNullViolation(error)) throw new UsedMarketError("INSUFFICIENT_WALLET_BALANCE");
    throw error;
  }
}

/**
 * Gives the fee back when the store rejects a listing outright.
 *
 * Keyed on the same cycle as the charge, so a listing rejected twice across two
 * paid windows refunds twice, and one rejected twice inside one window does not.
 */
async function refundListingFee(listing: UsedListing, now: string): Promise<boolean> {
  const amount = Number(listing.feeAmount ?? 0);
  if (!(amount > 0) || listing.feePaidCycle !== listing.feeCycle) return false;
  const reference = `${listing.id}#${listing.feeCycle}:refund`;
  try {
    const results = await d1BatchRun([
      {
        sql: `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
        binds: [amount, listing.sellerUserId],
      },
      {
        sql: `INSERT INTO wallet_transactions
                (id, user_id, kind, amount, description, order_id, created_at, reference_type, reference_id)
              VALUES (?, ?, 'refund', ?, ?, '', ?, 'used_listing_fee', ?)`,
        binds: [
          randomId("wtx"),
          listing.sellerUserId,
          amount,
          `إرجاع رسوم عرض قطعة مستعملة: ${listing.title}`.slice(0, 180),
          now,
          reference,
        ],
      },
    ]);
    if (!results.length) {
      // Same condition the charge refuses on. Here it must not undo the
      // rejection, so it is loud instead: the money is owed and nobody would
      // otherwise know.
      console.error(
        "[used-marketplace] the refund could not run — no batch support",
        listing.id,
        amount,
      );
      return false;
    }
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    // A failed refund is not a reason to leave the listing un-rejected, but it
    // is money owed to a member, so it is recorded rather than swallowed.
    console.error("[used-marketplace] refunding the listing fee failed", listing.id, error);
    return false;
  }
}

/* ------------------------------ transitions ------------------------------- */

export interface TransitionOptions {
  actor: Actor;
  actorUserId?: string;
  note?: string;
  /** Required on the move into SUBMITTED — the seller accepting the policy. */
  policyAccepted?: boolean;
  soldOrderId?: string;
  /**
   * Marks the item as one the store itself took back, which is what the
   * مسترجع badge means. Admin-only by construction: it is read from the
   * options a reviewer sends, never from anything the seller can write.
   */
  isReturned?: boolean;
}

async function recordEvent(
  listingId: string,
  from: UsedListingStatus | null,
  to: UsedListingStatus,
  options: TransitionOptions,
  now: string,
) {
  await d1Run(
    `INSERT INTO used_listing_events (id, listing_id, from_status, to_status, actor, actor_user_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomId("ule"),
    listingId,
    from,
    to,
    options.actor,
    options.actorUserId ?? null,
    options.note ?? null,
    now,
  );
}

/**
 * The single gate. Every status change in the marketplace comes through here.
 *
 * The status write itself is conditional on the status we read (`WHERE status =
 * ?`), so two admins clicking Approve and Reject at the same moment cannot both
 * succeed: the second one matches no row and is reported as a conflict rather
 * than silently overwriting the first decision.
 */
export async function transitionListing(
  listingId: string,
  to: UsedListingStatus,
  options: TransitionOptions,
): Promise<UsedListing> {
  await ensureUsedMarketplaceSchema();
  const config = await getUsedConfig();
  const listing = await getListing(listingId);
  if (!listing) throw new UsedMarketError("LISTING_NOT_FOUND");

  if (options.actor === "seller") {
    if (!options.actorUserId || options.actorUserId !== listing.sellerUserId) {
      throw new UsedMarketError("NOT_YOUR_LISTING");
    }
  }
  if (!canTransition(listing.status, to, options.actor)) {
    throw new UsedMarketError("TRANSITION_NOT_ALLOWED");
  }

  const now = new Date().toISOString();
  const sets: string[] = ["status = ?", "updated_at = ?"];
  const binds: unknown[] = [to, now];

  if (to === "SUBMITTED") {
    if (!config.enabled) throw new UsedMarketError("USED_MARKETPLACE_DISABLED");

    const issues = validateForSubmission(
      {
        title: listing.title,
        usedType: listing.usedType,
        conditionGrade: listing.conditionGrade,
        packaging: listing.packaging ?? undefined,
        guarantee: listing.guarantee ?? undefined,
        priceIqd: listing.priceIqd,
        quantity: listing.quantity,
        conditionNotes: listing.conditionNotes,
        photos: listing.photos,
      },
      config,
    );
    if (issues.length) throw new UsedMarketError("LISTING_INCOMPLETE", issues);

    // Accepting the policy is a precondition for the submission, not a field on
    // the listing body — a seller cannot get to review without it, and the
    // version they accepted is stamped so a later policy change is visible.
    const alreadyAccepted =
      listing.policyAcceptedAt != null && listing.policyVersion === config.policyVersion;
    if (!alreadyAccepted && !options.policyAccepted) {
      throw new UsedMarketError("POLICY_NOT_ACCEPTED");
    }
    if (!alreadyAccepted) {
      sets.push("policy_version = ?", "policy_accepted_at = ?");
      binds.push(config.policyVersion, now);
    }

    const active = await countActiveListings(listing.sellerUserId, listing.id);
    if (active >= config.maxActiveListingsPerSeller) {
      throw new UsedMarketError("TOO_MANY_ACTIVE_LISTINGS");
    }

    if (
      feeIsDue(listing.status, to, { feePaidForCycle: listing.feePaidCycle === listing.feeCycle })
    ) {
      await chargeListingFee(listing, config.listingFeeIqd, now);
    }
  }

  if (to === "APPROVED") {
    // Re-approving a paused listing keeps its original window; approving for
    // the first time starts one.
    if (!listing.publishedAt) {
      sets.push("published_at = ?", "expires_at = ?");
      binds.push(now, expiryFrom(now, config.listingDurationDays));
    }
    sets.push("reviewed_by_user_id = ?", "reviewed_at = ?");
    binds.push(options.actorUserId ?? null, now);
  }

  if (to === "REJECTED" || to === "NEEDS_CHANGES" || to === "UNDER_REVIEW") {
    sets.push("reviewed_by_user_id = ?", "reviewed_at = ?", "review_notes = ?");
    binds.push(options.actorUserId ?? null, now, options.note ?? null);
  }

  if (options.isReturned !== undefined && options.actor === "admin") {
    sets.push("is_returned = ?");
    binds.push(options.isReturned ? 1 : 0);
  }

  if (to === "SOLD") {
    sets.push("sold_at = ?", "sold_order_id = ?");
    binds.push(now, options.soldOrderId ?? null);
  }

  if (to === "DRAFT" && listing.status === "EXPIRED") {
    // Relisting buys a new window, so the next submission is charged again.
    sets.push(
      "fee_cycle = fee_cycle + 1",
      "published_at = NULL",
      "expires_at = NULL",
      "review_notes = NULL",
    );
  }

  const changed = await d1RunChanges(
    `UPDATE used_listings SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
    ...binds,
    listingId,
    listing.status,
  );
  if (changed !== 1) throw new UsedMarketError("LISTING_CHANGED_CONCURRENTLY");

  await recordEvent(listingId, listing.status, to, options, now);

  if (to === "REJECTED" && config.refundFeeOnReject) {
    // Read the row back first: the charge above may have set fee_amount in this
    // very call, and refunding against the stale copy would refund nothing.
    const afterReject = (await getListing(listingId)) ?? listing;
    await refundListingFee(afterReject, now);
  }

  await notifySeller(listing, to, options);
  if (to === "SUBMITTED") await notifyStore(listing, now);

  if (options.actorUserId) {
    await createAuditLog(
      options.actorUserId,
      `used_listing.${to.toLowerCase()}`,
      "used_listing",
      listingId,
      { status: listing.status },
      { status: to },
      options.note ? { note: options.note } : undefined,
    );
  }

  const updated = await getListing(listingId);
  if (!updated) throw new UsedMarketError("LISTING_NOT_FOUND");
  return updated;
}

const SELLER_NOTICE: Partial<Record<UsedListingStatus, { title: string; body: string }>> = {
  APPROVED: { title: "تم نشر عرضك", body: "عرض القطعة المستعملة أصبح ظاهراً للزبائن." },
  NEEDS_CHANGES: {
    title: "عرضك يحتاج تعديلاً",
    body: "راجع ملاحظات الفريق ثم أعد الإرسال — لا رسوم إضافية.",
  },
  REJECTED: { title: "تم رفض عرضك", body: "راجع ملاحظات الفريق لمعرفة السبب." },
  EXPIRED: { title: "انتهت مدة عرضك", body: "يمكنك إعادة النشر بدفع الرسوم من جديد." },
  SOLD: { title: "تم بيع قطعتك", body: "سيتواصل معك الفريق لإكمال التسليم." },
};

async function notifySeller(
  listing: UsedListing,
  to: UsedListingStatus,
  options: TransitionOptions,
) {
  const notice = SELLER_NOTICE[to];
  // A seller who made the move themselves already knows about it.
  if (!notice || options.actor === "seller") return;
  try {
    await createNotification(
      listing.sellerUserId,
      notice.title,
      options.note ? `${notice.body}\n${options.note}` : notice.body,
      "/used/mine",
    );
  } catch (error) {
    // The status change is the transaction; a failed notification must not
    // undo it or make the admin's click look like it failed.
    console.error("[used-marketplace] notifying the seller failed", listing.id, error);
  }
}

/**
 * Tells the store a listing is waiting, over Telegram.
 *
 * Dynamically imported so the marketplace does not drag the Telegram client
 * into every module that touches a listing, and swallowed on failure for the
 * same reason as the seller notice: the status change is the transaction.
 */
async function notifyStore(listing: UsedListing, submittedAt: string) {
  try {
    const [{ findUserById }, { enqueueNotification }] = await Promise.all([
      import("./db.server"),
      import("./notification-outbox.server"),
    ]);
    const seller = await findUserById(listing.sellerUserId);
    const listingPayload = {
      listingId: listing.id,
      title: listing.title,
      priceIqd: listing.priceIqd,
      conditionGrade: listing.conditionGrade,
      usedType: listing.usedType,
      user: { id: listing.sellerUserId, name: seller?.name, phone: seller?.phone },
    };
    /*
      Keyed on the submission, not the listing.

      A listing can be submitted, rejected, edited and submitted again — three
      genuinely separate things for the store to look at. `submittedAt` is the
      transition's own timestamp, stamped once in `transitionListing` and
      shared with the event row, so a retried queue delivery of one submission
      carries the same key while a later re-submission gets its own.
    */
    await enqueueNotification(
      {
        type: "telegram_admin_used_listing",
        payload: listingPayload,
        dedupeKey: `used_listing_submitted:${listing.id}:${submittedAt}`,
      },
      async () => {
        const { notifyAdminUsedListing } = await import("./telegram-notifications.server");
        return notifyAdminUsedListing(listingPayload);
      },
    );
  } catch (error) {
    console.error("[used-marketplace] telling the store failed", listing.id, error);
  }
}

export async function countActiveListings(
  sellerUserId: string,
  excludeListingId?: string,
): Promise<number> {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const row = await d1First<{ n: number }>(
    `SELECT count(*) AS n FROM used_listings
      WHERE seller_user_id = ? AND status IN (${placeholders}) AND id <> ?`,
    sellerUserId,
    ...ACTIVE_STATUSES,
    excludeListingId ?? "",
  );
  return Number(row?.n ?? 0);
}

/**
 * Expires every approved listing whose window has closed.
 *
 * Runs from the scheduled job. It goes through `transitionListing` one listing
 * at a time rather than a bulk UPDATE so each expiry gets its event row and its
 * seller notification, the same as any other status change.
 */
export async function expireDueListings(limit = 100): Promise<{ expired: string[] }> {
  await ensureUsedMarketplaceSchema();
  const now = new Date().toISOString();
  const rows = await d1All<{ id: string }>(
    `SELECT id FROM used_listings
      WHERE status IN ('APPROVED','PAUSED') AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at ASC LIMIT ?`,
    now,
    Math.min(Math.max(limit, 1), 500),
  );

  const expired: string[] = [];
  for (const row of rows) {
    try {
      await transitionListing(String(row.id), "EXPIRED", { actor: "system" });
      expired.push(String(row.id));
    } catch (error) {
      console.error("[used-marketplace] expiring a listing failed", row.id, error);
    }
  }
  return { expired };
}

export { DEFAULT_USED_CONFIG };
