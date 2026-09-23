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
  const total = alive + dead + unknown;
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
