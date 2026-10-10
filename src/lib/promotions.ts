/**
 * «اشتري ثلاثة ألعاب وأحصل على الرابعة مجانا ، حيث عندما يضع مستخدم أربعة
 *  ألعاب يعتمد على أرخص لعبة تكون مجانية في السله»
 *
 * The shop's buy-three-get-the-fourth offer, as one pure function the cart and
 * the checkout both call — so the free game the cart shows is the free game
 * the order is charged for. No server imports: the cart runs it in the
 * browser, `createOrderForUser` runs it on the catalogue's own prices.
 *
 * THE RULE.
 *   - Every four games in the cart, the cheapest one is free. A line bought
 *     twice is two games, so its copies count one by one.
 *   - «تتكرر مع كل 4 ألعاب» (the default): eight games, two free — the two
 *     cheapest. With it off, one free game per order at most.
 *   - Only games count. Accounts and listed games do; a bundle is already a
 *     deal of its own, a code or gift card is money, and anything that ships
 *     is not what the offer is about.
 *
 * WHAT IT DOES NOT DO. It never decides on a price the browser sent: the
 * checkout hands it the server's validated lines. And it never makes a line
 * cost less than nothing — a free copy is priced at its own unit price and
 * no more.
 *
 * The switch lives in the shop's content (`ContentDoc.promotions`), which is
 * patched key by key; see `content.ts` for why a new setting does not go in
 * `store.settings`.
 */

export interface Buy3Get1Settings {
  /** Whether the offer is on at all. */
  enabled: boolean;
  /** One free game for every four (true), or one per order at most (false). */
  repeat: boolean;
}

export interface PromotionsData {
  buy3get1: Buy3Get1Settings;
}

export const DEFAULT_PROMOTIONS: PromotionsData = {
  buy3get1: { enabled: false, repeat: true },
};

/** How many games make one free. */
export const BUY3GET1_GROUP = 4;

/** Whatever was stored, as settings the rule can trust. */
export function normalizePromotions(value: unknown): PromotionsData {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const offer = (
    source["buy3get1"] && typeof source["buy3get1"] === "object" ? source["buy3get1"] : {}
  ) as Record<string, unknown>;
  return {
    buy3get1: {
      enabled: offer["enabled"] === true,
      repeat: offer["repeat"] !== false,
    },
  };
}

/**
 * The kinds that count as «لعبة».
 *
 * `game` is what the catalogue importer writes on every listing; the account
 * kinds are games sold on an account; a pre-order is a game not out yet. A
 * missing kind reads as an account, as it does everywhere else in the shop.
 */
const GAME_KINDS = new Set(["game", "account", "offline_account", "online_account", "preorder"]);

export function countsAsGame(kind: unknown): boolean {
  const normalized = String(kind ?? "account")
    .trim()
    .toLowerCase();
  return GAME_KINDS.has(normalized || "account");
}

/** One cart or order line, as the offer reads it. */
export interface PromoLine {
  /** Stable per line: the cart line's id, or the order item's id. */
  key: string;
  productId: string;
  title: string;
  kind?: string | null | undefined;
  unitPrice: number;
  quantity: number;
}

export interface FreeUnit {
  key: string;
  productId: string;
  title: string;
  unitPrice: number;
}

export interface Buy3Get1Quote {
  /** True when at least one game is free. */
  applied: boolean;
  /** Games in the cart that count towards the offer. */
  games: number;
  /** The copies that are free, cheapest first. */
  free: FreeUnit[];
  /** What the free copies are worth, in dinars. */
  discount: number;
  /**
   * Games still to add for the next free one, or null when no further game
   * would earn one (the offer is off, or it gives one per order and has).
   */
  toNext: number | null;
}

const NOTHING: Buy3Get1Quote = { applied: false, games: 0, free: [], discount: 0, toNext: null };

export function quoteBuy3Get1(
  lines: readonly PromoLine[],
  settings: Buy3Get1Settings | null | undefined,
): Buy3Get1Quote {
  if (!settings?.enabled) return NOTHING;

  const units: FreeUnit[] = [];
  for (const line of lines) {
    if (!countsAsGame(line.kind)) continue;
    const price = Number(line.unitPrice);
    const copies = Math.floor(Number(line.quantity));
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(copies) || copies <= 0) continue;
    for (let i = 0; i < Math.min(copies, 100); i++) {
      units.push({
        key: String(line.key),
        productId: String(line.productId),
        title: String(line.title ?? ""),
        unitPrice: price,
      });
    }
  }

  const games = units.length;
  const sets = Math.floor(games / BUY3GET1_GROUP);
  const freeCount = settings.repeat ? sets : Math.min(sets, 1);
  /*
    Cheapest first, and the same answer on every run: equal prices are broken
    by the line's key, so the cart and the checkout never pick two different
    copies of one price.
  */
  const free = [...units]
    .sort((a, b) => a.unitPrice - b.unitPrice || a.key.localeCompare(b.key))
    .slice(0, freeCount);
  const discount = free.reduce((sum, unit) => sum + unit.unitPrice, 0);

  const toNext =
    !settings.repeat && freeCount >= 1 ? null : BUY3GET1_GROUP - (games % BUY3GET1_GROUP);

  return { applied: free.length > 0, games, free, discount, toNext };
}

/**
 * The lines with the free copies taken out — what a coupon or a referral is
 * then priced on, so neither can discount a game that already costs nothing.
 */
export function withoutFreeUnits<T extends { quantity: number }>(
  lines: readonly T[],
  keyOf: (line: T) => string,
  quote: Buy3Get1Quote,
): T[] {
  if (!quote.applied) return [...lines];
  const freeByKey = new Map<string, number>();
  for (const unit of quote.free) freeByKey.set(unit.key, (freeByKey.get(unit.key) ?? 0) + 1);
  const out: T[] = [];
  for (const line of lines) {
    const taken = freeByKey.get(keyOf(line)) ?? 0;
    const left = Math.max(0, Number(line.quantity) - taken);
    if (left > 0) out.push(taken ? { ...line, quantity: left } : line);
  }
  return out;
}

/** How many copies of a line are free — for a badge on that line. */
export function freeCopiesOf(key: string, quote: Buy3Get1Quote): number {
  return quote.free.filter((unit) => unit.key === key).length;
}
