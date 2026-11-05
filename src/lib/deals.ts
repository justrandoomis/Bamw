/**
 * Occasion deals — Black Friday, Eid, 11.11, flash deals and the rest.
 *
 *   «make black friday discount on all games … any of them have special design
 *    and clean ui ux for know this is dicount for this special deal. so i turn
 *    on that all product go on deal or turn off so the price remain the same as
 *    now today — it is discount not edit price so they show old and new price»
 *
 * The rules this file keeps:
 *
 *   1. A deal is a DISCOUNT, never a price edit. The stored prices are not
 *      touched; a live deal is applied to a copy of the product on the way out
 *      (`applyDealToProduct`), and the struck-through figure is today's real
 *      price. Switch the deals off and every price is exactly what it was.
 *   2. What the customer sees is what checkout charges. The public catalogue,
 *      the product page and the order line all run this same function, so the
 *      cart, the wallet debit and the card can never disagree.
 *   3. A deal never sells below cost. The server knows each row's cost; when a
 *      percentage would cut through it, the product's percentage is lowered
 *      (or the product sits the deal out) rather than losing money per sale.
 *   4. Dates are real. A campaign shows only between its start and end, in the
 *      shop's own clock, so a Black Friday can be prepared days ahead.
 *
 * Configuration lives in `settings.deals` (the «العروض والمناسبات» screen); a
 * product can follow it, sit it out, or carry its own occasion and percentage
 * (`occasionDeal`, set on the product's edit page).
 */

/* --------------------------------------------------------------- occasions */

export type OccasionKey =
  | "black_friday"
  | "white_friday"
  | "cyber_monday"
  | "singles_day"
  | "double_twelve"
  | "christmas"
  | "new_year"
  | "ramadan"
  | "eid_fitr"
  | "eid_adha"
  | "back_to_school"
  | "summer"
  | "winter"
  | "spring"
  | "flash"
  | "hyper"
  | "custom";

export interface OccasionTheme {
  key: OccasionKey;
  /** The name a customer reads. */
  ar: string;
  en: string;
  emoji: string;
  /** CSS background for the badge and banner. */
  background: string;
  /** Text colour on that background. */
  foreground: string;
  /** Accent for the percentage chip and the countdown. */
  accent: string;
}

/*
  Each occasion has its own look so a shopper knows at a glance which sale this
  is. Inline CSS rather than utility classes: these are data, chosen at run
  time, and a class name assembled from a map is not one the stylesheet build
  can see.
*/
export const OCCASIONS: Readonly<Record<OccasionKey, OccasionTheme>> = {
  black_friday: {
    key: "black_friday",
    ar: "الجمعة السوداء",
    en: "Black Friday",
    emoji: "🖤",
    background: "linear-gradient(135deg, #09090b 0%, #27272a 100%)",
    foreground: "#ffffff",
    accent: "#facc15",
  },
  white_friday: {
    key: "white_friday",
    ar: "الجمعة البيضاء",
    en: "White Friday",
    emoji: "🤍",
    background: "linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%)",
    foreground: "#0f172a",
    accent: "#2563eb",
  },
  cyber_monday: {
    key: "cyber_monday",
    ar: "سايبر مندي",
    en: "Cyber Monday",
    emoji: "💻",
    background: "linear-gradient(135deg, #1e1b4b 0%, #7c3aed 55%, #06b6d4 100%)",
    foreground: "#ffffff",
    accent: "#67e8f9",
  },
  singles_day: {
    key: "singles_day",
    ar: "عروض 11.11",
    en: "11.11",
    emoji: "🛍️",
    background: "linear-gradient(135deg, #e11d48 0%, #f97316 100%)",
    foreground: "#ffffff",
    accent: "#fde047",
  },
  double_twelve: {
    key: "double_twelve",
    ar: "عروض 12.12",
    en: "12.12",
    emoji: "🎁",
    background: "linear-gradient(135deg, #be185d 0%, #f59e0b 100%)",
    foreground: "#ffffff",
    accent: "#fef3c7",
  },
  christmas: {
    key: "christmas",
    ar: "عروض الكريسماس",
    en: "Christmas",
    emoji: "🎄",
    background: "linear-gradient(135deg, #b91c1c 0%, #166534 100%)",
    foreground: "#ffffff",
    accent: "#fde68a",
  },
  new_year: {
    key: "new_year",
    ar: "رأس السنة",
    en: "New Year",
    emoji: "🎆",
    background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #ca8a04 100%)",
    foreground: "#ffffff",
    accent: "#fde047",
  },
  ramadan: {
    key: "ramadan",
    ar: "عروض رمضان",
    en: "Ramadan",
    emoji: "🌙",
    background: "linear-gradient(135deg, #312e81 0%, #6d28d9 60%, #b45309 100%)",
    foreground: "#ffffff",
    accent: "#fcd34d",
  },
  eid_fitr: {
    key: "eid_fitr",
    ar: "عيد الفطر",
    en: "Eid al-Fitr",
    emoji: "🎉",
    background: "linear-gradient(135deg, #064e3b 0%, #059669 60%, #d97706 100%)",
    foreground: "#ffffff",
    accent: "#fef3c7",
  },
  eid_adha: {
    key: "eid_adha",
    ar: "عيد الأضحى",
    en: "Eid al-Adha",
    emoji: "🕌",
    background: "linear-gradient(135deg, #7c2d12 0%, #b45309 60%, #eab308 100%)",
    foreground: "#ffffff",
    accent: "#fef9c3",
  },
  back_to_school: {
    key: "back_to_school",
    ar: "العودة للمدارس",
    en: "Back to School",
    emoji: "🎒",
    background: "linear-gradient(135deg, #1d4ed8 0%, #f59e0b 100%)",
    foreground: "#ffffff",
    accent: "#fde68a",
  },
  summer: {
    key: "summer",
    ar: "عروض الصيف",
    en: "Summer Deal",
    emoji: "☀️",
    background: "linear-gradient(135deg, #ea580c 0%, #f59e0b 55%, #0891b2 100%)",
    foreground: "#ffffff",
    accent: "#fef08a",
  },
  winter: {
    key: "winter",
    ar: "عروض الشتاء",
    en: "Winter Deal",
    emoji: "❄️",
    background: "linear-gradient(135deg, #0c4a6e 0%, #0284c7 55%, #bae6fd 100%)",
    foreground: "#ffffff",
    accent: "#e0f2fe",
  },
  spring: {
    key: "spring",
    ar: "عروض الربيع",
    en: "Spring Deal",
    emoji: "🌸",
    background: "linear-gradient(135deg, #db2777 0%, #f472b6 50%, #65a30d 100%)",
    foreground: "#ffffff",
    accent: "#fdf2f8",
  },
  flash: {
    key: "flash",
    ar: "عرض خاطف",
    en: "Flash Deal",
    emoji: "⚡",
    background: "linear-gradient(135deg, #b91c1c 0%, #ea580c 100%)",
    foreground: "#ffffff",
    accent: "#fef08a",
  },
  hyper: {
    key: "hyper",
    ar: "هايبر ديل",
    en: "Hyper Deal",
    emoji: "🚀",
    background: "linear-gradient(135deg, #7e22ce 0%, #db2777 55%, #e11d48 100%)",
    foreground: "#ffffff",
    accent: "#fbcfe8",
  },
  custom: {
    key: "custom",
    ar: "عرض خاص",
    en: "Special Deal",
    emoji: "🏷️",
    background: "linear-gradient(135deg, #15803d 0%, #65a30d 100%)",
    foreground: "#ffffff",
    accent: "#ecfccb",
  },
};

export const OCCASION_KEYS = Object.keys(OCCASIONS) as OccasionKey[];

export function occasionTheme(key: unknown): OccasionTheme {
  return OCCASIONS[(String(key ?? "") as OccasionKey)] ?? OCCASIONS.custom;
}

/* ----------------------------------------------------------- configuration */

export type DealScope = "games" | "all" | "selected";

export interface DealCampaign {
  id: string;
  occasion: OccasionKey;
  /** The customer-facing name; the occasion's own name when empty. */
  label?: string;
  /** Percentage off, 1–90. */
  percent: number;
  /** ISO instant; empty means "from now". */
  startsAt?: string;
  /** ISO instant; empty means "until switched off". */
  endsAt?: string;
  scope: DealScope;
  productIds?: string[];
  active: boolean;
}

export interface DealsConfig {
  /** The master switch: off means every price is exactly as stored. */
  enabled: boolean;
  campaigns: DealCampaign[];
}

/** Stored on a product by its edit page. */
export interface ProductDealOverride {
  mode: "inherit" | "custom" | "exclude";
  occasion?: OccasionKey;
  label?: string;
  percent?: number;
  startsAt?: string;
  endsAt?: string;
}

/** What a live deal looks like on a product the customer receives. */
export interface AppliedDeal {
  id: string;
  occasion: OccasionKey;
  label: string;
  /** The percentage this product actually gets, after the cost floor. */
  percent: number;
  startsAt?: string;
  endsAt?: string;
}

export const MAX_DEAL_PERCENT = 90;

function clampPercent(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DEAL_PERCENT, n);
}

function isoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

function normalizeCampaign(raw: unknown, index: number): DealCampaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const percent = clampPercent(r["percent"]);
  if (!percent) return null;
  const scope: DealScope =
    r["scope"] === "all" || r["scope"] === "selected" ? (r["scope"] as DealScope) : "games";
  const productIds = Array.isArray(r["productIds"])
    ? (r["productIds"] as unknown[]).map((id) => String(id)).filter(Boolean)
    : [];
  return {
    id: String(r["id"] || `deal_${index + 1}`),
    occasion: occasionTheme(r["occasion"]).key,
    label: typeof r["label"] === "string" ? r["label"].trim().slice(0, 60) : "",
    percent,
    startsAt: isoOrEmpty(r["startsAt"]),
    endsAt: isoOrEmpty(r["endsAt"]),
    scope,
    ...(scope === "selected" ? { productIds } : {}),
    active: r["active"] !== false,
  };
}

/** The shop's deal settings, normalised. Anything malformed reads as "no deal". */
export function readDealsConfig(settings: Record<string, unknown> | null | undefined): DealsConfig {
  const raw = settings?.["deals"];
  if (!raw || typeof raw !== "object") return { enabled: false, campaigns: [] };
  const r = raw as Record<string, unknown>;
  const campaigns = Array.isArray(r["campaigns"])
    ? (r["campaigns"] as unknown[])
        .map((entry, i) => normalizeCampaign(entry, i))
        .filter((c): c is DealCampaign => Boolean(c))
    : [];
  return { enabled: r["enabled"] === true, campaigns };
}

export function readProductDealOverride(product: unknown): ProductDealOverride {
  const raw = (product as Record<string, unknown> | null | undefined)?.["occasionDeal"];
  if (!raw || typeof raw !== "object") return { mode: "inherit" };
  const r = raw as Record<string, unknown>;
  const mode = r["mode"] === "custom" || r["mode"] === "exclude" ? r["mode"] : "inherit";
  if (mode !== "custom") return { mode };
  return {
    mode,
    occasion: occasionTheme(r["occasion"]).key,
    label: typeof r["label"] === "string" ? r["label"].trim().slice(0, 60) : "",
    percent: clampPercent(r["percent"]),
    startsAt: isoOrEmpty(r["startsAt"]),
    endsAt: isoOrEmpty(r["endsAt"]),
  };
}

/** Between start and end, either of which may be open. */
export function isWithinWindow(
  startsAt: string | undefined,
  endsAt: string | undefined,
  now: number,
): boolean {
  const start = startsAt ? Date.parse(startsAt) : NaN;
  const end = endsAt ? Date.parse(endsAt) : NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now >= end) return false;
  return true;
}

/** Is this product a game, the way the shelves decide it? */
function isGame(product: Record<string, unknown>): boolean {
  const kind = String(product["kind"] ?? "").toLowerCase();
  if (["hardware", "physical", "accessory", "device", "amiibo", "gift_card", "giftcard"].includes(kind)) {
    return false;
  }
  const category = `${product["category"] ?? ""} ${product["categoryId"] ?? ""}`.toLowerCase();
  if (/hardware|accessor|amiibo|gift/.test(category)) return false;
  return true;
}

function campaignCovers(campaign: DealCampaign, product: Record<string, unknown>): boolean {
  if (campaign.scope === "all") return true;
  if (campaign.scope === "selected") {
    return (campaign.productIds ?? []).includes(String(product["id"] ?? ""));
  }
  return isGame(product);
}

/**
 * The deal this product is under right now, before the cost floor — or null.
 *
 * A product's own occasion wins over the store-wide campaigns; a product set
 * to sit the deals out never gets one; with the master switch off, nothing
 * does. Among campaigns, the largest live discount wins.
 */
export function dealForProduct(
  product: Record<string, unknown> | null | undefined,
  config: DealsConfig,
  now: number,
): AppliedDeal | null {
  if (!product || !config.enabled) return null;
  const override = readProductDealOverride(product);
  if (override.mode === "exclude") return null;

  if (override.mode === "custom") {
    if (!override.percent) return null;
    if (!isWithinWindow(override.startsAt, override.endsAt, now)) return null;
    const theme = occasionTheme(override.occasion);
    return {
      id: `product:${String(product["id"] ?? "")}`,
      occasion: theme.key,
      label: override.label || theme.ar,
      percent: override.percent,
      ...(override.startsAt ? { startsAt: override.startsAt } : {}),
      ...(override.endsAt ? { endsAt: override.endsAt } : {}),
    };
  }

  let best: DealCampaign | null = null;
  for (const campaign of config.campaigns) {
    if (!campaign.active) continue;
    if (!isWithinWindow(campaign.startsAt, campaign.endsAt, now)) continue;
    if (!campaignCovers(campaign, product)) continue;
    if (!best || campaign.percent > best.percent) best = campaign;
  }
  if (!best) return null;
  const theme = occasionTheme(best.occasion);
  return {
    id: best.id,
    occasion: theme.key,
    label: best.label || theme.ar,
    percent: best.percent,
    ...(best.startsAt ? { startsAt: best.startsAt } : {}),
    ...(best.endsAt ? { endsAt: best.endsAt } : {}),
  };
}

/* ----------------------------------------------------------------- pricing */

/** The shop's price step: every price is a whole multiple of 250 dinars. */
const PRICE_STEP = 250;

function amount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string" || !value.trim()) return 0;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The least a row may be sold for: its cost plus a working margin — 3% or
 * 500 IQD, whichever is more. No cost on record means no floor to keep.
 */
export function costFloor(cost: number): number {
  if (!(cost > 0)) return 0;
  return cost + Math.max(500, cost * 0.03);
}

/** One price under a deal: to the nearest step, above the floor, below the price. */
export function dealPrice(regular: number, percent: number, floor = 0): number {
  if (!(regular > 0) || !(percent > 0)) return regular;
  let next = Math.round((regular * (1 - percent / 100)) / PRICE_STEP) * PRICE_STEP;
  if (floor > 0 && next < floor) next = Math.ceil(floor / PRICE_STEP) * PRICE_STEP;
  return next > 0 && next < regular ? next : regular;
}

/** Product-level selling prices a deal applies to (lend/disc are display-only offers). */
const PRODUCT_PRICE_KEYS = ["price", "basePrice", "accountPrice", "accountOnlinePrice"] as const;
/** Their compare-at fields, written with the regular price while a deal is live. */
const COMPARE_AT_OF: Record<(typeof PRODUCT_PRICE_KEYS)[number], string> = {
  price: "originalPrice",
  basePrice: "originalPrice",
  accountPrice: "originalPrice",
  accountOnlinePrice: "accountOnlineOriginalPrice",
};
const ROW_LISTS = ["options", "types", "variants", "editions", "dlcs"] as const;

function productCost(product: Record<string, unknown>): number {
  return amount(product["cost"]) || amount(product["costPrice"]) || amount(product["baseCost"]);
}

/**
 * The largest percentage, up to `wanted`, that keeps every priced row of this
 * product at or above its cost floor. 0 when even 1% would cut into cost.
 */
export function safePercent(product: Record<string, unknown>, wanted: number): number {
  const fallbackCost = productCost(product);
  let allowed = wanted;
  const consider = (price: number, cost: number) => {
    if (!(price > 0) || !(cost > 0)) return;
    // Rounding may land up to half a step lower; keep that inside the floor too.
    const floor = costFloor(cost) + PRICE_STEP / 2;
    const max = Math.floor((1 - floor / price) * 100);
    allowed = Math.min(allowed, Math.max(0, max));
  };
  for (const key of PRODUCT_PRICE_KEYS) consider(amount(product[key]), fallbackCost);
  for (const list of ROW_LISTS) {
    const rows = product[list];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      consider(amount(r["price"]), amount(r["cost"]) || fallbackCost);
    }
  }
  return Math.max(0, Math.floor(allowed));
}

/**
 * The product as a customer should see and be charged for it right now.
 *
 * Returns the same object when no deal applies — so a shop with the deals
 * switched off serves exactly what it stores. Otherwise a copy, with every
 * selling price lowered and its compare-at set to today's price, plus `deal`
 * describing the occasion for the badge and the countdown.
 */
export function applyDealToProduct<T extends Record<string, unknown>>(
  product: T,
  config: DealsConfig,
  now: number = Date.now(),
): T {
  const wanted = dealForProduct(product, config, now);
  if (!wanted) return product;
  const percent = safePercent(product, wanted.percent);
  if (percent < 1) return product;

  const fallbackCost = productCost(product);
  const next: Record<string, unknown> = { ...product };
  let changed = false;

  /** Lower one product-level price; returns its regular figure, or 0 if unchanged. */
  const lower = (key: (typeof PRODUCT_PRICE_KEYS)[number]): number => {
    const regular = amount(product[key]);
    if (!(regular > 0)) return 0;
    const lowered = dealPrice(regular, percent, costFloor(fallbackCost));
    if (lowered >= regular) return 0;
    next[key] = lowered;
    changed = true;
    return regular;
  };
  const priceRegular = lower("price");
  const baseRegular = lower("basePrice");
  const accountRegular = lower("accountPrice");
  const onlineRegular = lower("accountOnlinePrice");
  /*
    The struck-through figure is today's real price, never an inflated one.
    `originalPrice` is the compare-at of the headline price (and of the offline
    account offer, which shares it); the online account has its own.
  */
  const headlineRegular = priceRegular || accountRegular || baseRegular;
  if (headlineRegular) next[COMPARE_AT_OF.price] = headlineRegular;
  if (onlineRegular) next[COMPARE_AT_OF.accountOnlinePrice] = onlineRegular;

  for (const list of ROW_LISTS) {
    const rows = product[list];
    if (!Array.isArray(rows)) continue;
    next[list] = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const r = row as Record<string, unknown>;
      const regular = amount(r["price"]);
      if (!(regular > 0)) return row;
      const lowered = dealPrice(regular, percent, costFloor(amount(r["cost"]) || fallbackCost));
      if (lowered >= regular) return row;
      changed = true;
      return { ...r, price: lowered, originalPrice: regular };
    });
  }

  if (!changed) return product;
  next["deal"] = { ...wanted, percent } satisfies AppliedDeal;
  return next as T;
}

/** The live deal a customer-side product carries, if its window is still open. */
export function liveDealOf(product: unknown, now: number = Date.now()): AppliedDeal | null {
  const raw = (product as Record<string, unknown> | null | undefined)?.["deal"];
  if (!raw || typeof raw !== "object") return null;
  const deal = raw as AppliedDeal;
  if (!(Number(deal.percent) > 0)) return null;
  if (!isWithinWindow(deal.startsAt, deal.endsAt, now)) return null;
  return { ...deal, occasion: occasionTheme(deal.occasion).key };
}

/**
 * A short key that changes whenever what the deals show could change.
 *
 * The public catalogue is cached against the catalogue revision, which moves
 * only on a write — but a deal starts and ends by the clock. While deals are
 * on, the cache key also carries a five-minute bucket, so an opening or a
 * closing reaches shoppers within minutes without anyone saving anything.
 */
export function dealsCacheKey(config: DealsConfig, now: number = Date.now()): string {
  if (!config.enabled || config.campaigns.length === 0) {
    return config.enabled ? "deals:on" : "";
  }
  return `deals:${Math.floor(now / 300_000)}`;
}

/** Remaining time, as the badge prints it: «2ي 5س», «3س 20د», «12د». */
export function timeLeftLabel(endsAt: string | undefined, now: number = Date.now()): string {
  if (!endsAt) return "";
  const ms = Date.parse(endsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}ي ${hours}س`;
  if (hours > 0) return `${hours}س ${mins}د`;
  return `${Math.max(1, mins)}د`;
}
