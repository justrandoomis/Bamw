-- Questions for the console to answer on the next push.
--
-- READ ONLY. A push can never apply a write from here — the guard sees apply
-- false on this path and refuses anything that is not SELECT, WITH, EXPLAIN or
-- PRAGMA.

-- 1. Did the catalogue import land, and is the search index in step with it?
--
-- The runner reported 1,275 -> 1,714 products, 439 created and 1,085 updated.
-- `product_index` is a projection of the catalogue written in the same
-- transaction, so a number that disagrees here means the projection fell
-- behind and the storefront search would not find the new games.
SELECT count(*) AS indexed FROM product_index;

SELECT count(*) AS with_cover FROM product_index
 WHERE bare = 0;

-- 2. The catalogue document itself: chunk count and bytes after the import.
SELECT count(*) AS total_rows,
       SUM(CASE WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN 1 ELSE 0 END) AS chunks,
       SUM(CASE WHEN key LIKE 'store:product:%' THEN 1 ELSE 0 END) AS overlays,
       SUM(LENGTH(value)) AS bytes
  FROM store_kv;

-- 3. The write ledger. The import token should be here exactly once, which is
--    what stops a later push repeating a 1,524-row write.
SELECT id, applied_at FROM console_runs ORDER BY applied_at DESC;
