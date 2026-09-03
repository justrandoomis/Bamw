/**
 * Cloudflare D1 access.
 *
 * The Worker's `env` is published to `globalThis.__CF_ENV__` by src/server.ts,
 * so any server-side module can reach the `DB` (D1) and `bananto` (R2)
 * bindings without threading `env` through every call.
 *
 * When no D1 binding exists (local sandbox preview), every helper returns
 * undefined and src/lib/db.server.ts transparently falls back to the
 * filesystem/memory JSON driver.
 */

export type D1Row = Record<string, unknown>;

interface D1PreparedStatement {
  /** Present only on the REST adapter so a D1 batch can be serialized. */
  _sql?: string;
  _params?: unknown[];
  bind: (...values: unknown[]) => D1PreparedStatement;
  all: <T = D1Row>() => Promise<{ results?: T[] }>;
  first: <T = D1Row>() => Promise<T | null>;
  run: () => Promise<D1RunResult>;
}

export interface D1RunResult {
  success?: boolean;
  meta?: { changes?: number; changed_db?: boolean };
  results?: unknown[];
}

export interface D1Like {
  prepare: (sql: string) => D1PreparedStatement;
  batch?: (statements: D1PreparedStatement[]) => Promise<D1RunResult[]>;
  exec?: (sql: string) => Promise<unknown>;
}

import { env, getEnv, getBinding } from "./env.server";
const envVar = (name: string) =>
  name === "D1_DATABASE_ID" ? env("D1_DATABASE_ID") || env("CLOUDFLARE_D1_DATABASE_ID") : env(name);

export function cfEnv(): Record<string, unknown> | undefined {
  return getEnv() as Record<string, unknown>;
}

/**
 * D1 over the Cloudflare REST API — used whenever the native binding is not
 * present (Lovable preview, local dev). Same database as production, so data
 * saved in preview persists and appears on the deployed site.
 */
function restD1(): D1Like | undefined {
  const accountId = envVar("CLOUDFLARE_ACCOUNT_ID");
  const token = envVar("CLOUDFLARE_API_TOKEN");
  const databaseId = envVar("D1_DATABASE_ID");
  if (!accountId || !token || !databaseId) return undefined;

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const executeSingle = async (sql: string, params: unknown[] = []): Promise<D1RunResult> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sql,
        params: params.map((p) => (p === undefined ? null : p)),
      }),
    });
    let rawText = "";
    try {
      rawText = await res.text();
    } catch (readErr) {
      console.error(`[d1:rest:read_error] status=${res.status}`, readErr);
      throw new Error(`D1_REST_READ_ERROR: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
    }

    let payload: {
      success?: boolean;
      errors?: { message?: string; code?: number }[];
      result?: D1RunResult[];
    };
    try {
      payload = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(
        `[d1:rest:json_parse_error] status=${res.status} length=${rawText.length} snippet=${rawText.slice(0, 100)}...${rawText.slice(-100)}`,
        parseErr,
      );
      throw new Error(`D1_REST_INVALID_JSON (length: ${rawText.length}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }

    if (!res.ok || payload.success === false) {
      const msg = payload.errors?.[0]?.message ?? `D1 REST error ${res.status}`;
      console.error(`[d1:rest:error] status=${res.status} error=${msg}`);
      throw new Error(res.status === 401 || res.status === 403 ? "D1_AUTHENTICATION_FAILED" : msg);
    }
    return payload.result?.[0] ?? { success: true, results: [] };
  };

  const executeBatch = async (
    statements: { sql: string; params: unknown[] }[],
  ): Promise<D1RunResult[]> => {
    if (!statements.length) return [];
    const results: D1RunResult[] = [];
    for (const statement of statements) {
      const res = await executeSingle(statement.sql, statement.params);
      results.push(res);
    }
    return results;
  };

  const make = (sql: string, params: unknown[]): D1PreparedStatement => ({
    _sql: sql,
    _params: params,
    bind: (...values: unknown[]) => make(sql, values),
    all: async <T = D1Row>() => ({
      results: ((await executeSingle(sql, params)).results as T[] | undefined) ?? [],
    }),
    first: async <T = D1Row>() =>
      ((await executeSingle(sql, params)).results?.[0] as T | undefined) ?? null,
    run: async () => executeSingle(sql, params),
  });

  return {
    prepare: (sql: string) => make(sql, []),
    batch: (statements) =>
      executeBatch(
        statements.map((statement) => ({
          sql: statement._sql ?? "",
          params: statement._params ?? [],
        })),
      ),
  };
}

let restCache: D1Like | undefined | null = null;
let restCacheKey = "";

export function getD1(): D1Like | undefined {
  // `bananto` is the binding in wrangler.jsonc. Older deployments and some
  // Cloudflare setups expose the same D1 database as `DB` instead.
  const envData = getEnv();
  const db =
    (envData["bananto"] as D1Like) ||
    (envData["DB"] as D1Like) ||
    (envData["BANANTO_DB"] as D1Like);

  // If a native Cloudflare D1 binding is present, ALWAYS prefer it for
  // direct zero-latency in-worker execution.
  if (db && typeof db.prepare === "function") {
    return db;
  }

  // When native binding is not present (e.g. Node.js local dev / preview container),
  // fall back to Cloudflare REST API if credentials are provided.
  const restConfigAvailable = Boolean(
    envVar("CLOUDFLARE_ACCOUNT_ID") && envVar("CLOUDFLARE_API_TOKEN") && envVar("D1_DATABASE_ID"),
  );

  if (restConfigAvailable) {
    const nextCacheKey = `${envVar("CLOUDFLARE_ACCOUNT_ID")}:${envVar("D1_DATABASE_ID")}:${envVar("CLOUDFLARE_API_TOKEN")}`;
    if (restCacheKey !== nextCacheKey || restCache === null || (!restCache && restConfigAvailable)) {
      restCacheKey = nextCacheKey;
      restCache = restD1();
    }
    if (restCache) return restCache;
  }

  return undefined;
}

function stmt(db: D1Like, sql: string, binds: unknown[]) {
  const prepared = db.prepare(sql);
  return binds.length ? prepared.bind(...binds) : prepared;
}

export async function d1All<T = D1Row>(sql: string, ...binds: unknown[]): Promise<T[]> {
  const db = getD1();
  if (!db) return [];
  const out = await stmt(db, sql, binds).all<T>();
  return out.results ?? [];
}

export async function d1First<T = D1Row>(sql: string, ...binds: unknown[]): Promise<T | undefined> {
  const db = getD1();
  if (!db) return {} as any;
  const row = await stmt(db, sql, binds).first<T>();
  return row ?? undefined;
}

export async function d1Run(sql: string, ...binds: unknown[]): Promise<void> {
  const db = getD1();
  if (!db) return;
  await stmt(db, sql, binds).run();
}

/** Execute a mutation and return the number of affected rows when available. */
export async function d1RunChanges(sql: string, ...binds: unknown[]): Promise<number> {
  const db = getD1();
  if (!db) return 0;
  const result = await stmt(db, sql, binds).run();
  return Number(result?.meta?.changes ?? (result?.success ? 1 : 0));
}

/** Execute an atomic D1 batch and retain each statement's mutation metadata. */
export async function d1BatchRun(
  statements: { sql: string; binds?: unknown[] }[],
): Promise<D1RunResult[]> {
  const db = getD1();
  if (!db?.batch) return [];
  return db.batch(statements.map(({ sql, binds = [] }) => stmt(db, sql, binds)));
}

/**
 * Idempotent schema bootstrap so a freshly created D1 database works even
 * before `wrangler d1 migrations apply` has been run. Executed at most once
 * per isolate.
 */
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  /*
    Optimistic lock for the catalogue document. Every save inserts the next
    revision; the primary key is what makes a concurrent save fail instead of
    silently overwriting the other one's changes. Holds a single row.
  */
  `CREATE TABLE IF NOT EXISTS store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
    password_hash TEXT NOT NULL DEFAULT '', avatar TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'password', provider_id TEXT,
    settings TEXT NOT NULL DEFAULT '{}', addresses TEXT NOT NULL DEFAULT '[]',
    favorites TEXT NOT NULL DEFAULT '[]', wallet_balance REAL NOT NULL DEFAULT 0,
    banana_balance INTEGER NOT NULL DEFAULT 0, banana_locked INTEGER NOT NULL DEFAULT 0,
    -- Who brought this member in, and whether they have spent their one
    -- lifetime referral discount. On the member rather than on the attribution
    -- because that is where the rules live: the discount is once per account
    -- for ever, and the referrer keeps earning on every later order, long
    -- after the link, the cookie and the attribution row have expired. An
    -- attribution is how a binding is established; this is the binding.
    -- referred_by_user_id is written once and never rewritten: the claim
    -- guards on it being NULL, so a second link cannot take a member off the
    -- person who actually brought them.
    referred_by_user_id TEXT, referral_discount_used_at TEXT, first_referral_order_id TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email)`,
  `CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by_user_id)`,
  `CREATE INDEX IF NOT EXISTS users_provider_idx ON users (provider, provider_id)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, code TEXT NOT NULL, user_id TEXT NOT NULL,
    doc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'unpaid',
    total REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    cancelled_at TEXT, idempotency_key TEXT, checkout_session_id TEXT, payment_reference TEXT, source TEXT, created_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT,
    doc TEXT NOT NULL, last_message_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS threads_user_idx ON threads (user_id, last_message_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, doc TEXT NOT NULL,
    created_at TEXT NOT NULL, client_message_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_client_msg_idx ON messages (thread_id, client_message_id) WHERE client_message_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    destination TEXT,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS otp_phone_idx ON otp_codes (phone, purpose, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS otp_user_idx ON otp_codes (user_id)`,
  `CREATE TABLE IF NOT EXISTS banana_wallets (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS banana_listings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, price_per REAL NOT NULL, is_private INTEGER NOT NULL DEFAULT 0,
    is_promoted INTEGER NOT NULL DEFAULT 0, promoted_until TEXT,
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS banana_listings_status_idx ON banana_listings (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS banana_price_points (id TEXT PRIMARY KEY, price REAL NOT NULL,
    recorded_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS banana_rewards (id TEXT PRIMARY KEY, title TEXT NOT NULL, cost INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT -1, icon TEXT NOT NULL DEFAULT '🍌', category TEXT NOT NULL DEFAULT 'digital',
    is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS banana_redemptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    reward_id TEXT NOT NULL, cost INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS banana_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    amount INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS product_reviews (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, user_id TEXT NOT NULL,
    order_id TEXT, rating INTEGER NOT NULL DEFAULT 5, comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS product_reviews_product_idx ON product_reviews (product_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS product_reviews_user_idx ON product_reviews (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    amount REAL NOT NULL, description TEXT, order_id TEXT, created_at TEXT NOT NULL,
    reference_type TEXT, reference_id TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_ref_idx ON wallet_transactions (reference_type, reference_id) WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS recharge_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL NOT NULL,
    method TEXT NOT NULL, proof_url TEXT, eshop_code TEXT, banan_code TEXT,
    status TEXT NOT NULL DEFAULT 'pending', admin_notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS banan_codes (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, value REAL NOT NULL,
    is_used INTEGER NOT NULL DEFAULT 0, used_by TEXT, used_at TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS game_extraction_jobs (
    id TEXT PRIMARY KEY, game_id TEXT, game_name TEXT NOT NULL, status TEXT DEFAULT 'QUEUED',
    current_section TEXT, current_field TEXT, progress REAL DEFAULT 0, model TEXT,
    started_at TEXT, updated_at TEXT, completed_at TEXT, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS game_field_audits (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, game_id TEXT, field_name TEXT NOT NULL,
    field_value TEXT, source_name TEXT, source_url TEXT, confidence TEXT,
    verified INTEGER DEFAULT 0, evidence TEXT, last_verified TEXT,
    FOREIGN KEY(job_id) REFERENCES game_extraction_jobs(id))`,
  `CREATE TABLE IF NOT EXISTS game_catalog (
    title TEXT PRIMARY KEY,
    description_ar TEXT,
    description_en TEXT,
    cover_url TEXT,
    trade_value_iqd INTEGER DEFAULT 0,
    platform TEXT DEFAULT 'switch',
    genres TEXT DEFAULT '[]',
    publisher TEXT,
    release_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS game_aliases (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, alias TEXT NOT NULL, normalized TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'user_variant', language TEXT, region TEXT, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_aliases_norm_idx ON game_aliases (normalized)`,
  `CREATE INDEX IF NOT EXISTS game_aliases_game_idx ON game_aliases (game_id)`,
  `CREATE TABLE IF NOT EXISTS game_images (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
    source_name TEXT, source_url TEXT, region TEXT, platform TEXT, edition TEXT,
    confidence REAL DEFAULT 0, verified INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 0,
    evidence TEXT, created_at TEXT NOT NULL, verified_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS game_images_game_idx ON game_images (game_id, kind)`,
  `CREATE TABLE IF NOT EXISTS game_variants (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, variant_type TEXT NOT NULL, name TEXT NOT NULL,
    price_usd REAL, features TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS game_variants_game_idx ON game_variants (game_id)`,
  `CREATE TABLE IF NOT EXISTS game_import_logs (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS game_import_logs_game_idx ON game_import_logs (game_id)`,
  `CREATE TABLE IF NOT EXISTS game_price_history (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, old_value_iqd INTEGER, new_value_iqd INTEGER,
    source TEXT, actor TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS trade_rules (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, key TEXT NOT NULL, label_ar TEXT NOT NULL,
    label_en TEXT, percent REAL NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS trade_rules_key_idx ON trade_rules (category, key)`,
  /*
    Who asked to be told when an unreleased product comes out.

    A pre-order in this catalogue is a priced product with a future release
    date, and until now nothing stopped a customer buying one — the store took
    money for a game it could not hand over. The customer registers here
    instead; `notified_at` is stamped when the release message goes out, so a
    restarted job cannot tell the same person twice.

    One row per person per product: the unique index makes a second tap on
    "notify me" a no-op rather than a duplicate.
  */
  `CREATE TABLE IF NOT EXISTS product_release_alerts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_id TEXT NOT NULL,
    product_title TEXT, release_date TEXT,
    created_at TEXT NOT NULL, notified_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS product_release_alerts_unique ON product_release_alerts (user_id, product_id)`,
  `CREATE INDEX IF NOT EXISTS product_release_alerts_pending_idx ON product_release_alerts (notified_at, product_id)`,
  /*
    The referral programme — "دعوة صديق".

    Four tables, and every one of them exists to make a rule unforgeable:

    - `referral_codes` is the stable identity behind a shared link. A link may
      show a username, but the username is only a lookup key; what is stored on
      the attribution is a code id, so renaming an account never moves anyone
      else's earnings.
    - `referral_attributions` is the claim that a visitor arrived through
      someone. It is written for guests, before there is an account to attach
      it to, and later bound to whoever signs in on that session.
    - `referral_rewards` is the money. The two unique indexes on it are the
      whole of "pay once": one reward per order, one per order item.
    - `referral_risk_events` is why a referral was refused, kept for the admin
      screen — never shown to the customer, who is told only that the code
      could not be applied.

    Hashes throughout, never raw values: an address or a device is stored as an
    HMAC so the comparison still works and the identifier itself is not in the
    database, the logs or an export.
  */
  `CREATE TABLE IF NOT EXISTS referral_codes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL,
    username_alias TEXT, is_active INTEGER NOT NULL DEFAULT 1, blocked_reason TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_idx ON referral_codes (user_id)`,
  `CREATE INDEX IF NOT EXISTS referral_codes_alias_idx ON referral_codes (username_alias)`,
  /*
    `product_id` and `guest_session_hash` are NOT NULL with a default rather
    than nullable, because the uniqueness rule below has to hold for a link
    with no product on it too — and in SQLite two NULLs are never equal, so a
    nullable column in a unique index means no constraint at all.
  */
  `CREATE TABLE IF NOT EXISTS referral_attributions (
    id TEXT PRIMARY KEY, referrer_user_id TEXT NOT NULL, referred_user_id TEXT,
    referral_code_id TEXT NOT NULL, product_id TEXT NOT NULL DEFAULT '',
    guest_session_hash TEXT NOT NULL DEFAULT '', device_hash TEXT, ip_hash TEXT,
    status TEXT NOT NULL DEFAULT 'captured',
    captured_at TEXT NOT NULL, expires_at TEXT NOT NULL, bound_at TEXT,
    converted_order_id TEXT, converted_at TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT,
    updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_session_idx
     ON referral_attributions (guest_session_hash, referral_code_id, product_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_order_idx
     ON referral_attributions (converted_order_id) WHERE converted_order_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS referral_attributions_referred_idx ON referral_attributions (referred_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS referral_attributions_referrer_idx ON referral_attributions (referrer_user_id, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS referral_rewards (
    id TEXT PRIMARY KEY, attribution_id TEXT,
    order_id TEXT NOT NULL, order_item_id TEXT NOT NULL, product_id TEXT NOT NULL,
    referrer_user_id TEXT NOT NULL, buyer_user_id TEXT NOT NULL,
    referral_code_id TEXT, referral_code TEXT,
    original_price_iqd INTEGER NOT NULL DEFAULT 0,
    buyer_discount_iqd INTEGER NOT NULL DEFAULT 0,
    referrer_reward_iqd INTEGER NOT NULL DEFAULT 0,
    reversed_amount_iqd INTEGER NOT NULL DEFAULT 0,
    buyer_percent_bps INTEGER NOT NULL DEFAULT 0,
    referrer_percent_bps INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'eligible',
    risk_score INTEGER NOT NULL DEFAULT 0, risk_verdict TEXT, blocked_reason TEXT,
    wallet_transaction_id TEXT, hold_until TEXT, approved_at TEXT, reversed_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_order_idx ON referral_rewards (order_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_item_idx ON referral_rewards (order_item_id)`,
  `CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON referral_rewards (referrer_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS referral_rewards_buyer_idx ON referral_rewards (buyer_user_id, status)`,
  `CREATE TABLE IF NOT EXISTS referral_risk_events (
    id TEXT PRIMARY KEY, attribution_id TEXT, reward_id TEXT, order_id TEXT,
    referrer_user_id TEXT, buyer_user_id TEXT, event_type TEXT NOT NULL,
    risk_score INTEGER NOT NULL DEFAULT 0, device_hash TEXT, ip_hash TEXT,
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS referral_risk_events_attr_idx ON referral_risk_events (attribution_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS referral_risk_events_order_idx ON referral_risk_events (order_id)`,
  /*
    Which devices, addresses and sessions an account has been seen on, and
    which members the admin has thrown out of the programme.

    One table for all three because the question is always the same shape — is
    this identity already attached to that account? — and because the device
    row in particular is what makes deleting a cookie pointless: the hash is
    re-derived on the server from the request itself, so the same phone lands
    on the same row whatever the browser is holding.
  */
  `CREATE TABLE IF NOT EXISTS referral_identity_links (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, identity_hash TEXT NOT NULL,
    user_id TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referral_identity_links_unique
     ON referral_identity_links (kind, identity_hash, user_id)`,
  `CREATE INDEX IF NOT EXISTS referral_identity_links_user_idx ON referral_identity_links (user_id, kind)`,
  `CREATE INDEX IF NOT EXISTS referral_identity_links_hash_idx ON referral_identity_links (kind, identity_hash)`,
  `CREATE TABLE IF NOT EXISTS referral_blocklist (
    user_id TEXT PRIMARY KEY, reason TEXT, blocked_by TEXT, created_at TEXT NOT NULL)`,
  /*
    Admin-only facts about a product, kept out of the product document.

    The Chinese supplier name is what an order is actually placed with, and it
    must never reach a customer, a public API, the search index or a cached
    page. It could have been a field on the product with a name on the redaction
    list — but every public path would then have to remember to strip it, and
    the one that forgets is the one that leaks. In its own table it is excluded
    by construction: `toPublicProduct` never sees it because `getStore` never
    loads it.

    `verification_status` is the gate the import rules turn on:
      - `verified`      a source was checked and agrees
      - `needs_review`  a name exists but nobody has confirmed it
      - `missing`       no name yet
    A product imported without a verified name stays hidden until an admin
    fills it in.
  */
  `CREATE TABLE IF NOT EXISTS product_admin_metadata (
    product_id TEXT PRIMARY KEY,
    supplier_name_zh_cn TEXT,
    supplier_name_zh_source_url TEXT,
    supplier_name_zh_verification_status TEXT NOT NULL DEFAULT 'missing',
    supplier_name_zh_verified_at TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS product_admin_metadata_status_idx
     ON product_admin_metadata (supplier_name_zh_verification_status)`,
  `CREATE TABLE IF NOT EXISTS product_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_type TEXT NOT NULL,
    product_name TEXT NOT NULL, game_id TEXT, platform TEXT, product_category TEXT,
    reference_url TEXT, notes TEXT, preferred_version TEXT, preferred_region TEXT,
    contact_method TEXT, status TEXT NOT NULL DEFAULT 'submitted', admin_note TEXT,
    user_visible_note TEXT, linked_product_id TEXT, status_history TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS product_requests_user_idx ON product_requests (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS product_requests_status_idx ON product_requests (status)`,
  `CREATE TABLE IF NOT EXISTS disc_trade_images (
    id TEXT PRIMARY KEY, trade_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
    url TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS delivery_events (
    id TEXT PRIMARY KEY, context_kind TEXT NOT NULL, context_id TEXT NOT NULL, event TEXT NOT NULL,
    actor TEXT, note TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS delivery_events_idx ON delivery_events (context_kind, context_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS game_extraction_phases (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, game_id TEXT, phase TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0,
    conflict INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'QUEUED', updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_extraction_phases_idx ON game_extraction_phases (job_id, phase)`,
  `CREATE TABLE IF NOT EXISTS game_sources (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, job_id TEXT, source_key TEXT,
    source_name TEXT NOT NULL, source_url TEXT NOT NULL, fields_json TEXT NOT NULL DEFAULT '[]',
    retrieved_at TEXT NOT NULL, confidence REAL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS game_sources_game_idx ON game_sources (game_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_sources_url_idx ON game_sources (game_id, source_url)`,
  `CREATE TABLE IF NOT EXISTS game_records (
    game_id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, english_title TEXT,
    japanese_title TEXT, normalized_name TEXT, aliases_json TEXT DEFAULT '[]',
    platform TEXT, edition TEXT, region TEXT, publisher TEXT, developer TEXT,
    release_date TEXT, release_status TEXT, nsuid TEXT, title_id TEXT,
    identity_confidence REAL DEFAULT 0, identity_sources_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS game_records_norm_idx ON game_records (normalized_name)`,
  `CREATE INDEX IF NOT EXISTS game_records_platform_idx ON game_records (platform)`,
  `CREATE TABLE IF NOT EXISTS game_device_performance (
    id TEXT PRIMARY KEY, game_id TEXT NOT NULL, hardware_id TEXT NOT NULL,
    device_name TEXT NOT NULL, device_slug TEXT NOT NULL, device_model TEXT,
    active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
    superseded_at TEXT, information_status TEXT NOT NULL DEFAULT 'available', unavailable_reason TEXT,
    handheld_supported INTEGER, handheld_resolution TEXT, handheld_rendering_resolution TEXT,
    handheld_output_resolution TEXT, handheld_fps TEXT, handheld_fps_min TEXT,
    handheld_fps_max TEXT, handheld_refresh_rate TEXT, handheld_hdr INTEGER,
    handheld_vrr INTEGER, handheld_notes TEXT, tv_supported INTEGER, tv_resolution TEXT,
    tv_rendering_resolution TEXT, tv_output_resolution TEXT, tv_fps TEXT, tv_fps_min TEXT,
    tv_fps_max TEXT, tv_refresh_rate TEXT, tv_hdr INTEGER, tv_vrr INTEGER, tv_notes TEXT,
    upscaling TEXT, ray_tracing INTEGER, ray_tracing_mode TEXT, loading_time TEXT,
    loading_notes TEXT, game_version TEXT, patch_version TEXT, tested_date TEXT,
    source_name TEXT, source_url TEXT, verification_status TEXT, verified_at TEXT,
    performance_notes TEXT, performance_summary TEXT NOT NULL DEFAULT '', data_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS game_device_performance_modes (
    id TEXT PRIMARY KEY, performance_id TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, handheld_resolution TEXT, handheld_fps TEXT, tv_resolution TEXT,
    tv_fps TEXT, hdr INTEGER, vrr INTEGER, notes TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (performance_id) REFERENCES game_device_performance(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_game_idx ON game_device_performance (game_id)`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_hardware_idx ON game_device_performance (hardware_id)`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_game_hardware_idx ON game_device_performance (game_id, hardware_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_device_performance_active_unique_idx ON game_device_performance (game_id, hardware_id) WHERE active = 1`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_device_slug_idx ON game_device_performance (device_slug, active)`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_verified_idx ON game_device_performance (verified_at DESC)`,
  `CREATE INDEX IF NOT EXISTS game_device_performance_modes_parent_idx ON game_device_performance_modes (performance_id, display_order)`,
  `CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_id TEXT NOT NULL, 
    quantity INTEGER NOT NULL DEFAULT 1, options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS cart_items_user_idx ON cart_items (user_id)`,
  `CREATE TABLE IF NOT EXISTS order_status_history (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, old_status TEXT, 
    new_status TEXT NOT NULL, changed_by TEXT NOT NULL, note TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history (order_id)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, 
    entity_type TEXT, entity_id TEXT, details TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, 
    body TEXT NOT NULL, type TEXT NOT NULL, reference_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, is_read)`,
  `CREATE TABLE IF NOT EXISTS staff_roles (
    user_id TEXT PRIMARY KEY, role TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_queue (
    id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
    assigned_staff_id TEXT, user_last_seen_at TEXT, admin_last_seen_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS order_queue_status_idx ON order_queue (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS telegram_links (
    user_id TEXT PRIMARY KEY,
    telegram_chat_id INTEGER UNIQUE NOT NULL,
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_phone TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    linked_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    telegram_chat_id INTEGER,
    telegram_user_id TEXT,
    used_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_verification_sessions (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    telegram_user_id TEXT,
    telegram_chat_id INTEGER,
    telegram_phone TEXT,
    token TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS tg_verif_owner_idx ON telegram_verification_sessions (owner_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tg_verif_token_idx ON telegram_verification_sessions (token)`,
  `CREATE TABLE IF NOT EXISTS telegram_otp_sessions (
    id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    user_id TEXT,
    telegram_chat_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS telegram_contests (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prize TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    winners_count INTEGER NOT NULL DEFAULT 1,
    required_channel_id INTEGER,
    draw_at TEXT,
    created_at TEXT NOT NULL,
    message_id INTEGER,
    channel_message_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_contest_entries (
    id TEXT PRIMARY KEY,
    contest_id TEXT NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    telegram_username TEXT,
    first_name TEXT,
    referred_by INTEGER,
    tickets INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(contest_id, telegram_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_contest_winners (
    id TEXT PRIMARY KEY,
    contest_id TEXT NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    telegram_username TEXT,
    first_name TEXT,
    won_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_contest_drafts (
    telegram_user_id INTEGER PRIMARY KEY,
    step TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS binance_topup_intents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expected_amount_atomic INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'verifying', 'credited', 'expired', 'cancelled', 'failed')
    ),
    bound_transaction_id TEXT UNIQUE,
    verify_attempts INTEGER NOT NULL DEFAULT 0,
    last_verify_at INTEGER,
    verify_started_at INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    credited_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_user ON binance_topup_intents(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_status ON binance_topup_intents(status)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_expiry ON binance_topup_intents(expires_at)`,
  `CREATE TABLE IF NOT EXISTS binance_topups (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    binance_transaction_id TEXT NOT NULL UNIQUE,
    amount_atomic INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    transaction_time INTEGER NOT NULL,
    order_type TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    credited_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_topups_user ON binance_topups(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_topups_tx ON binance_topups(binance_transaction_id)`,
  `CREATE TABLE IF NOT EXISTS binance_verification_logs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    intent_id TEXT,
    masked_tx_id TEXT,
    result TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    upstream_status INTEGER,
    rejection_code TEXT,
    client_ip_hash TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_logs_user ON binance_verification_logs(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_logs_intent ON binance_verification_logs(intent_id)`,
  // Legacy staging tables
  `CREATE TABLE IF NOT EXISTS legacy_users (
    id TEXT PRIMARY KEY, legacy_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    username TEXT, email TEXT, normalized_email TEXT, phone TEXT, normalized_phone TEXT,
    banana_balance INTEGER NOT NULL DEFAULT 0, store_credit_iqd INTEGER NOT NULL DEFAULT 0,
    claim_state TEXT NOT NULL DEFAULT 'unclaimed', claimed_by_user_id TEXT, claimed_at TEXT,
    legacy_created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_users_email ON legacy_users(normalized_email)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_users_phone ON legacy_users(normalized_phone)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_users_claimed ON legacy_users(claim_state, claimed_by_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_claims (
    id TEXT PRIMARY KEY, legacy_user_id TEXT UNIQUE NOT NULL, claimed_by_user_id TEXT NOT NULL,
    claim_type TEXT NOT NULL, claim_identifier TEXT NOT NULL, claimed_at TEXT NOT NULL,
    banana_transferred INTEGER NOT NULL DEFAULT 0, orders_linked INTEGER NOT NULL DEFAULT 0,
    threads_linked INTEGER NOT NULL DEFAULT 0, reviews_linked INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed', error_log TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_claims_user ON legacy_claims(claimed_by_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_banana_transactions (
    id TEXT PRIMARY KEY, legacy_id TEXT, legacy_user_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0, balance_after INTEGER NOT NULL DEFAULT 0,
    reason TEXT, type TEXT, created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_banana_tx_user ON legacy_banana_transactions(legacy_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_orders (
    id TEXT PRIMARY KEY, legacy_id TEXT UNIQUE NOT NULL, legacy_user_id TEXT NOT NULL,
    claimed_by_user_id TEXT, order_no TEXT, status TEXT NOT NULL DEFAULT 'completed',
    legacy_original_status TEXT, migration_archive INTEGER NOT NULL DEFAULT 1,
    total_iqd INTEGER NOT NULL DEFAULT 0, total_usd REAL NOT NULL DEFAULT 0,
    payment_method TEXT, created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_orders_user ON legacy_orders(legacy_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_orders_claimed_user ON legacy_orders(claimed_by_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_order_items (
    id TEXT PRIMARY KEY, legacy_order_id TEXT NOT NULL, product_id TEXT,
    product_name TEXT NOT NULL DEFAULT '', platform TEXT, unit_price REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'account', raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_order_items_order ON legacy_order_items(legacy_order_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_threads (
    id TEXT PRIMARY KEY, legacy_id TEXT UNIQUE NOT NULL, legacy_user_id TEXT NOT NULL,
    claimed_by_user_id TEXT, subject TEXT, order_id TEXT, status TEXT NOT NULL DEFAULT 'closed',
    mode TEXT NOT NULL DEFAULT 'RESOLVED', ai_paused INTEGER NOT NULL DEFAULT 1,
    needs_admin INTEGER NOT NULL DEFAULT 0, migration_archive INTEGER NOT NULL DEFAULT 1,
    legacy_original_status TEXT, created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_threads_user ON legacy_threads(legacy_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_threads_claimed_user ON legacy_threads(claimed_by_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_messages (
    id TEXT PRIMARY KEY, legacy_thread_id TEXT NOT NULL, sender_role TEXT NOT NULL DEFAULT 'assistant',
    sender_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL DEFAULT '{}', data_json TEXT, created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_messages_thread ON legacy_messages(legacy_thread_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_reviews (
    id TEXT PRIMARY KEY, legacy_id TEXT UNIQUE NOT NULL, legacy_user_id TEXT NOT NULL,
    claimed_by_user_id TEXT, product_id TEXT, legacy_game_id TEXT, legacy_game_name TEXT,
    slug TEXT, platform TEXT, rating INTEGER NOT NULL DEFAULT 5, comment TEXT,
    status TEXT NOT NULL DEFAULT 'approved', is_approved INTEGER NOT NULL DEFAULT 1,
    unresolved INTEGER NOT NULL DEFAULT 1, matched_game_id TEXT, matched_method TEXT,
    created_at TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_reviews_product ON legacy_reviews(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_reviews_user ON legacy_reviews(legacy_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_review_images (
    id TEXT PRIMARY KEY, legacy_review_id TEXT NOT NULL, image_url TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'product_photo', is_private INTEGER NOT NULL DEFAULT 0,
    r2_storage TEXT NOT NULL DEFAULT 'BANANTO_BUCKET', r2_key TEXT, raw_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_review_images_review ON legacy_review_images(legacy_review_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_media (
    id TEXT PRIMARY KEY, original_url TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'product_photo',
    v4_target_storage TEXT NOT NULL DEFAULT 'BANANTO_BUCKET', v4_target_key TEXT NOT NULL,
    v4_access_policy TEXT NOT NULL DEFAULT 'public', legacy_user_id TEXT,
    claimed_by_user_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error_log TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_media_user ON legacy_media(legacy_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_legacy_media_claimed ON legacy_media(claimed_by_user_id)`,
  `CREATE TABLE IF NOT EXISTS legacy_import_runs (
    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT,
    is_dry_run INTEGER NOT NULL DEFAULT 1, counts_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending', logs TEXT
  )`,
];

/**
 * Statements that are expected to fail once they have already been applied
 * (SQLite has no `ADD COLUMN IF NOT EXISTS`), so their errors are swallowed.
 */
const SCHEMA_PATCHES: string[] = [
  /*
    The admin products table, as a table.

    The catalogue itself stays in `store_kv` — see product-index.server.ts for
    why. This is the narrow projection the listing is read from, so rendering
    fifty rows is two indexed queries instead of parsing the whole document.
  */
  `CREATE TABLE IF NOT EXISTS product_index (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     title_en TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL DEFAULT '',
     category_id TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT '',
     schema_id TEXT NOT NULL DEFAULT '',
     platform TEXT NOT NULL DEFAULT '',
     price REAL,
     cost REAL,
     stock INTEGER,
     infinite_stock INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT '',
     sales INTEGER NOT NULL DEFAULT 0,
     image TEXT NOT NULL DEFAULT '',
     display_order INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     release_date TEXT NOT NULL DEFAULT '',
     sort_name TEXT NOT NULL DEFAULT '',
     sort_updated INTEGER,
     sort_release INTEGER,
     sort_rank INTEGER NOT NULL DEFAULT 0,
     performance_required INTEGER NOT NULL DEFAULT 0,
     rev INTEGER NOT NULL DEFAULT 0
   )`,
  // One index per column *and direction* the table can be ordered by, each
  // declaring the same leading expression as the ORDER BY it serves. Without
  // the expression (`price IS NULL` — missing values sort last in both
  // directions) SQLite cannot use the index and sorts the whole table to
  // return one page, which is the cost this set exists to avoid. Verified by
  // EXPLAIN QUERY PLAN in product-index.test.ts.
  `CREATE INDEX IF NOT EXISTS idx_pi_updated_desc ON product_index (sort_updated IS NULL, sort_updated DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_updated_asc ON product_index (sort_updated IS NULL, sort_updated, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_price_desc ON product_index (price IS NULL, price DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_price_asc ON product_index (price IS NULL, price, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_name_desc ON product_index (sort_name = '', sort_name DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_name_asc ON product_index (sort_name = '', sort_name, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_rank_desc ON product_index (display_order DESC, sort_rank DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_rank_asc ON product_index (display_order, sort_rank, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_category ON product_index (category_id, display_order DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_hidden ON product_index (hidden, sort_updated DESC)`,
  `CREATE TABLE IF NOT EXISTS store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`,
  `ALTER TABLE users ADD COLUMN wallet_balance REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN banana_balance INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN banana_locked INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN birth_date TEXT`,
  `ALTER TABLE users ADD COLUMN gender TEXT`,
  `ALTER TABLE users ADD COLUMN username TEXT`,
  `ALTER TABLE users ADD COLUMN phone_verified_at TEXT`,
  `ALTER TABLE users ADD COLUMN member_no TEXT`,
  `ALTER TABLE users ADD COLUMN preferred_genres TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE users ADD COLUMN profile_completed_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_idx ON users (phone)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_member_no_idx ON users (member_no)`,
  `ALTER TABLE orders ADD COLUMN cancelled_at TEXT`,
  `ALTER TABLE orders ADD COLUMN idempotency_key TEXT`,
  `ALTER TABLE orders ADD COLUMN checkout_session_id TEXT`,
  `ALTER TABLE orders ADD COLUMN payment_reference TEXT`,
  `ALTER TABLE orders ADD COLUMN source TEXT`,
  `ALTER TABLE orders ADD COLUMN created_by TEXT`,
  `ALTER TABLE orders ADD COLUMN last_otp_sent_at TEXT`,
  `ALTER TABLE orders ADD COLUMN auto_complete_at TEXT`,
  `ALTER TABLE orders ADD COLUMN customer_confirmed_at TEXT`,
  `ALTER TABLE orders ADD COLUMN auto_completed_at TEXT`,
  `ALTER TABLE orders ADD COLUMN delivery_issue_opened_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL`,
  // migrations/0002_otp_phone.sql created otp_codes with only
  // (id, phone, purpose, code_hash, expires_at, attempts, created_at).
  // `CREATE TABLE IF NOT EXISTS` in SCHEMA never widens that table, so every
  // INSERT naming the newer columns failed with "no such column" and surfaced
  // as a generic 500 on the whole verification flow.
  `ALTER TABLE otp_codes ADD COLUMN user_id TEXT`,
  `ALTER TABLE otp_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'`,
  `ALTER TABLE otp_codes ADD COLUMN destination TEXT`,
  `ALTER TABLE otp_codes ADD COLUMN verified_at TEXT`,
  `CREATE INDEX IF NOT EXISTS otp_user_idx ON otp_codes (user_id)`,
  // Telegram identity columns (added after telegram_links shipped)
  `ALTER TABLE telegram_links ADD COLUMN telegram_user_id TEXT`,
  `ALTER TABLE telegram_links ADD COLUMN verified INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE telegram_links ADD COLUMN updated_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_chat_idx ON telegram_links (telegram_chat_id)`,
  `CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx ON telegram_link_tokens (user_id)`,
  // Ownership-proof columns for /start <token> deep-link verification
  `ALTER TABLE telegram_link_tokens ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE telegram_link_tokens ADD COLUMN telegram_chat_id INTEGER`,
  `ALTER TABLE telegram_link_tokens ADD COLUMN telegram_user_id TEXT`,
  `ALTER TABLE telegram_link_tokens ADD COLUMN used_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_telegram_otp_sessions_token ON telegram_otp_sessions (session_token)`,
  `CREATE INDEX IF NOT EXISTS idx_telegram_otp_sessions_phone ON telegram_otp_sessions (phone)`,
  // Contests gained a publishing target (channel or group topic) and a record
  // of who created them once the operator could create one from the bot.
  `ALTER TABLE telegram_contests ADD COLUMN channel_id TEXT`,
  `ALTER TABLE telegram_contests ADD COLUMN message_thread_id INTEGER`,
  `ALTER TABLE telegram_contests ADD COLUMN created_by TEXT`,
  // Wallet top-up review trail. Without these, an approved request records no
  // reviewer, no timestamp and no credited amount, so there is nothing to audit
  // after the money has moved.
  `ALTER TABLE recharge_requests ADD COLUMN reviewed_by TEXT`,
  `ALTER TABLE recharge_requests ADD COLUMN reviewed_by_name TEXT`,
  `ALTER TABLE recharge_requests ADD COLUMN reviewed_at TEXT`,
  `ALTER TABLE recharge_requests ADD COLUMN review_source TEXT`,
  `ALTER TABLE recharge_requests ADD COLUMN credited_amount REAL`,
  `CREATE INDEX IF NOT EXISTS recharge_requests_status_idx ON recharge_requests (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS recharge_requests_user_idx ON recharge_requests (user_id)`,
  // banana_rewards created before the catalogue gained categories/ordering
  `ALTER TABLE banana_rewards ADD COLUMN icon TEXT NOT NULL DEFAULT '🍌'`,
  `ALTER TABLE banana_rewards ADD COLUMN category TEXT NOT NULL DEFAULT 'digital'`,
  `ALTER TABLE banana_rewards ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE banana_rewards ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE banana_rewards ADD COLUMN stock INTEGER NOT NULL DEFAULT -1`,
  `ALTER TABLE banana_rewards ADD COLUMN description TEXT DEFAULT ''`,
  `ALTER TABLE banana_rewards ADD COLUMN coupon_value REAL DEFAULT 0`,
  `ALTER TABLE banana_rewards ADD COLUMN coupon_type TEXT DEFAULT ''`,
  `ALTER TABLE banana_rewards ADD COLUMN reward_code TEXT DEFAULT ''`,
  `ALTER TABLE banana_redemptions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`,
  `ALTER TABLE banana_redemptions ADD COLUMN admin_notes TEXT`,
  `ALTER TABLE banana_redemptions ADD COLUMN delivery_code TEXT`,
  `ALTER TABLE banana_redemptions ADD COLUMN updated_at TEXT`,
  // banana_listings created before privacy/promotion flags existed
  `ALTER TABLE banana_listings ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE banana_listings ADD COLUMN is_promoted INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE banana_listings ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE banana_listings ADD COLUMN price_per REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE banana_listings ADD COLUMN promoted_until TEXT`,
  // disc trades
  `CREATE TABLE IF NOT EXISTS disc_trades (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', valuation_iqd INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS disc_trades_user_idx ON disc_trades (user_id, created_at DESC)`,
  `ALTER TABLE disc_trades ADD COLUMN platform TEXT NOT NULL DEFAULT 'Nintendo Switch'`,
  `ALTER TABLE disc_trades ADD COLUMN condition TEXT NOT NULL DEFAULT 'like_new'`,
  `ALTER TABLE disc_trades ADD COLUMN notes TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN photo_url TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN preferred_trade TEXT`,
  // legacy platform import (users migrated from the old store)
  `ALTER TABLE users ADD COLUMN wallet_iqd INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN contact_enc TEXT`,
  `ALTER TABLE users ADD COLUMN legacy_id TEXT`,
  `ALTER TABLE users ADD COLUMN must_reset_password INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN publisher TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN release_date TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN description_en TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN genres TEXT DEFAULT '[]'`,
  `ALTER TABLE game_catalog ADD COLUMN game_id TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN canonical_name TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN english_name TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN japanese_name TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN normalized_name TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN base_normalized TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN base_game_id TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN slug TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN switch_version TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN edition TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN region TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN developer TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN franchise TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN box_front_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN box_back_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN trailer_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN official_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN eshop_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN nsuid TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN title_id TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN product_code TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN players TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN modes TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN language_support TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN age_rating TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN trade_value_source TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN trade_value_updated_at TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN store_offer_bonus_iqd INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN trade_value_locked INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN trade_enabled INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE game_catalog ADD COLUMN ai_suggested_trade_iqd INTEGER`,
  `ALTER TABLE game_catalog ADD COLUMN completeness INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN is_active INTEGER DEFAULT 1`,
  `ALTER TABLE game_catalog ADD COLUMN needs_review INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN metacritic_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN updated_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS game_catalog_game_id_idx ON game_catalog (game_id)`,
  `CREATE INDEX IF NOT EXISTS game_catalog_norm_idx ON game_catalog (normalized_name)`,
  `CREATE INDEX IF NOT EXISTS game_catalog_base_idx ON game_catalog (base_normalized)`,
  `ALTER TABLE disc_trades ADD COLUMN game_id TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN selections TEXT DEFAULT '{}'`,
  `ALTER TABLE disc_trades ADD COLUMN base_iqd INTEGER`,
  `ALTER TABLE disc_trades ADD COLUMN final_iqd INTEGER`,
  `ALTER TABLE disc_trades ADD COLUMN admin_valuation_iqd INTEGER`,
  `ALTER TABLE disc_trades ADD COLUMN payout_type TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN status_history TEXT DEFAULT '[]'`,
  `ALTER TABLE disc_trades ADD COLUMN admin_notes TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN thread_id TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN store_offer_bonus_iqd INTEGER DEFAULT 0`,
  `ALTER TABLE disc_trades ADD COLUMN store_offer_total_iqd INTEGER`,
  `ALTER TABLE game_price_history ADD COLUMN old_store_bonus_iqd INTEGER`,
  `ALTER TABLE game_price_history ADD COLUMN new_store_bonus_iqd INTEGER`,
  `ALTER TABLE game_field_audits ADD COLUMN game_id TEXT`,
  `ALTER TABLE game_field_audits ADD COLUMN status TEXT DEFAULT 'verified'`,
  `ALTER TABLE game_field_audits ADD COLUMN attempted_sources TEXT DEFAULT '[]'`,
  `ALTER TABLE game_field_audits ADD COLUMN failure_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS game_field_audits_game_idx ON game_field_audits (game_id, field_name)`,
  `ALTER TABLE messages ADD COLUMN context_kind TEXT DEFAULT 'general'`,
  `ALTER TABLE messages ADD COLUMN context_id TEXT`,
  `ALTER TABLE messages ADD COLUMN internal INTEGER DEFAULT 0`,
  // migrations/0037_message_idempotency.sql added client_message_id, but the
  // CREATE TABLE above only carries it for a database created from scratch:
  // `CREATE TABLE IF NOT EXISTS` never widens an existing table. Without this
  // ALTER, every INSERT in appendMessage names a column an older database does
  // not have, so *every* message — assistant, admin, order — fails with a 500
  // and the member sees nothing but "retry".
  `ALTER TABLE messages ADD COLUMN client_message_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_client_msg_idx ON messages (thread_id, client_message_id) WHERE client_message_id IS NOT NULL`,
  // The same omission, found by the migration-coverage test, for every other
  // column a migration added after its table already existed in the wild.
  // wallet_transactions.reference_* is the one that matters most: without it a
  // top-up approval fails the moment it tries to record what it credited.
  `ALTER TABLE wallet_transactions ADD COLUMN reference_type TEXT`,
  `ALTER TABLE wallet_transactions ADD COLUMN reference_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_ref_idx ON wallet_transactions (reference_type, reference_id) WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL`,
  `ALTER TABLE users ADD COLUMN friend_id TEXT`,
  `ALTER TABLE users ADD COLUMN email_verified_at TEXT`,
  `ALTER TABLE users ADD COLUMN referred_by_user_id TEXT`,
  `ALTER TABLE users ADD COLUMN referral_discount_used_at TEXT`,
  `ALTER TABLE users ADD COLUMN first_referral_order_id TEXT`,
  `CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by_user_id)`,
  `ALTER TABLE legacy_claims ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE legacy_claims ADD COLUMN last_error_code TEXT`,
  `ALTER TABLE legacy_claims ADD COLUMN updated_at TEXT`,
  `ALTER TABLE legacy_claims ADD COLUMN completed_at TEXT`,
  // 20260813_deep_catalog.sql ends in Postgres-style GRANT statements, which D1
  // rejects, so its ALTERs cannot be relied on having run. Repeat them here
  // where a failure on an already-applied statement is expected and swallowed.
  `ALTER TABLE game_catalog ADD COLUMN cover_box_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN cover_front_url TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN metacritic_score REAL`,
  `ALTER TABLE game_catalog ADD COLUMN opencritic_score REAL`,
  `ALTER TABLE game_catalog ADD COLUMN user_score REAL`,
  `ALTER TABLE game_catalog ADD COLUMN size_gb REAL`,
  `ALTER TABLE game_catalog ADD COLUMN players_count TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN languages_json TEXT`,
  `ALTER TABLE game_catalog ADD COLUMN is_preorder INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN is_switch2_enhanced INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN upgrade_price_iqd INTEGER`,
  `ALTER TABLE game_catalog ADD COLUMN game_is_offline INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN game_is_online INTEGER DEFAULT 0`,
  `ALTER TABLE game_catalog ADD COLUMN game_language_locked INTEGER DEFAULT 0`,
  // extraction engine: per-field provenance and phase progress
  `ALTER TABLE game_extraction_jobs ADD COLUMN phase TEXT`,
  `ALTER TABLE game_extraction_jobs ADD COLUMN identity_json TEXT`,
  `ALTER TABLE game_extraction_jobs ADD COLUMN summary_json TEXT`,
  `ALTER TABLE game_extraction_jobs ADD COLUMN notes TEXT`,
  `ALTER TABLE game_field_audits ADD COLUMN phase TEXT`,
  `ALTER TABLE game_field_audits ADD COLUMN value_type TEXT`,
  `ALTER TABLE game_field_audits ADD COLUMN confidence_score REAL DEFAULT 0`,
  `ALTER TABLE game_field_audits ADD COLUMN observations TEXT DEFAULT '[]'`,
  `ALTER TABLE game_field_audits ADD COLUMN retrieved_at TEXT`,
  `CREATE INDEX IF NOT EXISTS game_field_audits_job_idx ON game_field_audits (job_id, field_name)`,
  `CREATE INDEX IF NOT EXISTS game_field_audits_status_idx ON game_field_audits (status)`,
  `ALTER TABLE game_images ADD COLUMN job_id TEXT`,
  `ALTER TABLE game_images ADD COLUMN width INTEGER`,
  `ALTER TABLE game_images ADD COLUMN height INTEGER`,
  `ALTER TABLE game_images ADD COLUMN tier TEXT`,
  `ALTER TABLE game_images ADD COLUMN description TEXT`,

  // --- STORE PROTOCOL PART 2: REVIEWS, COUPONS, BANANA MARKET, CONTENT, REQUESTS ---

  // 1. Reviews & Coupons
  `ALTER TABLE product_reviews ADD COLUMN screenshot_url TEXT`,
  `ALTER TABLE product_reviews ADD COLUMN instagram_proof_url TEXT`,
  `ALTER TABLE product_reviews ADD COLUMN is_auto_review INTEGER DEFAULT 0`,
  `ALTER TABLE product_reviews ADD COLUMN review_due_at TEXT`,
  `ALTER TABLE product_reviews ADD COLUMN approved_at TEXT`,
  `ALTER TABLE product_reviews ADD COLUMN approved_by TEXT`,
  `ALTER TABLE product_reviews ADD COLUMN updated_at TEXT`,

  `CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, discount_type TEXT NOT NULL, 
    discount_value REAL NOT NULL, start_at TEXT, expiration_at TEXT, usage_limit INTEGER, 
    per_user_limit INTEGER DEFAULT 1, eligible_products TEXT DEFAULT '[]', 
    eligible_categories TEXT DEFAULT '[]', eligible_users TEXT DEFAULT '[]',
    min_order_amount REAL DEFAULT 0, max_discount_amount REAL,
    is_active INTEGER DEFAULT 1, only_digital_products INTEGER DEFAULT 0,
    is_stackable INTEGER DEFAULT 0, once_per_user_lifetime INTEGER DEFAULT 0,
    created_at TEXT NOT NULL)`,

  `ALTER TABLE coupons ADD COLUMN only_digital_products INTEGER DEFAULT 0`,
  `ALTER TABLE coupons ADD COLUMN start_at TEXT`,
  `ALTER TABLE coupons ADD COLUMN is_stackable INTEGER DEFAULT 0`,
  `ALTER TABLE coupons ADD COLUMN once_per_user_lifetime INTEGER DEFAULT 0`,
  // Global usage counter, so the total cap can be claimed atomically instead of
  // counted. NULL means "never counted yet" and readers fall back to COUNT(*).
  `ALTER TABLE coupons ADD COLUMN total_uses INTEGER DEFAULT 0`,

  `CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL, coupon_type TEXT, user_id TEXT NOT NULL, 
    order_id TEXT NOT NULL, discount_amount REAL, target_product_id TEXT, created_at TEXT NOT NULL,
    UNIQUE(coupon_id, user_id, order_id))`,
  `ALTER TABLE coupon_redemptions ADD COLUMN coupon_type TEXT`,
  `ALTER TABLE coupon_redemptions ADD COLUMN discount_amount REAL`,
  `ALTER TABLE coupon_redemptions ADD COLUMN target_product_id TEXT`,
  /* Which option the discounted copy was bought with, for the audit trail. */
  `ALTER TABLE coupon_redemptions ADD COLUMN variant_id TEXT`,
  /* Restricts a coupon to one game bought with the Offline account option. */
  `ALTER TABLE coupons ADD COLUMN offline_account_only INTEGER DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON coupon_redemptions(user_id, coupon_type)`,

  /*
    Per-member coupon usage.

    The primary key is exactly the pair the "once per customer" rule is about,
    which is what makes the limit enforceable by claiming a row rather than
    counting rows and hoping nobody else is checking out at the same moment.
    `coupon_redemptions` remains the per-order audit trail; this is the counter
    the rule is decided on.
  */
  `CREATE TABLE IF NOT EXISTS coupon_user_usage (
    coupon_id TEXT NOT NULL, user_id TEXT NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0,
    first_used_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
    PRIMARY KEY (coupon_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS coupon_user_usage_user_idx ON coupon_user_usage (user_id)`,

  `CREATE TABLE IF NOT EXISTS review_cooldowns (
    user_id TEXT PRIMARY KEY, last_rewarded_at TEXT NOT NULL)`,

  // 2. Banana Ledger & Marketplace
  `CREATE TABLE IF NOT EXISTS banana_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL,
    type TEXT NOT NULL, direction TEXT NOT NULL, balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL, reference_type TEXT, reference_id TEXT,
    status TEXT DEFAULT 'completed', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS banana_ledger_user_idx ON banana_ledger (user_id, created_at DESC)`,

  `ALTER TABLE banana_wallets ADD COLUMN locked_balance INTEGER NOT NULL DEFAULT 0`,

  `CREATE TABLE IF NOT EXISTS banana_market_offers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, quantity INTEGER NOT NULL,
    price_iqd REAL NOT NULL, locked_banana INTEGER NOT NULL, 
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS banana_market_offers_status_idx ON banana_market_offers (status, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS banana_price_history (
    id TEXT PRIMARY KEY, old_price REAL, new_price REAL NOT NULL, 
    changed_by TEXT NOT NULL, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS banana_redemption_offers (
    id TEXT PRIMARY KEY, product_id TEXT, title TEXT NOT NULL, description TEXT,
    image_url TEXT, banana_price INTEGER NOT NULL, stock INTEGER DEFAULT -1,
    quantity_limit INTEGER DEFAULT 1, start_date TEXT, end_date TEXT,
    is_active INTEGER DEFAULT 1, only_digital_products INTEGER DEFAULT 0, created_at TEXT NOT NULL)`,

  // 3. Banana Bots
  `CREATE TABLE IF NOT EXISTS banana_bots (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, budget_iqd REAL DEFAULT 0,
    max_trade_banana INTEGER, daily_limit_banana INTEGER,
    max_total_banana INTEGER, min_price_iqd REAL, max_purchase_price_iqd REAL,
    delay_strategy_json TEXT, trading_schedule_json TEXT,
    is_active INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS bot_activity_logs (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, action TEXT NOT NULL,
    details TEXT, created_at TEXT NOT NULL)`,

  // 4. Content Management
  `CREATE TABLE IF NOT EXISTS store_banners (
    id TEXT PRIMARY KEY, image_url TEXT NOT NULL, title TEXT, description TEXT,
    target_url TEXT, start_date TEXT, end_date TEXT, priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, only_digital_products INTEGER DEFAULT 0, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS store_guides (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    content_html TEXT NOT NULL, category TEXT, images_json TEXT DEFAULT '[]',
    video_url TEXT, priority INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS problem_solutions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    steps_json TEXT NOT NULL, images_json TEXT DEFAULT '[]', video_url TEXT,
    related_product_id TEXT, tags_json TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS store_assets (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
    url TEXT NOT NULL, volume REAL DEFAULT 1.0, priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, only_digital_products INTEGER DEFAULT 0, created_at TEXT NOT NULL)`,

  // 5. Game Requests
  `CREATE TABLE IF NOT EXISTS game_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_name TEXT NOT NULL,
    edition TEXT, platform TEXT, image_url TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending', admin_notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,

  // 6. Notifications & Audits
  /*
    `notifications` is declared earlier in this array with `type` and
    `reference_id`. A second `CREATE TABLE IF NOT EXISTS` for the same name
    never runs, so this one only ever misled the code that wrote `link` into a
    table that has no such column — which is why no in-app notification was
    ever stored. Removed rather than reconciled: one definition, or neither is
    trustworthy.
  */

  /*
    The same definition as the one in SCHEMA above, kept identical rather than
    reconciled after the fact — this is the pair that disagreed. The `ALTER`s
    are what actually repair an already-created table, since a second
    `CREATE TABLE IF NOT EXISTS` never widens one.
  */
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, old_value TEXT, new_value TEXT,
    details TEXT, created_at TEXT NOT NULL)`,
  `ALTER TABLE audit_logs ADD COLUMN old_value TEXT`,
  `ALTER TABLE audit_logs ADD COLUMN new_value TEXT`,
  `CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id)`,

  // --- DATA PERSISTENCE & ACTIVITY HISTORY ---
  `CREATE TABLE IF NOT EXISTS user_activity_log (
    id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT, activity_type TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, action TEXT NOT NULL, metadata_json TEXT DEFAULT '{}',
    ip_hash TEXT, user_agent TEXT, device_type TEXT, browser TEXT, os TEXT,
    referrer TEXT, path TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS user_activity_log_user_idx ON user_activity_log (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS browsing_history (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, path TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, metadata_json TEXT DEFAULT '{}',
    referrer TEXT, duration_seconds INTEGER, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS browsing_history_user_idx ON browsing_history (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL,
    filters_json TEXT DEFAULT '{}', category TEXT, results_count INTEGER,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS product_interactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_id TEXT NOT NULL,
    interaction_type TEXT NOT NULL, metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS product_interactions_user_idx ON product_interactions (user_id, product_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_info_json TEXT DEFAULT '{}',
    ip_hash TEXT, last_seen_at TEXT NOT NULL, expires_at TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS login_history (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
    provider TEXT, device_info_json TEXT DEFAULT '{}', ip_hash TEXT,
    region TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_history_user_idx ON login_history (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS order_items_snapshot (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
    title TEXT NOT NULL, price_iqd INTEGER NOT NULL, quantity INTEGER NOT NULL,
    options_json TEXT DEFAULT '{}', image_url TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS order_items_snapshot_order_idx ON order_items_snapshot (order_id)`,

  `CREATE TABLE IF NOT EXISTS wallet_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL NOT NULL,
    type TEXT NOT NULL, balance_before REAL NOT NULL, balance_after REAL NOT NULL,
    reference_type TEXT, reference_id TEXT, description TEXT,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS order_status_history_v2 (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, old_status TEXT,
    new_status TEXT NOT NULL, changed_by_user_id TEXT,
    changed_by_role TEXT NOT NULL, reason TEXT, metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS order_status_history_v2_order_idx ON order_status_history_v2 (order_id, created_at DESC)`,
  `ALTER TABLE telegram_verification_sessions ADD COLUMN token TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tg_verif_token_idx ON telegram_verification_sessions (token)`,
  `CREATE TABLE IF NOT EXISTS binance_topup_intents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expected_amount_atomic INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'verifying', 'credited', 'expired', 'cancelled', 'failed')
    ),
    bound_transaction_id TEXT UNIQUE,
    verify_attempts INTEGER NOT NULL DEFAULT 0,
    last_verify_at INTEGER,
    verify_started_at INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    credited_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_user ON binance_topup_intents(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_status ON binance_topup_intents(status)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_intent_expiry ON binance_topup_intents(expires_at)`,
  `CREATE TABLE IF NOT EXISTS binance_topups (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    binance_transaction_id TEXT NOT NULL UNIQUE,
    amount_atomic INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    transaction_time INTEGER NOT NULL,
    order_type TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    credited_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_topups_user ON binance_topups(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_topups_tx ON binance_topups(binance_transaction_id)`,
  `CREATE TABLE IF NOT EXISTS binance_verification_logs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    intent_id TEXT,
    masked_tx_id TEXT,
    result TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    upstream_status INTEGER,
    rejection_code TEXT,
    client_ip_hash TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_logs_user ON binance_verification_logs(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_binance_logs_intent ON binance_verification_logs(intent_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_unique_ref ON wallet_ledger (reference_type, reference_id)`,

  // Columns the application writes that no CREATE TABLE or migration ever
  // added. Every statement touching them failed at runtime — disc trade
  // submission, the trade payout batch, the market offer buyer, and the
  // legacy claim lock — so these features were dead on a real database.
  `ALTER TABLE disc_trades ADD COLUMN box_condition TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN region TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN accessories TEXT DEFAULT '[]'`,
  `ALTER TABLE disc_trades ADD COLUMN damage TEXT`,
  /*
    Pricing model for a trade request.

    `pricing_mode` decides which of the two flows a request follows and which
    badge its card shows. `final_iqd` stays the *estimate*; `approved_iqd` is
    the number the business actually committed to, and is only written when an
    admin approves — which is what lets the card show "السعر التقريبي" and
    "السعر المعتمد" as two separate, honest lines instead of one ambiguous
    "غير مسعر".
  */
  `ALTER TABLE disc_trades ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE disc_trades ADD COLUMN approved_iqd INTEGER`,
  `ALTER TABLE disc_trades ADD COLUMN priced_at TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN approved_at TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN customer_approved_at TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN shipping_option TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN payout_credited INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE disc_trades ADD COLUMN payout_credited_at TEXT`,
  `ALTER TABLE disc_trades ADD COLUMN payout_amount_credited INTEGER`,
  `ALTER TABLE banana_market_offers ADD COLUMN buyer_id TEXT`,
  `ALTER TABLE banana_redemption_offers ADD COLUMN updated_at TEXT`,
  `ALTER TABLE legacy_users ADD COLUMN claim_started_at TEXT`,
  // Per-step checkpoints for claimLegacyAccount. Without them every read of
  // claim.<step>_done was undefined and every write was a no-op, so a claim
  // re-imported all orders, threads and reviews on every single sign-in.
  `ALTER TABLE legacy_claims ADD COLUMN banana_done INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE legacy_claims ADD COLUMN orders_done INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE legacy_claims ADD COLUMN threads_done INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE legacy_claims ADD COLUMN reviews_done INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE legacy_claims ADD COLUMN media_done INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE legacy_claims ADD COLUMN created_at TEXT`,
  `ALTER TABLE game_records ADD COLUMN game_is_offline INTEGER`,
  `ALTER TABLE game_records ADD COLUMN game_is_online INTEGER`,
  `ALTER TABLE game_records ADD COLUMN game_language_locked INTEGER`,
  `ALTER TABLE orders ADD COLUMN cancelled_at TEXT`,
  `ALTER TABLE orders ADD COLUMN idempotency_key TEXT`,
  `ALTER TABLE orders ADD COLUMN checkout_session_id TEXT`,
  `ALTER TABLE orders ADD COLUMN payment_reference TEXT`,
  `ALTER TABLE orders ADD COLUMN source TEXT`,
  `ALTER TABLE orders ADD COLUMN created_by TEXT`,
  /*
    The catalogue lives in a JSON document, so a read-then-write duplicate check
    in the API can be raced by two concurrent saves. This table is the atomic
    half: one row per product identity, with the uniqueness the JSON blob
    cannot enforce. It holds keys only — the product itself stays where it is.
  */
  `CREATE TABLE IF NOT EXISTS product_identity (
    product_id TEXT PRIMARY KEY,
    normalized_title TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT,
    updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS product_identity_key_idx
     ON product_identity (normalized_title, platform)`,
  `CREATE INDEX IF NOT EXISTS orders_cancelled_idx ON orders (status, cancelled_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL`,
];

/**
 * Tables an earlier migration created with different column names
 * (`banana_listings.seller_id`, `banana_wallets.bananas`, ...). SQLite cannot
 * relax the old NOT NULL columns, so an incompatible table is renamed aside
 * and recreated by SCHEMA below.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  banana_wallets: ["user_id", "balance"],
  banana_listings: ["user_id", "quantity", "price_per", "status"],
  banana_redemptions: ["user_id", "reward_id", "cost"],
  banana_rewards: ["id", "title", "cost", "category", "is_active", "sort_order"],
};

async function retireLegacyTables(db: D1Like) {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    let columns: { name?: unknown; notnull?: unknown; dflt_value?: unknown }[] = [];
    try {
      columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).results ?? [];
    } catch {
      continue;
    }
    if (!columns.length) continue;
    const names = columns.map((c) => String(c.name));
    const missing = required.some((c) => !names.includes(c));
    // A leftover NOT NULL column without a default breaks every new insert.
    const blocking = columns.some(
      (c) =>
        Number(c.notnull) === 1 &&
        c.dflt_value == null &&
        !required.includes(String(c.name)) &&
        String(c.name) !== "created_at",
    );
    if (!missing && !blocking) continue;
    try {
      await db.prepare(`ALTER TABLE ${table} RENAME TO ${table}_legacy_${Date.now()}`).run();
    } catch {
      // Rename failed — leave the table as-is rather than lose data.
    }
  }
}

let schemaPromise: Promise<void> | undefined;

const TELEGRAM_TABLES = [
  `CREATE TABLE IF NOT EXISTS telegram_links (
    user_id TEXT PRIMARY KEY, telegram_chat_id INTEGER UNIQUE NOT NULL,
    telegram_user_id TEXT, telegram_username TEXT, telegram_phone TEXT,
    verified INTEGER NOT NULL DEFAULT 0, linked_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    telegram_chat_id INTEGER, telegram_user_id TEXT, used_at TEXT,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telegram_verification_sessions (
    id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', telegram_user_id TEXT,
    telegram_chat_id INTEGER, telegram_phone TEXT, token TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, verified_at TEXT)`,
] as const;

const TELEGRAM_COLUMNS: Record<string, Record<string, string>> = {
  telegram_links: {
    telegram_user_id: "TEXT",
    telegram_username: "TEXT",
    telegram_phone: "TEXT",
    verified: "INTEGER NOT NULL DEFAULT 0",
    linked_at: "TEXT",
    updated_at: "TEXT",
  },
  telegram_link_tokens: {
    status: "TEXT NOT NULL DEFAULT 'pending'",
    telegram_chat_id: "INTEGER",
    telegram_user_id: "TEXT",
    used_at: "TEXT",
  },
  telegram_verification_sessions: {
    token: "TEXT",
    telegram_user_id: "TEXT",
    telegram_chat_id: "INTEGER",
    telegram_phone: "TEXT",
    attempts: "INTEGER NOT NULL DEFAULT 0",
    verified_at: "TEXT",
  },
};

let telegramSchemaPromise: Promise<void> | undefined;

/**
 * Small, request-safe bootstrap for the Telegram ownership flow.
 *
 * The old implementation ran the entire application schema (roughly 250 DDL
 * statements) before it could save one verification session. That frequently
 * exhausted a Worker request and produced an unpersisted session. Deployment
 * migrations remain the source of truth; this only repairs the three tables
 * required to complete an ownership proof.
 */
export function ensureTelegramSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.reject(new Error("D1_BINDING_UNAVAILABLE"));
  if (!telegramSchemaPromise) {
    telegramSchemaPromise = (async () => {
      for (const sql of TELEGRAM_TABLES) await db.prepare(sql).run();

      for (const [table, expected] of Object.entries(TELEGRAM_COLUMNS)) {
        const current = (await db.prepare(`PRAGMA table_info(${table})`).all()).results ?? [];
        const names = new Set(current.map((column) => String((column as D1Row)["name"] ?? "")));
        for (const [column, definition] of Object.entries(expected)) {
          if (!names.has(column)) {
            await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
          }
        }
      }

      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_chat_idx ON telegram_links (telegram_chat_id)`,
        )
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx ON telegram_link_tokens (user_id)`,
        )
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS tg_verif_owner_idx ON telegram_verification_sessions (owner_key)`,
        )
        .run();
      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS tg_verif_token_idx ON telegram_verification_sessions (token)`,
        )
        .run();
    })().catch((error) => {
      telegramSchemaPromise = undefined;
      throw error;
    });
  }
  return telegramSchemaPromise;
}

const OTP_TABLE = `CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  destination TEXT,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL)`;

const OTP_COLUMNS: Record<string, string> = {
  user_id: "TEXT",
  channel: "TEXT NOT NULL DEFAULT 'whatsapp'",
  destination: "TEXT",
  verified_at: "TEXT",
};

let otpSchemaPromise: Promise<void> | undefined;

/**
 * Small, request-safe bootstrap for one-time codes.
 *
 * `migrations/0002_otp_phone.sql` shipped a narrower `otp_codes` table than the
 * application writes today, and the full runtime bootstrap is gated behind a
 * schema-version stamp that older databases already carry. Without this repair
 * every `INSERT INTO otp_codes` fails with "no such column", which the API
 * could only report as a generic server error. Deployment migrations remain the
 * source of truth; this repairs the one table verification cannot work without.
 */
export function ensureOtpSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.reject(new Error("D1_BINDING_UNAVAILABLE"));
  if (!otpSchemaPromise) {
    otpSchemaPromise = (async () => {
      await db.prepare(OTP_TABLE).run();

      const current = (await db.prepare(`PRAGMA table_info(otp_codes)`).all()).results ?? [];
      const names = new Set(current.map((column) => String((column as D1Row)["name"] ?? "")));
      for (const [column, definition] of Object.entries(OTP_COLUMNS)) {
        if (!names.has(column)) {
          await db.prepare(`ALTER TABLE otp_codes ADD COLUMN ${column} ${definition}`).run();
        }
      }

      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS otp_phone_idx ON otp_codes (phone, purpose, created_at DESC)`,
        )
        .run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS otp_user_idx ON otp_codes (user_id)`).run();
    })().catch((error) => {
      otpSchemaPromise = undefined;
      throw error;
    });
  }
  return otpSchemaPromise;
}

const USERS_TABLE = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT,
  member_no TEXT,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT,
  phone_verified_at TEXT,
  password_hash TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  gender TEXT,
  birth_date TEXT,
  preferred_genres TEXT NOT NULL DEFAULT '[]',
  profile_completed_at TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'password',
  provider_id TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  addresses TEXT NOT NULL DEFAULT '[]',
  favorites TEXT NOT NULL DEFAULT '[]',
  friend_id TEXT,
  email_verified_at TEXT,
  wallet_balance REAL NOT NULL DEFAULT 0,
  banana_balance INTEGER NOT NULL DEFAULT 0,
  banana_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '')`;

const USERS_COLUMNS: Record<string, string> = {
  name: "TEXT NOT NULL DEFAULT ''",
  username: "TEXT",
  member_no: "TEXT",
  email: "TEXT NOT NULL DEFAULT ''",
  phone: "TEXT",
  phone_verified_at: "TEXT",
  password_hash: "TEXT NOT NULL DEFAULT ''",
  avatar: "TEXT",
  gender: "TEXT",
  birth_date: "TEXT",
  preferred_genres: "TEXT NOT NULL DEFAULT '[]'",
  profile_completed_at: "TEXT",
  is_admin: "INTEGER NOT NULL DEFAULT 0",
  provider: "TEXT NOT NULL DEFAULT 'password'",
  provider_id: "TEXT",
  settings: "TEXT NOT NULL DEFAULT '{}'",
  addresses: "TEXT NOT NULL DEFAULT '[]'",
  favorites: "TEXT NOT NULL DEFAULT '[]'",
  friend_id: "TEXT",
  email_verified_at: "TEXT",
  referred_by_user_id: "TEXT",
  referral_discount_used_at: "TEXT",
  first_referral_order_id: "TEXT",
  wallet_balance: "REAL NOT NULL DEFAULT 0",
  banana_balance: "INTEGER NOT NULL DEFAULT 0",
  banana_locked: "INTEGER NOT NULL DEFAULT 0",
  points: "INTEGER NOT NULL DEFAULT 0",
  wallet_iqd: "INTEGER NOT NULL DEFAULT 0",
  contact_enc: "TEXT",
  legacy_id: "TEXT",
  must_reset_password: "INTEGER NOT NULL DEFAULT 0",
  created_at: "TEXT NOT NULL DEFAULT ''",
};

let usersSchemaPromise: Promise<void> | undefined;

export function ensureUsersSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.resolve();
  if (!usersSchemaPromise) {
    usersSchemaPromise = (async () => {
      await db.prepare(USERS_TABLE).run();
      const current = (await db.prepare(`PRAGMA table_info(users)`).all()).results ?? [];
      const names = new Set(current.map((column) => String((column as D1Row)["name"] ?? "")));
      for (const [column, definition] of Object.entries(USERS_COLUMNS)) {
        if (!names.has(column)) {
          try {
            await db.prepare(`ALTER TABLE users ADD COLUMN ${column} ${definition}`).run();
          } catch {
            // Column may already exist
          }
        }
      }
      try {
        await db.prepare(`CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone)`).run();
      } catch {
        // ignore index creation error
      }
      try {
        await db.prepare(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)`).run();
      } catch {
        // ignore index creation error
      }
      try {
        await db.prepare(`CREATE INDEX IF NOT EXISTS users_username_idx ON users (username)`).run();
      } catch {
        // ignore index creation error
      }
      try {
        await db
          .prepare(`CREATE INDEX IF NOT EXISTS users_member_no_idx ON users (member_no)`)
          .run();
      } catch {
        // ignore index creation error
      }
    })().catch((error) => {
      usersSchemaPromise = undefined;
      throw error;
    });
  }
  return usersSchemaPromise;
}

const COUPONS_TABLE = `CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  start_at TEXT,
  expiration_at TEXT,
  usage_limit INTEGER,
  per_user_limit INTEGER DEFAULT 1,
  eligible_products TEXT DEFAULT '[]',
  eligible_categories TEXT DEFAULT '[]',
  eligible_users TEXT DEFAULT '[]',
  min_order_amount REAL DEFAULT 0,
  max_discount_amount REAL,
  is_active INTEGER DEFAULT 1,
  only_digital_products INTEGER DEFAULT 0,
  is_stackable INTEGER DEFAULT 0,
  once_per_user_lifetime INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
)`;

const COUPONS_COLUMNS: Record<string, string> = {
  total_uses: "INTEGER DEFAULT 0",
  start_at: "TEXT",
  expiration_at: "TEXT",
  usage_limit: "INTEGER",
  per_user_limit: "INTEGER DEFAULT 1",
  eligible_products: "TEXT DEFAULT '[]'",
  eligible_categories: "TEXT DEFAULT '[]'",
  eligible_users: "TEXT DEFAULT '[]'",
  min_order_amount: "REAL DEFAULT 0",
  max_discount_amount: "REAL",
  is_active: "INTEGER DEFAULT 1",
  only_digital_products: "INTEGER DEFAULT 0",
  is_stackable: "INTEGER DEFAULT 0",
  once_per_user_lifetime: "INTEGER DEFAULT 0",
  offline_account_only: "INTEGER DEFAULT 0",
};

const COUPON_REDEMPTIONS_TABLE = `CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL,
  coupon_type TEXT,
  user_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  discount_amount REAL,
  target_product_id TEXT,
  variant_id TEXT,
  created_at TEXT NOT NULL
)`;

const COUPON_REDEMPTIONS_COLUMNS: Record<string, string> = {
  coupon_type: "TEXT",
  discount_amount: "REAL",
  target_product_id: "TEXT",
};

const COUPON_USER_USAGE_TABLE = `CREATE TABLE IF NOT EXISTS coupon_user_usage (
  coupon_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (coupon_id, user_id)
)`;

let couponsSchemaPromise: Promise<void> | undefined;

export function ensureCouponsSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.resolve();
  if (!couponsSchemaPromise) {
    couponsSchemaPromise = (async () => {
      await db.prepare(COUPONS_TABLE).run();
      const current = (await db.prepare(`PRAGMA table_info(coupons)`).all()).results ?? [];
      const names = new Set(current.map((column) => String((column as D1Row)["name"] ?? "")));
      for (const [column, definition] of Object.entries(COUPONS_COLUMNS)) {
        if (!names.has(column)) {
          try {
            await db.prepare(`ALTER TABLE coupons ADD COLUMN ${column} ${definition}`).run();
          } catch {
            // Column may already exist
          }
        }
      }
      try {
        await db
          .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_idx ON coupons (code)`)
          .run();
      } catch (_e) {
        // Ignore index existence conflict
      }

      /*
        Per-member usage counter. Its primary key is the (coupon_id, user_id)
        pair the "once per customer" rule is about, so the limit can be claimed
        atomically rather than counted — see coupon-usage.server.ts.
      */
      try {
        await db.prepare(COUPON_USER_USAGE_TABLE).run();
        await db
          .prepare(
            `CREATE INDEX IF NOT EXISTS coupon_user_usage_user_idx ON coupon_user_usage (user_id)`,
          )
          .run();
        /*
          Backfill from the redemptions already on record, so shipping this does
          not hand every existing member a fresh set of uses. Idempotent: the
          conflict clause keeps whichever count is higher, so re-running never
          double-counts.
        */
        await db
          .prepare(
            `INSERT INTO coupon_user_usage (coupon_id, user_id, uses, first_used_at, last_used_at)
             SELECT coupon_id, user_id, COUNT(*), MIN(created_at), MAX(created_at)
             FROM coupon_redemptions
             WHERE coupon_id IS NOT NULL AND user_id IS NOT NULL
             GROUP BY coupon_id, user_id
             ON CONFLICT(coupon_id, user_id) DO UPDATE SET
               uses = MAX(coupon_user_usage.uses, excluded.uses),
               last_used_at = excluded.last_used_at`,
          )
          .run();
        // Derive the global counter from the per-member counters just written,
        // so the two can never disagree. Idempotent, and safe to re-run.
        await db
          .prepare(
            `UPDATE coupons SET total_uses = COALESCE((SELECT SUM(uses) FROM coupon_user_usage WHERE coupon_user_usage.coupon_id = coupons.id), 0)`,
          )
          .run();
      } catch (_e) {
        // Backfill is best effort; readers fall back to counting redemptions.
      }

      await db.prepare(COUPON_REDEMPTIONS_TABLE).run();
      const redemptionsCols =
        (await db.prepare(`PRAGMA table_info(coupon_redemptions)`).all()).results ?? [];
      const redemptionsNames = new Set(
        redemptionsCols.map((column) => String((column as D1Row)["name"] ?? "")),
      );
      for (const [column, definition] of Object.entries(COUPON_REDEMPTIONS_COLUMNS)) {
        if (!redemptionsNames.has(column)) {
          try {
            await db
              .prepare(`ALTER TABLE coupon_redemptions ADD COLUMN ${column} ${definition}`)
              .run();
          } catch (_e) {
            // Column may already exist
          }
        }
      }
      try {
        await db
          .prepare(
            `CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON coupon_redemptions (user_id, coupon_type)`,
          )
          .run();
      } catch (_e) {
        // Ignore index existence conflict
      }
      try {
        await db
          .prepare(
            `CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id)`,
          )
          .run();
      } catch (_e) {
        // Ignore index existence conflict
      }
      try {
        await db
          .prepare(
            `CREATE INDEX IF NOT EXISTS coupon_redemptions_order_idx ON coupon_redemptions (order_id)`,
          )
          .run();
      } catch (_e) {
        // Ignore index existence conflict
      }
    })().catch((error) => {
      couponsSchemaPromise = undefined;
      throw error;
    });
  }
  return couponsSchemaPromise;
}

// Bumped whenever SCHEMA_PATCHES gains a statement existing databases need.
// The stamp below short-circuits the bootstrap, so a new patch is invisible to
// already-deployed databases until this number moves.
const RUNTIME_SCHEMA_VERSION = 23;

async function runSchemaStatements(
  db: D1Like,
  statements: string[],
  tolerateExistingErrors: boolean,
) {
  for (let offset = 0; offset < statements.length; offset += 40) {
    const chunk = statements.slice(offset, offset + 40);
    if (db.batch) {
      try {
        await db.batch(chunk.map((sql) => db.prepare(sql)));
        continue;
      } catch (error) {
        if (!tolerateExistingErrors) throw error;
      }
    }
    for (const sql of chunk) {
      try {
        await db.prepare(sql).run();
      } catch (error) {
        if (!tolerateExistingErrors) throw error;
      }
    }
  }
}

export function ensureSchema(): Promise<void> {
  const db = getD1();
  if (!db) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS app_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        )
        .run();
      // Always guarantee base store tables exist regardless of schema meta
      try {
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS store_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
          )
          .run();
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS store_rev (rev INTEGER PRIMARY KEY, updated_at TEXT NOT NULL)`,
          )
          .run();
      } catch (e) {
        console.warn("[d1:base_store_tables_ensure_failed]", e);
      }

      const installed = await db
        .prepare(`SELECT value FROM app_schema_meta WHERE key = 'runtime_schema_version'`)
        .first<{ value: string }>();
      if (Number(installed?.value ?? 0) >= RUNTIME_SCHEMA_VERSION) return;

      await retireLegacyTables(db);
      // Existing production databases can contain legacy tables with different
      // columns. `CREATE TABLE IF NOT EXISTS` correctly preserves those tables,
      // but a following optional index may reference a column the legacy table
      // does not have (for example `user_id`) and must not abort the entire
      // bootstrap. Run the idempotent base schema in compatibility mode; the
      // targeted repair routines and patches below still create every usable
      // table/column while leaving legacy data intact.
      await runSchemaStatements(db, SCHEMA, true);

      const remainingPatches: string[] = [];
      const tableColumns = new Map<string, Set<string>>();
      for (const sql of SCHEMA_PATCHES) {
        const alter = /^ALTER TABLE ([A-Za-z0-9_]+) ADD COLUMN ([A-Za-z0-9_]+)/i.exec(sql.trim());
        if (!alter) {
          remainingPatches.push(sql);
          continue;
        }
        const table = alter[1]!;
        const column = alter[2]!;
        let columns = tableColumns.get(table);
        if (!columns) {
          const rows = (await db.prepare(`PRAGMA table_info(${table})`).all()).results ?? [];
          columns = new Set(rows.map((row) => String((row as D1Row)["name"] ?? "")));
          tableColumns.set(table, columns);
        }
        if (!columns.has(column)) {
          remainingPatches.push(sql);
          columns.add(column);
        }
      }
      await runSchemaStatements(db, remainingPatches, true);

      /*
        Report the suspect orders. Do not delete them.

        This block used to `DELETE FROM orders` on every schema bump for any
        row whose document merely *contained* the substring "NaN" — which a
        perfectly good order can, in a title, a URL or an encoded image. A paid
        order is not something to remove on a substring match at boot, and once
        it is gone there is nothing left to investigate.

        The read paths keep degraded orders visible now (see `isOrderReadable`)
        and every surface renders what is missing rather than inventing it, so
        a suspect order is something staff can see and fix. Here it is only
        counted and logged.
      */
      try {
        const suspect = await db
          .prepare(
            `SELECT id, code FROM orders
             WHERE id LIKE 'legacy_ord_%'
                OR doc LIKE '%"title":"undefined"%'
                OR doc LIKE '%"title":"null"%'
             LIMIT 50`,
          )
          .all();
        const rows = suspect.results ?? [];
        if (rows.length > 0) {
          console.warn("[d1:suspect_orders_kept]", {
            count: rows.length,
            ids: rows.map((row) => String((row as D1Row)["id"] ?? "")),
          });
        }
      } catch (err) {
        console.warn("[d1:suspect_order_audit_skipped]", err);
      }

      /*
        Release queue rows for orders that are no longer the admin's problem.

        The preparation queue should hold only orders still waiting on staff.
        Every transition releases its own row now, but databases carry rows
        from before that was true: a completed order still sitting in the queue
        inflates everybody else's "your turn is #N" and keeps a finished order
        in the admin's list forever. Marking them released is reversible and
        removes nothing.
      */
      try {
        const released = await db
          .prepare(
            `UPDATE order_queue
             SET status = 'completed',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE status IN ('waiting', 'processing')
               AND order_id IN (
                 SELECT id FROM orders
                 WHERE status IN ('completed', 'cancelled', 'awaiting_customer_confirmation')
               )`,
          )
          .run();
        const changes = Number(released.meta?.changes ?? 0);
        if (changes > 0) console.info("[d1:queue_released_stale_rows]", { changes });
      } catch (err) {
        console.warn("[d1:queue_cleanup_skipped]", err);
      }

      /*
        Clean up any duplicate active game_device_performance records, keeping the highest revision / newest.
      */
      try {
        await db
          .prepare(
            `UPDATE game_device_performance
             SET active = 0, superseded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE active = 1 AND id NOT IN (
               SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (
                   PARTITION BY game_id, hardware_id
                   ORDER BY revision DESC, updated_at DESC, id DESC
                 ) as rn
                 FROM game_device_performance
                 WHERE active = 1
               ) WHERE rn = 1
             )`,
          )
          .run();

        await db
          .prepare(
            `DELETE FROM game_device_performance_modes
             WHERE performance_id NOT IN (SELECT id FROM game_device_performance)`,
          )
          .run();
      } catch (err) {
        console.warn("[d1:game_device_performance_dedupe_skipped]", err);
      }

      await db
        .prepare(
          `INSERT INTO app_schema_meta (key, value) VALUES ('runtime_schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .bind(String(RUNTIME_SCHEMA_VERSION))
        .run();
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export function isD1Ready(): boolean {
  return Boolean(getD1());
}

export const d1Ready = isD1Ready;
export const d1Batch = d1BatchRun;
export const d1Execute = d1Run;
