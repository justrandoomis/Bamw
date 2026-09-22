/**
 * The listing payload carries every field the listing rules read.
 *
 * `/category/$categoryId` now fetches `?slim=1` instead of the whole record,
 * which is the point — 6.78 MB against 78 fields. But the projection is a
 * fixed list of NAMES and the page decides what a member sees through helpers
 * written against the full record. A field that does not travel does not read
 * as absent-but-fine; it reads as absent:
 *
 *   - `hasUsableImage` decides whether a listing counts as having artwork, and
 *     `picturedFirst` shelves the ones that do not LAST and labels them «لم يتم
 *     إضافة الصورة بعد». A dropped image field silently re-orders the shelf,
 *     and ترتيب العرض is a thing the owner has said must not change.
 *   - the sort keys decide «الأحدث» and «تاريخ الإصدار».
 *
 * An adversarial review found `coverHiResImage` missing from the projection.
 * Measured on the live catalogue the same day: zero products relied on it
 * alone, so nothing had actually moved. The instance was empty; the CLASS is
 * not, and the next field added to either list would reopen it silently. This
 * test is the guard, and it reads both lists from their own source rather than
 * restating them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The string literals inside the first array in a file, from `anchor`. */
function literalsIn(file: string, anchor: string, end: string): string[] {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const from = source.indexOf(anchor);
  if (from < 0) throw new Error(`${anchor} not found in ${file}`);
  const to = source.indexOf(end, from);
  if (to < 0) throw new Error(`${end} not found after ${anchor} in ${file}`);
  return [...source.slice(from, to).matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1] as string);
}

const SLIM = new Set(literalsIn("src/routes/api/data.ts", "LIST_FIELDS", "] as const;"));
const IMAGE_FIELDS = literalsIn(
  "src/lib/bareListing.ts",
  "const IMAGE_FIELDS",
  "const DESCRIPTION_FIELDS",
);

describe("the slim projection and the listing rules agree", () => {
  it("parsed both lists, rather than passing on an empty one", () => {
    expect(SLIM.size).toBeGreaterThan(50);
    expect(IMAGE_FIELDS.length).toBeGreaterThanOrEqual(7);
  });

  it("carries every field that decides whether a listing has artwork", () => {
    const missing = IMAGE_FIELDS.filter((field) => !SLIM.has(field));
    expect(
      missing,
      `These fields decide ترتيب العرض through picturedFirst but do not travel in ?slim=1: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("carries every field the shelf's sort keys read", () => {
    /*
      From src/lib/listingSort.ts. Listed rather than parsed because they are
      read as property accesses, not from an array — so if that file grows a
      source, this list is what has to be updated with it.
    */
    const sortFields = [
      "releaseDate",
      "release_date",
      "releaseYear",
      "release_year",
      "createdAt",
      "created_at",
      "updatedAt",
      "updated_at",
    ];
    const missing = sortFields.filter((field) => !SLIM.has(field));
    expect(missing, `sort keys missing from the listing payload: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("carries every field that decides which SHELF a product stands on", () => {
    /*
      The sharpest of the four, because it is not a re-ordering: a product
      whose category resolves differently is on the wrong PAGE. And the
      failure is silent and one-directional — `resolveCategoryType` ends with
      `return "game"`, so anything this projection cannot resolve becomes a
      game rather than becoming nothing.
    */
    const categoryFields = [
      "category",
      "categoryId",
      "category_id",
      "categoryTitle",
      "category_title",
      "schemaId",
      "schema_id",
    ];
    const missing = categoryFields.filter((field) => !SLIM.has(field));
    expect(
      missing,
      `getProductCategory reads these but the listing payload drops them, so a non-game would resolve to "game": ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("carries the fields the genre chips and the genre filter read", () => {
    const genreFields = ["genres", "genre", "tags"];
    const missing = genreFields.filter((field) => !SLIM.has(field));
    expect(
      missing,
      `genre sources missing from the listing payload: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
