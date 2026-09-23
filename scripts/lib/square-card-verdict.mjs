/**
 * When may a failed square-card lookup be remembered for thirty days?
 *
 * `square-card-fill` keeps a memory so a run does not re-ask a question that
 * has already been answered. The memory is only sound when what it stores IS
 * an answer — and twice it was storing a silence:
 *
 *   - every url key failing in transport (timeout, reset, 403, 429), and
 *   - our own inability to fetch, decode or store the picture.
 *
 * Neither says anything about whether Nintendo has the game. A game written
 * off for one of those sits on the shop with no cover for a month, and because
 * `remember()` refreshes `attempted_at` on every upsert, a game re-written-off
 * on each run it is reached never ages out at all.
 *
 * ## The asymmetry
 *
 * Asking again costs one HTTP request. Writing off wrongly costs a month of a
 * missing picture that nobody notices. So every decision here leans the same
 * way: remember ONLY on evidence that is a fact about the game or its artwork,
 * and treat anything unrecognised as a reason to ask again.
 *
 * ## Why this is a module and not four lines in the script
 *
 * The old guard lived inline and was tested by reading the script's source —
 * the identifier was present, the regex literal was present, the branch did not
 * call `remember`. Every assertion true, and the branch unreachable the whole
 * time. A predicate that can be CALLED can be tested against the strings
 * production really produced, which is what
 * `-a-blacklist-needs-an-answer-not-a-silence.test.mjs` does.
 */

/**
 * The keys half of a resolver note.
 *
 * `media-pipeline` builds `no Nintendo store page resolved (<keys>)` and, for
 * this caller, ALWAYS appends `; europe: <reason>`. Since the keys themselves
 * are joined with the same `"; "`, splitting the whole note mixes the europe
 * reason in with them — which is precisely what made the old guard dead code.
 *
 * Returns null rather than the whole note when the shape is not recognised:
 * falling back to the note would reintroduce the bug quietly.
 *
 * @param {unknown} note
 * @returns {string | null}
 */
export function keysOf(note) {
  if (typeof note !== "string" || !note) return null;
  const found = /resolved \(([\s\S]*?)\)(?:; europe: |$)/.exec(note);
  return found ? found[1] : null;
}

/**
 * What a note saying "no page resolved" actually tells us.
 *
 * @param {unknown} note
 * @returns {{ verdict: string, remember: string | null, keys: string[] }}
 */
export function verdictForNoPage(note) {
  const keysPart = keysOf(note);
  if (keysPart === null) {
    // An unparseable note is not an answer either.
    return { verdict: "unparsed", remember: null, keys: [] };
  }

  const keys = keysPart.split("; ").map((k) => k.trim()).filter(Boolean);

  // No candidate key was ever built, so nothing was ever asked.
  if (keys.length === 0) return { verdict: "no_keys_tried", remember: null, keys };

  /*
    A page was fetched and the game on it was not ours. That is an answer, but
    an answer about OUR label rather than about Nintendo's catalogue — so it
    gets its own reason and can be re-asked once the label is corrected,
    instead of being buried in `no_listing_404` forever.
  */
  if (keys.some((k) => /, rejected:/.test(k))) {
    return { verdict: "identity_rejected", remember: "identity_rejected", keys };
  }

  /*
    `HTTP 0` is how `fetchText` reports a request that never completed — a
    timeout, a reset, a rate limit, a 5xx after its retries. If that is all we
    got, we never asked the question.
  */
  if (keys.every((k) => /→ HTTP 0\b/.test(k))) {
    return { verdict: "unreachable", remember: null, keys };
  }

  /*
    At least one key came back with a real status. Deliberately not "any
    timeout means retry": a 404 is Nintendo telling us it has nothing under
    that key, and that is the answer the memory exists to keep.
  */
  return { verdict: "no_listing", remember: "no_listing_404", keys };
}

/**
 * Reasons that describe OUR failure rather than the artwork.
 *
 * Matched as prefixes against the `reason` strings `media-candidates` and
 * `media-pipeline` compose, so a detail suffix does not defeat the match.
 */
const OUR_FAULT = [
  "unreachable", // image-probe: the request never completed
  "http-error", // image-probe: the asset host answered 4xx/5xx
  "R2 store or read-back failed", // media-pipeline: our storage, not their picture
  "conversion failed", // media-pipeline: we had the bytes and fumbled them
  "undecodable", // possibly a truncated download; cheap to re-ask
];

/**
 * Reasons that describe the ARTWORK, which retrying cannot change.
 */
const ABOUT_THE_ART = [
  "too small", // it is the size it is
  "shape is", // it is the shape it is
  "identical bytes already used for", // a fact about this catalogue
];

/**
 * What a resolved page carrying no usable square asset tells us.
 *
 * @param {unknown} rejectedReason the `reason` of the failed report entry for
 *   the role, or null/empty when the page offered no candidate at all.
 * @returns {{ verdict: string, remember: string | null }}
 */
export function verdictForNoAsset(rejectedReason) {
  const reason = typeof rejectedReason === "string" ? rejectedReason.trim() : "";

  /*
    Nothing was even offered for the role. The page is real, we read it, and it
    carries no square picture — a fact about the game, and the original and
    entirely correct meaning of `no_square_asset`.
  */
  if (!reason) return { verdict: "no_square_asset", remember: "no_square_asset" };

  if (OUR_FAULT.some((p) => reason.startsWith(p))) {
    return { verdict: "asset_unreachable", remember: null };
  }
  if (ABOUT_THE_ART.some((p) => reason.startsWith(p))) {
    return { verdict: "no_square_asset", remember: "no_square_asset" };
  }

  /*
    A reason nobody has seen before. It might be about the art and it might be
    about us, and guessing wrong in the remembering direction is the expensive
    one — so it is not remembered, and the reason is carried out so the report
    can name it and somebody can add it to a list above.
  */
  return { verdict: `unknown: ${reason.slice(0, 60)}`, remember: null };
}

/** Every reason string this module can write, for the stale-filter query. */
export const REMEMBERED_REASONS = ["no_listing_404", "no_square_asset", "identity_rejected"];
