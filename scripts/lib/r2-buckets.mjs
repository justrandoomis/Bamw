/**
 * Which R2 bucket the shop actually serves its pictures from.
 *
 * ## THIS FILE EXISTS BECAUSE THE ANSWER WAS WRITTEN DOWN IN SIX PLACES
 *
 * `/api/files/<path>` is served by `src/routes/api/files/$.ts`, which reads
 * `files/<path>` through `storage.server.ts` → `getPrivateBucket()` → the
 * `BANANTO_PRIVATE_BUCKET` binding. There is exactly one bucket a stored
 * `/api/files/...` URL can be answered from, and it is that one.
 *
 * The scripts did not agree with the app or with each other:
 *
 *   game-create · research-import · zip-import   →  "bananto-private"   ✓
 *   square-card-fill · store-media-repair        →  env || "bananto"    ✗
 *
 * So `square-card-fill.mjs` uploaded a square cover, read it back from the
 * bucket it had just written, stored `/api/files/...` — and the shopper got a
 * 404. Measured on 2026-09-23: 849 of the catalogue's 1,428 square cards were
 * sitting in `bananto`, every one of them a `square-card-*.webp`, which is the
 * only thing that script produces. None of them was missing. All of them were
 * invisible.
 *
 * `-every-writer-uses-the-bucket-the-shop-reads.test.mjs` makes this the only
 * way to name a bucket, so the disagreement cannot come back.
 *
 * ## WHY IT IS READ FROM `wrangler.jsonc`
 *
 * Because that file is what actually configures the Worker. A constant here
 * would be a seventh place to write the answer down, and the next person to
 * rename the binding would change the app and not the scripts — which is the
 * fault this file is about, one rename later.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The binding `storage.server.ts` reads every `/api/files/...` request from. */
export const SERVING_BINDING = "BANANTO_PRIVATE_BUCKET";

/** Used only if `wrangler.jsonc` cannot be read — it is in the repo, so it can. */
const FALLBACK = "bananto-private";

/**
 * The bucket named by a binding in `wrangler.jsonc`, or null.
 *
 * Deliberately a small regex rather than a JSONC parser: the file carries
 * comments, and pulling in a parser to read one string would be a dependency
 * for the sake of a dependency. The shape it matches is the shape the file has,
 * and the test pins both.
 */
export function bucketForBinding(source, binding) {
  const pattern = new RegExp(
    `"binding"\\s*:\\s*"${binding}"\\s*,?\\s*"bucket_name"\\s*:\\s*"([^"]+)"`,
  );
  const compact = String(source ?? "").replace(/\s+/g, " ");
  return pattern.exec(compact)?.[1] ?? null;
}

function readServingBucket() {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    return bucketForBinding(config, SERVING_BINDING) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * The one bucket a script may put a `/api/files/...` object in.
 *
 * Every writer imports THIS. `CLOUDFLARE_R2_BUCKET_NAME` is deliberately not
 * consulted: a secret that can disagree with `wrangler.jsonc` is a secret that
 * eventually does, silently, and the shop cannot see the difference until a
 * customer looks at a card.
 */
export const SERVING_BUCKET = readServingBucket();

/**
 * The bucket the two mistaken scripts used to write to.
 *
 * Kept — and named — only so the relocation can look for strays there. Nothing
 * writes to it.
 */
export const LEGACY_BUCKET = "bananto";
