/**
 * The rules that decide what gets erased from the catalogue.
 *
 * `square-card-verify.mjs` clears a stored square-card URL when the file behind
 * it is gone. That is a destructive act performed on the owner's data by a job
 * nobody is watching, so the two decisions that authorise it are pulled out
 * here and tested without a network, a database or a catalogue.
 *
 * ## THE FAILURE THIS FILE IS REALLY ABOUT
 *
 * Not "does it find dead links" — that is the easy half. It is: what does the
 * script do on a run where it CANNOT ASK?
 *
 * This edge already answers these runners 403 on `/api/data?slim=1` while
 * answering 200 on `/`. A checker that read a 403 as "not there" would, on such
 * a run, find every picture in the shop missing and clear every one of them.
 * One job, and the whole picture library gone — and it would report success,
 * because from inside it did exactly what it was told.
 *
 * So `unknown` is a first-class verdict and never clears anything, and
 * `isBlanketFailure` refuses the entire run when too much of it is unknown.
 */
import { describe, expect, it } from "vitest";

import {
  absoluteUrl,
  DEFAULT_MAX_DEAD_SHARE,
  isBlanketFailure,
  prefixFor,
  r2ListVerdictFor,
  r2VerdictFor,
  SERVING_BUCKET,
  storageKeyFor,
  verdictFor,
  WRITING_BUCKET,
} from "./lib/square-link-verdict.mjs";

const gone404 = { ok: false, kind: "http-error", status: 404 };
const gone410 = { ok: false, kind: "http-error", status: 410 };

describe("one URL's verdict", () => {
  it("calls a 200 alive without paying for a second request", () => {
    expect(verdictFor(200, null)).toBe("alive");
    expect(verdictFor(204, null)).toBe("alive");
  });

  it("calls a file that answered 404 twice dead", () => {
    expect(verdictFor(404, gone404)).toBe("dead");
    expect(verdictFor(410, gone410)).toBe("dead");
  });

  /*
    THE ONE THAT MATTERS. Every one of these is a reason we could not ask, and
    not one of them is evidence that a picture is missing.
  */
  it.each([403, 401, 429, 500, 502, 503, 504])("never clears on a %i", (status) => {
    expect(verdictFor(status, null)).toBe("unknown");
  });

  it("never clears when the request did not complete at all", () => {
    /* A timeout or a DNS failure reaches the caller as no status at all. */
    expect(verdictFor(undefined, null)).toBe("unknown");
    expect(verdictFor(null, null)).toBe("unknown");
    expect(verdictFor(0, null)).toBe("unknown");
  });

  /*
    A HEAD that said gone is not enough on its own. Some hosts answer 404 to a
    HEAD and serve the file to a GET, and the cost of being wrong here is the
    owner's work.
  */
  it("will not call a link dead on the HEAD alone", () => {
    expect(verdictFor(404, null)).toBe("unknown");
  });

  it("believes the GET over the HEAD when they disagree", () => {
    expect(verdictFor(404, { ok: true, kind: "image", status: 200 })).toBe("alive");
  });

  /*
    A 404 from the HEAD and a TIMEOUT from the GET is not two answers; it is one
    answer and one silence.
  */
  it("needs the second answer to be an answer", () => {
    expect(verdictFor(404, { ok: false, kind: "unreachable" })).toBe("unknown");
    expect(verdictFor(404, { ok: false, kind: "http-error", status: 403 })).toBe("unknown");
  });

  /*
    A file that is there but is an error page is a different fault, repaired by
    a different script. This one only removes links to files that are ABSENT.
  */
  it("does not clear a link that serves something which is not an image", () => {
    expect(verdictFor(200, null)).toBe("alive");
    expect(verdictFor(404, { ok: false, kind: "html", status: 200 })).toBe("unknown");
  });
});

describe("the whole run's refusal", () => {
  it("lets an ordinary run through", () => {
    /* Six dead among several hundred is what the audit actually found. */
    expect(isBlanketFailure({ alive: 594, dead: 6, unknown: 0 })).toBe(false);
  });

  it("refuses the run when nothing could be asked", () => {
    expect(isBlanketFailure({ alive: 0, dead: 0, unknown: 600 })).toBe(true);
  });

  /*
    THE SHAPE OF A BLOCKED RUNNER: no dead links at all, because a 403 is never
    dead — and a guard that only watched `dead` would have waved this through.
  */
  it("counts the unknowns, not just the dead", () => {
    expect(isBlanketFailure({ alive: 400, dead: 0, unknown: 200 })).toBe(true);
  });

  it("refuses at just over the share, and allows at just under", () => {
    expect(isBlanketFailure({ alive: 900, dead: 101, unknown: 0 }, 0.1)).toBe(true);
    expect(isBlanketFailure({ alive: 901, dead: 99, unknown: 0 }, 0.1)).toBe(false);
  });

  it("holds the default at a tenth", () => {
    expect(DEFAULT_MAX_DEAD_SHARE).toBe(0.1);
  });

  it("is not a refusal when there was nothing to probe", () => {
    expect(isBlanketFailure({ alive: 0, dead: 0, unknown: 0 })).toBe(false);
  });

  it("survives counts it was handed as rubbish", () => {
    expect(isBlanketFailure(null)).toBe(false);
    expect(isBlanketFailure({})).toBe(false);
  });
});

describe("making a stored value addressable", () => {
  it("leaves an absolute URL alone", () => {
    expect(absoluteUrl("https://assets.banan.to/a.webp", "https://banan.to")).toBe(
      "https://assets.banan.to/a.webp",
    );
  });

  it("puts the shop's origin in front of a stored path", () => {
    expect(absoluteUrl("/api/files/products/a.webp", "https://banan.to")).toBe(
      "https://banan.to/api/files/products/a.webp",
    );
  });

  it("does not double the slash when the origin carries one", () => {
    expect(absoluteUrl("/api/files/a.webp", "https://banan.to/")).toBe(
      "https://banan.to/api/files/a.webp",
    );
  });

  /*
    Returns "" rather than guessing, and the caller reads that as `unknown`. A
    value this cannot address is a value it cannot judge.
  */
  it.each(["", "   ", "data:image/png;base64,AAAA", "a.webp", "[object Object]"])(
    "refuses to address %o",
    (value) => {
      expect(absoluteUrl(value, "https://banan.to")).toBe("");
    },
  );

  it("survives a value that is not a string", () => {
    expect(absoluteUrl(null, "https://banan.to")).toBe("");
    expect(absoluteUrl(undefined, "https://banan.to")).toBe("");
  });
});

describe("this shop's own files, asked of R2 rather than of the website", () => {
  /*
    THE FIRST RUN OF THIS SCRIPT CALLED 94.3% OF THE SHOP'S PICTURES MISSING.

    It asked `https://banan.to/api/files/...` with a HEAD. `src/routes/api/files/$.ts`
    registers a GET handler and no HEAD one, so the router answers 404 to every
    HEAD — for a file that is there exactly as loudly as for one that is not.
    The cheap question was not a question at all, and the blanket guard is the
    only reason the answer did not reach the catalogue.

    R2 is asked now: no router, no edge, no cache, and a status that means what
    it says.
  */
  it("reads the storage key out of one of our URLs", () => {
    expect(storageKeyFor("/api/files/products/prd_x/square-card-abc.webp")).toBe(
      "files/products/prd_x/square-card-abc.webp",
    );
    expect(storageKeyFor("https://banan.to/api/files/products/prd_x/a.webp")).toBe(
      "files/products/prd_x/a.webp",
    );
  });

  /* `?w=600` is a resize instruction to the route, not part of the object key. */
  it("drops the route's own query before asking storage", () => {
    expect(storageKeyFor("/api/files/products/prd_x/a.webp?w=600&q=85")).toBe(
      "files/products/prd_x/a.webp",
    );
  });

  it("has no key for a URL that is not ours", () => {
    expect(storageKeyFor("https://assets.nintendo.com/a.png")).toBe(null);
    expect(storageKeyFor("/images/a.png")).toBe(null);
    expect(storageKeyFor("")).toBe(null);
    expect(storageKeyFor(null)).toBe(null);
  });

  it("is alive when the bucket the site reads from has it", () => {
    expect(r2VerdictFor(200, null)).toBe("alive");
    expect(r2VerdictFor(206, null)).toBe("alive");
  });

  it("is dead only when BOTH buckets answered 404", () => {
    expect(r2VerdictFor(404, 404)).toBe("dead");
  });

  /*
    THE VERDICT THIS WHOLE SECOND BUCKET EXISTS FOR. `square-card-fill.mjs`
    writes to `CLOUDFLARE_R2_BUCKET_NAME || "bananto"` and stores a URL the site
    serves out of `bananto-private`. Whether those are the same bucket depends
    on a secret this repository cannot read. If they are not, the picture EXISTS
    — and clearing its URL would destroy real work to fix a routing mistake.
  */
  it("will not call a file missing when it is merely in the other bucket", () => {
    expect(r2VerdictFor(404, 200)).toBe("misplaced");
  });

  it("names the two buckets it is talking about", () => {
    expect(SERVING_BUCKET).toBe("bananto-private");
    expect(WRITING_BUCKET).toBe("bananto");
  });

  it.each([401, 403, 429, 500, 503])("never clears when the API answered %i", (status) => {
    expect(r2VerdictFor(status, null)).toBe("unknown");
    expect(r2VerdictFor(404, status)).toBe("unknown");
  });

  it("never clears when a request did not complete", () => {
    expect(r2VerdictFor(null, null)).toBe("unknown");
    expect(r2VerdictFor(404, null)).toBe("unknown");
  });

  /*
    A misplaced file is an ANSWER, not a failure to see. Both buckets replied
    and agreed where the object is. Counting it against the guard would make a
    real finding about the shop look like a broken checker and abort the run
    that found it.
  */
  it("does not let a misplaced file trip the blocked-runner guard", () => {
    expect(isBlanketFailure({ alive: 10, dead: 0, unknown: 0, misplaced: 590 })).toBe(false);
    expect(isBlanketFailure({ alive: 10, dead: 0, unknown: 590, misplaced: 0 })).toBe(true);
  });
});

describe("one listing instead of one request per picture", () => {
  /*
    The first R2 version asked for each object with `range: bytes=0-0`. The
    REST object endpoint sends the BYTES, and thirteen minutes into the run it
    was still downloading the catalogue's square cards. A prefix listing costs
    one request per folder and transfers keys.
  */
  it("takes the folder an object should be in", () => {
    expect(prefixFor("files/products/prd_x/square-card-abc.webp")).toBe("files/products/prd_x/");
    expect(prefixFor("files/a.webp")).toBe("files/");
  });

  it("has no prefix for a key with no folder", () => {
    expect(prefixFor("a.webp")).toBe("");
    expect(prefixFor("")).toBe("");
    expect(prefixFor(null)).toBe("");
  });

  const KEY = "files/products/prd_x/square-card-abc.webp";

  it("is alive when the serving bucket's folder holds it", () => {
    expect(r2ListVerdictFor(KEY, new Set([KEY]), null)).toBe("alive");
  });

  it("is dead when neither folder holds it", () => {
    expect(r2ListVerdictFor(KEY, new Set(), new Set())).toBe("dead");
    expect(r2ListVerdictFor(KEY, new Set(["files/products/prd_x/front-box-1.webp"]), new Set())).toBe(
      "dead",
    );
  });

  it("is misplaced when only the bucket the scripts write to holds it", () => {
    expect(r2ListVerdictFor(KEY, new Set(), new Set([KEY]))).toBe("misplaced");
  });

  /*
    THE ONE THAT MATTERS, and it is the same distinction as everywhere else in
    this file: a folder that could not be READ is not a folder with nothing in
    it. `null` must never become `dead`.
  */
  it("never calls a picture missing because a listing failed", () => {
    expect(r2ListVerdictFor(KEY, null, null)).toBe("unknown");
    expect(r2ListVerdictFor(KEY, null, new Set([KEY]))).toBe("unknown");
    expect(r2ListVerdictFor(KEY, new Set(), null)).toBe("unknown");
  });

  /* An empty Set is a real answer — the folder is there and it is empty. */
  it("does distinguish an empty folder from an unreadable one", () => {
    expect(r2ListVerdictFor(KEY, new Set(), new Set())).toBe("dead");
    expect(r2ListVerdictFor(KEY, null, new Set())).toBe("unknown");
  });
});
