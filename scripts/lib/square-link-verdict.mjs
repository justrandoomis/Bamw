/**
 * Whether a stored image URL is missing, and whether we are entitled to say so.
 *
 * Extracted from `square-card-verify.mjs` because these three decisions are the
 * ones that erase data, and a decision that erases data should be testable
 * without a network, a database or a catalogue.
 *
 * The distinction the whole thing turns on is ABSENT versus UNANSWERED. A 404
 * is the file saying it is not there. A 403, a 500, a timeout or a DNS failure
 * is our own side failing to ask — and clearing a picture on that evidence
 * deletes work the owner did because a network hiccuped.
 */

/**
 * The bucket `/api/files/...` is actually served from.
 *
 * `storage.server.ts` reads through `getPrivateBucket()`, which is the
 * `BANANTO_PRIVATE_BUCKET` binding — `bananto-private` in `wrangler.jsonc`. A
 * file that is not in THIS bucket does not reach a shopper, whatever other
 * bucket it may be sitting in.
 */
export const SERVING_BUCKET = "bananto-private";

/**
 * The other bucket the image scripts write to.
 *
 * `square-card-fill.mjs` puts objects in `CLOUDFLARE_R2_BUCKET_NAME || "bananto"`
 * and stores the URL `/api/files/...`, which is served from the bucket above.
 * Whether those are the same bucket depends on a secret this repository cannot
 * read, so the checker asks BOTH and reports which one answered rather than
 * assuming. A picture in the wrong bucket is not a missing picture, and
 * clearing its URL would throw away work that exists.
 */
export const WRITING_BUCKET = "bananto";

/** Below this share of clean answers, the checker is the broken thing. */
export const DEFAULT_MAX_DEAD_SHARE = 0.1;

/** HTTP statuses that mean the file is genuinely not there. */
const GONE = new Set([404, 410]);

/**
 * The verdict for one URL, from a HEAD status and — only if needed — a GET.
 *
 * `get` is the shape `fetchImage` returns: `{ ok, kind, status }`. It is asked
 * for ONLY when the HEAD says gone, because a destructive answer deserves a
 * second, different question. Passing `null` means "the HEAD was conclusive on
 * its own", which is true for every status but 404 and 410.
 *
 * @returns "alive" | "dead" | "unknown"
 */
export function verdictFor(head, get) {
  if (typeof head !== "number") return "unknown";
  if (head >= 200 && head < 300) return "alive";
  if (!GONE.has(head)) return "unknown";
  /* It looked gone. Without the confirming GET we are not entitled to say so. */
  if (!get) return "unknown";
  if (get.ok) return "alive";
  if (get.kind === "http-error" && GONE.has(get.status)) return "dead";
  return "unknown";
}

/**
 * The verdict for one of this shop's own files, from both buckets.
 *
 * Each argument is what the R2 REST API answered for that bucket: a number for
 * a status, or null when the request never completed.
 *
 *   - "alive"     — it is in the bucket the site serves from.
 *   - "misplaced" — it is not, but it IS in the bucket the image scripts write
 *                   to. The picture exists; it is in the wrong place. NEVER
 *                   cleared: the repair is to copy the object, not to erase the
 *                   link, and a checker that conflated the two would delete
 *                   real work to fix a routing mistake.
 *   - "dead"      — both buckets answered 404. The file is not anywhere.
 *   - "unknown"   — anything else. A 401 or 403 is the token, a 5xx is
 *                   Cloudflare, and neither is evidence about a picture.
 */
export function r2VerdictFor(servingStatus, writingStatus) {
  const ok = (status) => typeof status === "number" && status >= 200 && status < 300;
  const gone = (status) => status === 404;
  if (ok(servingStatus)) return "alive";
  if (!gone(servingStatus)) return "unknown";
  if (ok(writingStatus)) return "misplaced";
  if (!gone(writingStatus)) return "unknown";
  return "dead";
}

/**
 * The `files/...` key behind one of this shop's own URLs, or null.
 *
 * `/api/files/products/x/a.webp` is served by reading `files/products/x/a.webp`
 * — see `src/routes/api/files/$.ts`. A query string is dropped: `?w=600` is a
 * resize instruction to the route, not part of the key.
 */
export function storageKeyFor(url) {
  const match = /^(?:https?:\/\/[^/]+)?\/api\/files\/(.+)$/i.exec(String(url ?? "").trim());
  if (!match) return null;
  const path = (match[1] ?? "").split(/[?#]/, 1)[0];
  return path ? `files/${path}` : null;
}

/**
 * Should the whole run be refused?
 *
 * Measured against everything probed, not against the dead alone. A runner the
 * edge has decided to 403 produces `unknown`, not `dead`, so a guard watching
 * only the dead count would sail straight past the one failure it exists to
 * catch — and a script that trusted itself there would erase the shop's entire
 * picture library in a single pass.
 *
 * Zero probes is not a refusal. There is nothing to be wrong about.
 */
export function isBlanketFailure(counts, maxDeadShare = DEFAULT_MAX_DEAD_SHARE) {
  const alive = Number(counts?.alive) || 0;
  const dead = Number(counts?.dead) || 0;
  const unknown = Number(counts?.unknown) || 0;
  /*
    A misplaced file counts as ANSWERED. Both buckets replied and agreed on
    where the object is — that is a finding about the shop, not a failure of
    the checker, and it must not trip a guard that exists to detect a checker
    which cannot see.
  */
  const misplaced = Number(counts?.misplaced) || 0;
  const total = alive + dead + unknown + misplaced;
  if (total === 0) return false;
  return (dead + unknown) / total > maxDeadShare;
}

/**
 * A stored value made absolute, so a shop-relative row can be asked about.
 *
 * Returns "" for anything that cannot be addressed — a `data:` URI, a bare
 * filename, an empty field. The caller treats that as `unknown`: not
 * addressable is not the same as not there.
 */
export function absoluteUrl(url, origin) {
  const text = String(url ?? "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("/")) return `${String(origin ?? "").replace(/\/+$/, "")}${text}`;
  return "";
}
