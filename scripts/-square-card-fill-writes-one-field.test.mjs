/**
 * The square-card fill writes a picture and nothing else.
 *
 * The owner's standing rule is that this tooling may not move commercial data
 * — «السعر، الكلفة، المخزون، الإخفاء أو الظهور، خيارات Offline/Online،
 * الأنواع، قيم Trade-In، ترتيب العرض، بيانات المبيعات» — and a filler that
 * walks nine hundred products with `updateStore` in its hand is exactly the
 * shape of tool that breaks it by accident.
 *
 * These read the script's source with comments stripped, because the rule is
 * about which field names the file is allowed to mention at all. A test that
 * ran the script would need Cloudflare, Nintendo and R2; a test that reads it
 * catches the one edit that matters.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const FILL = strip(readFileSync(resolve(process.cwd(), "scripts/square-card-fill.mjs"), "utf8"));
const PIPELINE = strip(
  readFileSync(resolve(process.cwd(), "scripts/lib/media-pipeline.mjs"), "utf8"),
);

describe("what the fill is allowed to write", () => {
  it("asks the media pipeline for the square card and no other role", () => {
    expect(FILL).toMatch(/roles:\s*\[ROLE\]/);
    expect(FILL).toMatch(/const ROLE = "nintendoCardImage"/);
  });

  it("names no commercial field anywhere in the write", () => {
    /*
      Not a stylistic rule. `updateStore` replaces the product object, so any
      one of these appearing in the mapper is a value being set.
    */
    for (const field of [
      "price",
      "cost",
      "stock",
      "hidden",
      "displayOrder",
      "sortOrder",
      "tradeIn",
      "options",
      "kind",
    ]) {
      expect(FILL).not.toMatch(new RegExp(`\\[?["']?${field}["']?\\]?\\s*:`));
    }
  });

  it("writes only the canonical square-card field, and checks it is canonical", () => {
    expect(FILL).toContain("SQUARE_CARD_FIELDS[0]");
    // The run refuses rather than guessing if that name ever stops being ours.
    expect(FILL).toMatch(/if \(field !== ROLE\)/);
  });

  it("never overwrites a card a game already has", () => {
    expect(FILL).toMatch(/if \(app\.hasNintendoSquareCard\(item\)\) return item/);
  });

  it("is a dry run unless --apply is passed", () => {
    expect(FILL).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(FILL).toMatch(/if \(APPLY && patches\.size > 0\)/);
  });

  it("refuses to report a pass whose tallies do not add up", () => {
    /*
      Every game in the slice is accounted for by exactly one outcome —
      filled, no listing, no square asset, or never reached because the
      deadline stopped the loop. A run that loses rows must not exit 0.
    */
    expect(FILL).toMatch(
      /filled \+ noPage \+ noSquare \+ stoppedEarly !== missing\.length/,
    );
  });

  it("stops before the job's timeout can discard what it collected", () => {
    /*
      The document is written once at the end, which is right everywhere
      except at the boundary: a run killed by the timeout loses every picture
      it had found but not yet stored.
    */
    expect(FILL).toMatch(/const outOfTime = \(\) =>/);
    expect(FILL).toMatch(/if \(outOfTime\(\)\) \{/);
  });
});

describe("one role costs one role's work", () => {
  it("skips the printed sleeve when no role is cut from it", () => {
    /*
      The GameTDB wrap answers `coverHiResImage` and `cartridgeImage`. Left
      unconditional it downloads a full printed sleeve for every game in a run
      that wants only the square card — most of the wall clock, for bytes that
      are then discarded.
    */
    expect(PIPELINE).toMatch(/wanted\.some\(\(role\) => WRAP_ROLES\.has\(role\)\)/);
  });

  it("still fills every role when no subset is asked for", () => {
    expect(PIPELINE).toMatch(/roles = ROLES/);
    expect(PIPELINE).toMatch(/const wanted = ROLES\.filter\(\(role\) => roles\.includes\(role\)\)/);
  });
});

describe("successive runs make forward progress", () => {
  it("remembers a game Nintendo answered nothing for", () => {
    /*
      Measured before this existed: the second apply run wrote twenty-eight
      cards in forty-two minutes. The list is ordered by id and the four
      hundred games that failed the first run sit all through the front of it,
      so the run re-asked about games Nintendo does not have and barely
      reached the ones it had never seen.
    */
    expect(FILL).toContain("square_card_attempts");
    expect(FILL).toMatch(/await remember\(id, "no_listing"\)/);
    expect(FILL).toMatch(/await remember\(id, "no_square_asset"\)/);
  });

  it("does not remember a request that simply failed", () => {
    /*
      A timeout or a rate limit says nothing about whether Nintendo has the
      game. A run that remembered its own network faults would skip games it
      never actually asked about — which is worse than the problem, because it
      is invisible.
    */
    const thrown = FILL.slice(FILL.indexOf("} catch (err) {"));
    const untilContinue = thrown.slice(0, thrown.indexOf("continue;"));
    expect(untilContinue).not.toContain("remember(");
  });

  it("writes nothing to that memory on a dry run", () => {
    // Otherwise a dry run teaches the next apply to skip.
    expect(FILL).toMatch(/async function remember\([\s\S]{0,80}?if \(!APPLY\) return;/);
  });

  it("lets the memory be overridden and lets it go stale", () => {
    // Nintendo does add listings; a "no" is not forever.
    expect(FILL).toContain("--retry-failed");
    expect(FILL).toMatch(/STALE_DAYS/);
  });
});
