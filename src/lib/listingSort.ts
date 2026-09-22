/**
 * How a shelf decides what comes first.
 *
 * These lived inside the category page's sort comparator, rebuilt on every
 * comparison — about 29,270 calls to sort 1,714 games, each constructing up to
 * two `Date`s and running up to two regexes over a string. Measured on this
 * catalogue: 35.2 ms against 2.9 ms for the identical ordering with the key
 * computed once per product.
 *
 * Out here they are computed once, shared, and testable — which matters more
 * than the speed: a faster sort that orders the shelf differently is not a
 * faster sort, it is a bug, and there was no way to check that while they were
 * closures inside a route.
 */

/**
 * A release date, however the record happens to spell it.
 *
 * Pulled out of the comparator it used to live in. The parsing is unchanged —
 * ISO first, then a day-month-year with any of three separators, then a bare
 * four-digit year — because a catalogue imported from several sources spells
 * dates every way there is and the shelf order should not depend on which.
 */
export function releaseTime(p: any): number {
  const d =
    p.releaseDate ||
    p.release_date ||
    p.metadata?.releaseDate ||
    p.metadata?.release_date ||
    p.releaseYear ||
    p.release_year;
  if (!d) return 0;

  /*
    A bare number is a YEAR, not a timestamp.

    `releaseYear: 1998` went through `new Date(1998)`, which is 1998
    MILLISECONDS past the epoch — so a 1998 game sorted as though it came out
    in January 1970, and `isNaN` never fired to send it to the year regex
    below. Found by the test written to prove this refactor changed nothing;
    it changed this, deliberately, because a shelf that files every
    numerically-dated game at the dawn of time is not an ordering anyone chose.
  */
  if (typeof d === "number" && d > 1900 && d < 2200) {
    return new Date(String(Math.trunc(d))).getTime();
  }

  let val = new Date(d).getTime();
  if (isNaN(val)) {
    /*
      Only reached for a string `new Date` REFUSED — and it refuses exactly
      the ones this branch can read unambiguously. "08-03-2019", "08.03.2019"
      and "08/03/2019" all parse, month-first, as the third of August, so this
      never sees them; "28-03-2019" cannot be a month-first date at all, is
      refused, and lands here, where day-month is the only reading left. The
      two paths therefore never disagree about the same string. Left exactly
      as it was: changing which reading wins would silently re-date part of
      the catalogue, and nobody has asked for that.
    */
    const dmMatch = String(d).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (dmMatch) val = new Date(`${dmMatch[3]}-${dmMatch[2]}-${dmMatch[1]}`).getTime();
    if (isNaN(val)) {
      const match = String(d).match(/\b(20\d{2}|19\d{2})\b/);
      if (match) val = new Date(match[0]).getTime();
    }
  }
  return isNaN(val) ? 0 : val;
}

/**
 * How new a listing is: whichever is later, when it was added or when it came out.
 *
 * A game added to the shop today but released in 2017 is new TO THIS SHOP, and
 * a 2026 release added months ago is new to the world. The default shelf order
 * wants both, so it takes the larger.
 */
export function freshnessScore(p: any): number {
  const createTime =
    new Date(p.createdAt || p.created_at || p.updatedAt || p.updated_at || 0).getTime() || 0;
  return Math.max(createTime, releaseTime(p));
}
