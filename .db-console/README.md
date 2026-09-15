# `.db-console`

Two files the **D1 / R2 console** workflow reads when it runs.

## `read.sql` — questions

Runs on every push that touches the console. `SELECT`, `WITH`, `EXPLAIN` and
`PRAGMA` only: a push cannot write, whatever is in here, because the guard sees
apply as false on that path and refuses anything else.

## `apply.sql` — a write

Empty most of the time. When it carries statements it must begin with a token:

```sql
-- run-once: 2026-09-16-drop-stale-overlays
DELETE FROM store_kv WHERE key LIKE 'store:product:%' AND updated_at <= 1757000000;
```

The token is claimed in `console_runs` before anything runs, so the same write
cannot happen twice — which matters because the workflow fires again the next
time the console's own script is edited, with this file still in the tree.

Change the statements **and** the token to run something new. Leave the old
token in place to keep it from running again.

`DROP`, `TRUNCATE`, and any `DELETE` or `UPDATE` without a `WHERE` are refused
here as well. The catalogue, the prices, the costs and the stock are all rows
in `store_kv`.

## What does not go in either file

Customer data. These files are committed, the run's output is an artifact and a
job summary, and neither is a place for a phone number, an order's contents or
a member's name. The console masks what it prints, but a statement that
*selects by* a customer's phone number has already put that number in the diff.
Match on ids instead.
