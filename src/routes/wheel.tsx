import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Gift, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { tr } from "@/i18n";
import { playSound } from "@/utils/audio";

export const Route = createFileRoute("/wheel")({
  head: () => ({
    meta: [
      { title: "عجلة الحظ — بنانتو" },
      {
        name: "description",
        content: "استبدل الموز بتذكرة ودوّر عجلة الحظ لتربح لعبة عشوائية من متجر بنانتو.",
      },
      { property: "og:title", content: "عجلة الحظ — بنانتو" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: WheelPage,
});

interface WheelState {
  tickets: number;
  poolSize: number;
  candidates: { id: string; title: string; image: string | null }[];
  spins: {
    id: string;
    product_title: string;
    coupon_code: string | null;
    expires_at: string | null;
    created_at: string;
  }[];
  prizeValidDays: number;
  odds: { label: string; weight: number; games: number; chance: number }[];
}

interface SpinResult {
  ok?: boolean;
  prize?: { productId: string; title: string; price: number; image: string | null };
  couponCode?: string;
  expiresAt?: string;
  tickets?: number;
}

const shortDate = (iso: string | null) => {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

/**
 * عجلة الحظ.
 *
 * The wheel is an animation, not a decision. The server has already chosen
 * the prize by the time anything here moves — so the spin runs for a fixed,
 * satisfying moment and then reveals what was always going to be revealed.
 * Pretending otherwise would mean the browser choosing, and the browser is
 * not a place to decide who gets a game worth money.
 */
function WheelPage() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wheel-summary"],
    queryFn: () => api.fetch<WheelState>("/api/wheel"),
    retry: false,
  });

  const spin = useMutation({
    mutationFn: () => api.fetch<SpinResult>("/api/wheel", { method: "POST", body: "{}" }),
    onMutate: () => {
      setResult(null);
      setSpinning(true);
      playSound("hover", 0.5);
    },
    onSuccess: async (outcome) => {
      /*
        Let the wheel turn before the answer lands. The result is already in
        hand; holding it for a moment is the difference between a game and a
        form submission.
      */
      await new Promise((wake) => setTimeout(wake, reduceMotion ? 300 : 2600));
      setSpinning(false);
      setResult(outcome);
      playSound("bumper_end", 0.7);
      void queryClient.invalidateQueries({ queryKey: ["wheel-summary"] });
    },
    onError: (failure: unknown) => {
      setSpinning(false);
      toast.error(failure instanceof Error ? failure.message : tr("تعذر تدوير العجلة"));
      void queryClient.invalidateQueries({ queryKey: ["wheel-summary"] });
    },
  });

  const tickets = data?.tickets ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6" dir="rtl">
      <header className="mb-5 space-y-1.5 text-center">
        <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground">
          {tr("عجلة الحظ")}
        </h1>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {tr("تذكرة واحدة = دورة واحدة. الجائزة لعبة من المتجر.")}
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm font-bold text-foreground">{tr("سجّل الدخول للعب")}</p>
          <Link
            to="/auth"
            className="mt-3 inline-block rounded-xl bg-foreground px-5 py-2.5 text-xs font-bold text-background"
          >
            {tr("تسجيل الدخول")}
          </Link>
        </div>
      ) : isLoading ? (
        <div className="flex h-60 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="relative mx-auto mb-5 flex h-64 w-64 items-center justify-center">
            {/* The rim. Purely decorative — the segments are not the outcome. */}
            <motion.div
              className="absolute inset-0 rounded-full border-[10px] border-amber-500/30 bg-gradient-to-br from-amber-400/20 via-card to-card shadow-inner"
              animate={spinning && !reduceMotion ? { rotate: 360 * 6 } : { rotate: 0 }}
              transition={
                spinning && !reduceMotion
                  ? { duration: 2.6, ease: [0.16, 0.9, 0.2, 1] }
                  : { duration: 0.3 }
              }
            >
              {Array.from({ length: 12 }, (_, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-amber-500/25"
                  style={{ transform: `rotate(${index * 30}deg)` }}
                />
              ))}
            </motion.div>

            <div className="relative z-10 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-border bg-card shadow-lg">
              {spinning ? (
                <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
              ) : (
                <>
                  <Ticket className="h-6 w-6 text-amber-500" />
                  <span className="mt-1 text-xl font-black text-foreground">{tickets}</span>
                  <span className="text-[10px] font-bold text-muted-foreground">{tr("تذكرة")}</span>
                </>
              )}
            </div>
          </div>

          {tickets > 0 ? (
            <button
              type="button"
              onClick={() => spin.mutate()}
              disabled={spinning || spin.isPending}
              className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-3.5 text-sm font-black text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              <Gift className="h-4 w-4" />
              {spinning ? tr("تدور...") : tr("دوّر العجلة")}
            </button>
          ) : (
            <div className="mx-auto max-w-sm space-y-2.5 text-center">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                {tr("لا توجد لديك تذاكر. التذاكر تُشترى بالموز من شاشة الاسترداد.")}
              </p>
              <Link
                to="/banana_redeem"
                className="inline-block rounded-2xl bg-foreground px-6 py-3 text-[13px] font-bold text-background"
              >
                {tr("استبدل الموز بتذكرة")}
              </Link>
            </div>
          )}

          <AnimatePresence>
            {result?.ok && result.prize ? (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", bounce: 0.2, visualDuration: 0.4 }}
                className="mt-6 space-y-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center"
              >
                <p className="text-sm font-black text-emerald-800 dark:text-emerald-300">
                  {tr("مبروك! ربحت")}
                </p>
                <p className="text-base font-bold text-foreground">{result.prize.title}</p>
                {result.couponCode ? (
                  <>
                    <p className="text-[12px] text-muted-foreground">
                      {tr("استخدم هذا الكود عند الشراء ليصبح سعر اللعبة صفراً:")}
                    </p>
                    <p className="select-all rounded-xl bg-background px-4 py-2.5 font-mono text-lg font-black tracking-widest text-foreground">
                      {result.couponCode}
                    </p>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {tr("صالح حتى")} {shortDate(result.expiresAt ?? null)}
                    </p>
                  </>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {data?.odds?.length ? (
            <section className="mt-8 space-y-2">
              <h2 className="text-[13px] font-bold text-foreground">{tr("الفرص")}</h2>
              {/*
                Stated, not hidden. A wheel that will not say what the chances
                are is one nobody should trust, and these are counted from the
                catalogue as it stands rather than promised.
              */}
              <ul className="space-y-1.5">
                {data.odds
                  .filter((tier) => tier.games > 0)
                  .map((tier) => (
                    <li
                      key={tier.label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-[12px]"
                    >
                      <span className="font-bold text-foreground" dir="ltr">
                        {tier.label} {tr("دينار")}
                      </span>
                      <span className="text-muted-foreground">
                        {tier.games} {tr("لعبة")} ·{" "}
                        {tier.chance >= 0.001
                          ? `${(tier.chance * 100).toFixed(1)}%`
                          : tr("نادرة جداً")}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          {data?.spins?.length ? (
            <section className="mt-8 space-y-2">
              <h2 className="text-[13px] font-bold text-foreground">{tr("جوائزك السابقة")}</h2>
              <ul className="space-y-1.5">
                {data.spins.map((won) => (
                  <li
                    key={won.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-[12px]"
                  >
                    <span className="min-w-0 truncate font-bold text-foreground">
                      {won.product_title}
                    </span>
                    {won.coupon_code ? (
                      <span className="select-all shrink-0 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        {won.coupon_code}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
