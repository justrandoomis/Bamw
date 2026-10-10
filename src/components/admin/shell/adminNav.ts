import {
  BarChart2,
  Bell,
  BookOpen,
  Coins,
  FileUp,
  Folder,
  Gift,
  HelpCircle,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  LifeBuoy,
  MessageSquare,
  Music,
  Package,
  PercentCircle,
  PieChart,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  Ticket,
  Trophy,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Where everything in the admin lives, grouped by the job it is for.
 *
 * The old sidebar was one long list in the order things were built — the
 * catalogue between the music and the reviews, the money under a collapsed
 * group, the banana economy beside the user list — so finding a screen meant
 * reading the whole list. These groups follow a working day instead: what is
 * waiting now, the catalogue, the shop's offers, the bananas, the money, the
 * members, the help pages, and the machinery.
 *
 * Every `id` is a section the dashboard already renders; nothing here invents
 * a screen. An item with `href` is a page of its own.
 */

export type AdminBadge = "orders" | "chats" | "gameRequests";

export interface AdminNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Other words an admin might type for this screen. */
  keywords?: string;
  /** A live count shown beside the label. */
  badge?: AdminBadge;
  /** A separate page rather than a section of the dashboard. */
  href?: string;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "today",
    label: "اليوم",
    items: [
      { id: "dashboard", label: "الرئيسية", icon: LayoutDashboard, keywords: "لوحة التحكم home" },
      {
        id: "orders",
        label: "الطلبات",
        icon: ShoppingCart,
        badge: "orders",
        keywords: "مبيعات تسليم دفع orders",
      },
      {
        id: "messages",
        label: "المحادثات والدعم",
        icon: MessageSquare,
        badge: "chats",
        keywords: "رسائل شات دعم inbox chat",
      },
    ],
  },
  {
    id: "catalogue",
    label: "الكتالوج",
    items: [
      {
        id: "listings_all",
        label: "المنتجات",
        icon: Package,
        keywords: "ألعاب منتجات اسعار products games",
      },
      { id: "categories", label: "الأقسام", icon: Folder, keywords: "تصنيفات categories" },
      { id: "bundles", label: "حزم الحسابات", icon: Layers, keywords: "باقات bundles" },
      {
        id: "missing_square_images",
        label: "ألعاب بلا صورة مربعة",
        icon: ImageIcon,
        keywords: "صور غلاف images",
      },
      {
        id: "import",
        label: "استيراد بيانات الألعاب",
        icon: FileUp,
        href: "/admin/import",
        keywords: "رفع ملف import",
      },
      {
        id: "image_migration",
        label: "نظام صور المنتجات",
        icon: ImageIcon,
        keywords: "webp صور",
      },
    ],
  },
  {
    id: "growth",
    label: "العروض والتسويق",
    items: [
      {
        id: "promotions",
        label: "العروض",
        icon: PercentCircle,
        keywords: "عرض 3+1 الرابعة مجانا اشتري ثلاثة offer",
      },
      { id: "coupons", label: "أكواد الخصم", icon: Tag, keywords: "كوبونات كوبون خصم coupon" },
      { id: "referrals", label: "دعوة صديق", icon: Gift, keywords: "إحالات إحالة referral" },
      { id: "contests", label: "المسابقات", icon: Trophy, keywords: "سحب جوائز انستغرام contest" },
      { id: "banners", label: "البنرات الإعلانية", icon: ImageIcon, keywords: "إعلانات banners" },
      { id: "notifications", label: "الإشعارات", icon: Bell, keywords: "تنبيهات notifications" },
    ],
  },
  {
    id: "bananas",
    label: "الموز والروليت",
    items: [
      {
        id: "market_settings",
        label: "اقتصاد الموز والروليت",
        icon: Sparkles,
        keywords: "موز سوق روليت تذاكر banana roulette market",
      },
      { id: "banan_codes", label: "أكواد بنانتا", icon: Coins, keywords: "اكواد شحن codes" },
    ],
  },
  {
    id: "money",
    label: "المال",
    items: [
      {
        id: "financial_stats",
        label: "التكلفة والأرباح",
        icon: PieChart,
        keywords: "ارباح تكلفة مالية profit",
      },
      {
        id: "wallet_mgmt",
        label: "المحافظ والشحن",
        icon: Wallet,
        keywords: "محفظة رصيد شحن wallet",
      },
      { id: "binance_mgmt", label: "Binance Pay", icon: Zap, keywords: "بايننس binance usdt" },
      {
        id: "pricing_settings",
        label: "السعر والتوصيل",
        icon: Settings,
        keywords: "إعدادات السعر صرف دولار توصيل محافظات",
      },
    ],
  },
  {
    id: "members",
    label: "الأعضاء",
    items: [
      { id: "users", label: "المستخدمون", icon: Users, keywords: "اعضاء حسابات users" },
      { id: "reviews", label: "التقييمات", icon: Star, keywords: "تقييم مراجعات reviews" },
      {
        id: "game_requests",
        label: "طلبات الألعاب",
        icon: Ticket,
        badge: "gameRequests",
        keywords: "طلبات اضافة لعبة requests",
      },
      {
        id: "used_listings",
        label: "سوق المستعمل",
        icon: Tag,
        keywords: "مستعمل مسترجع اقراص used",
      },
    ],
  },
  {
    id: "services",
    label: "خدمات المتجر",
    items: [
      { id: "services_requests", label: "طلبات المنتجات", icon: Plus },
      {
        id: "services_disc_trades",
        label: "مقايضة الأقراص",
        icon: RefreshCw,
        keywords: "استبدال trade",
      },
      { id: "services_trade_library", label: "مكتبة أسعار المقايضة", icon: BookOpen },
      { id: "services_faq", label: "الأسئلة الشائعة", icon: HelpCircle, keywords: "faq" },
      { id: "services_policy", label: "السياسات", icon: ShieldCheck, keywords: "سياسة policy" },
      { id: "services_support", label: "إعدادات الدعم", icon: LifeBuoy },
      { id: "services_guides", label: "إرشادات الحساب", icon: BookOpen, keywords: "شرح guides" },
    ],
  },
  {
    id: "system",
    label: "النظام",
    items: [
      { id: "store_advisor", label: "مستشار المتجر", icon: Sparkles, keywords: "ذكاء advisor" },
      { id: "stats", label: "الإحصائيات", icon: BarChart2, keywords: "زيارات مشاهدات stats" },
      { id: "music", label: "الموسيقى", icon: Music, keywords: "اغاني music" },
      { id: "settings", label: "الإعدادات", icon: Settings, keywords: "دفع زين كاش settings" },
    ],
  },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((group) => group.items.map((item) => ({ group, item })));

/**
 * The section a tab id belongs to — `listings_<category>` is still the
 * products screen, and the three old spellings of it land there too.
 */
export function navEntryFor(tab: string): { group: AdminNavGroup; item: AdminNavItem } | null {
  const id =
    tab === "products" || tab === "listings" || tab.startsWith("listings_") ? "listings_all" : tab;
  return ALL_ITEMS.find((entry) => entry.item.id === id) ?? null;
}

/**
 * Arabic as it is typed, folded: hamza forms to their letter, the final
 * ya and ta marbuta to their common shapes, diacritics and tatweel dropped,
 * Latin lowercased. «أكواد» finds «اكواد» and «إحالة» finds «احاله».
 */
export function foldArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PaletteEntry {
  key: string;
  tab: string;
  label: string;
  group: string;
  icon: LucideIcon;
  href?: string;
  haystack: string;
}

/** Every destination the search can reach, including each product category. */
export function paletteEntries(categories: { id: string; title: string }[]): PaletteEntry[] {
  const entries: PaletteEntry[] = ALL_ITEMS.map(({ group, item }) => ({
    key: item.id,
    tab: item.id,
    label: item.label,
    group: group.label,
    icon: item.icon,
    ...(item.href ? { href: item.href } : {}),
    haystack: foldArabic(`${item.label} ${group.label} ${item.keywords ?? ""}`),
  }));
  for (const category of categories) {
    if (!category?.id) continue;
    entries.push({
      key: `listings_${category.id}`,
      tab: `listings_${category.id}`,
      label: `المنتجات › ${category.title || "قسم"}`,
      group: "الكتالوج",
      icon: Package,
      haystack: foldArabic(`منتجات ${category.title} قسم`),
    });
  }
  return entries;
}

/** Entries matching every word typed, the ones whose label starts with it first. */
export function searchPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const words = foldArabic(query).split(" ").filter(Boolean);
  if (!words.length)
    return entries.filter(
      (entry) => !entry.key.startsWith("listings_") || entry.key === "listings_all",
    );
  const matches = entries.filter((entry) => words.every((word) => entry.haystack.includes(word)));
  const first = words[0]!;
  return matches.sort(
    (a, b) =>
      Number(!foldArabic(a.label).startsWith(first)) -
      Number(!foldArabic(b.label).startsWith(first)),
  );
}

/** Threads a person has to answer: handed over, asked for, or waiting on the shop. */
export function threadWaitsForAdmin(thread: Record<string, unknown> | null | undefined): boolean {
  if (!thread || thread["status"] === "closed") return false;
  if (thread["needsAdmin"] === true || thread["humanRequested"] === true) return true;
  return thread["mode"] === "WAITING_FOR_ADMIN" || thread["mode"] === "ESCALATED";
}

/** Orders that still need the shop to do something. */
export function orderNeedsAction(order: Record<string, unknown> | null | undefined): boolean {
  const status = String(order?.["status"] ?? "");
  return status === "pending" || status === "processing";
}
