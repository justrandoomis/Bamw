/**
 * D1 over Cloudflare's REST API, for a script that writes hundreds of
 * statements: every request paced against the account's rate limit and
 * retried on 429 and 5xx (`cloudflare-pace.mjs`).
 *
 * The app's own REST adapter (`src/lib/d1.server.ts`) is built for a handful
 * of reads from a preview; the games database load is about six hundred
 * statements, and Cloudflare answers 429 past roughly four a second.
 *
 * A retried write must be safe to repeat. Everything the loader sends through
 * here is (INSERT OR REPLACE, INSERT OR IGNORE, a DELETE of what is already
 * gone) except the token claim, which passes `attempts: 1`: a claim retried
 * after a lost answer would find its own row and report the token spent.
 */
import { pacedFetch } from "./cloudflare-pace.mjs";

export function d1Rest({ accountId, token, databaseId, fetchImpl = fetch } = {}) {
  if (!accountId || !token || !databaseId) throw new Error("d1Rest: missing credentials");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function query(sql, params = [], { attempts } = {}) {
    const res = await pacedFetch(
      endpoint,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      },
      attempts ? { fetchImpl, attempts } : { fetchImpl },
    );
    const raw = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    if (!res.ok || !payload || payload.success === false) {
      if (res.status === 401 || res.status === 403) throw new Error("D1_AUTHENTICATION_FAILED");
      throw new Error(payload?.errors?.[0]?.message ?? `D1 REST ${res.status}`);
    }
    return payload.result?.[0] ?? { results: [], meta: {} };
  }

  return {
    /** Rows of a read. */
    all: async (sql, params = [], options) => (await query(sql, params, options)).results ?? [],
    /** A write; resolves to D1's result with `meta.changes`. */
    run: (sql, params = [], options) => query(sql, params, options),
  };
}
