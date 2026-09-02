-- Refer a Friend — دعوة صديق
--
-- The same tables the runtime bootstrap creates (src/lib/d1.server.ts), kept
-- here so a database built with `wrangler d1 migrations apply` matches one
-- built by the Worker on first request.
--
-- No customer identifier is stored in the clear: an address, a device and a
-- contact detail all arrive as an HMAC, so the comparisons that stop
-- self-referral still work while the values themselves are not in the
-- database, the logs or an export.

CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  username_alias TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code);
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_user_idx ON referral_codes (user_id);
CREATE INDEX IF NOT EXISTS referral_codes_alias_idx ON referral_codes (username_alias);

CREATE TABLE IF NOT EXISTS referral_attributions (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT,
  referral_code_id TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  guest_session_hash TEXT NOT NULL DEFAULT '',
  device_hash TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'captured',
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  bound_at TEXT,
  converted_order_id TEXT,
  converted_at TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  updated_at TEXT NOT NULL
);
-- One attribution per guest session, code and product: re-opening the same
-- link cannot pile up rows, and NOT NULL columns are what make this hold —
-- two NULLs are never equal in a SQLite unique index.
CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_session_idx
  ON referral_attributions (guest_session_hash, referral_code_id, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_order_idx
  ON referral_attributions (converted_order_id) WHERE converted_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_attributions_referred_idx
  ON referral_attributions (referred_user_id, status);
CREATE INDEX IF NOT EXISTS referral_attributions_referrer_idx
  ON referral_attributions (referrer_user_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  attribution_id TEXT,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  referrer_user_id TEXT NOT NULL,
  buyer_user_id TEXT NOT NULL,
  referral_code_id TEXT,
  referral_code TEXT,
  original_price_iqd INTEGER NOT NULL DEFAULT 0,
  buyer_discount_iqd INTEGER NOT NULL DEFAULT 0,
  referrer_reward_iqd INTEGER NOT NULL DEFAULT 0,
  reversed_amount_iqd INTEGER NOT NULL DEFAULT 0,
  buyer_percent_bps INTEGER NOT NULL DEFAULT 0,
  referrer_percent_bps INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'eligible',
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_verdict TEXT,
  blocked_reason TEXT,
  wallet_transaction_id TEXT,
  hold_until TEXT,
  approved_at TEXT,
  reversed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- "Pay once", as two constraints: one reward per order, one per order item.
CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_order_idx ON referral_rewards (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_item_idx ON referral_rewards (order_item_id);
CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON referral_rewards (referrer_user_id, status);
CREATE INDEX IF NOT EXISTS referral_rewards_buyer_idx ON referral_rewards (buyer_user_id, status);

CREATE TABLE IF NOT EXISTS referral_risk_events (
  id TEXT PRIMARY KEY,
  attribution_id TEXT,
  reward_id TEXT,
  order_id TEXT,
  referrer_user_id TEXT,
  buyer_user_id TEXT,
  event_type TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  device_hash TEXT,
  ip_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_risk_events_attr_idx
  ON referral_risk_events (attribution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_risk_events_order_idx ON referral_risk_events (order_id);

-- Which devices, addresses and sessions an account has been seen on. The device
-- hash is re-derived server-side from the request, so clearing a cookie does
-- not produce a new device.
CREATE TABLE IF NOT EXISTS referral_identity_links (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS referral_identity_links_unique
  ON referral_identity_links (kind, identity_hash, user_id);
CREATE INDEX IF NOT EXISTS referral_identity_links_user_idx
  ON referral_identity_links (user_id, kind);
CREATE INDEX IF NOT EXISTS referral_identity_links_hash_idx
  ON referral_identity_links (kind, identity_hash);

CREATE TABLE IF NOT EXISTS referral_blocklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  blocked_by TEXT,
  created_at TEXT NOT NULL
);
