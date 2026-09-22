/**
 * The four prices a Nintendo game carries, and which rule owns each of them.
 *
 * A game imported from the Nintendo template does not have one price. It has
 * up to four, on `types`: an offline account plain and with add-ons, and an
 * online account plain and with add-ons. The owner's rules are not the same
 * for all four, and the whole point of this module is that nothing has to
 * guess which is which:
 *
 *   offline, plain       the discount rules — «هذا التخفيض هو فقط للحساب
 *                        الاوفلاين العادي او dlc»
 *   offline, add-ons     the plain offline price plus what the add-ons are
 *                        worth, from the COST GAP between the two
 *   online, plain        profit between 10,000 and 15,000
 *   online, add-ons      profit between 10,000 and 15,000 — «سواء كان عادي او
 *                        مع الاضافات»
 *
 * The tiers are DATA, not constants. `offline_base` and friends appear only in
 * this repository's tests; on a real product they are whatever the importer or
 * an admin wrote, in whichever language they wrote it. So a tier is recognised
 * by reading its id and its name together, and a tier that cannot be
 * recognised is reported as unknown rather than being pushed into the nearest
 * bucket — a rule applied to the wrong tier is worse than no rule, because it
 * would be applied confidently.
 */

export type TierKind = "offline_base" | "offline_extras" | "online_base" | "online_extras";

export interface TierRow {
  id?: string;
  name?: string;
  price?: unknown;
  cost?: unknown;
  [key: string]: unknown;
}

export interface ClassifiedTier {
  kind: TierKind | "unknown";
  id: string;
  name: string;
  price: number;
  cost: number;
}

/*
  Arabic-Indic digits, because a cost typed on an Arabic keyboard arrives as
  ٢٧٥٠ and not 2750. Both the Arabic (\u0660-\u0669) and the Extended Arabic /
  Persian (\u06F0-\u06F9) sets are written in the region.
*/
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

const latinDigits = (text: string): string =>
  text.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });

/**
 * A tier's cost or price as a number.
 *
 * The minus sign is KEPT. This used to strip every non-digit, so the string
 * "-5000" became 5000 while the number -5000 stayed negative — the same value
 * in two representations disagreeing about its sign. `tierSkip` refuses a cost
 * of zero or less, and that refusal is the reason the guard exists; a sign
 * silently flipped on the way in walks straight past it and the whole margin
 * is then computed against a cost that is 10,000 too high.
 *
 * A stray "-" in the middle of a number ("1-500") is not a negative number and
 * is not treated as one: only a leading sign counts.
 */
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = latinDigits(String(value ?? "")).trim();
  // U+2212 MINUS SIGN and U+2013 EN DASH both turn up in pasted spreadsheets.
  const negative = /^[-\u2212\u2013]/.test(text);
  const parsed = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

/*
  Both languages, because both are written. The importer writes ids in English
  and an admin types names in Arabic, and a product can carry one, the other,
  or a mix of the two.
*/
/*
  The hamza and the space are both optional, because all of أونلاين، اونلاين،
  «أون لاين»، «اون لاين» are written by the same admin on different days. The
  earlier version enumerated six literal spellings and happened to cover the
  hamza'd JOINED form and the bare-alef SPLIT form, but not the hamza'd split
  one — so «أون لاين» classified as unknown and the tier went unpriced.
*/
const ONLINE = /(on[_\s-]?line|[اأإ]ون[\s\u0640]*لاين)/i;
const OFFLINE = /(off[_\s-]?line|[اأإ]وف[\s\u0640]*لاين)/i;

/*
  ADD-ONS.

  The bare particle «مع» ("with") used to be an alternative here, and it has
  no word boundary, so the two letters م+ع anywhere in a tier name routed that
  row to the add-ons branch: «حساب اوفلاين مع ضمان» (with a warranty),
  «حساب اوفلاين معتمد» (verified) — ordinary plain accounts priced as though
  they carried DLC, from a cost gap that is not an add-ons cost gap.

  It is also redundant. The owner writes «مع الاضافات», and «الاضافات» is
  already matched. So the particle is gone and the actual add-ons words carry
  the decision, now including the SINGULAR («اضافة», «اضافه», «الإضافة»),
  which the plural-only list missed.
*/
const EXTRAS = /(extras?|dlc|add[_\s-]?ons?|(ال)?[اأإ]ضاف(ات|ة|ه))/i;

/*
  …unless the name says it does NOT include them.

  «بدون اضافات», «لا يشمل الإضافات», «من دون الاضافه» are plain editions that
  name the add-ons only to deny them, and reading them as the add-ons edition
  prices the CHEAPER row with the DEARER rule. The negator has to sit against
  the add-ons word: «مع الاضافات وبدون ضمان» is still an add-ons edition.
*/
const EXTRAS_NEGATED =
  /(بدون|بلا|بغير|من[\s\u0640]*دون|دون|لا[\s\u0640]*(يشمل|تشمل|يتضمن|تتضمن)|غير[\s\u0640]*شامل|without|excluding|not[\s_-]*incl)[\s\u0640]*(ال)?([اأإ]ضاف|dlc|extras?|add[_\s-]?ons?)/i;

/** What kind of tier this row is, from its id and its name together. */
export function classifyTier(row: TierRow): ClassifiedTier {
  const id = String(row?.id ?? "").trim();
  const name = String(row?.name ?? "").trim();
  const subject = `${id} ${name}`;

  const online = ONLINE.test(subject);
  const offline = OFFLINE.test(subject);
  const extras = EXTRAS.test(subject) && !EXTRAS_NEGATED.test(subject);

  /*
    Neither, or BOTH. A row naming both an online and an offline account is
    not a row this module understands, and saying so is the honest answer —
    the alternative is picking one and being confidently wrong about a price.
  */
  const kind: TierKind | "unknown" =
    online === offline
      ? "unknown"
      : online
        ? extras
          ? "online_extras"
          : "online_base"
        : extras
          ? "offline_extras"
          : "offline_base";

  return { kind, id, name, price: num(row?.price), cost: num(row?.cost) };
}

/** Every tier on a product, classified, in the order the product lists them. */
export function classifyTiers(types: unknown): ClassifiedTier[] {
  if (!Array.isArray(types)) return [];
  return types.map((row) => classifyTier(row as TierRow));
}

/** The first tier of a kind, or undefined. */
export function tierOf(
  tiers: readonly ClassifiedTier[],
  kind: TierKind,
): ClassifiedTier | undefined {
  return tiers.find((tier) => tier.kind === kind);
}

/**
 * The cost gap the add-ons edition is priced from.
 *
 * The gap between what the two editions COST, never between what they sell
 * for: «اذا كان ١٧٠٠ عادي و ٢٠٠٠ مع الاضافات الفرق هو ٣٠٠». Pricing off the
 * selling gap would compound whatever the last pass did.
 */
export function extrasCostGap(
  base: ClassifiedTier | undefined,
  extras: ClassifiedTier | undefined,
): number {
  if (!base || !extras) return 0;
  const gap = extras.cost - base.cost;
  return gap > 0 ? gap : 0;
}
