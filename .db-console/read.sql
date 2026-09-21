-- Read-only questions. Nothing here writes, so this file needs no token.
--
-- After the apply file above: did the weekly gate land, and was it seeded
-- from the rewards that already existed?
SELECT 'cooldown_rows' AS t, COUNT(*) AS n FROM review_reward_cooldowns;
SELECT 'distinct_reward_users' AS t, COUNT(DISTINCT user_id) AS n FROM review_rewards;
SELECT 'prompt_claim_rows' AS t, COUNT(*) AS n FROM order_review_prompts;
SELECT 'reviews_awaiting_admin' AS t, COUNT(*) AS n
  FROM product_reviews WHERE status = 'awaiting_admin';
SELECT name FROM sqlite_master
  WHERE type = 'index'
    AND name IN ('orders_auto_complete_due_idx', 'orders_review_prompt_due_idx',
                 'product_reviews_group_idx', 'product_reviews_status_created_idx');
SELECT name FROM pragma_table_info('orders') WHERE name = 'review_prompt_at';
SELECT name FROM pragma_table_info('product_reviews')
  WHERE name IN ('review_group_id', 'rejection_reason', 'instagram_proof_url');
