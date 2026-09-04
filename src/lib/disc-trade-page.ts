/**
 * One page of the admin's trade list.
 *
 * ## What this replaces
 *
 * `SELECT * FROM disc_trades ORDER BY created_at DESC LIMIT 200`, with no way
 * to ask for the next page and the status filter applied in the browser
 * afterwards. Two hundred is not "the first screenful" when nothing can follow
 * it — it is the whole list, and the two hundred and first oldest trade is
 * gone. If that trade is still waiting on a price, nobody can price it and the
 * customer waits for an answer that can no longer be given. Filtering made it
 * worse: "بانتظار المراجعة" searched only that window, so it could come back
 * empty while trades sat waiting.
 *
 * ## Why a keyset and not an offset
 *
 * `OFFSET 50` is computed against the table as it is *now*. A trade submitted
 * while the admin reads page one pushes every row down by one, and the row
 * that was last on page one becomes first on page two — read twice — while
 * nothing is skipped only because the new rows land at the top. Deleting one
 * skips a row outright. A cursor names the last row the admin actually saw, so
 * the next page starts strictly after it whatever the table does meanwhile.
 *
 * The cursor is `created_at` *and* `id`: two trades submitted in the same
 * millisecond share a timestamp, and a cursor on the timestamp alone either
 * skips the second one or returns the first one again forever.
 */

/** The page a request asked for, clamped to what the endpoint will serve. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export interface TradePageRequest {
  /** A normalized `TradeStatus`, or "" for every status. */
  status?: string;
  /** `created_at|id` of the last row of the previous page. */
  cursor?: string;
  limit?: number;
  /** Free text over the game name, trade id, member id and platform. */
  search?: string;
}

export interface TradePageQuery {
  sql: string;
  binds: unknown[];
  /** How many rows the caller asked for, before the +1 lookahead. */
  limit: number;
}

export function pageSize(requested: unknown): number {
  const value = Number(requested);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

/** `created_at` is an ISO stamp and holds no "|", so the first one splits it. */
export function parseCursor(cursor: string | undefined | null): { at: string; id: string } | null {
  if (!cursor) return null;
  const split = cursor.indexOf("|");
  if (split <= 0) return null;
  const at = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  return at && id ? { at, id } : null;
}

export function cursorOf(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const at = String(row["created_at"] ?? "");
  const id = String(row["id"] ?? "");
  return at && id ? `${at}|${id}` : null;
}

/**
 * The statement for one page.
 *
 * Asks for one row more than the page, which is how `hasMore` is answered
 * without a `COUNT(*)` over the whole table on every keystroke of the search.
 */
export function adminTradePageQuery(request: TradePageRequest): TradePageQuery {
  const limit = pageSize(request.limit ?? DEFAULT_PAGE_SIZE);
  const where: string[] = [];
  const binds: unknown[] = [];

  if (request.status) {
    // `pending` is the pre-normalisation name for `waiting_review`; rows
    // written before the rename still carry it.
    where.push("(status = ? OR (status = 'pending' AND ? = 'waiting_review'))");
    binds.push(request.status, request.status);
  }

  const cursor = parseCursor(request.cursor);
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.at, cursor.at, cursor.id);
  }

  const search = (request.search ?? "").trim().toLowerCase();
  if (search) {
    /*
      The four fields the screen used to match in the browser — over every
      trade now, not only the loaded page.

      SQLite's `LIKE` folds case for ASCII only, and only while
      `case_sensitive_like` is off — so both sides are lowered explicitly
      rather than left to a default. Arabic has no case to fold, and neither
      `lower()` nor `toLowerCase()` changes it, so an Arabic game name matches
      literally either way.

      `%` and `_` are wildcards, so a term containing one is escaped — an
      unescaped "%" is every row in the table, which reads as a broken filter
      rather than a search. The escape character means nothing to SQLite unless
      `ESCAPE` names it, which is why it is on all four.
    */
    where.push(
      `(lower(game_name) LIKE ? ESCAPE '\\'
         OR lower(id) LIKE ? ESCAPE '\\'
         OR lower(user_id) LIKE ? ESCAPE '\\'
         OR lower(platform) LIKE ? ESCAPE '\\')`,
    );
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    binds.push(like, like, like, like);
  }

  const sql =
    `SELECT * FROM disc_trades${where.length ? ` WHERE ${where.join(" AND ")}` : ""}` +
    ` ORDER BY created_at DESC, id DESC LIMIT ?`;

  return { sql, binds: [...binds, limit + 1], limit };
}

/** Trim the lookahead row off and name the cursor the next page starts from. */
export function takePage<T extends Record<string, unknown>>(
  rows: T[],
  limit: number,
): { items: T[]; hasMore: boolean; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? cursorOf(items[items.length - 1]) : null,
  };
}
