/**
 * How the games database says a fact in Arabic: dates in the Iraqi month
 * names the shop uses, players, ratings, and which facts are worth a line.
 */

/** Today as YYYY-MM-DD, the form release dates are stored in. */
export const todayIso = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** A release date still ahead of us. */
export function isUpcoming(releaseDate: string, now: Date = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) && releaseDate > todayIso(now);
}

const DATE_FORMAT = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** «12 أيار 2023», or "" for no date. */
export function formatReleaseDate(releaseDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return "";
  const date = new Date(`${releaseDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

export const releaseYear = (releaseDate: string) => (/^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : "");

/** «1-4» → «1–4 لاعبين», «1» → «لاعب واحد». */
export function playersLabel(players: string): string {
  const range = /^(\d+)-(\d+)$/.exec(players.trim());
  if (range) return `${range[1]}–${range[2]} لاعبين`;
  if (players.trim() === "1") return "لاعب واحد";
  return players.trim();
}

/** Nintendo's «Unknown» and «TBD» say nothing, and an empty fact is not drawn. */
export function ageRatingLabel(rating: string): string {
  const text = rating.trim();
  return /^(unknown|tbd|n\/a)$/i.test(text) ? "" : text;
}

/** The ways the game is sold, in the order a buyer cares about. */
export function editionsLabel(physical: boolean, digital: boolean): string {
  if (physical && digital) return "قرص ونسخة رقمية";
  if (physical) return "قرص فقط";
  if (digital) return "نسخة رقمية فقط";
  return "";
}

/** The product id inside a `/product/<id>` link the API answers with. */
export function productIdFromPath(shopPath: string | null): string | null {
  if (!shopPath || !shopPath.startsWith("/product/")) return null;
  try {
    return decodeURIComponent(shopPath.slice("/product/".length)) || null;
  } catch {
    return null;
  }
}
