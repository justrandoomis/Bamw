/**
 * Supplier cost and customer selling price are different numbers.
 *
 * The import templates do not keep them apart. Every `type.N.price` in the
 * archive is a supplier figure, and the shape it arrives in hides that:
 *
 * ```
 * type.1  Regular / Offline   option=offline  price=1750   cost=1750
 * type.2  Special             option=offline  price=3000   cost=3000
 * type.3  Standard / Online   option=online   price=25000  cost=1750
 * type.4  Deluxe              option=online   price=38000  cost=3000
 * ```
 *
 * The offline rows carry one supplier number written into both fields. The
 * online rows carry the *online* supplier number in `price` and a copy of the
 * *offline* cost in `cost` — in 67 of the 76 templates every online `cost` is
 * a value that also appears on the offline side, which is what a copy looks
 * like. So the four real acquisition costs are:
 *
 *   offline base    ← offline base row, either field
 *   offline extras  ← offline extras row, either field
 *   online base     ← online base row's *price*
 *   online extras   ← online extras row's *price*
 *
 * and not one of the four selling prices exists yet. This module maps the
 * costs and then prices each tier separately, so a supplier number can never
 * reach a customer by being left in a field nobody re-read.
 */

/** Which account the customer buys, and whether extra content comes with it. */
export type AccountKind = "offline" | "online";
export type ContentKind = "base" | "extras";

export interface SupplierCost {
  amount: number;
  /** Where the number came from, kept so a wrong mapping is traceable. */
  source: string;
}

export interface SupplierCosts {
  offlineBase?: SupplierCost;
  offlineExtras?: SupplierCost;
  onlineBase?: SupplierCost;
  onlineExtras?: SupplierCost;
  /** Rows that could not be placed. Never guessed into a slot. */
  unmapped: string[];
}

export interface TemplateType {
  id?: string;
  name?: string;
  optionId?: string;
  price?: number | null;
  cost?: number | null;
  description?: string;
}

/**
 * Extra content, judged from the row rather than from its price.
 *
 * A dear row is not thereby a DLC row: FIFA's offline extras cost 6,000 while
 * Xenoblade's offline *base* costs 3,500, and reading the price would call one
 * of those wrong. The names the archive actually uses are the evidence.
 */
const EXTRAS = /\b(special|deluxe|complete|ultimate|bonus|expansion|premium|gold|dlc)\b/i;
const BASE = /\b(regular|standard|base|normal)\b/i;

export function isExtrasRow(name: string | undefined): boolean {
  const text = String(name ?? "");
  if (!text.trim()) return false;
  // "Standard / Online" and "Regular / Offline" name the account, not content.
  if (BASE.test(text) && !EXTRAS.test(text)) return false;
  return EXTRAS.test(text);
}

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Reads the four acquisition costs out of a template's type rows.
 *
 * A slot left undefined means the archive did not state it. That is reported,
 * never filled from the other account or the other tier.
 */
/** A template row placed against the account and tier it describes. */
export interface ClassifiedRow {
  row: TemplateType;
  account: AccountKind;
  content: ContentKind;
}

/**
 * Which account and tier each row is for.
 *
 * Supplier names are not edition semantics. In several sports templates the
 * first online row is called "Complete" while it is the base online
 * counterpart to the first offline row; a lone Wolfenstein row is called
 * "Deluxe" even though no second tier exists. The archive's stable contract is
 * row order per account: first = base, second = extras. Name matching is only
 * a fallback for a malformed row that was not present in that group.
 *
 * Shared, because two readers of the same rows that classify them differently
 * is how a product ends up with the offline tier's price on the online tier —
 * the class of fault this file already exists to prevent.
 */
export function classifyTemplateRows(types: readonly TemplateType[]): {
  rows: ClassifiedRow[];
  unmapped: string[];
} {
  const rows: ClassifiedRow[] = [];
  const unmapped: string[] = [];
  const rowsByAccount = {
    offline: types.filter((type) => type.optionId === "offline_account"),
    online: types.filter((type) => type.optionId === "online_account"),
  };
  for (const type of types) {
    const account: AccountKind | null =
      type.optionId === "offline_account"
        ? "offline"
        : type.optionId === "online_account"
          ? "online"
          : null;
    if (!account) {
      unmapped.push(`${type.name ?? type.id ?? "?"} — no recognisable option`);
      continue;
    }
    const rowIndex = rowsByAccount[account].indexOf(type);
    const content: ContentKind =
      rowIndex >= 0
        ? rowIndex === 0
          ? "base"
          : "extras"
        : isExtrasRow(type.name)
          ? "extras"
          : "base";
    rows.push({ row: type, account, content });
  }
  return { rows, unmapped };
}

export function mapSupplierCosts(types: readonly TemplateType[]): SupplierCosts {
  const out: SupplierCosts = { unmapped: [] };
  const offlineAmounts = new Set<number>();

  for (const type of types) {
    if (type.optionId !== "offline_account") continue;
    const cost = num(type.cost);
    const price = num(type.price);
    if (cost !== null) offlineAmounts.add(cost);
    if (price !== null) offlineAmounts.add(price);
  }

  const classified = classifyTemplateRows(types);
  out.unmapped.push(...classified.unmapped);

  for (const { row: type, account, content } of classified.rows) {
    /*
      Most legacy rows copied the corresponding offline cost into online
      `cost`, while putting the real online acquisition figure in `price`.
      Newer corrected rows keep a distinct online acquisition figure in
      `cost`. A distinct positive value is therefore authoritative; a value
      duplicated on the offline side is the legacy copy and `price` is used.
    */
    const parsedCost = num(type.cost);
    const parsedPrice = num(type.price);
    const useOnlineCost =
      account === "online" && parsedCost !== null && !offlineAmounts.has(parsedCost);
    const amount =
      account === "offline"
        ? (parsedCost ?? parsedPrice)
        : useOnlineCost
          ? parsedCost
          : parsedPrice;
    if (amount === null) {
      out.unmapped.push(`${type.name ?? type.id ?? "?"} — no usable amount`);
      continue;
    }

    const key = `${account}${content === "base" ? "Base" : "Extras"}` as const;
    if (out[key]) {
      out.unmapped.push(`${type.name ?? type.id ?? "?"} — ${key} was already taken`);
      continue;
    }
    out[key] = {
      amount,
      source: `${type.name ?? type.id ?? "?"} (${account === "offline" || useOnlineCost ? "cost" : "price"} field)`,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ pricing */

/**
 * How much the market will bear for this particular game.
 *
 * This is the judgement, and it is made per game from what the game is —
 * how well known it is, how old, whether it still sells. It is deliberately
 * not derived from the supplier cost: a cheap supplier line on a flagship
 * Nintendo title is a bargain, not a signal to price it low.
 */
export type DemandTier =
  /** Evergreen system seller — Mario Kart, Smash, Zelda, Animal Crossing. */
  | "flagship"
  /** Well known and still in demand — most first-party and big third-party. */
  | "major"
  /** Recognised but not a draw — solid mid-list. */
  | "standard"
  /** Older, niche, or long discounted. */
  | "niche";

export type Platform = "switch1" | "switch2";

/**
 * The bands the store sells offline accounts in, per console.
 *
 * Switch 2 reaches higher because the library is newer and less discounted.
 */
const OFFLINE_BAND: Record<Platform, { min: number; max: number }> = {
  switch1: { min: 5_000, max: 15_000 },
  switch2: { min: 5_000, max: 20_000 },
};

export interface PricedTier {
  account: AccountKind;
  content: ContentKind;
  /** What the customer pays. */
  price: number;
  /** What the copy costs to acquire. Admin-only; never rendered publicly. */
  cost: number;
  margin: number;
  reason: string;
}

export interface GamePricing {
  tiers: PricedTier[];
  /** The base product's own figures — the offline base tier. */
  productPrice?: number;
  productCost?: number;
  /** Tiers the archive did not give a cost for, so nothing was invented. */
  needsReview: string[];
}

/** Where in its band a tier sits, as a fraction from the floor to the ceiling. */
const TIER_POSITION: Record<DemandTier, number> = {
  flagship: 1,
  major: 0.65,
  standard: 0.35,
  niche: 0,
};

/** How much margin an online account carries, by how well the game sells. */
const ONLINE_UPLIFT: Record<DemandTier, number> = {
  flagship: 1.45,
  major: 1.35,
  standard: 1.28,
  niche: 1.22,
};

/** Prices land on a round 250 so the storefront never shows an odd figure. */
export function roundToStep(value: number, step = 250): number {
  return Math.round(value / step) * step;
}

/**
 * Prices every tier of one game.
 *
 * Offline sits inside the console's band, positioned by demand — the supplier
 * cost is an input to the decision, not a multiplier, so a flagship on a cheap
 * supplier line is still priced as a flagship.
 *
 * Online has no band. Acquiring an online account costs an order of magnitude
 * more than an offline copy of the same game — 25,000 against 1,750 for Smash —
 * so an offline band would price every online tier below its own cost. The
 * margin is taken on the cost instead, widening with demand.
 *
 * Extras are priced above their own base by what the extra content actually
 * cost to acquire, so a 6,000 season pass moves the price further than a 1,250
 * one does.
 */
export function priceGame(costs: SupplierCosts, platform: Platform, tier: DemandTier): GamePricing {
  const tiers: PricedTier[] = [];
  const needsReview = [...costs.unmapped];

  const band = OFFLINE_BAND[platform];
  const offlineBase = costs.offlineBase?.amount;

  let offlineBasePrice: number | undefined;
  if (offlineBase !== undefined) {
    let price = roundToStep(band.min + (band.max - band.min) * TIER_POSITION[tier]);
    let reason = `${tier} on ${platform}, placed in the ${band.min.toLocaleString()}–${band.max.toLocaleString()} band`;
    if (price <= offlineBase) {
      price = roundToStep(offlineBase * 1.6);
      reason = `${reason}; lifted clear of the ${offlineBase.toLocaleString()} acquisition cost`;
    }
    offlineBasePrice = price;
    tiers.push({
      account: "offline",
      content: "base",
      price,
      cost: offlineBase,
      margin: price - offlineBase,
      reason,
    });
  } else {
    needsReview.push("offline base — no supplier cost in the source");
  }

  const offlineExtras = costs.offlineExtras?.amount;
  if (offlineExtras !== undefined) {
    if (offlineBase !== undefined && offlineBasePrice !== undefined) {
      const extraContent = Math.max(0, offlineExtras - offlineBase);
      const price = roundToStep(offlineBasePrice + extraContent * 2);
      tiers.push({
        account: "offline",
        content: "extras",
        price,
        cost: offlineExtras,
        margin: price - offlineExtras,
        reason: `base plus ${extraContent.toLocaleString()} of extra content, at twice its acquisition cost`,
      });
    } else {
      needsReview.push("offline extras — priced against a base that has no cost");
    }
  }

  if (Boolean(costs.offlineExtras) !== Boolean(costs.onlineExtras)) {
    needsReview.push("extras — one account has an extra-content cost while the other does not");
  }

  for (const [content, entry] of [
    ["base", costs.onlineBase],
    ["extras", costs.onlineExtras],
  ] as const) {
    if (!entry) continue;
    const percentagePrice = roundToStep(entry.amount * ONLINE_UPLIFT[tier]);
    const minimumMarginPrice = roundToStep(entry.amount + 10_000);
    const price = Math.max(percentagePrice, minimumMarginPrice);
    tiers.push({
      account: "online",
      content,
      price,
      cost: entry.amount,
      margin: price - entry.amount,
      reason: `${tier} online: ${Math.round((ONLINE_UPLIFT[tier] - 1) * 100)}% over the ${entry.amount.toLocaleString()} acquisition cost`,
    });
  }
  if (!costs.onlineBase) needsReview.push("online base — no supplier cost in the source");

  return {
    tiers,
    productPrice: offlineBasePrice,
    productCost: offlineBase,
    needsReview,
  };
}

/**
 * The prices the file already states, when it states them properly.
 *
 * The shipped template asks the operator for a ready price — its own comment
 * on the type block says the tiers are added «بسعرها الجاهز من الملف», with
 * their ready price from the file — and when a file carries one there is
 * nothing for the pricing engine to decide. Read them and use them.
 *
 * The care is in telling a ready price from the thing that merely looks like
 * one. The legacy archive this module was written for put a single supplier
 * number into *both* fields of an offline row:
 *
 *     type.1  Regular / Offline   option=offline  price=1750   cost=1750
 *
 * `price` there is what the copy cost to buy, not what a customer pays, and
 * honouring it would sell the game at cost — the shop giving away its whole
 * margin on every game an operator imported. So a row counts as ready-priced
 * only when it states both numbers and they leave a margin: `price > cost`.
 * A row whose price equals its cost is the legacy duplication, and a file
 * containing one is handed to the engine instead.
 *
 * All or nothing, per file. A file half in one shape and half in the other is
 * not a file anybody wrote on purpose, and mixing the two readings within one
 * product is how a game ends up with a real price on one tier and a supplier
 * number on another.
 *
 * Returns `undefined` when the file is not ready-priced, which is the caller's
 * signal to price it the old way.
 */
export function readyTierPricing(types: readonly TemplateType[]): GamePricing | undefined {
  const { rows, unmapped } = classifyTemplateRows(types);
  // A row that could not even be placed against an account is not a file to
  // take numbers from on trust.
  if (unmapped.length > 0 || rows.length === 0) return undefined;

  /*
    Every amount the offline rows mention, which is how the legacy copy is
    recognised on an online row.

    `price > cost` alone is not enough to call an online row ready-priced. The
    legacy shape puts the real online acquisition figure in `price` and a copy
    of the *offline* cost in `cost`:

        type.3  Standard / Online  option=online  price=25000  cost=1750

    — which passes `price > cost` comfortably while being the opposite of a
    priced tier: 25,000 is what the copy costs, and the 1,750 beside it belongs
    to a different account entirely. A file half-corrected, offline rows given
    real prices and online rows left alone, would otherwise be read as ready
    and the online tier sold at exactly what it cost, showing a 23,250 margin
    that does not exist.

    `mapSupplierCosts` already knows this signal — it is why it prefers `price`
    for an online row whose `cost` appears on the offline side — and this is
    the same test, used to decide the file is not ready rather than which field
    to read.
  */
  const offlineAmounts = new Set<number>();
  for (const { row, account } of rows) {
    if (account !== "offline") continue;
    const cost = num(row.cost);
    const price = num(row.price);
    if (cost !== null) offlineAmounts.add(cost);
    if (price !== null) offlineAmounts.add(price);
  }

  const tiers: PricedTier[] = [];
  const seen = new Set<string>();
  for (const { row, account, content } of rows) {
    const price = num(row.price);
    const cost = num(row.cost);
    if (price === null || cost === null || price <= cost) return undefined;
    if (account === "online" && offlineAmounts.has(cost)) return undefined;
    const key = `${account}_${content}`;
    // Two rows claiming one tier: the file disagrees with itself.
    if (seen.has(key)) return undefined;
    seen.add(key);
    tiers.push({
      account,
      content,
      price,
      cost,
      margin: price - cost,
      reason: "priced in the import file",
    });
  }

  /*
    The same coverage the engine insists on, so that what a file must contain
    does not quietly depend on which of the two paths read it. Both accounts,
    base tier each.
  */
  const at = (account: AccountKind, content: ContentKind) =>
    tiers.find((tier) => tier.account === account && tier.content === content);
  const offlineBase = at("offline", "base");
  if (!offlineBase || !at("online", "base")) return undefined;

  /*
    Canonical order, not file order: offline before online, base before extras.
    The caller turns this list straight into the product's `types`, so the
    order is the order a customer sees the tiers in.
  */
  const order: [AccountKind, ContentKind][] = [
    ["offline", "base"],
    ["offline", "extras"],
    ["online", "base"],
    ["online", "extras"],
  ];
  const ordered = order.map(([account, content]) => at(account, content)).filter(Boolean) as PricedTier[];

  return {
    tiers: ordered,
    productPrice: offlineBase.price,
    productCost: offlineBase.cost,
    needsReview: [],
  };
}

/**
 * Converts legacy “shared/private” account products to canonical Offline/Online
 * without changing any price, cost, stock, or commercial value.
 */
export function normalizeNintendoAccountPricing<T extends Record<string, any>>(product: T): T {
  const sourceOptions = Array.isArray(product.options) ? product.options : [];
  const sourceTypes = Array.isArray(product.types)
    ? product.types
    : Array.isArray(product.variants)
      ? product.variants
      : [];

  const accountFrom = (value: unknown): AccountKind | null => {
    const folded = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!folded) return null;
    if (
      folded.includes("offline") ||
      folded.includes("أوفلاين") ||
      folded.includes("اوفلاين") ||
      folded.includes("shared") ||
      folded.includes("مشترك")
    ) {
      return "offline";
    }
    if (
      folded.includes("online") ||
      folded.includes("أونلاين") ||
      folded.includes("اونلاين") ||
      folded.includes("private") ||
      folded.includes("خاص بك")
    ) {
      return "online";
    }
    return null;
  };

  const optionAccounts = new Map<string, AccountKind>();
  for (const option of sourceOptions) {
    const account = accountFrom(
      `${option?.id ?? ""} ${option?.name ?? ""} ${option?.description ?? ""}`,
    );
    if (account && option?.id) optionAccounts.set(String(option.id), account);
  }
  for (const type of sourceTypes) {
    const linked = optionAccounts.get(String(type?.optionId ?? ""));
    const account =
      linked ??
      accountFrom(
        `${type?.optionId ?? ""} ${type?.id ?? ""} ${type?.name ?? ""} ${type?.description ?? ""}`,
      );
    if (account && type?.optionId) optionAccounts.set(String(type.optionId), account);
  }

  const recognised =
    optionAccounts.size > 0 ||
    sourceTypes.some((type: any) =>
      Boolean(accountFrom(`${type?.id ?? ""} ${type?.name ?? ""} ${type?.description ?? ""}`)),
    );
  if (!recognised) return product;

  const seenOptions = new Set<AccountKind>();
  const options = sourceOptions.map((option: any) => {
    const account =
      optionAccounts.get(String(option?.id ?? "")) ??
      accountFrom(`${option?.id ?? ""} ${option?.name ?? ""} ${option?.description ?? ""}`);
    if (!account || seenOptions.has(account)) return option;
    seenOptions.add(account);
    return {
      ...option,
      name: customerOptionName(account),
      description:
        account === "offline"
          ? "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل."
          : "حساب يدعم تشغيل اللعبة مع الاتصال والميزات المتاحة أونلاين.",
    };
  });

  const rowsSeen = { offline: 0, online: 0 };
  const types = sourceTypes.map((type: any) => {
    const account =
      optionAccounts.get(String(type?.optionId ?? "")) ??
      accountFrom(
        `${type?.optionId ?? ""} ${type?.id ?? ""} ${type?.name ?? ""} ${type?.description ?? ""}`,
      );
    if (!account) return type;

    const folded = `${type?.id ?? ""} ${type?.name ?? ""} ${type?.description ?? ""}`.toLowerCase();
    const explicitlyExtras =
      isExtrasRow(folded) ||
      folded.includes("مع الإضافات") ||
      folded.includes("مع الاضافات") ||
      folded.includes("إضافات") ||
      folded.includes("اضافات");
    const explicitlyBase =
      folded.includes("اللعبة الأساسية") ||
      folded.includes("اللعبة الاساسية") ||
      folded.includes("عادي") ||
      BASE.test(folded);
    const content: ContentKind = explicitlyExtras
      ? "extras"
      : explicitlyBase
        ? "base"
        : rowsSeen[account] === 0
          ? "base"
          : "extras";
    rowsSeen[account] += 1;

    return {
      ...type,
      // Existing ids are commercial/relational identities used by carts and
      // linked editions. Only products whose selector is genuinely missing
      // need a new canonical option id.
      optionId: sourceOptions.length === 0 ? `${account}_account` : type.optionId,
      name: customerTypeName(account, content),
      description:
        content === "extras"
          ? "تشمل اللعبة الأساسية والمحتوى الإضافي المثبت في هذا الإصدار."
          : "تشمل الإصدار العادي من اللعبة.",
    };
  });

  // Recreate missing selectors only when the tier rows prove the account exists.
  for (const account of ["offline", "online"] as const) {
    if (rowsSeen[account] === 0 || seenOptions.has(account)) continue;
    options.push({
      id: `${account}_account`,
      name: customerOptionName(account),
      description:
        account === "offline"
          ? "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل."
          : "حساب يدعم تشغيل اللعبة مع الاتصال والميزات المتاحة أونلاين.",
    });
  }

  return { ...product, options, types, variants: types };
}

/* ------------------------------------------------------- what the customer reads */

/** Arabic labels. Supplier wording and Chinese text never reach a customer. */
export const CUSTOMER_LABELS = {
  offline: "حساب أوفلاين",
  online: "حساب أونلاين",
  base: "عادي",
  extras: "مع الإضافات",
} as const;

export function customerTypeName(account: AccountKind, content: ContentKind): string {
  return `${CUSTOMER_LABELS[account]} — ${CUSTOMER_LABELS[content]}`;
}

export function customerOptionName(account: AccountKind): string {
  return CUSTOMER_LABELS[account];
}
