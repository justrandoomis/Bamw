/**
 * Whether a product has actually come out yet.
 *
 * A pre-order in this catalogue is an ordinary product with a price and a
 * future release date — nothing stopped a customer buying one, so the store
 * took money for a game it could not hand over. The customer registers
 * interest instead, and the moment the date passes the product becomes
 * buyable on its own: the rule is read at request time, so nothing has to run
 * and no admin has to remember to flip a switch.
 *
 * The one rule that matters here: **an unreadable date means released**. Every
 * product in the catalogue is sellable today, and a parser that guessed at
 * "TBA", "Q1 2026" or a stray year would take working products off sale. Only
 * a date this can read, that is genuinely in the future, blocks a sale.
 */

/** `YYYY-MM-DD`, optionally followed by a time. Anything else is not a date. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

const RELEASE_FIELDS = ["releaseDate", "release_date", "releasedAt", "released_at"] as const;

/**
 * The moment a product becomes available, or null when nothing readable says.
 *
 * A date with no time is read as midnight UTC, which for a Baghdad shopper
 * falls three hours *after* local midnight. Late is the safe direction: the
 * store never offers a game before the publisher does.
 */
export function releaseMoment(product: unknown): Date | null {
  if (!product || typeof product !== "object") return null;
  const record = product as Record<string, unknown>;

  for (const field of RELEASE_FIELDS) {
    const raw = record[field];
    if (typeof raw !== "string") continue;
    const match = ISO_DATE.exec(raw.trim());
    if (!match) continue;

    const [, year, month, day, hour, minute, second] = match;
    const moment = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour ?? 0),
        Number(minute ?? 0),
        Number(second ?? 0),
      ),
    );
    if (Number.isNaN(moment.getTime())) continue;
    // `Date.UTC` rolls 2026-13-45 forward into a real date rather than
    // refusing it. A month or day that did not survive the round trip was
    // never a date, and guessing at it could hide a product for months.
    if (
      moment.getUTCFullYear() !== Number(year) ||
      moment.getUTCMonth() !== Number(month) - 1 ||
      moment.getUTCDate() !== Number(day)
    ) {
      continue;
    }
    return moment;
  }
  return null;
}

/** Out already — including everything that never named a release date. */
export function isReleased(product: unknown, now: Date = new Date()): boolean {
  const moment = releaseMoment(product);
  if (!moment) return true;
  return moment.getTime() <= now.getTime();
}

/**
 * Announced, priced, and not out yet: the customer may register, not buy.
 */
export function isAwaitingRelease(product: unknown, now: Date = new Date()): boolean {
  return !isReleased(product, now);
}

/** The release date as a plain `YYYY-MM-DD`, for display and for storage. */
export function releaseDayISO(product: unknown): string | null {
  const moment = releaseMoment(product);
  return moment ? moment.toISOString().slice(0, 10) : null;
}
