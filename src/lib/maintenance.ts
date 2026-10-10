/**
 * The features the owner has put under maintenance.
 *
 *   «حاليا الروليت والموز وسوق الموز وخصم التقييم الالف دينار
 *    ( اجعلها تحت الصيانه )»
 *   «وقف ميزه استبدال الاقراص وجعلها تحت الصيانه»
 *
 * And later, the banana half back:
 *
 *   «ارجاع ربح الموز / ارجاع الروليت / ارجاع قسم الموز كاملا»
 *
 * So the roulette, the bananas and the banana market are open again; the
 * review discount and disc trade-in are still closed.
 *
 * ONE SWITCH PER FEATURE, ASKED WHEREVER THAT FEATURE CAN MOVE VALUE. A
 * maintenance screen on its own is a curtain: the endpoints behind it would
 * still spin, sell, redeem and mint for anyone who calls them directly. So
 * every server path that changes a banana balance, a ticket count, a market
 * price or a review coupon asks this module first, and the screens ask it too,
 * so a member reads a sentence instead of meeting a refusal.
 *
 * WHAT MAINTENANCE KEEPS, ON PURPOSE:
 *   - every balance — bananas, tickets, wallet money — untouched and shown;
 *   - what the shop already owes: a roulette prize already won can still be
 *     claimed, a review code already issued still works at checkout, and a
 *     disc trade already submitted can still be followed, accepted or
 *     cancelled — and settled by the admin;
 *   - the reviews themselves: a customer can still rate an order. Only the
 *     1,000-dinar code is paused.
 *
 * A constant, not a setting. It reaches production with the deploy that
 * carries it and cannot be flipped by a stray admin save; reopening a feature
 * is setting its line to `false`.
 */
export type MaintenanceFeature =
  | "roulette"
  | "bananas"
  | "bananaMarket"
  | "reviewReward"
  | "discTrade";

export const UNDER_MAINTENANCE: Readonly<Record<MaintenanceFeature, boolean>> = {
  /** Spinning and buying tickets. Claiming a prize already won stays open. */
  roulette: false,
  /** Earning bananas on orders and top-up codes, and spending them on rewards. */
  bananas: false,
  /** Selling to the shop, trading listings, and the market's bots. */
  bananaMarket: false,
  /** The 1,000-dinar code an approved review earns. */
  reviewReward: true,
  /** New disc trade-in requests and their quotes. Trades already submitted carry on. */
  discTrade: true,
};

export function isUnderMaintenance(feature: MaintenanceFeature): boolean {
  return UNDER_MAINTENANCE[feature] === true;
}

export const MAINTENANCE_COPY: Readonly<
  Record<MaintenanceFeature, { title: string; body: string }>
> = {
  roulette: {
    title: "الروليت تحت الصيانة",
    body: "نعمل على تحسين الروليت وسيعود قريبًا. تذاكرك محفوظة، والألعاب التي ربحتها سابقًا يمكنك استيرادها كالمعتاد.",
  },
  bananas: {
    title: "الموز تحت الصيانة",
    body: "كسب الموز واستخدامه متوقفان مؤقتًا. رصيدك من الموز محفوظ بالكامل، وسيعود كل شيء قريبًا.",
  },
  bananaMarket: {
    title: "سوق الموز تحت الصيانة",
    body: "البيع والشراء والجوائز في السوق متوقفة مؤقتًا. رصيدك محفوظ بالكامل، وسيعود السوق قريبًا.",
  },
  reviewReward: {
    title: "خصم التقييم تحت الصيانة",
    body: "كود خصم الألف دينار مقابل التقييم متوقف مؤقتًا. يمكنك تقييم طلبك كالمعتاد.",
  },
  discTrade: {
    title: "استبدال الأقراص تحت الصيانة",
    body: "استقبال طلبات الاستبدال الجديدة متوقف مؤقتًا. طلباتك السابقة محفوظة ويمكنك متابعتها هنا كالمعتاد، وسيعود الاستبدال قريبًا.",
  },
};

/**
 * What a refused request answers with: the sentence a member reads, and a
 * `code` a client can branch on without parsing Arabic.
 */
export function maintenanceError(feature: MaintenanceFeature): {
  error: string;
  code: "maintenance";
  feature: MaintenanceFeature;
} {
  const copy = MAINTENANCE_COPY[feature];
  return { error: `${copy.title}. ${copy.body}`, code: "maintenance", feature };
}
