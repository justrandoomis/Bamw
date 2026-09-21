-- The weekly gate for the 1,000 IQD review coupon, and one index the
-- every-minute delivery cron has been missing.
--
-- No ALTER TABLE here on purpose. product_reviews.review_group_id /
-- .rejection_reason and orders.review_prompt_at are added by the PRAGMA-guarded
-- loops in ensureReviewsSchema and ensureDigitalDeliverySchema, which are
-- idempotent by construction. SQLite has no ADD COLUMN IF NOT EXISTS, so an
-- ALTER in this file would fail outright on the re-run that
-- .github/workflows/deploy.yml warns is possible when d1_migrations was never
-- created.

CREATE TABLE IF NOT EXISTS review_reward_cooldowns (
  user_id          TEXT PRIMARY KEY,
  last_issued_at   TEXT NOT NULL,
  prev_issued_at   TEXT,
  last_coupon_code TEXT,
  last_order_id    TEXT
);

-- Seed from the ledger that already exists, so the first week after this
-- deploys is measured from each customer's real last reward rather than from
-- zero — otherwise every customer who was auto-rewarded yesterday could earn a
-- second code today, which is the opposite of the rule.
--
-- The WHERE before GROUP BY is required for SQLite to parse
-- INSERT...SELECT...ON CONFLICT at all. MAX(a, b) is the two-argument scalar
-- form, not the aggregate: a re-run can only carry a cooldown forward, never
-- move one backwards.
INSERT INTO review_reward_cooldowns (user_id, last_issued_at)
SELECT user_id, MAX(issued_at) FROM review_rewards
WHERE user_id IS NOT NULL AND issued_at IS NOT NULL
GROUP BY user_id
ON CONFLICT(user_id) DO UPDATE SET
  last_issued_at = MAX(review_reward_cooldowns.last_issued_at, excluded.last_issued_at);

-- `processDueDeliveryAutoCompletions` filters `orders.auto_complete_at` with
-- nothing behind it, so the every-minute cron full-scans the table. Partial, so
-- the index holds only the orders that actually have a live timer.
CREATE INDEX IF NOT EXISTS orders_auto_complete_due_idx
  ON orders (auto_complete_at) WHERE auto_complete_at IS NOT NULL;
