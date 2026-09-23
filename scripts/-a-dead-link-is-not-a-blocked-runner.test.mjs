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
  verdictFor,
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
