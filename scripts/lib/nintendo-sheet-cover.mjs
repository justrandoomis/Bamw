/**
 * The square cover the shop already owns, and never looked at.
 *
 * The supplier sheet carries a `Cover URL` per row, and it is not a third
 * party's guess — it is Nintendo's own media, on Nintendo's own host, for the
 * row the importer matched. `catalogueImport` stores it on the product as
 * `coverImage`. Measured on `import-sources/catalogue.csv`, 607 of the 1,530
 * rows carry one and they sort by Nintendo's own directory names:
 *
 *   11_square_images            396   square key art
 *   05_packshots                172   the portrait box, not a card
 *   migration                    23   unclassified
 *   03_teaser_module_1_square    15   square
 *
 * So four hundred and eleven square covers were sitting in the shop's own
 * records while the filler asked Nintendo's US store and then Europe about
 * them and often got nothing. This is the strongest identity available
 * anywhere — no title match, no search ranking, no chance of returning a
 * different game — and it is the cheapest, because the URL is already known.
 *
 * WHAT THIS REFUSES, and why each one matters:
 *
 *   - A packshot (`05_packshots`, `PS_…`). It is the real game's real art, but
 *     it is portrait. Offering it for the card role would simply be refused by
 *     `validateCandidate`'s shape check, so refusing it here saves a download;
 *     more importantly it keeps the roles honest — provenance decides the role
 *     in this pipeline, not a lucky aspect ratio.
 *   - Anything that is not on a Nintendo host. The field is a URL from a
 *     spreadsheet and nothing stops a future row pointing somewhere else.
 *   - This shop's own `/api/...` R2 references. After a media run `coverImage`
 *     may hold the HERO this pipeline itself stored. Feeding that back as the
 *     card would copy one of our own images into a second role.
 *
 * The shape is still MEASURED downstream: this proposes, `validateCandidate`
 * fetches and measures, and only a genuinely 1:1 image is stored. A directory
 * name is a claim, not a measurement, and the claim alone is not enough.
 */

const NINTENDO_HOST = /(^|\.)nintendo\.(com|net|co\.jp|com\.hk|co\.kr)$/i;

/** Nintendo's own directories for square key art. */
const SQUARE_DIRECTORY = /\/media\/images\/(11_square_images|03_teaser_module_1_square)\//i;

/** And its own filename prefixes for the same, for a path that is not there. */
const SQUARE_FILENAME = /\/(1x1|SQ)_[^/]*$/i;

/** A packshot: the portrait box, never the card. */
const PACKSHOT = /\/media\/images\/05_packshots\//i;

/**
 * The square cover for this product, or null.
 *
 * @param {unknown} coverUrl the product's `coverImage`, straight off the record
 * @returns {{url: string, provenance: string} | null}
 */
export function sheetSquareCover(coverUrl) {
  const raw = String(coverUrl ?? "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    /* A relative `/api/...` reference — this shop's own R2, not Nintendo's. */
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!NINTENDO_HOST.test(parsed.hostname)) return null;
  if (PACKSHOT.test(parsed.pathname)) return null;

  const square = SQUARE_DIRECTORY.test(parsed.pathname) || SQUARE_FILENAME.test(parsed.pathname);
  if (!square) return null;

  return {
    url: parsed.toString(),
    provenance: "Nintendo's own square key art, from the supplier sheet's Cover URL for this row",
  };
}
