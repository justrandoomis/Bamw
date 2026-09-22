import { tr } from "@/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Search, TrendingDown, TrendingUp, X } from "lucide-react";

import { dinars } from "@/lib/banana-price";
import { useBananaMarket, type BananaListing } from "@/hooks/useBananaMarket";
import { playSound } from "@/utils/audio";

export const Route = createFileRoute("/banana_buy")({
  head: () => ({
    meta: [
      { title: "شراء الموز — بنانتو" },
      {
        name: "description",
        content:
          "كل عروض الموز المتاحة في بنانتو مع البحث والفلترة حسب السعر والكمية والحساب الموثّق.",
      },
      { property: "og:title", content: "شراء الموز — بنانتو" },
      { property: "og:description", content: "اختر العرض الأنسب واشترِ الموز فوراً." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BananaBuyPage,
});

const FILTERS = [
  { id: "all", label: "الكل" },
  { id: "cheapest", label: "الأرخص" },
  { id: "largest", label: "الأكبر كمية" },
  { id: "verified", label: "موثّق" },
  { id: "live", label: "سعر السوق" },
];

function BananaBuyPage() {
  const navigate = useNavigate();
  const { snapshot, isPending, act } = useBananaMarket("1D");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BananaListing | null>(null);
  const [state, setState] = useState<"none" | "confirm" | "success">("none");
  const [error, setError] = useState("");

  const balance = snapshot?.balance ?? 0;

  const listings = useMemo(() => {
    let out = [...(snapshot?.listings ?? [])];
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((l) => l.user.toLowerCase().includes(q));
    if (filter === "cheapest") out.sort((a, b) => a.pricePer - b.pricePer);
    if (filter === "largest") out.sort((a, b) => b.quantity - a.quantity);
    if (filter === "verified") out = out.filter((l) => l.verified);
    if (filter === "live") out = out.filter((l) => l.isLive);
    return out;
  }, [snapshot?.listings, filter, search]);

  const confirm = async () => {
    if (!selected) return;
    setError("");
    try {
      await act.mutateAsync({ action: "buy_listing", id: selected.id });
      setState("success");
      setTimeout(() => {
        setState("none");
        setSelected(null);
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر إكمال الشراء");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden" dir="rtl">
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-4 bg-background/80 backdrop-blur-md">
        <button
          onClick={() => void navigate({ to: "/banana_market" })}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20"
          aria-label={tr("رجوع")}
        >
          <X className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold tracking-tight">{tr("شراء الموز")}</h1>
        <div className="flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1.5 text-sm font-bold">
          <span>🍌</span>
          <span dir="ltr">{(balance / 1000).toFixed(1)}k</span>
        </div>
      </header>

      <main className="px-4 pt-24 pb-24 space-y-4">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("ابحث عن حساب…")}
            className="w-full rounded-2xl border border-foreground/15 bg-foreground/5 py-3 pr-11 pl-4 text-sm font-bold outline-none focus:border-foreground/40"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onPointerDown={() => playSound("hover_s", 0.4)}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-black transition-colors ${
                filter === f.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-foreground/5 text-foreground/70 border-foreground/15"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isPending ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-foreground/20 border-t-amber-500" />
          </div>
        ) : listings.length === 0 ? (
          <p className="py-20 text-center text-sm text-foreground/60">
            {tr("لا توجد عروض مطابقة.")}
          </p>
        ) : (
          <div className="space-y-2.5">
            {listings.map((l, i) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="flex items-center justify-between rounded-[22px] border border-foreground/10 bg-foreground/5 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-foreground/10 text-xl">
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
                      <span dir="ltr">{l.quantity.toLocaleString("en-US")}</span> موزة
                      {l.isPromoted && <span className="mr-1 text-amber-500">{tr("• مميّز")}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex flex-col text-left" dir="ltr">
                    <span className="text-sm font-black">{dinars(l.total)}</span>
                    <span className="text-[10px] font-bold text-foreground/60">
                      {dinars(l.pricePer)} / موزة
                    </span>
                    <span className="text-[10px] font-bold">
                      {l.isLive ? (
                        <span className="text-foreground/40">{tr("سعر السوق")}</span>
                      ) : (
                        <span className={l.diff < 0 ? "text-emerald-600" : "text-amber-500"}>
                          {l.diff < 0 ? (
                            <TrendingDown className="inline h-2.5 w-2.5" />
                          ) : (
                            <TrendingUp className="inline h-2.5 w-2.5" />
                          )}{" "}
                          {Math.abs(l.diff)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    onPointerDown={() => playSound("bumper_end", 0.5)}
                    onClick={() => {
                      setSelected(l);
                      setError("");
                      setState("confirm");
                    }}
                    className="h-9 rounded-full bg-foreground px-4 text-xs font-black text-background active:scale-95"
                  >
                    {tr("شراء")}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <AnimatePresence>
        {state !== "none" && selected && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setState("none")}
              className="absolute inset-0"
            />
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 w-full max-w-md rounded-t-[40px] bg-background p-6 pb-10 shadow-2xl sm:rounded-[40px]"
            >
              {state === "success" ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-600">
                    <Check className="h-8 w-8" />
                  </div>
                  <h3 className="mt-4 text-xl font-black">{tr("تم الشراء")}</h3>
                  <p className="mt-1 text-sm text-foreground/60">
                    {tr("أُضيفت")}{" "}
                    <span dir="ltr">{selected.quantity.toLocaleString("en-US")}</span>{" "}
                    {tr("موزة إلى رصيدك.")}
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-black">{tr("تأكيد الشراء")}</h3>
                  <div className="mt-4 space-y-2 rounded-2xl bg-foreground/5 p-4 text-sm font-bold">
                    <div className="flex justify-between">
                      <span className="text-foreground/60">{tr("البائع")}</span>
                      <span dir="ltr">{selected.user}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground/60">{tr("الكمية")}</span>
                      <span dir="ltr">{selected.quantity.toLocaleString("en-US")} 🍌</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-foreground/60">{tr("السعر لكل موزة")}</span>
                      <span dir="ltr">{dinars(selected.pricePer)}</span>
                    </div>
                    <div className="flex justify-between border-t border-foreground/10 pt-2 text-base font-black">
                      <span>{tr("الإجمالي")}</span>
                      <span dir="ltr">{dinars(selected.total)}</span>
                    </div>
                  </div>

                  {error && <p className="mt-3 text-xs font-bold text-destructive">{error}</p>}

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={() => setState("none")}
                      className="flex-1 rounded-2xl bg-foreground/10 py-3.5 text-sm font-black"
                    >
                      {tr("إلغاء")}
                    </button>
                    <button
                      onClick={() => void confirm()}
                      disabled={act.isPending}
                      className="flex-1 rounded-2xl bg-foreground py-3.5 text-sm font-black text-background disabled:opacity-60"
                    >
                      {act.isPending ? "جارٍ التنفيذ…" : "تأكيد"}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
