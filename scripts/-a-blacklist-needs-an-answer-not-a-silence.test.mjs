/**
 * A game is only written off when Nintendo actually answered.
 *
 * «أصلح أي فشل فعليًا، ولا تكتفِ بكتابة تقرير أو TODO.»
 *
 * `square-card-fill` remembers a failure for thirty days so the next run does
 * not re-ask a question already answered. That is only sound when the thing
 * remembered IS an answer. Two paths were writing a thirty-day verdict on a
 * silence instead:
 *
 *   1. Every url key failed in TRANSPORT — a timeout, a reset, a 403, a 429.
 *      There was a guard for it, `everyKeyUnreachable`, and it was dead code:
 *      it split the WHOLE note on "; ", and this caller always appends
 *      "; europe: <reason>", so the last element never matched `→ HTTP 0` and
 *      `.every()` was false on every run the script has ever made. The count it
 *      guards has always printed 0 — not because it never happened, but
 *      because it could not be reached.
 *
 *   2. The page WAS found and the image could not be fetched, decoded or
 *      stored. An R2 hiccup or a CDN 503 was recorded as «Nintendo has no
 *      square card for this game» and the game was skipped for a month. That
 *      path had no guard at all.
 *
 * Both are the same mistake: our own failure to ask, filed as the answer.
 *
 * ## Why this file exists rather than more lines in the existing one
 *
 * `-square-card-fill-writes-one-field.test.mjs` already has a test named «does
 * not remember a game whose every request failed in transport». It passes. It
 * has always passed, while the branch it describes was unreachable — because it
 * greps the SOURCE: the identifier is there, the regex literal is there, the
 * branch body does not call `remember`. All three true, and none of them the
 * thing that mattered.
 *
 * So the predicate is a real function now, and these tests run it against the
 * note strings production actually produced. A test that cannot execute the
 * thing it is named after is not a test of it.
 */
import { describe, expect, it } from "vitest";

import { verdictForNoPage, verdictForNoAsset } from "./lib/square-card-verdict.mjs";

/** Real notes, in the shape `media-pipeline` builds for THIS caller. */
const PRISON_ARCHITECT =
  "no Nintendo store page resolved (prison-architect-switch → HTTP 0; prison-architect → HTTP 0); europe: no comparable title";
const ONE_KEY_DOWN =
  "no Nintendo store page resolved (some-game → HTTP 0); europe: no Switch 2 row with this title";
const EU_ALSO_DOWN =
  "no Nintendo store page resolved (some-game → HTTP 0); europe: search HTTP 0";
const GENUINE_404 =
  "no Nintendo store page resolved (some-game → HTTP 404; some-game-switch → HTTP 404); europe: no comparable title";
const MIXED =
  "no Nintendo store page resolved (a → HTTP 0; b → HTTP 404); europe: no comparable title";
const IDENTITY_REJECTED =
  "no Nintendo store page resolved (some-game → HTTP 200, rejected: the page says Switch 1); europe: stored nothing";

describe("a silence is not an answer", () => {
  it("does not write off a game whose every key failed in transport", () => {
    // The exact game named in the fourth run's report, with its real note.
    expect(verdictForNoPage(PRISON_ARCHITECT)).toMatchObject({
      verdict: "unreachable",
      remember: null,
    });
  });

  it("is not defeated by the europe suffix, which is what killed the old guard", () => {
    /*
      This is the regression. The old predicate split the whole note, so
      «europe: no comparable title» — which has no arrow in it — made
      `.every()` false and the game was blacklisted. Every note this caller
      builds carries that suffix.
    */
    for (const note of [PRISON_ARCHITECT, ONE_KEY_DOWN, EU_ALSO_DOWN]) {
      expect(verdictForNoPage(note).remember, note).toBeNull();
    }
  });

  it("still writes off a game Nintendo really answered about", () => {
    // 404 is an answer: the store does not have it under any key we know.
    expect(verdictForNoPage(GENUINE_404)).toMatchObject({
      verdict: "no_listing",
      remember: "no_listing_404",
    });
  });

  it("treats one real 404 among timeouts as an answer, because it is one", () => {
    /*
      Deliberately NOT "any timeout means retry". One key returning 404 tells
      us that key is wrong; it does not tell us the others are. But we did get
      a real reply from the store, so this is the conservative middle: it is
      remembered, and the reason says which keys were never reached.
    */
    expect(verdictForNoPage(MIXED).remember).toBe("no_listing_404");
  });

  it("keeps a mislabelled game apart from a missing one", () => {
    /*
      «the page is there and the game is not the one we asked for» is a
      research job about OUR label, not a fact about Nintendo's catalogue.
      Filed under its own reason so it can be re-asked once the label is fixed,
      rather than hiding inside `no_listing_404` forever.
    */
    expect(verdictForNoPage(IDENTITY_REJECTED)).toMatchObject({
      verdict: "identity_rejected",
      remember: "identity_rejected",
    });
  });

  it("does not write off a game it never built a key for", () => {
    // `no keys tried` is the emptiest silence of all.
    expect(verdictForNoPage("no Nintendo store page resolved (); europe: no rows").remember).toBeNull();
  });

  it("refuses to guess from a note it cannot parse", () => {
    for (const note of ["", "something else entirely", null, undefined]) {
      expect(verdictForNoPage(note).remember, String(note)).toBeNull();
    }
  });
});

describe("our own failure to fetch is not the game's fault", () => {
  it("does not write off a game whose image could not be reached", () => {
    expect(verdictForNoAsset("unreachable: socket hang up")).toMatchObject({
      verdict: "asset_unreachable",
      remember: null,
    });
  });

  it("does not write off a game whose image server answered with an error", () => {
    expect(verdictForNoAsset("http-error").remember).toBeNull();
  });

  it("does not write off a game because R2 was having a bad minute", () => {
    // This is the one that turns our outage into a month of missing covers.
    expect(verdictForNoAsset("R2 store or read-back failed").remember).toBeNull();
  });

  it("does not write off a game we failed to convert or decode", () => {
    for (const reason of ["conversion failed: bad input", "undecodable: truncated"]) {
      expect(verdictForNoAsset(reason).remember, reason).toBeNull();
    }
  });

  it("writes off art that is genuinely the wrong shape", () => {
    // A fact about the picture. Retrying cannot change it.
    expect(verdictForNoAsset("shape is wide (1920×1080), the role wants square")).toMatchObject({
      verdict: "no_square_asset",
      remember: "no_square_asset",
    });
  });

  it("writes off art that is genuinely too small", () => {
    expect(verdictForNoAsset("too small (64×64)").remember).toBe("no_square_asset");
  });

  it("writes off a duplicate, which is a fact about the catalogue", () => {
    expect(verdictForNoAsset("identical bytes already used for hero").remember).toBe(
      "no_square_asset",
    );
  });

  it("writes off a page that simply carried no square candidate", () => {
    // No rejection to read means nothing was even offered for the role.
    expect(verdictForNoAsset(null).remember).toBe("no_square_asset");
    expect(verdictForNoAsset("").remember).toBe("no_square_asset");
  });

  it("errs towards asking again when it does not recognise the reason", () => {
    /*
      The asymmetry is deliberate and is the whole lesson of this file. Asking
      again costs one request. Writing off wrongly costs a month of a game
      sitting on the shop with no picture, and nobody finds out.
    */
    expect(verdictForNoAsset("some new failure nobody has seen yet").remember).toBeNull();
  });
});
