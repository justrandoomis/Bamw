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

/** The picture fields a repair may write: each its own role, as the fill writes them. */
export const REPAIRABLE_PICTURES = new Set(["cartridgeImage", "nintendoCardImage", "coverImage"]);

/**
 * The part of `repair` that may be written onto `live` now: a picture whose
 * stored link points at a file proven gone (`isDead`, from listing the
 * buckets) is replaced by Nintendo's picture for the same role. Nothing else:
 * not a live picture, not an unknown one, not a field that is not a picture,
 * not with an empty or non-web value. This is the one place the enrichment
 * writes over a value, and only over a link to nothing.
 */
export function planRepair(live, repair, isDead) {
  const out = {};
  if (!live || typeof live !== "object" || !repair || typeof repair !== "object") return out;
  for (const [field, value] of Object.entries(repair)) {
    if (!REPAIRABLE_PICTURES.has(field)) continue;
    if (typeof value !== "string" || !/^https:\/\/\S+$/i.test(value.trim())) continue;
    const current = live[field];
    if (isEmptyValue(current) || typeof current !== "string") continue;
    if (!isDead(current.trim())) continue;
    out[field] = value.trim();
  }
  return out;
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
