-- Questions for the console to answer on the next push.
--
-- READ ONLY. A push can never apply a write — `refusal()` sees APPLY false on
-- this path and refuses anything that is not a SELECT, WITH, EXPLAIN or PRAGMA.
-- Writes go in `.db-console/apply.sql` under a run-once token instead.
--
-- Every statement here ends its own line with a semicolon; that is how they
-- are separated.

-- 1. Every index the database has.
--
-- The every-minute cron scans four tables and the limiter sweeps a fifth. An
-- index that is missing does not fail, it just makes each firing walk the
-- whole table — which is the shape of a Worker that is killed for exceeding
-- CPU eighteen times an hour without any single query looking wrong.
SELECT m.tbl_name AS tbl, m.name AS idx, m.sql AS definition
  FROM sqlite_master m
 WHERE m.type = 'index' AND m.sql IS NOT NULL
 ORDER BY m.tbl_name, m.name;

-- 2. What the minute cron's own queries actually do.
--
-- Asked as the cron asks them, with a literal where it binds a timestamp.
-- "SCAN <table>" in the answer is the whole table, every minute, forever.
EXPLAIN QUERY PLAN
SELECT id FROM product_reviews
 WHERE status = 'pending' AND review_due_at <= '2026-09-15T00:00:00.000Z' AND is_auto_review = 0;

EXPLAIN QUERY PLAN
UPDATE disc_trades SET status = 'cancelled', updated_at = '2026-09-15T00:00:00.000Z'
 WHERE status = 'pending' AND created_at <= '2026-09-08T00:00:00.000Z';

EXPLAIN QUERY PLAN
SELECT o.* FROM banana_market_offers o
  LEFT JOIN banana_bots b ON o.user_id = b.id
 WHERE o.status = 'active' AND b.id IS NULL AND o.quantity > 0
   AND (o.price_iqd / o.quantity) <= 0.005;

EXPLAIN QUERY PLAN
SELECT * FROM banana_bots WHERE is_active = 1;

-- 3. How many bots the offers query is being run for.
--
-- It is inside the per-bot loop and does not mention the bot, so this count is
-- the multiplier on a query that already scans.
SELECT count(*) AS active_bots FROM banana_bots WHERE is_active = 1;

-- 4. Does the search index still describe the catalogue?
--
-- The catalogue is a JSON document and the index is a table. An import that
-- stopped part way leaves them disagreeing, and the storefront search is the
-- table — so a game can be in the shop and unfindable.
SELECT count(*) AS indexed FROM product_index;

-- 5. Anything in store_kv that is not the catalogue and not small.
--
-- Keys and lengths only. This is the read `/api/admin/store` pays on every
-- cold isolate.
SELECT key, LENGTH(value) AS bytes FROM store_kv
 WHERE key NOT LIKE 'store:products%'
 ORDER BY bytes DESC
 LIMIT 20;

-- 6. Leftovers from the interrupted import.
SELECT count(*) AS overlay_rows FROM store_kv WHERE key LIKE 'store:product:%';
