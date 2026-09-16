-- Questions for the console to answer on the next push.
--
-- READ ONLY. A push can never apply a write from here — the guard sees apply
-- false on this path and refuses anything that is not SELECT, WITH, EXPLAIN or
-- PRAGMA. Writes go in `.db-console/apply.sql` under a run-once token, and are
-- run before these, so these describe the database that write leaves behind.
--
-- Every statement ends its own line with a semicolon; that is how they are
-- separated.

-- 1. Do the minute cron's two scans now use an index?
--
-- The first run of this console answered `SCAN product_reviews` and `SCAN
-- disc_trades` for these — every review ever collected and every trade ever
-- offered, walked sixty times an hour to find the handful that are due.
-- `SEARCH … USING INDEX` is the answer that means the repair landed.
EXPLAIN QUERY PLAN
SELECT id FROM product_reviews
 WHERE status = 'pending' AND review_due_at <= '2026-09-15T00:00:00.000Z' AND is_auto_review = 0;

EXPLAIN QUERY PLAN
UPDATE disc_trades SET status = 'cancelled', updated_at = '2026-09-15T00:00:00.000Z'
 WHERE status = 'pending' AND created_at <= '2026-09-08T00:00:00.000Z';

-- 2. The read the cron used to make, and what it now makes instead.
--
-- `processInactivityAndQueue()` called `listThreads()` — every conversation
-- document in the shop, parsed in the Worker — to find the open ones. The two
-- counts say how much of that was waste. The third is the statement that
-- replaced it, which should scan inside D1 and return only the second count.
SELECT count(*) AS all_threads FROM threads;

SELECT count(*) AS open_threads FROM threads
 WHERE CASE WHEN json_valid(doc)
            THEN json_extract(doc, '$.status') = 'open'
                 AND COALESCE(json_extract(doc, '$.mode'), '') <> 'RESOLVED'
            ELSE 0 END;

EXPLAIN QUERY PLAN
SELECT doc FROM threads
 WHERE CASE WHEN json_valid(doc)
            THEN json_extract(doc, '$.status') = 'open'
                 AND COALESCE(json_extract(doc, '$.mode'), '') <> 'RESOLVED'
            ELSE 0 END
 ORDER BY last_message_at DESC;

-- 3. Is the rate limiter's sweep using the index that was added for it?
EXPLAIN QUERY PLAN
SELECT key FROM security_rate_limits WHERE expires_at < 1757000000;

-- 4. The catalogue, against the search index that has to describe it.
--
-- Both were 876 on the first run. They agree; the import simply stopped.
SELECT count(*) AS indexed FROM product_index;
