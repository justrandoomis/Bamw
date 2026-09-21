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
    expect(FILL).toMatch(/filled \+ noPage \+ noSquare !== missing\.length/);
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
