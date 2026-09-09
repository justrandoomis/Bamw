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
import { normalizeContact } from "./contact-links";
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
    usage_period_months REAL,
    warranty_months REAL,
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

/**
 * Columns added to a table that already exists.
 *
 * `CREATE TABLE IF NOT EXISTS` above does nothing to a database already
 * carrying listings, so these are how a live `used_listings` gets the two
 * numbers a second-hand buyer asks for first. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so a second application fails and is swallowed —
 * the same shape `SCHEMA_PATCHES` uses in d1.server.ts.
 */
const SCHEMA_PATCH_STATEMENTS = [
  `ALTER TABLE used_listings ADD COLUMN usage_period_months REAL`,
  `ALTER TABLE used_listings ADD COLUMN warranty_months REAL`,
  /*
    The contact trail, and the question it eventually asks.

    A buyer pressing a contact button is the only signal this section gets that
    a sale might be happening — nothing goes through the till, so the shop
    never learns the outcome unless it asks. `first_contact_at` starts the
    three-day clock; `sold_prompt_at` records that the seller was asked, so
    they are asked once rather than every time the cron runs.
  */
  `ALTER TABLE used_listings ADD COLUMN first_contact_at TEXT`,
  `ALTER TABLE used_listings ADD COLUMN contact_clicks INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE used_listings ADD COLUMN sold_prompt_at TEXT`,
  `ALTER TABLE used_listings ADD COLUMN sold_prompt_answer TEXT`,
] as const;

/** Reports left by people looking at a listing, for an admin to act on. */
const REPORT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS used_listing_reports (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    reporter_user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    handled_at TEXT,
    handled_by_user_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS used_listing_reports_listing_idx ON used_listing_reports (listing_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS used_listing_reports_open_idx ON used_listing_reports (handled_at, created_at DESC)`,
  /*
    One report per person per listing. A viewer who feels strongly is not a
    queue of complaints, and without this an admin's list would be as long as
    somebody was willing to click.
  */
  `CREATE UNIQUE INDEX IF NOT EXISTS used_listing_reports_once_idx ON used_listing_reports (listing_id, reporter_user_id)`,
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
      for (const sql of REPORT_SCHEMA_STATEMENTS) await d1Run(sql);
      for (const sql of SCHEMA_PATCH_STATEMENTS) {
        // Expected to fail once applied — see SCHEMA_PATCH_STATEMENTS.
        await d1Run(sql).catch(() => undefined);
      }
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
  usagePeriodMonths: number | null;
  warrantyMonths: number | null;
  firstContactAt: string | null;
  contactClicks: number;
  soldPromptAt: string | null;
  soldPromptAnswer: string | null;
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
    /*
      Read as null when absent rather than zero: "used for 0 months" and "the
      seller did not say" are different answers, and a listing written before
      these columns existed has no answer at all.
    */
    usagePeriodMonths: row.usage_period_months == null ? null : Number(row.usage_period_months),
    warrantyMonths: row.warranty_months == null ? null : Number(row.warranty_months),
    firstContactAt: row.first_contact_at ? String(row.first_contact_at) : null,
    contactClicks: Number(row.contact_clicks ?? 0),
    soldPromptAt: row.sold_prompt_at ? String(row.sold_prompt_at) : null,
    soldPromptAnswer: row.sold_prompt_answer ? String(row.sold_prompt_answer) : null,
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
  usagePeriodMonths?: number | null;
  warrantyMonths?: number | null;
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

/**
 * A month count, or null for "the seller did not say".
 *
 *零 is a real answer — a console with no warranty left — so an empty box has
 * to be distinguishable from a typed zero, which is why this returns null
 * rather than 0 for nothing.
 */
function months(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
       condition_grade, packaging, guarantee, description, condition_notes,
       usage_period_months, warranty_months, defects_json,
       price_iqd, quantity, media_json, contact_json, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
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
    months(fields.usagePeriodMonths),
    months(fields.warrantyMonths),
    JSON.stringify((fields.defects ?? []).map((d) => String(d)).filter(Boolean)),
    Number(fields.priceIqd ?? 0),
    Number(fields.quantity ?? 1),
    JSON.stringify(ownPhotos(fields.photos, sellerUserId, config.maxPhotos)),
    /*
      Normalised, not stored as typed.

      Photos two lines up go through `ownPhotos` before they are trusted; the
      contact map went in raw — any key, any value up to 200 characters, no
      shape check anywhere in the stack. It ends up in an `href` on a public
      page, so it is cleaned at the point it is written: `normalizeContact`
      keeps only the channels it recognises, and only handles it could build a
      link from.
    */
    JSON.stringify(normalizeContact(fields.contact as Record<string, unknown> | undefined)),
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
       usage_period_months = ?, warranty_months = ?,
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
    fields.usagePeriodMonths === undefined
      ? listing.usagePeriodMonths
      : months(fields.usagePeriodMonths),
    fields.warrantyMonths === undefined ? listing.warrantyMonths : months(fields.warrantyMonths),
    JSON.stringify(
      fields.defects === undefined
        ? listing.defects
        : fields.defects.map((d) => String(d)).filter(Boolean),
    ),
    fields.priceIqd === undefined ? listing.priceIqd : Number(fields.priceIqd),
    fields.quantity === undefined ? listing.quantity : Number(fields.quantity),
    JSON.stringify(photos),
    /* Normalised on edit too — see the note on the insert. */
    JSON.stringify(
      fields.contact === undefined
        ? listing.contact
        : normalizeContact(fields.contact as Record<string, unknown>),
    ),
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
        /*
          Validated from the stored row, not from the request that triggered
          the submit — the seller's last save is what is being published, and
          this gate exists precisely so the request cannot claim otherwise.
        */
        usagePeriodMonths: listing.usagePeriodMonths,
        warrantyMonths: listing.warrantyMonths,
        contact: listing.contact,
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

/* ------------------------- contact, sale, reports ------------------------- */

/** How long after the first contact the seller is asked whether it sold. */
export const SOLD_PROMPT_AFTER_DAYS = 3;

/** The answers the seller may give. */
export const SOLD_ANSWERS = ["sold", "still_available"] as const;
export type SoldAnswer = (typeof SOLD_ANSWERS)[number];

/**
 * A buyer pressed one of the seller's contact buttons.
 *
 * Nothing about a private sale goes through the till, so this press is the
 * only sign the shop ever gets that one might be happening — and it is what
 * starts the three-day clock before the seller is asked how it went.
 *
 * The count is a tally, not an audience measure: it is deliberately not tied
 * to who pressed it, because the point is the seller's prompt, and keeping a
 * record of which member looked at whose listing would be collecting something
 * nobody needs. `first_contact_at` is written once — the clock runs from the
 * first interest, not the most recent — so a listing being pressed daily still
 * asks its question on day three.
 */
export async function recordContactClick(listingId: string): Promise<void> {
  await ensureUsedMarketplaceSchema();
  const now = new Date().toISOString();
  await d1Run(
    `UPDATE used_listings
        SET contact_clicks = contact_clicks + 1,
            first_contact_at = COALESCE(first_contact_at, ?)
      WHERE id = ? AND status = 'APPROVED'`,
    now,
    listingId,
  );
}

/**
 * Asks every seller whose listing was contacted three days ago how it went.
 *
 * Runs on the cron beside `expireDueListings`. Two guards keep it to one
 * question per listing: `sold_prompt_at IS NULL` means it has not been asked,
 * and the same column is stamped inside the same statement that claims the
 * row, so a second cron tick a minute later finds nothing to do.
 *
 * Not asking is the default. A seller who never answers keeps their listing
 * until the window closes on its own, which is what the owner asked for — the
 * question is a courtesy, not a condition of staying up.
 */
export async function promptSellersAboutSales(limit = 100): Promise<{ asked: string[] }> {
  await ensureUsedMarketplaceSchema();
  const now = Date.now();
  const due = new Date(now - SOLD_PROMPT_AFTER_DAYS * 24 * 3600 * 1000).toISOString();
  const rows = await d1All<{ id: string; seller_user_id: string; title: string }>(
    `SELECT id, seller_user_id, title FROM used_listings
      WHERE status = 'APPROVED'
        AND first_contact_at IS NOT NULL
        AND first_contact_at <= ?
        AND sold_prompt_at IS NULL
      ORDER BY first_contact_at ASC LIMIT ?`,
    due,
    Math.min(Math.max(limit, 1), 500),
  );

  const asked: string[] = [];
  const stamp = new Date(now).toISOString();
  for (const row of rows) {
    try {
      /*
        Stamped before the notification, and conditional on still being unset.
        Cloudflare Cron is at-least-once, so two overlapping runs can select
        the same row; the one whose UPDATE changes nothing sends nothing.
      */
      const claimed = await d1RunChanges(
        `UPDATE used_listings SET sold_prompt_at = ? WHERE id = ? AND sold_prompt_at IS NULL`,
        stamp,
        String(row.id),
      );
      if (!claimed) continue;

      await createNotification(
        String(row.seller_user_id),
        "هل بعت القطعة؟",
        `تواصل معك مشترٍ بخصوص «${String(row.title ?? "")}». إذا بِعتها أخبِرنا لنخفي العرض، وإن كانت ما زالت متاحة اتركه كما هو.`,
        "/used",
        "used_marketplace",
      );
      asked.push(String(row.id));
    } catch (error) {
      console.error("[used-marketplace] asking a seller about a sale failed", row.id, error);
    }
  }
  return { asked };
}

/**
 * The seller's answer to that question.
 *
 * "Sold" pauses the listing rather than marking it SOLD. SOLD in this table
 * means the shop sold it — it carries `sold_order_id` and only an admin or the
 * system may set it — and a private sale arranged over Telegram is not that.
 * Pausing is a move the seller already owns, it takes the item off the shop
 * immediately, which is what the owner asked for, and it leaves the admin free
 * to record the outcome properly.
 */
export async function answerSoldPrompt(
  sellerUserId: string,
  listingId: string,
  answer: SoldAnswer,
): Promise<UsedListing> {
  await ensureUsedMarketplaceSchema();
  if (!(SOLD_ANSWERS as readonly string[]).includes(answer)) {
    throw new UsedMarketError("UNKNOWN_ANSWER");
  }
  const listing = await getListing(listingId);
  if (!listing) throw new UsedMarketError("LISTING_NOT_FOUND");
  if (listing.sellerUserId !== sellerUserId) throw new UsedMarketError("NOT_YOUR_LISTING");

  await d1Run(
    `UPDATE used_listings SET sold_prompt_answer = ?, updated_at = ? WHERE id = ? AND seller_user_id = ?`,
    answer,
    new Date().toISOString(),
    listingId,
    sellerUserId,
  );

  if (answer === "sold" && listing.status === "APPROVED") {
    return transitionListing(listingId, "PAUSED", {
      actor: "seller",
      actorUserId: sellerUserId,
      note: "أبلغ البائع أنه باع القطعة",
    });
  }

  const updated = await getListing(listingId);
  if (!updated) throw new UsedMarketError("LISTING_NOT_FOUND");
  return updated;
}

/** Why somebody is reporting a listing. */
export const REPORT_REASONS = ["already_sold", "no_reply", "wrong_details", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL_AR: Record<ReportReason, string> = {
  already_sold: "القطعة مباعة",
  no_reply: "البائع لا يرد",
  wrong_details: "المعلومات غير صحيحة",
  other: "سبب آخر",
};

/**
 * Somebody looking at a listing says something is wrong with it.
 *
 * Reports do not change the listing. A seller who stops answering and a seller
 * whose listing a rival wants taken down look identical from here, so the
 * decision stays with a person: this records the complaint and tells the
 * admins, and hiding the listing is a hand they play.
 *
 * One report per person per listing, enforced by a unique index rather than a
 * read-then-write, so two taps cannot become two rows.
 */
export async function reportListing(
  reporterUserId: string,
  listingId: string,
  reason: ReportReason,
  note?: string,
): Promise<{ recorded: boolean }> {
  await ensureUsedMarketplaceSchema();
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new UsedMarketError("UNKNOWN_REPORT_REASON");
  }
  const listing = await getListing(listingId);
  if (!listing) throw new UsedMarketError("LISTING_NOT_FOUND");
  /* Reporting your own listing is not a report; it is a request to pause it. */
  if (listing.sellerUserId === reporterUserId) throw new UsedMarketError("YOUR_OWN_LISTING");

  const now = new Date().toISOString();
  try {
    await d1Run(
      `INSERT INTO used_listing_reports (id, listing_id, reporter_user_id, reason, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomId("ulr"),
      listingId,
      reporterUserId,
      reason,
      clean(note),
      now,
    );
  } catch {
    // The unique index refused a second report from the same person. Their
    // first one already reached the admins, so this is not a failure to report.
    return { recorded: false };
  }

  await createAuditLog(
    reporterUserId,
    "used_listing_reported",
    "used_listing",
    listingId,
    undefined,
    undefined,
    { reason },
  );
  return { recorded: true };
}

/** Open reports, newest first, for the admin screen. */
export async function listOpenReports(limit = 100): Promise<
  {
    id: string;
    listingId: string;
    listingTitle: string;
    listingStatus: string;
    reporterUserId: string;
    reason: string;
    note: string | null;
    createdAt: string;
  }[]
> {
  await ensureUsedMarketplaceSchema();
  const rows = await d1All<Record<string, unknown>>(
    `SELECT r.id, r.listing_id, r.reporter_user_id, r.reason, r.note, r.created_at,
            l.title AS listing_title, l.status AS listing_status
       FROM used_listing_reports r
       JOIN used_listings l ON l.id = r.listing_id
      WHERE r.handled_at IS NULL
      ORDER BY r.created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 500),
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    listingId: String(row["listing_id"]),
    listingTitle: String(row["listing_title"] ?? ""),
    listingStatus: String(row["listing_status"] ?? ""),
    reporterUserId: String(row["reporter_user_id"]),
    reason: String(row["reason"]),
    note: row["note"] ? String(row["note"]) : null,
    createdAt: String(row["created_at"]),
  }));
}

/** An admin has dealt with a report, whatever they decided to do about it. */
export async function resolveReport(adminUserId: string, reportId: string): Promise<void> {
  await ensureUsedMarketplaceSchema();
  await d1Run(
    `UPDATE used_listing_reports SET handled_at = ?, handled_by_user_id = ? WHERE id = ? AND handled_at IS NULL`,
    new Date().toISOString(),
    adminUserId,
    reportId,
  );
}

export { DEFAULT_USED_CONFIG };
