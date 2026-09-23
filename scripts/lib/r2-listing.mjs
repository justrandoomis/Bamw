/**
 * Reads what R2 actually holds, by listing rather than by asking object by object.
 *
 * ## TWO MEASUREMENTS PRODUCED THIS FILE, AND BOTH WERE OF MY OWN INSTRUMENT
 *
 * The first checker asked the REST object endpoint for each picture with
 * `range: bytes=0-0`. That endpoint sends the BYTES, so a run spent a hundred
 * seconds downloading square cards to learn their HTTP status.
 *
 * The second listed one prefix per product — `files/products/<id>/` — which
 * fixed the bytes and broke something else: about twelve hundred authenticated
 * calls inside a minute, against an API with a per-account rate limit. Listings
 * started coming back empty or not at all, and a hundred and fifty pictures
 * that are sitting in R2 right now were reported `unknown` because the folder
 * they live in could not be read.
 *
 * So: ONE listing per bucket, over the root the keys share, paginated. Five or
 * six requests instead of twelve hundred, and the whole answer in memory.
 *
 * ## A TRUNCATED LISTING IS A FAILED LISTING
 *
 * The page loop has a cap, because a loop that trusts a remote cursor is a loop
 * that can run forever. If the cap is reached while the API still says there is
 * more, this returns `null` — NOT the keys it managed to collect. A partial
 * listing is the most dangerous possible answer here: every key past the cut
 * would look absent, which is exactly the verdict that erases things.
 */

const API = "https://api.cloudflare.com/client/v4";

/** How many 1,000-key pages to read before refusing to keep going. */
export const MAX_PAGES = 60;

/**
 * The deepest folder every one of these keys sits under.
 *
 * `files/products/a/x.webp` and `files/products/b/y.webp` share
 * `files/products/`. Used to turn a few hundred per-product listings into one.
 * Returns "" when they share nothing, which lists the whole bucket — correct,
 * and the caller decides whether it wants that.
 */
export function commonPrefix(keys) {
  const list = [...keys].map((k) => String(k ?? ""));
  if (!list.length) return "";
  let shared = list[0];
  for (const key of list.slice(1)) {
    let i = 0;
    while (i < shared.length && i < key.length && shared[i] === key[i]) i += 1;
    shared = shared.slice(0, i);
    if (!shared) break;
  }
  const cut = shared.lastIndexOf("/");
  return cut >= 0 ? shared.slice(0, cut + 1) : "";
}

/**
 * Every key under `prefix`, or null when the question could not be answered.
 *
 * `null` covers a refusal, a network failure, an unsuccessful body AND a
 * listing that was still truncated at the page cap. An empty Set is a real
 * answer and means the folder is empty; the two are never conflated.
 */
export async function listPrefix(bucket, prefix, { account, token, fetchImpl = fetch } = {}) {
  if (!account || !token) return null;
  const keys = new Set();
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `${API}/accounts/${account}/r2/buckets/${bucket}/objects` +
      `?prefix=${encodeURIComponent(prefix)}&per_page=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    let body;
    try {
      const res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return null;
      body = await res.json();
    } catch {
      return null;
    }
    if (!body?.success) return null;
    for (const row of body.result ?? []) if (row?.key) keys.add(String(row.key));
    const info = body.result_info ?? {};
    cursor = String(info.cursor ?? "");
    if (!info.is_truncated || !cursor) return keys;
  }
  /* Still more to read and no pages left. Partial is worse than unknown. */
  return null;
}
