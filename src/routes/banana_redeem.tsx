import { tr } from "@/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X, Copy, Tag, CheckCircle2 } from "lucide-react";

import { useBananaMarket, type BananaReward } from "@/hooks/useBananaMarket";
import { playSound } from "@/utils/audio";

export const Route = createFileRoute("/banana_redeem")({
  head: () => ({
    meta: [
      { title: "استبدال الموز — بنانتو" },
      {
        name: "description",
        content: "استبدل رصيد الموز بمكافآت: خلفيات، مزايا رقمية، كوبونات خصم وجوائز حقيقية.",
      },
      { property: "og:title", content: "استبدال الموز — بنانتو" },
      { property: "og:description", content: "متجر مكافآت بنانتو مقابل رصيد الموز." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BananaRedeemPage,
});

const CATEGORIES = [
  { id: "all", label: "الكل" },
  // Tickets first: they are the one reward that leads somewhere else.
  { id: "wheel_ticket", label: "🎟️ تذاكر عجلة الحظ" },
  { id: "vouchers", label: "🎟️ قسائم وخصومات" },
  { id: "digital", label: "🎮 بطاقات وشحن" },
  { id: "physical", label: "🕹️ هدايا واكسسوارات" },
  { id: "perks", label: "⭐ مزايا وعضويات" },
];

function BananaRedeemPage() {
  const navigate = useNavigate();
  const { snapshot, isPending, act } = useBananaMarket("1D");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<BananaReward | null>(null);
  const [state, setState] = useState<"none" | "confirm" | "success">("none");
  const [redeemResult, setRedeemResult] = useState<any | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [error, setError] = useState("");

  const balance = snapshot?.balance ?? 0;

  const rewards = useMemo(
    () => (snapshot?.rewards ?? []).filter((r) => category === "all" || r.category === category),
    [snapshot?.rewards, category],
  );

  const confirm = async () => {
    if (!selected) return;
    setError("");
    try {
      const res = await act.mutateAsync({ action: "redeem_reward", rewardId: selected.id });
      setRedeemResult(res || selected);
      setState("success");
      playSound("complete_task", 0.6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر الاستبدال");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
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
        <h1 className="text-lg font-bold tracking-tight">{tr("استبدال الموز")}</h1>
        <div className="flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1.5 text-sm font-bold">
          <span>🍌</span>
          <span dir="ltr">{(balance / 1000).toFixed(1)}k</span>
        </div>
      </header>

      <main className="px-4 pt-24 pb-24 space-y-4 max-w-3xl mx-auto">
        <div className="rounded-[24px] border border-foreground/10 bg-foreground/5 p-5">
          <div className="text-xs font-black uppercase tracking-wider text-amber-500">
            {tr("رصيدك")}
          </div>
          <div className="mt-1 text-3xl font-black">
            🍌 <span dir="ltr">{balance.toLocaleString("en-US")}</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-foreground/60">
            {tr("اجمع الموز من عمليات الشراء والسوق ثم استبدله بما يعجبك.")}
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onPointerDown={() => playSound("hover_s", 0.4)}
              onClick={() => setCategory(c.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-black transition-colors ${
                category === c.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-foreground/5 text-foreground/70 border-foreground/15"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {isPending ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-foreground/20 border-t-amber-500" />
          </div>
        ) : rewards.length === 0 ? (
          <p className="py-20 text-center text-sm text-foreground/60">
            {tr("لا توجد مكافآت في هذا التصنيف.")}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {rewards.map((r, i) => {
              const affordable = balance >= r.cost && r.stock !== 0;
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  className="flex flex-col justify-between rounded-[22px] border border-foreground/10 bg-foreground/5 p-4"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="text-3xl">{r.icon}</div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-foreground/10 text-foreground/70">
                        {r.category === "wheel_ticket"
                          ? `${r.ticketQuantity ?? 1} تذكرة`
                          : r.category === "vouchers"
                            ? "قسيمة خصم"
                            : r.category === "digital"
                              ? "بطاقة رقمية"
                              : r.category === "physical"
                                ? "منتج حقيقي"
                                : "ميزة"}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold leading-snug">{r.title}</h3>
                    {r.description && (
                      <p className="mt-1 text-xs text-foreground/60 line-clamp-2">
                        {r.description}
                      </p>
                    )}
                    {r.category === "wheel_ticket" && (
                      <p className="mt-2 w-fit rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                        تُستخدم في عجلة الحظ لربح لعبة عشوائية
                      </p>
                    )}
                    {r.couponValue && r.couponValue > 0 && (
                      <div className="mt-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                        <Tag className="w-3 h-3" />
                        <span>خصم {r.couponValue.toLocaleString("en-US")} د.ع</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-foreground/10 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-black text-amber-500">
                        🍌 <span dir="ltr">{r.cost.toLocaleString("en-US")}</span>
                      </span>
                      <div className="text-[10px] font-bold text-foreground/50">
                        المتوفر: {r.stock < 0 ? "∞" : r.stock}
                      </div>
                    </div>
                    <button
                      disabled={!affordable}
                      onPointerDown={() => affordable && playSound("bumper_end", 0.5)}
                      onClick={() => {
                        setSelected(r);
                        setError("");
                        setState("confirm");
                      }}
                      className="h-8 rounded-full bg-foreground px-4 text-xs font-black text-background disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      {tr("استبدال")}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      <AnimatePresence>
        {state !== "none" && selected && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (state !== "confirm") {
                  setState("none");
                  setSelected(null);
                  setRedeemResult(null);
                }
              }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 w-full max-w-md rounded-3xl bg-background p-6 shadow-2xl border border-border"
            >
              {state === "success" ? (
                <div className="flex flex-col items-center py-4 text-center space-y-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
                    <Check className="h-8 w-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black">{tr("تم الاستبدال بنجاح!")}</h3>
                    <p className="mt-1 text-sm text-foreground/60">{selected.title}</p>
                  </div>

                  {redeemResult?.deliveryCode && (
                    <div className="w-full p-4 rounded-2xl bg-foreground/5 border border-foreground/10 text-right space-y-2">
                      <div className="text-xs font-bold text-foreground/70">
                        كود القسيمة / البطاقة الخاص بك:
                      </div>
                      <div className="flex items-center justify-between p-2.5 bg-background rounded-xl border border-border">
                        <span
                          className="font-mono font-black text-sm tracking-wider text-amber-500"
                          dir="ltr"
                        >
                          {redeemResult.deliveryCode}
                        </span>
                        <button
                          onClick={() => copyToClipboard(redeemResult.deliveryCode)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-foreground/10 hover:bg-foreground/20 text-xs font-bold transition-colors"
                        >
                          {copiedCode ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span>تم النسخ</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>نسخ الكود</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[11px] text-foreground/50">
                        يمكنك استخدام هذا الكود عند الدفع للحصول على الخصم فوراً.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setState("none");
                      setSelected(null);
                      setRedeemResult(null);
                    }}
                    className="w-full rounded-2xl bg-foreground py-3.5 text-sm font-black text-background mt-2"
                  >
                    تم
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-center text-4xl">{selected.icon}</div>
                  <h3 className="mt-3 text-center text-xl font-black">{selected.title}</h3>
                  {selected.description && (
                    <p className="text-center text-xs text-foreground/60 mt-1">
                      {selected.description}
                    </p>
                  )}
                  <div className="mt-4 space-y-2 rounded-2xl bg-foreground/5 p-4 text-sm font-bold">
                    <div className="flex justify-between">
                      <span className="text-foreground/60">{tr("التكلفة")}</span>
                      <span dir="ltr">{selected.cost.toLocaleString("en-US")} 🍌</span>
                    </div>
                    <div className="flex justify-between border-t border-foreground/10 pt-2">
                      <span className="text-foreground/60">{tr("رصيدك بعد الاستبدال")}</span>
                      <span dir="ltr">{(balance - selected.cost).toLocaleString("en-US")} 🍌</span>
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
