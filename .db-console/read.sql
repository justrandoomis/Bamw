-- Questions for the console to answer on the next push.
--
-- READ ONLY. A push can never apply a write from here — the guard sees apply
-- false on this path and refuses anything that is not SELECT, WITH, EXPLAIN or
-- PRAGMA. Writes go in `.db-console/apply.sql` under a run-once token, and are
-- run before these, so these describe the database that write leaves behind.
--
-- Every statement ends its own line with a semicolon; that is how they are
-- separated.

-- 1. The two indexes the console applied. Asked again after the deploy,
--    because an index that exists and an index the planner chooses are not the
--    same claim.
EXPLAIN QUERY PLAN
SELECT id FROM product_reviews
 WHERE status = 'pending' AND review_due_at <= '2026-09-15T00:00:00.000Z' AND is_auto_review = 0;

EXPLAIN QUERY PLAN
UPDATE disc_trades SET status = 'cancelled', updated_at = '2026-09-15T00:00:00.000Z'
 WHERE status = 'pending' AND created_at <= '2026-09-08T00:00:00.000Z';

-- 2. The rate limiter's sweep.
--
-- This answered `SCAN security_rate_limits` before the deploy, and correctly
-- so: its index is created by `ensureTable()` at runtime, and that code was
-- still on the branch. After the deploy the first limited request creates it,
-- so `SEARCH … USING INDEX` here is the proof it shipped and ran — and a
-- second `SCAN` would mean the deploy did not reach this path.
EXPLAIN QUERY PLAN
SELECT key FROM security_rate_limits WHERE expires_at < 1757000000;

SELECT name FROM sqlite_master
 WHERE type = 'index' AND tbl_name IN ('security_rate_limits', 'product_reviews', 'disc_trades')
 ORDER BY tbl_name, name;

-- 3. The write ledger. One row, one token, applied once.
SELECT id, applied_at FROM console_runs ORDER BY applied_at DESC;

-- 4. The catalogue and the search index that has to describe it.
SELECT count(*) AS indexed FROM product_index;
