import { tr } from "@/i18n";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Coins, TrendingDown, TrendingUp, X, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

import TextFlip from "@/components/TextFlip";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { useBananaMarket, type BananaListing } from "@/hooks/useBananaMarket";
import { playSound } from "@/utils/audio";

// recharts is the heaviest dependency on this route; keep it off the critical path.
const BananaPriceChart = lazyWithRetry(() => import("@/components/BananaPriceChart"));

export const Route = createFileRoute("/banana_market")({
  head: () => ({
    meta: [
      { title: "سوق الموز — بنانتو" },
      {
        name: "description",
        content:
          "سوق الموز في بنانتو: تابع سعر الموزة، اشترِ واعرض موزك للبيع، واستبدل رصيدك بمكافآت حقيقية.",
      },
      { property: "og:title", content: "سوق الموز — بنانتو" },
      { property: "og:description", content: "بيع واشترِ الموز واستبدله بمكافآت داخل بنانتو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BananaMarketPage,
});

const CARD =
  "overflow-hidden rounded-[24px] bg-foreground/5 backdrop-blur-3xl border-t border-l border-foreground/20 border-b border-r border-foreground/5 shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] text-foreground";

/**
 * A banana price, in the currency the market actually trades in.
 *
 * Every figure on this page was printed with a `$` in front of it, and the
 * market has never been in dollars: the offers column is `price_iqd`, the bot
 * floor it is compared against is `min_price_iqd`, and the admin panel calls
 * the same number «السعر الأساسي (د.ع)». The shop's own default currency is
 * IQD. So the sign was simply wrong, on every row a customer reads.
 *
 * Not `formatGenericPrice`: that guesses the unit from the magnitude — under
 * 500 it treats the number as dollars and converts it — which is precisely
 * backwards for a price that is a fraction of one dinar. The unit is known
 * here, so it is stated rather than inferred.
 *
 * Three decimals below one dinar, because that is the precision the engine
 * rounds to (`spotPriceAt`), and a price of 0.24 shown as «0 د.ع» would be the
 * same lie in a different font.
 */
export function dinars(value: number | undefined | null): string {
  const amount = Number(value) || 0;
  const digits = amount !== 0 && Math.abs(amount) < 1 ? 3 : amount % 1 === 0 ? 0 : 2;
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} د.ع`;
}

/** Full timestamp with seconds, shown faintly under the price in the tooltip. */
function stampOf(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("ar-IQ", { day: "2-digit", month: "long" });
  const time = d.toLocaleTimeString("ar-IQ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${date} · ${time}`;
}

function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const stamp = stampOf(payload[0]?.payload?.t);
    return (
      <div className="rounded-xl bg-foreground px-3 py-2 text-background shadow-xl ring-1 ring-white/10">
        <p className="text-sm font-semibold" dir="ltr">
          {dinars(Number(payload[0].value))}
        </p>
        {stamp && <p className="mt-0.5 text-[10px] font-medium opacity-60">{stamp}</p>}
      </div>
    );
  }
  return null;
}

const RANGES = ["1H", "4H", "12H", "1D", "7D"];

function BananaMarketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [range, setRange] = useState("1D");
  const { snapshot, isPending, act } = useBananaMarket(range);
  const [modal, setModal] = useState<"none" | "sell" | "buy" | "success">("none");
  const [editing, setEditing] = useState<BananaListing | null>(null);
  const [buying, setBuying] = useState<BananaListing | null>(null);

  const [quantity, setQuantity] = useState("");
  const [pricePer, setPricePer] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  const [promoHours, setPromoHours] = useState(3);
  const [error, setError] = useState("");

  const price = snapshot?.price ?? 0;
  const balance = snapshot?.balance ?? 0;
  const changePct = snapshot?.changePct ?? 0;
  const promoRate = snapshot?.promoRatePerMinute ?? 2;
  const promoCost = isPromoted ? promoHours * 60 * promoRate : 0;

  /** Percentage of the sell price relative to the live market price. */
  const pricePct =
    price > 0 && Number(pricePer) > 0 ? Math.round(((Number(pricePer) - price) / price) * 100) : 0;

  const applyPricePct = (pct: number) => {
    const next = Math.max(0.01, Math.round(price * (1 + pct / 100) * 100) / 100);
    setPricePer(String(next));
  };

  const openSell = (listing?: BananaListing) => {
    playSound("bumper_end", 0.6);
    setEditing(listing ?? null);
    setQuantity(listing ? String(listing.quantity) : "");
    setPricePer(listing ? String(listing.pricePer) : String(price || 0.24));
    setIsPrivate(listing?.isPrivate ?? false);
    setIsPromoted(listing?.isPromoted ?? false);
    setPromoHours(3);
    setError("");
    setModal("sell");
  };

  const submitSell = async () => {
    setError("");
    try {
      if (editing) {
        await act.mutateAsync({
          action: "update_listing",
          id: editing.id,
          quantity: Number(quantity),
          pricePer: Number(pricePer),
        });
      } else {
        await act.mutateAsync({
          action: "create_listing",
          quantity: Number(quantity),
          pricePer: Number(pricePer),
          isPrivate,
          isPromoted,
          promoteMinutes: isPromoted ? promoHours * 60 : 0,
        });
      }
      setModal("success");
      setTimeout(() => setModal("none"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر تنفيذ العملية");
    }
  };

  const openBuy = (listing: BananaListing) => {
    playSound("bumper_end", 0.5);
    setBuying(listing);
    setError("");
    setModal("buy");
  };

  const submitBuy = async () => {
    if (!buying) return;
    setError("");
    try {
      await act.mutateAsync({ action: "buy_listing", id: buying.id });
      setModal("success");
      setTimeout(() => setModal("none"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر إتمام الشراء");
    }
  };

  const cancelListing = async (id: string) => {
    playSound("bumper_end", 0.5);
    try {
      await act.mutateAsync({ action: "cancel_listing", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر إلغاء العرض");
    }
  };

  return (
    <div
      className="min-h-screen bg-background text-foreground overflow-x-hidden relative"
      dir="rtl"
    >
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-4 bg-background/80 backdrop-blur-md">
        <button
          onClick={() => void navigate({ to: "/" })}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors"
          aria-label={tr("إغلاق")}
        >
          <X className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold tracking-tight">{tr("سوق الموز")}</h1>
        <div className="flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1.5 text-sm font-bold">
          <span>🍌</span>
          <span dir="ltr">{(balance / 1000).toFixed(1)}k</span>
        </div>
      </header>

      <main className="relative z-10 px-4 pt-24 pb-28 space-y-4">
        {/* Price + chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${CARD} p-5`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-3xl font-black tracking-tight">{tr("موزة واحدة")}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-2xl font-black" dir="ltr">
                  {dinars(price)}
                </span>
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold border ${
                    changePct < 0
                      ? "bg-destructive/15 border-destructive/30 text-destructive"
                      : "bg-emerald-600/15 border-emerald-600/30 text-emerald-600"
                  }`}
                >
                  {changePct < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : (
                    <TrendingUp className="h-3 w-3" />
                  )}
                  <span dir="ltr">{changePct > 0 ? `+${changePct}` : changePct}%</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-foreground/10 border border-foreground/10 px-2 py-1 text-[10px] font-bold text-foreground/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              </span>
              {tr("السوق مباشر")}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground/90">{tr("مخطط السعر")}</h2>
            <div
              className="flex gap-1 rounded-full bg-foreground/10 p-1 border border-foreground/10"
              dir="ltr"
            >
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    playSound("hover_s", 0.4);
                    setRange(r);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black transition-all ${
                    range === r ? "bg-foreground text-background shadow-sm" : "text-foreground/60"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 h-[200px] w-full" dir="ltr">
            <Suspense fallback={null}>
              <BananaPriceChart data={snapshot?.chart ?? []} tooltip={<CustomTooltip />} />
            </Suspense>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2"
        >
          <Link
            to="/banana_buy"
            onPointerDown={() => playSound("bumper_end", 0.6)}
            className="flex flex-1 flex-col items-center rounded-xl bg-foreground/5 border border-foreground/10 py-3 transition-all active:scale-95 hover:bg-foreground/10"
          >
            <span className="text-sm font-black leading-none text-amber-500">{tr("شراء")}</span>
            <span className="mt-1 text-[10px] font-bold text-foreground/70">{tr("موز")}</span>
          </Link>
          <button
            onClick={() => openSell()}
            className="flex flex-1 flex-col items-center rounded-xl bg-foreground/5 border border-foreground/10 py-3 transition-all active:scale-95 hover:bg-foreground/10"
          >
            <span className="text-sm font-black leading-none text-emerald-600">{tr("بيع")}</span>
            <span className="mt-1 text-[10px] font-bold text-foreground/70">{tr("موز")}</span>
          </button>
          <Link
            to="/banana_redeem"
            onPointerDown={() => playSound("bumper_end", 0.6)}
            className="flex flex-1 flex-col items-center rounded-xl bg-foreground/5 border border-foreground/10 py-3 transition-all active:scale-95 hover:bg-foreground/10"
          >
            <span className="text-sm font-black leading-none">{tr("استبدال")}</span>
            <span className="mt-1 text-[10px] font-bold text-foreground/70">{tr("موز")}</span>
          </Link>
        </motion.div>

        {/* Listings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={`${CARD} pt-5 pb-2`}
        >
          <div className="px-5 pb-3 border-b border-foreground/10">
            <h2 className="text-lg font-black tracking-tight">{tr("عروض السوق")}</h2>
          </div>

          {isPending ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-foreground/20 border-t-amber-500" />
            </div>
          ) : (snapshot?.listings.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-foreground/60">
              {tr("لا توجد عروض حالياً — كن أول من يعرض موزه.")}
            </p>
          ) : (
            <div className="flex flex-col">
              {snapshot!.listings.slice(0, 10).map((l, i) => (
                <div
                  key={l.id}
                  className={`flex items-center justify-between px-5 py-3 transition-colors hover:bg-foreground/5 ${
                    i !== Math.min(9, snapshot!.listings.length - 1)
                      ? "border-b border-foreground/10"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-foreground/10 border border-foreground/10 text-xl">
                      {l.avatar.startsWith("http") ? (
                        <img
                          src={l.avatar}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        l.avatar
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-sm font-bold" dir="ltr">
                        {l.user}
                        {l.verified && <Check className="h-3 w-3 text-emerald-600" />}
                      </div>
                      <div className="text-xs font-semibold text-foreground/60">
                        <span dir="ltr">{l.quantity.toLocaleString("en-US")}</span> {tr("موزة")}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col text-left" dir="ltr">
                      <div className="text-sm font-black leading-tight">
                        ${l.total.toLocaleString("en-US")}
                      </div>
                      <div className="mt-0.5 text-[10px] font-bold leading-tight text-foreground/60">
                        {dinars(l.pricePer)} / موزة
                      </div>
                      <div className="text-[10px] font-bold">
                        {l.isLive ? (
                          <span className="text-foreground/40">{tr("سعر السوق")}</span>
                        ) : (
                          <span className={l.diff < 0 ? "text-emerald-600" : "text-amber-500"}>
                            {Math.abs(l.diff)}% {l.diff < 0 ? "أقل" : "أعلى"}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openBuy(l)}
                      className="flex h-8 items-center rounded-full bg-foreground/20 px-4 text-xs font-black transition-colors hover:bg-foreground/30 active:scale-95"
                    >
                      {tr("شراء")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 pt-3 pb-2">
            <Link
              to="/banana_buy"
              onPointerDown={() => playSound("bumper_end", 0.5)}
              className="flex w-full items-center justify-center rounded-xl bg-foreground/10 border border-foreground/10 py-3 text-sm font-black transition-colors hover:bg-foreground/20 active:scale-95"
            >
              {tr("عرض كل العروض")}
            </Link>
          </div>
        </motion.div>

        {/* My listings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`${CARD} relative p-5`}
        >
          <div className="absolute top-0 left-0 p-5 opacity-10">
            <Coins className="h-20 w-20" />
          </div>
          <div className="relative z-10">
            <h2 className="text-xs font-black uppercase tracking-wider text-emerald-600">
              {tr("عروضي النشطة")}
            </h2>

            <div className="mt-4 space-y-3">
              {(snapshot?.myListings.length ?? 0) === 0 ? (
                <p className="text-sm text-foreground/60">{tr("لا يوجد لديك عرض نشط.")}</p>
              ) : (
                snapshot!.myListings.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between rounded-xl bg-foreground/10 border border-foreground/10 p-3"
                  >
                    <div>
                      <div className="text-sm font-black">
                        <span dir="ltr">{l.quantity.toLocaleString("en-US")}</span> 🍌
                      </div>
                      <div className="mt-0.5 text-[10px] font-bold text-emerald-600">
                        <span dir="ltr">{dinars(l.pricePer)}</span> / موزة •{" "}
                        {l.isPrivate ? "خاص" : "عام"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openSell(l)}
                        className="h-7 rounded-full bg-foreground/20 px-3 text-xs font-bold hover:bg-foreground/30"
                      >
                        {tr("تعديل")}
                      </button>
                      <button
                        onClick={() => void cancelListing(l.id)}
                        className="h-7 rounded-full bg-destructive/20 px-3 text-xs font-bold text-destructive hover:bg-destructive/30"
                      >
                        {tr("حذف")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-foreground/10 pt-4">
              <div className="text-xs font-bold text-emerald-600">{tr("الرصيد المتاح")}</div>
              <div className="font-black">
                🍌 <span dir="ltr">{balance.toLocaleString("en-US")}</span>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="flex justify-center pt-4 text-3xl font-black text-amber-500">
          <TextFlip words={["اشترِ", "بِع", "استبدل", "بادل", "اعرض", "اربح"]} />
        </div>

        {!isPending && !snapshot?.signedIn && (
          <Link
            to="/auth"
            className="flex items-center justify-center rounded-2xl bg-foreground py-3 text-sm font-black text-background"
          >
            {tr("سجّل الدخول للمشاركة في السوق")}
          </Link>
        )}

        {!isPending && snapshot?.signedIn && !snapshot.profileComplete && (
          <Link
            to="/profile"
            onPointerDown={() => playSound("bumper_end", 0.5)}
            className="flex flex-col items-center rounded-2xl bg-amber-500 py-3 text-background"
          >
            <span className="text-sm font-black">{tr("أكمل ملفك الشخصي للمشاركة في السوق")}</span>
            <span className="mt-0.5 text-[11px] font-bold opacity-80">
              {tr("الاسم، المعرّف، البريد، تاريخ الميلاد والجنس")}
            </span>
          </Link>
        )}
      </main>

      {/* Sell / success modal */}
      <AnimatePresence>
        {modal !== "none" && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModal("none")}
              className="absolute inset-0"
            />
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 w-full max-w-md rounded-t-[40px] bg-background p-6 pb-10 text-foreground shadow-2xl sm:rounded-[40px]"
            >
              <button
                onClick={() => setModal("none")}
                className="absolute left-6 top-6 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20"
                aria-label={tr("إغلاق")}
              >
                <X className="h-4 w-4" />
              </button>

              {modal === "success" ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-600">
                    <Check className="h-8 w-8" />
                  </div>
                  <h3 className="mt-4 text-xl font-black">{tr("تم بنجاح")}</h3>
                  <p className="mt-1 text-sm text-foreground/60">{tr("تم تحديث عروضك ورصيدك.")}</p>
                </div>
              ) : modal === "buy" && buying ? (
                <div className="pt-2">
                  <h3 className="text-xl font-black">{tr("شراء موز")}</h3>
                  <p className="mt-1 text-xs text-foreground/60">
                    {tr("من")} <span dir="ltr">{buying.user}</span>
                  </p>

                  <div className="mt-5 space-y-2 rounded-2xl bg-foreground/5 px-4 py-3 text-sm font-bold">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/70">{tr("الكمية")}</span>
                      <span dir="ltr">{buying.quantity.toLocaleString("en-US")} 🍌</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/70">{tr("السعر لكل موزة")}</span>
                      <span dir="ltr">{dinars(buying.pricePer)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-foreground/70">{tr("مقارنة بسعر السوق")}</span>
                      <span
                        dir="ltr"
                        className={
                          buying.isLive
                            ? "text-foreground/60"
                            : buying.diff < 0
                              ? "text-emerald-600"
                              : "text-amber-500"
                        }
                      >
                        {buying.isLive
                          ? "سعر السوق"
                          : `${Math.abs(buying.diff)}% ${buying.diff < 0 ? "أقل" : "أعلى"}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-foreground/10 pt-2 text-base font-black">
                      <span>{tr("الإجمالي")}</span>
                      <span dir="ltr">${buying.total.toLocaleString("en-US")}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-blue-600/10 border border-blue-600/20 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="text-[11px] font-bold text-blue-800">
                        {tr("رصيد المحفظة")}
                      </span>
                    </div>
                    <span className="text-sm font-black text-blue-600" dir="ltr">
                      {dinars(user?.walletBalance)}
                    </span>
                  </div>

                  {user && user.walletBalance < (buying?.total || 0) && (
                    <p className="mt-3 text-[10px] font-bold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100">
                      {tr("رصيد المحفظة غير كافٍ لإتمام عملية الشراء.")}
                    </p>
                  )}

                  {error && <p className="mt-3 text-xs font-bold text-destructive">{error}</p>}

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={() => setModal("none")}
                      className="flex-1 rounded-2xl bg-foreground/10 py-3.5 text-sm font-black"
                    >
                      {tr("إلغاء")}
                    </button>
                    <button
                      onClick={() => void submitBuy()}
                      disabled={
                        !!(act.isPending || (user && user.walletBalance < (buying?.total || 0)))
                      }
                      className="flex-1 rounded-2xl bg-foreground py-3.5 text-sm font-black text-background disabled:opacity-60"
                    >
                      {act.isPending ? "جارٍ الشراء…" : "تأكيد الشراء"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-2">
                  <h3 className="text-xl font-black">
                    {editing ? "تعديل العرض" : "عرض موز للبيع"}
                  </h3>
                  <p className="mt-1 text-xs text-foreground/60">
                    {tr("رصيدك:")} <span dir="ltr">{balance.toLocaleString("en-US")}</span> 🍌
                  </p>

                  <label className="mt-5 block text-xs font-bold text-foreground/70">
                    {tr("الكمية")}
                  </label>
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="1000"
                    className="mt-1 w-full rounded-2xl border border-foreground/15 bg-foreground/5 px-4 py-3 text-sm font-bold outline-none focus:border-foreground/40"
                  />

                  <label className="mt-4 block text-xs font-bold text-foreground/70">
                    {tr("السعر لكل موزة (دولار)")}
                  </label>
                  <input
                    value={pricePer}
                    onChange={(e) => setPricePer(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.25"
                    className="mt-1 w-full rounded-2xl border border-foreground/15 bg-foreground/5 px-4 py-3 text-sm font-bold outline-none focus:border-foreground/40"
                  />

                  {/* نسبة السعر مقارنة بسعر السوق */}
                  <div className="mt-3 rounded-2xl bg-foreground/5 px-4 py-3">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-foreground/70">{tr("مقارنة بسعر السوق")}</span>
                      <span
                        className={
                          pricePct === 0
                            ? "text-foreground/60"
                            : pricePct < 0
                              ? "text-emerald-600"
                              : "text-amber-500"
                        }
                        dir="ltr"
                      >
                        {pricePct > 0 ? `+${pricePct}` : pricePct}% (
                        {pricePct === 0 ? "سعر السوق" : pricePct < 0 ? "أقل" : "أعلى"})
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={Math.max(-50, Math.min(50, pricePct))}
                      onChange={(e) => applyPricePct(Number(e.target.value))}
                      className="mt-2 w-full accent-amber-500"
                      dir="ltr"
                      aria-label={tr("نسبة السعر مقارنة بسعر السوق")}
                    />
                    <div
                      className="flex justify-between text-[10px] font-bold text-foreground/50"
                      dir="ltr"
                    >
                      <span>-50%</span>
                      <span>0%</span>
                      <span>+50%</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-foreground/5 px-4 py-3">
                    <span className="text-sm font-bold">{tr("الإجمالي المتوقع")}</span>
                    <span className="text-sm font-black" dir="ltr">
                      {dinars((Number(quantity) || 0) * (Number(pricePer) || 0))}
                    </span>
                  </div>

                  {!editing && (
                    <div className="mt-4 space-y-2">
                      <label className="flex items-center justify-between rounded-2xl bg-foreground/5 px-4 py-3 text-sm font-bold">
                        {tr("عرض خاص (بالرابط فقط)")}
                        <input
                          type="checkbox"
                          checked={isPrivate}
                          onChange={(e) => setIsPrivate(e.target.checked)}
                          className="h-4 w-4 accent-amber-500"
                        />
                      </label>
                      <div className="rounded-2xl bg-foreground/5 px-4 py-3">
                        <label className="flex items-center justify-between text-sm font-bold">
                          {tr("تمييز العرض في أعلى القائمة")}
                          <input
                            type="checkbox"
                            checked={isPromoted}
                            onChange={(e) => setIsPromoted(e.target.checked)}
                            className="h-4 w-4 accent-amber-500"
                          />
                        </label>

                        {isPromoted && (
                          <div className="mt-3 border-t border-foreground/10 pt-3">
                            <div className="flex items-center justify-between text-[11px] font-bold text-foreground/70">
                              <span>{tr("مدة الظهور")}</span>
                              <span dir="ltr">{promoRate} 🍌 / دقيقة</span>
                            </div>
                            <div className="mt-2 flex gap-1.5" dir="ltr">
                              {[1, 3, 6, 12, 24].map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => setPromoHours(h)}
                                  className={`flex-1 rounded-xl py-2 text-[11px] font-black transition-all ${
                                    promoHours === h
                                      ? "bg-foreground text-background"
                                      : "bg-foreground/10 text-foreground/70"
                                  }`}
                                >
                                  {h}h
                                </button>
                              ))}
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[11px] font-black">
                              <span className="text-foreground/70">
                                تكلفة التمييز ({promoHours * 60} دقيقة)
                              </span>
                              <span dir="ltr">{promoCost.toLocaleString("en-US")} 🍌</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {error && <p className="mt-3 text-xs font-bold text-destructive">{error}</p>}

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={() => setModal("none")}
                      className="flex-1 rounded-2xl bg-foreground/10 py-3.5 text-sm font-black"
                    >
                      {tr("إلغاء")}
                    </button>
                    <button
                      onClick={() => void submitSell()}
                      disabled={!!(act.isPending || (isPromoted && balance < promoCost))}
                      className="flex-1 rounded-2xl bg-foreground py-3.5 text-sm font-black text-background disabled:opacity-60"
                    >
                      {act.isPending ? "جارٍ التنفيذ…" : editing ? "حفظ التعديل" : "نشر العرض"}
                    </button>
                  </div>

                  {isPromoted && balance < promoCost && (
                    <p className="mt-3 text-[10px] font-bold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100">
                      {tr("رصيد الموز غير كافٍ لتكلفة التمييز.")}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
