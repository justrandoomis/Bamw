/**
 * A listing that is only a name and a price.
 *
 * The owner's supplier catalogue is roughly fifteen hundred Switch titles with
 * nothing attached but an English name, a cost and an offline selling price.
 * They go on sale in that state on purpose: a customer can find one, see what
 * it costs, and order it, while the pictures, the description and the rest of
 * the fields are filled in over the following weeks. A shop that waits until
 * every field is researched sells nothing for a year.
 *
 * This is the one definition of "still only a name and a price", and it is
 * **derived, never stored as a flag**. That matters: the moment an admin gives
 * a game a cover and a description it stops being one, with nothing to
 * remember to untick. A flag would have to be cleared by hand, and the field
 * everybody forgets is the field that makes the filter lie.
 *
 * The floor it measures against is deliberately the *same* one
 * `publishGate.ts` refuses to publish below — an image and forty characters of
 * description. Two lists would drift, and then "needs details" and "cannot be
 * published" would mean different things while reading as though they meant
 * the same.
 */

/** A URL that will actually render, as opposed to a placeholder someone left. */
function usableImage(value: unknown): boolean {
  const url = String(value ?? "").trim();
  if (!url) return false;
  if (/^(undefined|null|n\/a|-|—)$/i.test(url)) return false;
  if (/^\[?circular\]?$/i.test(url)) return false;
  return /^(https?:\/\/|\/)/.test(url);
}

function text(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .trim();
}

/*
  The same field lists publishGate.ts checks, for the reason in the header.
  Kept here rather than imported from there because the direction of the
  dependency matters: the gate is about refusing a save, this is about
  describing a row, and the gate must not start importing display code.
*/
const IMAGE_FIELDS = [
  "coverImage",
  "cartridgeImage",
  "mainImage",
  "listingImage",
  "image",
  "coverHiResImage",
  "nintendoCardImage",
];

const DESCRIPTION_FIELDS = ["description", "descriptionEn", "descriptionAr", "descriptionShort"];

/** Forty characters, the same length the publication floor calls a description. */
export const DESCRIPTION_FLOOR = 40;

export function hasUsableImage(product: Record<string, unknown> | undefined): boolean {
  if (!product) return false;
  return IMAGE_FIELDS.some((field) => usableImage(product[field]));
}

export function hasRealDescription(product: Record<string, unknown> | undefined): boolean {
  if (!product) return false;
  return DESCRIPTION_FIELDS.some((field) => text(product[field]).length >= DESCRIPTION_FLOOR);
}

/**
 * Whether this product is still only a name and a price.
 *
 * A price is required: a record with neither a price nor any details is not a
 * listing awaiting its details, it is an empty row, and the «غير المسعّرة»
 * filter is the one that already names that. Counting it here as well would
 * put the same product under two chips and make the two numbers add up to more
 * than the catalogue.
 */
export function isBareListing(product: Record<string, unknown> | undefined): boolean {
  if (!product) return false;
  const price = Number(product["price"]);
  if (!Number.isFinite(price) || price <= 0) return false;
  return !hasUsableImage(product) && !hasRealDescription(product);
}

/**
 * What this listing is still missing, in Arabic, for the admin.
 *
 * Returned as a list rather than a sentence so the caller decides whether it
 * is a badge, a tooltip or a line — and so a listing that has a cover but no
 * description says so, instead of being described as empty.
 */
export function bareListingGaps(product: Record<string, unknown> | undefined): string[] {
  const gaps: string[] = [];
  if (!hasUsableImage(product)) gaps.push("صورة");
  if (!hasRealDescription(product)) gaps.push("وصف");
  return gaps;
}
