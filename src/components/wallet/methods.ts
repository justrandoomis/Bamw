import { CreditCard, Gamepad2, Gift, Smartphone, Zap, Coins, type LucideIcon } from "lucide-react";

/**
 * The ways to top up the wallet, in the order the owner set:
 *
 *   «اجعل خيار ماستر كارد اولا ثم زين كاش ثم نتندو كريدت كارد وبعدها باينس
 *    باي بعدها كود بنانتو»
 *
 * One list for the top-up sheet, the wallet page's shortcuts and the history's
 * labels, so a method is called the same thing everywhere it appears.
 *
 * `crypto` is not on the owner's list. It stays last, and only where the shop
 * has a crypto address to show — a method with nothing to transfer to is a
 * dead end, not a choice.
 */
export type TopUpMethod =
  "rafidain" | "zain_cash" | "eshop_card" | "binance" | "banan_code" | "crypto";

export interface TopUpMethodInfo {
  key: TopUpMethod;
  /** The name on the method's own row. */
  label: string;
  /** The short name under a shortcut tile. */
  short: string;
  /** One line on how it works. */
  hint: string;
  icon: LucideIcon;
  /** Icon tile tint — readable on every theme pack, light or dark. */
  tint: string;
  /** Credited without waiting for a person to check it. */
  instant?: boolean;
  /** The amount is entered in dollars, not dinars. */
  dollars?: boolean;
}

export const TOPUP_METHODS: readonly TopUpMethodInfo[] = [
  {
    key: "rafidain",
    label: "ماستركارد الرافدين",
    short: "ماستركارد",
    hint: "حوّل إلى البطاقة وارفع صورة الإيصال",
    icon: CreditCard,
    tint: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  },
  {
    key: "zain_cash",
    label: "زين كاش",
    short: "زين كاش",
    hint: "حوّل إلى الرقم وارفع صورة الإيصال",
    icon: Smartphone,
    tint: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  {
    key: "eshop_card",
    label: "بطاقة نينتندو eShop",
    short: "نينتندو",
    hint: "أرسل كود البطاقة ويُضاف بقيمته",
    icon: Gamepad2,
    tint: "bg-red-500/15 text-red-600 dark:text-red-300",
    dollars: true,
  },
  {
    key: "binance",
    label: "Binance Pay",
    short: "Binance",
    hint: "حوّل USDT ويُضاف تلقائيًا",
    icon: Zap,
    tint: "bg-amber-400/20 text-amber-700 dark:text-amber-300",
    instant: true,
    dollars: true,
  },
  {
    key: "banan_code",
    label: "كود بنانتو",
    short: "كود بنانتو",
    hint: "أدخل الكود ويُضاف فورًا",
    icon: Gift,
    tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    instant: true,
  },
  {
    key: "crypto",
    label: "عملات رقمية",
    short: "عملات رقمية",
    hint: "حوّل إلى العنوان وارفع صورة التحويل",
    icon: Coins,
    tint: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    dollars: true,
  },
];

/** The methods this shop can take right now, in the owner's order. */
export function availableMethods(settings: Record<string, unknown>): TopUpMethodInfo[] {
  return TOPUP_METHODS.filter(
    (method) => method.key !== "crypto" || String(settings?.["cryptoID"] ?? "").trim() !== "",
  );
}

export function methodInfo(key: string | undefined): TopUpMethodInfo | undefined {
  return TOPUP_METHODS.find((method) => method.key === key);
}

/** Where the money goes for a method paid by transfer, from the shop's settings. */
export function transferTarget(
  key: TopUpMethod,
  settings: Record<string, unknown>,
): { value: string; qr: string } {
  const read = (name: string) => String(settings?.[name] ?? "").trim();
  if (key === "zain_cash") return { value: read("zainCashNumber"), qr: read("zainCashQR") };
  if (key === "rafidain") return { value: read("rafidainNumber"), qr: read("rafidainQR") };
  if (key === "crypto") return { value: read("cryptoID"), qr: "" };
  return { value: "", qr: "" };
}
