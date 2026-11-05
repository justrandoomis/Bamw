/**
 * The one rule catalogue enrichment writes by: fill what is empty, nothing else.
 *
 * A patch is a set of facts from Nintendo's own catalogue. At write time each
 * field is checked again against the LIVE product — not the snapshot the patch
 * was generated from — so an admin who wrote a description in the meantime
 * keeps it. A curated Arabic text, a hand-picked cover or a corrected date is
 * worth more than Nintendo's generic copy, so no field that has a value is
 * ever touched.
 */

/** Fields enrichment may fill. Anything else in a patch is ignored. */
export const ENRICHABLE_FIELDS = new Set([
  "tagline",
  "description",
  "descriptionEn",
  "genres",
  "publisher",
  "developer",
  "releaseDate",
  "ageRating",
  "numberOfPlayers",
  "supportedLanguages",
  "size",
  "downloadSizeGb",
  "nsuid",
  "product_code",
  "officialStoreUrl",
  "cartridgeImage",
  "nintendoCardImage",
  "coverImage",
]);

export function isEmptyValue(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "number" && !(value > 0))
  );
}

/** The part of `fill` that may be written onto `live` now. */
export function planFill(live, fill) {
  const out = {};
  if (!live || typeof live !== "object" || !fill || typeof fill !== "object") return out;
  for (const [field, value] of Object.entries(fill)) {
    if (!ENRICHABLE_FIELDS.has(field)) continue;
    if (isEmptyValue(value)) continue;
    if (!isEmptyValue(live[field])) continue;
    out[field] = value;
  }
  return out;
}
