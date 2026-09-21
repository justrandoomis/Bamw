-- run-once: 2026-09-21-review-weekly-gate
--
-- The weekly gate's table and its seed, plus one index the every-minute
-- delivery cron has been running without.
--
-- Why here and not through `migrations/`: `wrangler d1 migrations list`
-- against production answers with THIRTY-TWO pending files, from
-- `0002_otp_phone.sql` onwards. `d1_migrations` was never populated, so
-- wrangler considers every file in the directory unapplied, and ticking the
-- deploy's `migrate` input would re-run the whole history against a live
-- database holding 1,714 products and real orders. `.github/workflows/
-- deploy.yml` warns about exactly this. So the new migration file stays in
-- the repository for a database built from scratch, and production gets the
-- same three statements from here, where each one is visible in the diff and
-- the run-once token above stops a later push repeating them.
--
-- `review_reward_cooldowns` and `order_review_prompts` are also created at
-- runtime by `ensureReviewRewardSchema`, so the feature does not depend on
-- this file. What does depend on it is the seed: without it every customer
-- who was auto-rewarded in the last week could earn a second code
-- immediately, which is the opposite of the rule the owner asked for.
--
-- No ALTER TABLE. `product_reviews.review_group_id`, `.rejection_reason` and
-- `orders.review_prompt_at` are added by the PRAGMA-guarded loops in
-- `ensureReviewsSchema` and `ensureDigitalDeliverySchema`; SQLite has no
-- ADD COLUMN IF NOT EXISTS, so an ALTER here would fail outright on a re-run.
--
-- No price, cost, stock, visibility flag, option, type, trade-in value,
-- ordering or sales figure is read or written by anything below.

CREATE TABLE IF NOT EXISTS review_reward_cooldowns (
  user_id          TEXT PRIMARY KEY,
  last_issued_at   TEXT NOT NULL,
  prev_issued_at   TEXT,
  last_coupon_code TEXT,
  last_order_id    TEXT
);

-- Seeded from the ledger that already exists, so each customer's week is
-- measured from their real last code rather than from zero. It wrote 24 rows
-- against 24 distinct customers in `review_rewards` — a read forty minutes
-- earlier had said 23, and the difference is one more auto-minted code in
-- between, which is the behaviour this change stops.
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
-- nothing behind it, so the every-minute cron full-scans the table. Partial,
-- so the index holds only the orders that actually have a live timer.
CREATE INDEX IF NOT EXISTS orders_auto_complete_due_idx
  ON orders (auto_complete_at) WHERE auto_complete_at IS NOT NULL;

-- The same shape for the thirty-minute review prompt, which the sweep added
-- to that cron reads on the same schedule.
CREATE INDEX IF NOT EXISTS orders_review_prompt_due_idx
  ON orders (review_prompt_at) WHERE review_prompt_at IS NOT NULL;
