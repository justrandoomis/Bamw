-- A durable, one-per-order entitlement for the 1,000 IQD review coupon.
-- The application treats this row as the source of truth and repairs the
-- matching coupons row on every read, so an interrupted Worker cannot lose the
-- reward or mint a second one.

CREATE TABLE IF NOT EXISTS review_rewards (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  coupon_code TEXT NOT NULL,
  amount_iqd REAL NOT NULL,
  expires_at TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS review_rewards_coupon_code_idx
  ON review_rewards (coupon_code);

CREATE INDEX IF NOT EXISTS review_rewards_user_idx
  ON review_rewards (user_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS review_reward_notifications (
  order_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS product_reviews_product_status_idx
  ON product_reviews (product_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS product_reviews_order_idx
  ON product_reviews (order_id, product_id, user_id);
