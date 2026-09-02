import { describe, expect, it } from "vitest";

import { parseGameImport } from "./gameImportParser";
import { GAME_IMPORT_SCHEMA } from "./gameImportSchema";
import { generateGameImportTemplate } from "./gameImportGenerator";

/**
 * Repeatable import fields must not be capped at three.
 *
 * The parser was never capped — it reads whatever indices the file contains.
 * The *template* was: it printed three slots for most groups and nothing said
 * otherwise, so every extraction run learned "three genres, three FAQs, three
 * sources" from the shape of the file it was given.
 *
 * These lock both halves: the parser genuinely consumes N, and the template
 * says out loud that N is allowed.
 */

/*
  A complete, valid import — not a minimal one.

  These tests assert that a file with N repeated entries parses with no errors,
  so the fixture has to satisfy every rule the parser enforces, not just the
  repeat handling. The device-performance record is the one that made them
  fail: a game must now carry a performance record for its own platform, and a
  fixture without one is genuinely invalid rather than incidentally so. Stating
  "the figures are not published, here is the source" is the shortest honest
  way to satisfy it, and it keeps `errorsOf(result)` a real assertion instead of
  something that had to be weakened.
*/
const HEADER = `schema_version=1
name=Test Game
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.device_slug=nintendo-switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures for this title.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
`;

function build(lines: string[]): string {
  return HEADER + lines.join("\n") + "\n";
}

function errorsOf(result: ReturnType<typeof parseGameImport>) {
  return result.errors.filter((issue) => issue.severity === "error");
}

describe("the parser consumes every numbered entry, however many", () => {
  for (const n of [1, 3, 10, 30]) {
    it(`reads ${n} genres`, () => {
      const lines = Array.from({ length: n }, (_, i) => `genre.${i + 1}=Genre ${i + 1}`);
      const result = parseGameImport(build(lines));
      expect(errorsOf(result)).toEqual([]);
      expect((result.data as Record<string, unknown>)["genres"]).toHaveLength(n);
    });

    it(`reads ${n} gallery images`, () => {
      const lines = Array.from(
        { length: n },
        (_, i) => `gallery.${i + 1}.image=https://cdn.example/shot-${i + 1}.webp`,
      );
      const result = parseGameImport(build(lines));
      expect(errorsOf(result)).toEqual([]);
      const gallery = (result.data as Record<string, unknown>)["galleryImages"] as unknown[];
      expect(gallery).toHaveLength(n);
    });

    it(`reads ${n} sources`, () => {
      const lines = Array.from({ length: n }, (_, i) =>
        [`source.${i + 1}.name=Source ${i + 1}`, `source.${i + 1}.url=https://s${i + 1}.example`].join(
          "\n",
        ),
      );
      const result = parseGameImport(build(lines));
      expect(errorsOf(result)).toEqual([]);
      expect((result.data as Record<string, unknown>)["sources"]).toHaveLength(n);
    });

    it(`reads ${n} FAQ entries`, () => {
      const lines = Array.from({ length: n }, (_, i) =>
        [`faq.${i + 1}.question=Question ${i + 1}`, `faq.${i + 1}.answer=Answer ${i + 1}`].join(
          "\n",
        ),
      );
      const result = parseGameImport(build(lines));
      expect(errorsOf(result)).toEqual([]);
      expect((result.data as Record<string, unknown>)["faq"]).toHaveLength(n);
    });
  }

  it("keeps entries in file order rather than sorting them as strings", () => {
    // `10` before `9` is what a naive string sort produces.
    const lines = Array.from({ length: 12 }, (_, i) => `genre.${i + 1}=G${i + 1}`);
    const result = parseGameImport(build(lines));
    const genres = (result.data as Record<string, unknown>)["genres"] as string[];
    expect(genres[8]).toBe("G9");
    expect(genres[9]).toBe("G10");
    expect(genres[11]).toBe("G12");
  });

  it("does not stop at the first gap in the numbering", () => {
    const result = parseGameImport(
      build(["genre.1=First", "genre.2=Second", "genre.7=Seventh", "genre.20=Twentieth"]),
    );
    const genres = (result.data as Record<string, unknown>)["genres"] as string[];
    expect(genres).toContain("Seventh");
    expect(genres).toContain("Twentieth");
  });
});

describe("no repeatable field is capped by accident", () => {
  /*
    `option` is genuinely two, by business rule: every game is sold as an
    offline account and an online account. A bounded field is not an artificial
    cap — it is the product model — so it is named here rather than silently
    passing a "more than three" rule.
  */
  const INTENTIONALLY_BOUNDED = new Set(["option"]);

  it("gives every open-ended group room for more than three entries in the template", () => {
    const capped = GAME_IMPORT_SCHEMA.filter(
      (field) =>
        field.repeatable &&
        !INTENTIONALLY_BOUNDED.has(field.key) &&
        (field.templateRepeat ?? 0) > 0 &&
        field.templateRepeat! < 4,
    ).map((field) => field.key);
    expect(capped, `these still print fewer than 4 slots: ${capped.join(", ")}`).toEqual([]);
  });
});

describe("the template says the numbering is open-ended", () => {
  const template = generateGameImportTemplate();

  it("states the rule in words, not only by example", () => {
    expect(template).toMatch(/غير محدود|open-ended|as many as|N\b/i);
  });

  it("prints enough example slots that three does not look like the limit", () => {
    const genreSlots = (template.match(/^genre\.\d+=/gm) || []).length;
    expect(genreSlots).toBeGreaterThan(3);
  });

  it("round-trips: the emitted template still parses", () => {
    const result = parseGameImport(template);
    // A template is all empty values, so field-level warnings are expected;
    // structural errors are not.
    const structural = result.errors.filter(
      (issue) => issue.severity === "error" && /unknown|malformed|parse/i.test(issue.message),
    );
    expect(structural).toEqual([]);
  });
});
