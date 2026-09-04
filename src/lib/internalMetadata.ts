/**
 * Recognises internal supplier/import notes that must never reach a customer.
 *
 * ## Why a detector and not just a schema change
 *
 * `type.N.description` sat directly under `type.N.cost` in the import template
 * with no guidance about who it was for, so extraction runs wrote the cost
 * derivation there:
 *
 *     "Supplier Regular / 普通版 converted to IQD using 1 CNY = 220 IQD
 *      and rounded down to nearest 250 IQD"
 *
 * `buildEditions` turns a variant description with no `contents` into a
 * customer-visible row in the editions comparison — so that sentence was
 * printed on the product page, next to the price, in front of buyers.
 *
 * A dedicated `internal_note` field (added to the schema alongside this) stops
 * *future* imports doing it. It does nothing for the rows already in
 * production D1, and this session cannot run a migration against them. So the
 * public serializer strips these at read time as well: existing products are
 * clean on the very next request, with no migration and no data rewritten.
 *
 * ## The bias
 *
 * Deliberately biased toward treating text as internal. A customer losing one
 * edition sub-line is a cosmetic gap; a customer reading our supplier cost
 * formula is a commercial leak. Every pattern below is vocabulary that belongs
 * to procurement, not to a game description.
 */

/**
 * Phrases that only appear in supplier/import bookkeeping.
 *
 * Each is sufficient on its own — none of them has an innocent reading in a
 * sentence describing a game edition to a shopper.
 */
const INTERNAL_PATTERNS: RegExp[] = [
  // Supplier vocabulary.
  /\bsupplier\b/i,
  /\bwholesale\b/i,
  // No `\b` on the Arabic patterns: JavaScript word boundaries are defined
  // against `\w`, which is ASCII-only, so `\bمورد\b` never matches anything.
  /مورد|المورّد|المورد/,

  // Chinese edition names from the supplier's own catalogue. An Arabic
  // storefront describing a game to a buyer does not reach for these.
  /普通版|标准版|豪华版|典藏版|限定版|数字版/,

  // Currency conversion and rounding rules — cost derivation, by definition.
  /\bCNY\b/i,
  /\bRMB\b/i,
  /\bconverted\s+to\s+(?:IQD|USD|EUR)\b/i,
  /\b1\s*(?:CNY|RMB|USD)\s*=/i,
  /rounded\s+(?:down|up)\s+to\b/i,
  /nearest\s+\d+\s*(?:IQD|USD|EUR)?\b/i,
  /\bexchange\s+rate\b/i,
  /سعر\s+الصرف/,
  /التحويل\s+إلى\s+الدينار/,

  /*
    Pricing bookkeeping written into a customer-facing field.

    The gift card's denomination row carried "سعر البيع: 7,000 د.ع" as stored
    copy, printed beside a header showing a different number — because a
    price written into prose is a price nothing ever updates. The template
    puts `variant.N.description` directly beneath `variant.N.price` and
    `variant.N.cost`, which is the same adjacency that put a cost derivation
    into `type.N.description`.

    Each requires the colon, so ordinary prose about a game's value does not
    match — only a line that is stating a figure.
  */
  /سعر\s*البيع\s*[:：]/,
  /\bselling\s*price\s*[:：]/i,
  /*
    The same figure stated without a colon, which is how the gift-card rows
    write it: "20 USD face value; selling price 28000 IQD at the
    merchant-defined rate of 1400 IQD/USD". A number immediately after the
    words is bookkeeping — prose about what a game is worth does not read
    that way.
  */
  /\bselling\s+price\s+\d/i,
  /\bmerchant[-\s]?defined\s+rate\b/i,
  /\bIQD\s*\/\s*(?:USD|CNY|EUR)\b/i,
  /\bacquisition\s+cost\b/i,
  /\bmerchant\s+stock\b/i,
  // An instruction to whoever fulfils the order, not to the person buying.
  /\bdisclose\b[^.]*\bbefore\s+sale\b/i,
  /\bmerchant\s+pricing\b/i,
  /\bcalculated\s+as\b.*\b(?:IQD|USD|CNY)\b/i,
  /\b\d[\d,.]*\s*IQD\s+per\s+(?:USD|CNY|EUR)\b/i,
  /\bper\s+USD\b/i,
  /سعر\s*الشراء\s*[:：]/,
  /(?:التكلفة|الكلفة)\s*[:：]/,
  /(?:هامش\s+)?الربح\s*[:：]/,
  /\b(?:cost|profit|margin|markup)\s*[:：]\s*\d/i,

  // Import/extraction bookkeeping.
  /\bextraction\b/i,
  /\bimport\s+(?:note|rule|mapping)\b/i,
  /\bparsed\s+from\b/i,
  /\bschema_version\b/i,
  /ملاحظة\s+داخلية/,
  /للاستخدام\s+الداخلي/,
];

/**
 * Does this customer-facing string actually contain internal bookkeeping?
 *
 * Whitespace-only and non-string values are not internal — they are simply
 * empty, and the caller drops them for their own reasons.
 */
export function looksLikeInternalNote(value: unknown): boolean {
  return internalNoteReason(value) !== undefined;
}

/**
 * Which pattern decided, as its source text — or `undefined` for clean text.
 *
 * The detector is deliberately biased toward calling text internal, and a
 * biased rule needs to be able to say why: a false positive silently deletes a
 * sentence a customer was meant to read, and "the filter removed it" is not a
 * reviewable answer. The repair tool prints this beside every line it drops.
 */
export function internalNoteReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return INTERNAL_PATTERNS.find((pattern) => pattern.test(text))?.source;
}

/**
 * One line, split where a sentence ends.
 *
 * The delimiter stays with the sentence it closes, so re-joining the survivors
 * with a single space produces readable prose.
 */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?؟。])\s+/);
}

/**
 * The sentences of one line that a customer may read, re-joined.
 *
 * Filtering whole lines was too coarse for how these records are actually
 * written. The gift cards keep a paragraph like:
 *
 *     "US code balances do not expire … No physical card, console, pictured
 *      game or accessory is included. Actual merchant stock and supplier
 *      acquisition cost still require confirmation."
 *
 * — four sentences of genuine customer policy and one note to ourselves. A
 * line filter removes all five, so the fix for a leak silently deleted the
 * terms the buyer needed. The variant rows are worse: their one line carries
 * the cost derivation *and* the "no coupon applies to this product" exclusion,
 * so the customer lost the exclusion too.
 *
 * Sentence granularity keeps what was written for the buyer. It only works
 * because each bookkeeping sentence trips a pattern on its own — a sentence
 * that stated a rate only by sitting next to one would now survive, which is
 * why the patterns above name the rate forms these records use.
 */
function customerSafeLine(line: string): string {
  return sentencesOf(line)
    .filter((sentence) => !looksLikeInternalNote(sentence))
    .join(" ")
    .trim();
}

/**
 * The string with its internal sentences removed, or `undefined` when nothing
 * is left.
 *
 * Returning `undefined` rather than an empty string matters: an empty string
 * would still render as a blank row in the editions comparison, which is the
 * kind of "fixed it" that leaves a visible hole.
 */
export function customerSafeText(value: unknown): string | undefined {
  return customerSafeParagraph(value);
}

/**
 * The sentences {@link customerSafeParagraph} would remove, and why.
 *
 * For the repair tool, which rewrites the stored copy rather than filtering it
 * on the way out: a removal that changes production data has to be reviewable
 * before it is applied, and "the filter took it" is not a review.
 */
export function internalSentences(value: unknown): Array<{ sentence: string; reason: string }> {
  if (typeof value !== "string") return [];
  const out: Array<{ sentence: string; reason: string }> = [];
  for (const line of value.split(/\r?\n/)) {
    for (const sentence of sentencesOf(line)) {
      const reason = internalNoteReason(sentence);
      if (reason !== undefined) out.push({ sentence, reason });
    }
  }
  return out;
}

/**
 * The same rule over a multi-line value, line by line.
 *
 * A line whose sentences are all internal is dropped rather than left blank,
 * so a removed heading does not leave a gap where a paragraph used to be.
 * Returns `undefined` when nothing survives, so callers can omit the field
 * instead of rendering an empty one — a blank product page is not a smaller
 * problem than the line it replaced.
 */
export function customerSafeParagraph(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const kept = value
    .split(/\r?\n/)
    .map((line) => (line.trim() ? customerSafeLine(line) : line))
    .filter((line, index, all) => {
      if (line.trim()) return true;
      // Keep a blank line only where it still separates two kept paragraphs.
      return index > 0 && index < all.length - 1 && Boolean(all[index - 1]?.trim());
    })
    .join("\n")
    .trim();
  return kept || undefined;
}

/**
 * Product fields that are internal by name, wherever they appear in the tree.
 *
 * `internalNote` is the field the import template now writes supplier notes
 * into; the rest are the spellings already present in older rows.
 */
export const INTERNAL_FIELD_NAMES = new Set([
  "internalNote",
  "internal_note",
  "internalNotes",
  "internal_notes",
  "adminNote",
  "admin_note",
  "adminNotes",
  "importNote",
  "import_note",
  "supplierNote",
  "supplier_note",
  "extractionNote",
  "extraction_note",
  "sourceNote",
  "conversionRule",
  "conversion_rule",
  "priceRule",
  "price_rule",
]);

/**
 * Text fields on a variant that a customer is allowed to read.
 *
 * Anything here still goes through {@link customerSafeText}, because the field
 * being *meant* for customers does not mean an importer respected that.
 */
export const CUSTOMER_TEXT_FIELDS = [
  "description",
  "descriptionEn",
  "descriptionAr",
  "description_ar",
  "description_en",
  "customerDescription",
  "customer_description",
  "label",
  "labelEn",
  "note",
  "subtitle",
] as const;
