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
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  return INTERNAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The string, or `undefined` when it is internal bookkeeping.
 *
 * Returning `undefined` rather than an empty string matters: an empty string
 * would still render as a blank row in the editions comparison, which is the
 * kind of "fixed it" that leaves a visible hole.
 */
export function customerSafeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || looksLikeInternalNote(text)) return undefined;
  return text;
}

/**
 * The same text with only its internal lines removed.
 *
 * {@link customerSafeText} drops the whole value, which is right for a
 * variant's one-line sub-caption: what is left of "converted to IQD using 1
 * CNY = 220" is nothing worth printing. It is wrong for a product's own
 * description, where a single stray bookkeeping line would take the entire
 * page copy with it — a blank product page is not a smaller problem than the
 * line it removed.
 *
 * So a paragraph is filtered by line. Returns `undefined` when nothing
 * survives, so callers can omit the field rather than render an empty one.
 */
export function customerSafeParagraph(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const kept = value
    .split(/\r?\n/)
    .filter((line) => !looksLikeInternalNote(line))
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
