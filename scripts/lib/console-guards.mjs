/**
 * The two decisions that make a production console safe to hand an agent.
 *
 * They live here, apart from the script that runs the queries, because they
 * are the parts that must be tested: a guard that is only exercised by being
 * pointed at the live database is not a guard, it is a hope.
 *
 *   1. **Whether a statement may run at all** — `refusal`.
 *   2. **Whether a value may be printed** — `present`.
 *
 * Both fail closed. An unrecognised statement is treated as a write, and an
 * unrecognised value is truncated rather than trusted.
 */

/* ------------------------------------------------------------------ */
/* 1. Whether a statement may run                                      */
/* ------------------------------------------------------------------ */

/**
 * Comments and string literals removed, so the keywords found are real ones.
 *
 * Without this, `SELECT 'drop table'` reads as a DROP and a statement with a
 * `-- DELETE` note above it reads as a DELETE. Worse in the other direction:
 * `UPDATE store_kv SET value = '... WHERE ...'` would appear to carry a WHERE
 * clause it does not have, and the guard against rewriting the whole shop
 * would pass it.
 */
export function skeleton(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\s+/g, " ")
    .trim();
}

export const READ_ONLY = /^(SELECT|WITH|EXPLAIN|PRAGMA)\b/i;

export function isReadOnly(sql) {
  return READ_ONLY.test(skeleton(sql));
}

/**
 * Returns the reason a statement is refused, or null when it may run.
 *
 * `apply` unlocks ordinary writes and nothing else. The three shapes below
 * stay refused however the run was dispatched, because each destroys data no
 * console session can put back, and each is far more often a slip than an
 * intention. The catalogue, the prices, the costs and the stock are all rows
 * in `store_kv`; an `UPDATE store_kv SET value = …` that lost its `WHERE` is
 * the entire shop.
 */
export function refusal(sql, apply) {
  const s = skeleton(sql);
  if (!s) return "empty statement";
  if (/\b(DROP|TRUNCATE)\b/i.test(s)) return "DROP/TRUNCATE is never run from here";
  if (/^DELETE\b/i.test(s) && !/\bWHERE\b/i.test(s)) return "DELETE with no WHERE";
  if (/^UPDATE\b/i.test(s) && !/\bWHERE\b/i.test(s)) return "UPDATE with no WHERE";
  if (READ_ONLY.test(s)) return null;
  if (!apply) return "a write, and this run was not dispatched with apply";
  return null;
}

/**
 * Splits a dispatched script into statements.
 *
 * Only a semicolon that ends a line separates them. A semicolon inside a
 * string literal — a `LIKE 'a;b'` — sits mid-line, and every statement this
 * console is meant to carry ends its own line.
 */
export function statementsIn(script) {
  return String(script ?? "")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 2. Whether a value may be printed                                   */
/* ------------------------------------------------------------------ */

/**
 * Columns whose contents never belong in a log, whatever the query asked for.
 *
 * `supplier_name_zh` is here by the owner's instruction: the Chinese supplier
 * name is private, kept out of the public product API, the product page, the
 * public HTML, the cache and the search, and reachable only through the
 * protected admin endpoint. A console artifact in a Git repository is none of
 * those places.
 */
export const HIDDEN_COLUMN = new RegExp(
  [
    "pass",
    "hash",
    "secret",
    "token",
    "salt",
    "otp",
    "session",
    "cookie",
    "api_?key",
    "phone",
    "whats_?app",
    "mobile",
    "email",
    "address",
    "ip_?addr",
    "client_?ip",
    "supplier_name_zh",
    "note", // admin notes are the owner's own internal writing
  ].join("|"),
  "i",
);

/**
 * What a value looks like, when its column name gave nothing away.
 *
 * Deliberately eager. A false positive costs one cell in a report; a false
 * negative puts a customer's phone number in a repository's logs, where the
 * owner's standing rule says it must never be.
 */
export const LOOKS_PRIVATE = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // an email address
  /(?:\+|00)\d{7,}/, // an international phone number
  /\b07\d{8,}\b/, // an Iraqi mobile
  /\beyJ[\w-]{10,}\./, // a JWT
  /\b[A-Fa-f0-9]{32,}\b/, // a digest or an opaque identifier
];

/** Digits of five or more are addresses here — ids, orders, phones, codes. */
export const maskDigits = (t) => String(t ?? "").replace(/\d{5,}/g, "«n»");

/**
 * One table cell, safe to print.
 *
 * `redact` is passed in rather than imported so this module never needs to
 * know the account's secrets to be tested.
 */
export function present(column, value, { preview = 220, redact = (t) => String(t ?? "") } = {}) {
  if (value === null || value === undefined) return "—";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (HIDDEN_COLUMN.test(String(column))) return `«hidden» (${raw.length} chars)`;
  /*
    A number that SQLite returned as a number is a count, a length or a
    timestamp — never a phone number or an order code, which arrive as text.
    The digit mask below was turning `store:content`'s size into `«n»` in the
    first report this ran, which is the one fact that row was there to give.
  */
  if (typeof value === "number") return String(value);
  if (LOOKS_PRIVATE.some((re) => re.test(raw))) return `«looks private» (${raw.length} chars)`;
  const cut = raw.length > preview ? `${raw.slice(0, preview)}… (${raw.length} chars)` : raw;
  return maskDigits(redact(cut)).replace(/\|/g, "\\|").replace(/\s+/g, " ");
}
