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

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/*
  Both languages, because both are written. The importer writes ids in English
  and an admin types names in Arabic, and a product can carry one, the other,
  or a mix of the two.
*/
const ONLINE = /(online|اونلاين|أونلاين|اون لاين)/i;
const OFFLINE = /(offline|اوفلاين|أوفلاين|اوف لاين)/i;
const EXTRAS = /(extras?|dlc|add[_\s-]?ons?|الاضافات|الإضافات|اضافات|إضافات|مع)/i;

/** What kind of tier this row is, from its id and its name together. */
export function classifyTier(row: TierRow): ClassifiedTier {
  const id = String(row?.id ?? "").trim();
  const name = String(row?.name ?? "").trim();
  const subject = `${id} ${name}`;

  const online = ONLINE.test(subject);
  const offline = OFFLINE.test(subject);
  const extras = EXTRAS.test(subject);

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
