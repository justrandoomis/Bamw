-- Questions for the console to answer on the next push.
--
-- READ ONLY. A push can never apply a write from here — the guard sees apply
-- false on this path and refuses anything that is not SELECT, WITH, EXPLAIN or
-- PRAGMA.

-- 1. Did the supplier's Chinese names land with the import?
--
-- The sheet carries one for all 1,530 rows and the runner pushed them through
-- `supplierNameStatements` inside a `try { } catch { }` that reported nothing.
-- The owner says the copy button is empty for some games. This is the count
-- that settles whether the write happened at all. The name itself is private
-- and is never selected here — only how many there are.
SELECT count(*) AS rows_total,
       SUM(CASE WHEN supplier_name_zh_cn IS NOT NULL
                 AND length(trim(supplier_name_zh_cn)) > 0
                THEN 1 ELSE 0 END) AS with_name,
       SUM(CASE WHEN product_id LIKE 'prd_cat_%' THEN 1 ELSE 0 END) AS catalogue_rows,
       SUM(CASE WHEN product_id LIKE 'prd_cat_%'
                 AND supplier_name_zh_cn IS NOT NULL
                 AND length(trim(supplier_name_zh_cn)) > 0
                THEN 1 ELSE 0 END) AS catalogue_with_name
  FROM product_admin_metadata;

-- 2. How many products exist to carry one, so the two numbers can be compared.
SELECT count(*) AS indexed FROM product_index;

-- 3. The kind on order lines already sold.
--
-- `buildListing` writes kind 'game', which was not in the delivery code's
-- allow-list, so an order for an imported game produced no delivery slot at
-- all. Fixing the derivation makes those slots appear on first read. This says
-- how many orders that is, and whether any of them are already finished — a
-- completed order gaining draft slots is the one surprise worth knowing about
-- before the deploy rather than after.
SELECT oi.kind,
       count(*) AS lines,
       SUM(oi.quantity) AS units,
       count(DISTINCT oi.order_id) AS orders
  FROM order_items oi
 GROUP BY oi.kind
 ORDER BY lines DESC;

SELECT o.status,
       count(DISTINCT o.id) AS orders
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
 WHERE oi.kind = 'game'
 GROUP BY o.status
 ORDER BY orders DESC;

-- 4. The queue the customer is shown a position in.
--
-- A customer reports being seventh with nobody ahead. The queue is built from
-- open threads that carry an order id, with no check on whether that order is
-- still waiting for anything. If most open order threads belong to finished
-- orders, that is the whole fault.
SELECT COALESCE(o.status, '(no order row)') AS order_status,
       count(*) AS open_threads
  FROM threads t
  LEFT JOIN orders o ON o.id = t.order_id
 WHERE t.order_id IS NOT NULL
   AND json_valid(t.doc)
   AND json_extract(t.doc, '$.status') = 'open'
   AND COALESCE(json_extract(t.doc, '$.mode'), '') <> 'RESOLVED'
 GROUP BY order_status
 ORDER BY open_threads DESC;

-- 5. The write ledger, so an armed token is never spent twice.
SELECT id, applied_at FROM console_runs ORDER BY applied_at DESC;
