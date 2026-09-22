/**
 * What went wrong in the banana market, in words a customer can act on.
 *
 * Every refusal arrives as a bare English code — `price_above_max`,
 * `listing_expired`, `insufficient_funds`. The market page translated them; the
 * BUY screen did not, and printed the code itself, so a refusal there read
 * «insufficient_funds» at an Arabic-speaking member.
 *
 * Lifted out of the page so both read one map. Two copies of a message list is
 * how one screen comes to explain a refusal the other only names.
 */
import { dinars } from "@/lib/banana-price";

export interface MarketLimitsForText {
  minPrice: number;
  maxPrice: number;
  minQty: number;
  maxQty: number;
}

/**
 * What went wrong, in words a customer can act on.
 *
 * Every refusal from the market arrives as a bare English code —
 * `price_above_max`, `listing_expired`, `insufficient_funds` — and was printed
 * straight onto the screen. A member who priced a banana above the ceiling read
 * «price_above_max» and had no way to know a ceiling existed, let alone what it
 * was. The limits are passed in so the sentence names the number, which is the
 * difference between an error and an instruction.
 */
export function marketErrorText(error: unknown, limits: MarketLimitsForText): string {
  const code = error instanceof Error ? error.message : String(error ?? "");
  const map: Record<string, string> = {
    price_below_min: `أقل سعر مسموح ${dinars(limits.minPrice)} للموزة الواحدة.`,
    price_above_max: `أعلى سعر مسموح ${dinars(limits.maxPrice)} للموزة الواحدة.`,
    quantity_below_min: `أقل كمية للعرض ${limits.minQty.toLocaleString("en-US")} موزة.`,
    quantity_above_max: `أكبر كمية للعرض ${limits.maxQty.toLocaleString("en-US")} موزة.`,
    insufficient_balance: "رصيدك من الموز لا يكفي لهذا العرض.",
    insufficient_funds: "رصيد محفظتك لا يكفي لإتمام الشراء.",
    listing_not_found: "هذا العرض لم يعد موجوداً.",
    /*
      Bot offers are rebuilt every five minutes, so one left open on screen
      goes stale. Says what to do rather than only that it failed.
    */
    listing_expired: "تغيّر سعر هذا العرض — أغلق النافذة وحدّث السوق ثم أعد المحاولة.",
    cannot_buy_own_listing: "لا يمكنك شراء عرضك أنت.",
    out_of_stock: "نفدت الكمية من هذه الجائزة.",
    profile_incomplete: "أكمل بيانات حسابك أولاً لتتمكن من التداول.",
  };
  return map[code] ?? (code ? `تعذّر إتمام العملية (${code})` : "تعذّر إتمام العملية");
}
