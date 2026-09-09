import type { AccountBundle, BundleAccountKind, BundleAccountOption, Product } from "./types";

/**
 * What a game with no price of its own is worth inside a bundle.
 *
 * A game named in the description that the shop does not carry yet gets a
 * hidden placeholder row with no price, on purpose — the admin fills it in
 * later. Counting that as zero made the "sum of the individual prices" fall by
 * one game every time a placeholder was created, so a four-game bundle could
 * advertise a smaller saving than a three-game one. The owner set this figure:
 * a game the shop has not priced is counted at five thousand until it is.
 */
export const UNPRICED_GAME_VALUE = 5000;

export function getBundleGames(bundle: AccountBundle, products: Product[]): Product[] {
  if (!bundle.gameIds || !Array.isArray(bundle.gameIds) || !products || !Array.isArray(products)) {
    return [];
  }
  const idSet = new Set(bundle.gameIds.map((id) => String(id)));
  return products.filter((p) => idSet.has(String(p.id)));
}

/**
 * The sum of what the games in a bundle cost separately.
 *
 * Every id in `gameIds` counts once, whether or not the catalogue at hand can
 * resolve it. Three things made that not so:
 *
 *  - a game the customer's catalogue cannot see. Placeholders are hidden, and
 *    the public catalogue drops hidden rows, so a bundle carrying one summed
 *    over fewer games on the storefront than in the admin panel;
 *  - a placeholder that *is* resolved but carries no price, which added zero;
 *  - a pending entry, which was never summed at all.
 *
 * All three are the same case — a game the shop has not priced — and all three
 * are now worth {@link UNPRICED_GAME_VALUE}. Counting by id rather than by
 * resolved row is also what stops a game being counted twice once its
 * placeholder is filled in and published.
 */
export function sumBundleGamePrices(bundle: AccountBundle, products: Product[]): number {
  const ids = Array.isArray(bundle.gameIds) ? bundle.gameIds : [];
  if (ids.length === 0) return 0;

  const priceById = new Map<string, number>();
  for (const product of products ?? []) {
    priceById.set(String(product.id), Number(product.price) || 0);
  }

  let total = 0;
  const counted = new Set<string>();
  for (const id of ids) {
    const key = String(id);
    // A bundle listing the same game twice is one game, not two.
    if (counted.has(key)) continue;
    counted.add(key);
    const price = priceById.get(key) ?? 0;
    total += price > 0 ? price : UNPRICED_GAME_VALUE;
  }
  return total;
}

export function getBundleOriginalTotal(bundle: AccountBundle, products: Product[]): number {
  if (bundle.originalPrice && bundle.originalPrice > bundle.price) {
    return bundle.originalPrice;
  }
  const sum = sumBundleGamePrices(bundle, products);
  return sum > bundle.price ? sum : Math.round(bundle.price * 1.4);
}

/**
 * The ways this bundle can be bought.
 *
 * A bundle saved before options existed carries only `accountType`, so it is
 * read as the single option it has always been. That keeps every existing
 * bundle buyable and priced exactly as before — the list is never empty, so
 * callers do not each need their own answer for "what if there are none".
 */
export function bundleAccountOptions(bundle: AccountBundle): BundleAccountOption[] {
  const declared = Array.isArray(bundle.accountOptions) ? bundle.accountOptions : [];
  const usable = declared.filter((option) => option && String(option.id ?? "").trim());
  if (usable.length > 0) return usable;
  const kind = (bundle.accountType ?? "primary") as BundleAccountKind;
  return [{ id: `legacy_${kind}`, kind, extraPrice: 0 }];
}

/**
 * What to call one option on screen and on the order.
 *
 * The admin's own words when they typed any, and otherwise the standard label
 * for that kind — so an option added with nothing but a kind still reads as
 * «حساب أوفلاين (Offline)» rather than as an id.
 */
export function bundleAccountLabel(option: BundleAccountOption): string {
  const own = String(option.label ?? "").trim();
  return own || getAccountTypeInfo(option.kind).label;
}

/**
 * What one copy of this bundle costs, given the option the buyer picked.
 *
 * The bundle record is the source. Only the *id* of the option is read from
 * the request; an id naming nothing on the record prices as the bundle's own
 * price rather than as whatever was claimed alongside it. That is the rule
 * `resolveUnitPrice` already applies to products, and it is here for the same
 * reason: the storefront and the till must not be able to disagree.
 */
export function resolveBundleUnitPrice(
  bundle: AccountBundle,
  selection: { optionId?: string | number | null } = {},
): { unitPrice: number; option: BundleAccountOption | null } {
  const base = Number(bundle?.price) || 0;
  const wanted =
    selection.optionId === undefined || selection.optionId === null
      ? ""
      : String(selection.optionId);
  if (!wanted) return { unitPrice: base, option: null };

  const option = bundleAccountOptions(bundle).find((row) => String(row.id) === wanted);
  if (!option) return { unitPrice: base, option: null };

  const extra = Number(option.extraPrice) || 0;
  // A negative surcharge would be a discount nobody typed. Ignored, not applied.
  return { unitPrice: base + (extra > 0 ? extra : 0), option };
}

/**
 * How much the bundle saves against buying the games separately.
 *
 * `paying` is what the customer is actually about to be charged, which is not
 * always `bundle.price`: an account option adds to it. Measured against the
 * base, a bundle bought as the dearer account claimed a saving larger than the
 * one it gives. Defaults to the bundle's own price, so a caller with no
 * selection to hand gets what it always got.
 */
export function getBundleSavings(
  bundle: AccountBundle,
  products: Product[],
  paying?: number,
): { amount: number; percentage: number } {
  const original = getBundleOriginalTotal(bundle, products);
  const current =
    Number.isFinite(paying as number) && (paying as number) > 0
      ? (paying as number)
      : Number(bundle.price) || 0;
  if (original <= current) {
    return { amount: 0, percentage: 0 };
  }
  const amount = original - current;
  const percentage = Math.round((amount / original) * 100);
  return { amount, percentage };
}

export function getAccountTypeInfo(type?: string): {
  label: string;
  description: string;
  color: string;
} {
  switch (type) {
    case "primary":
      return {
        label: "حساب رئيسي (Primary)",
        description:
          "يمكنك اللعب بجميع الحسابات على جهازك مع حفظ التخزينات واللعب أونلاين وأوفلاين",
        color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      };
    case "secondary":
      return {
        label: "حساب فرعي (Secondary)",
        description: "اللعب من نفس الحساب المشترى مع اتصال بالإنترنت لبدء اللعبة",
        color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      };
    case "full":
      return {
        label: "حساب كامل خاص (Full Ownership)",
        description: "حساب كامل مع الإيميل الأساسي وإمكانية تغيير كافة البيانات وكلمة المرور",
        color: "bg-purple-500/10 text-purple-600 border-purple-500/20",
      };
    case "offline":
      return {
        label: "حساب أوفلاين (Offline)",
        description: "تحميل الألعاب كاملة واللعب بدون الحاجة لاتصال بالإنترنت",
        color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      };
    /*
      The admin panel has offered this since before bundles had options, and
      nothing here answered for it — so a bundle sold as an online account was
      labelled «حساب رقمي أصلي» by the default below, on the card, on the page
      and in the account-type explanation. Named now, in the same words the
      admin picks it by.
    */
    case "online":
      return {
        label: "حساب أونلاين (Online)",
        description: "اللعب أونلاين من الحساب المشترى مع الاتصال بالإنترنت وكل مزايا الشبكة",
        color: "bg-sky-500/10 text-sky-600 border-sky-500/20",
      };
    default:
      return {
        label: "حساب رقمي أصلي (Digital Account)",
        description: "تحميل رسمي ومباشر من متجر Nintendo eShop مع ضمان شامل",
        color: "bg-red-500/10 text-red-600 border-red-500/20",
      };
  }
}

export function generateSeedBundles(products: Product[]): AccountBundle[] {
  const switchGames = products.filter(
    (p) =>
      p.isActive !== false &&
      p.kind !== "hardware" &&
      p.kind !== "accessory" &&
      p.kind !== "device",
  );

  const marioGames = switchGames.filter((g) =>
    /mario|luigi|kart|odyssey|wonder|party/i.test(
      String(g.title || "") + " " + String(g.titleEn || ""),
    ),
  );
  const zeldaGames = switchGames.filter((g) =>
    /zelda|hyrule|tears|breath|link/i.test(String(g.title || "") + " " + String(g.titleEn || "")),
  );
  const pokemonGames = switchGames.filter((g) =>
    /pokemon|pokémon|arceus|scarlet|violet/i.test(
      String(g.title || "") + " " + String(g.titleEn || ""),
    ),
  );
  const actionGames = switchGames.filter(
    (g) =>
      !marioGames.includes(g) &&
      !zeldaGames.includes(g) &&
      !pokemonGames.includes(g) &&
      (g.price || 0) > 0,
  );

  const now = new Date().toISOString();
  const bundles: AccountBundle[] = [];

  // Mario Bundle
  if (marioGames.length >= 2) {
    const selected = marioGames.slice(0, 3);
    const origSum = selected.reduce((sum, g) => sum + (Number(g.price) || 25000), 0);
    const bundlePrice = Math.round((origSum * 0.65) / 1000) * 1000 || 38000;
    bundles.push({
      id: "bnd_mario_allstars",
      title: "بندل أساطير ماريو الشامل (3 ألعاب)",
      titleEn: "Mario All-Stars Complete Bundle",
      slug: "mario-all-stars-bundle",
      description:
        "احصل على أقوى وأشهر 3 ألعاب من عالم سوبر ماريو في حساب ننتندو سويتش واحد جاهز للتحميل المباشر مع توفير كبير وضمان مدى الحياة.",
      price: bundlePrice,
      originalPrice: origSum || 55000,
      image:
        (selected[0]?.image as string | undefined) ||
        (selected[0]?.coverImage as string | undefined) ||
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=600&auto=format&fit=crop",
      gameIds: selected.map((g) => g.id),
      accountType: "primary",
      stock: 25,
      isActive: true,
      badge: "الأكثر مبيعاً 🔥",
      features: [
        "3 ألعاب ماريو كاملة بحساب واحد",
        "تفعيل رئيسي - العب بحسابك الشخصي",
        "تحميل مباشر وسريع من Nintendo eShop",
        "دعم الأونلاين والتخزين السحابي",
        "ضمان ذهبي شامل ودائم",
      ],
      deliveryTime: "فوري وتلقائي في محادثة الطلب",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Zelda Bundle
  if (zeldaGames.length >= 2) {
    const selected = zeldaGames.slice(0, 2);
    const origSum = selected.reduce((sum, g) => sum + (Number(g.price) || 30000), 0);
    const bundlePrice = Math.round((origSum * 0.7) / 1000) * 1000 || 42000;
    bundles.push({
      id: "bnd_zelda_duology",
      title: "بندل ملحمة زيلدا (Tears & Breath of the Wild)",
      titleEn: "Zelda Dual Masterpiece Bundle",
      slug: "zelda-dual-masterpiece-bundle",
      description:
        "عش أروع تجربة عالم مفتوح في تاريخ الألعاب مع تحفتي زيلدا بحساب ننتندو سويتش واحد رسمي ومضمون 100%.",
      price: bundlePrice,
      originalPrice: origSum || 60000,
      image:
        (selected[0]?.image as string | undefined) ||
        (selected[0]?.coverImage as string | undefined) ||
        "https://images.unsplash.com/photo-1563089145-599997674d42?q=80&w=600&auto=format&fit=crop",
      gameIds: selected.map((g) => g.id),
      accountType: "primary",
      stock: 18,
      isActive: true,
      badge: "توفير 35% 💎",
      features: [
        "اللعبتان مع كافة التحديثات الرسمية",
        "لعب بدون قيود على السويتش الخاص بك",
        "تسليم بيانات الحساب فورياً",
        "ضمان استبدال مدى الحياة",
      ],
      deliveryTime: "فوري وتلقائي في محادثة الطلب",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Pokemon Bundle
  if (pokemonGames.length >= 2) {
    const selected = pokemonGames.slice(0, 2);
    const origSum = selected.reduce((sum, g) => sum + (Number(g.price) || 25000), 0);
    const bundlePrice = Math.round((origSum * 0.68) / 1000) * 1000 || 36000;
    bundles.push({
      id: "bnd_pokemon_masters",
      title: "بندل مغامرات بوكيمون الأسطوري",
      titleEn: "Pokemon Masters Switch Bundle",
      slug: "pokemon-masters-bundle",
      description:
        "انطلق في أروع رحلات البوكيمون واصطد أندر المخلوقات في حساب واحد يضم نخبة ألعاب بوكيمون على السويتش.",
      price: bundlePrice,
      originalPrice: origSum || 52000,
      image:
        (selected[0]?.image as string | undefined) ||
        (selected[0]?.coverImage as string | undefined) ||
        "https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?q=80&w=600&auto=format&fit=crop",
      gameIds: selected.map((g) => g.id),
      accountType: "primary",
      stock: 20,
      isActive: true,
      badge: "بندل مميز ⭐",
      features: [
        "أقوى ألعاب بوكيمون بحساب واحد",
        "إمكانية التبادل واللعب أونلاين",
        "تسليم فوري ومباشر في المحادثة",
        "ضمان كامل ودعم فني مستمر",
      ],
      deliveryTime: "فوري وتلقائي في محادثة الطلب",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Ultimate Variety Bundle
  if (switchGames.length >= 3 && bundles.length === 0) {
    const selected = switchGames.slice(0, 3);
    const origSum = selected.reduce((sum, g) => sum + (Number(g.price) || 25000), 0);
    const bundlePrice = Math.round((origSum * 0.6) / 1000) * 1000 || 35000;
    bundles.push({
      id: "bnd_switch_essentials",
      title: "حزمة ألعاب السويتش الأساسية (3 ألعاب)",
      titleEn: "Switch Essentials Mega Bundle",
      slug: "switch-essentials-bundle",
      description:
        "مجموعة مختارة من أفضل ألعاب ننتندو سويتش في حساب رقمي واحد لتستمتع بأفضل تجربة لعب وتوفير هائل.",
      price: bundlePrice,
      originalPrice: origSum || 50000,
      image:
        (selected[0]?.image as string | undefined) ||
        (selected[0]?.coverImage as string | undefined) ||
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=600&auto=format&fit=crop",
      gameIds: selected.map((g) => g.id),
      accountType: "primary",
      stock: 15,
      isActive: true,
      badge: "توفير 40% 🚀",
      features: [
        "3 ألعاب ممتازة بحساب واحد",
        "تحميل من المتجر الرسمي eShop",
        "تسليم فوري بعد الدفع",
        "ضمان مدى الحياة",
      ],
      deliveryTime: "فوري وتلقائي في محادثة الطلب",
      createdAt: now,
      updatedAt: now,
    });
  }

  return bundles;
}
