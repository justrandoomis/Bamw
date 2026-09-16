-- run-once: 2026-09-16-minute-cron-indexes
--
-- Two indexes the every-minute cron has been running without.
--
-- `EXPLAIN QUERY PLAN` against production answered `SCAN product_reviews` and
-- `SCAN disc_trades` for the two statements below — every review the shop has
-- ever collected and every disc trade ever offered, walked sixty times an
-- hour, to find the handful that are due. Both tables' existing indexes are
-- keyed on the member, which is the wrong key for a job that asks "what is
-- due?" rather than "what is this person's?".
--
-- The same two statements are now in `d1.server.ts` so a fresh database gets
-- them, but they sit behind the runtime schema version — and bumping that
-- makes every isolate re-run the bootstrap, which is what took the site down
-- at version 24. So production gets them from here instead, where creating an
-- index is the only thing that happens.
--
-- `IF NOT EXISTS` on both: this is the safe direction, and it stays true if a
-- later schema bump runs the same statements again.
--
-- Nothing here reads or writes a row. No price, cost, stock, visibility,
-- option, type, trade-in value, ordering or sales figure is touched.

CREATE INDEX IF NOT EXISTS product_reviews_due_idx ON product_reviews (status, review_due_at);

CREATE INDEX IF NOT EXISTS disc_trades_pending_idx ON disc_trades (status, created_at);
