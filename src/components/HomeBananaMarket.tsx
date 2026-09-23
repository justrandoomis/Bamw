import { Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Gift, Loader2, Ticket, TrendingDown, TrendingUp } from "lucide-react";

import { BananaIcon } from "@/components/Icons";
import { useBananaMarket } from "@/hooks/useBananaMarket";
import { formatPrice } from "@/lib/banana-price";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { useI18n } from "../i18n";

const BananaPriceChart = lazyWithRetry(() => import("@/components/BananaPriceChart"));

/**
 * The market, as the home page shows it.
 *
 * ## WHAT THIS USED TO BE, AND WHY IT HAD TO GO
 *
 * «احذف مفهوم Marketplace بين المستخدمين بالكامل» was carried out on
 * `/banana_market` and nowhere else. This component was never migrated, so the
 * home page kept drawing the deleted shop: «أحدث العروض (Top 10)», a row of
 * cards for «بوت 1 … بوت 4» each labelled «متداول نشط» with a quantity and a
 * per-banana price. A member landing on banan.to was being shown a
 * member-to-member market that the market page itself refuses to let anyone
 * trade in — `create_listing` answers «سوق العروض بين الأعضاء أُغلق».
 *
 * The server still returns `listings`, and that is correct: only creation was
 * closed, nothing was deleted, and an offer still standing can still be
 * cancelled by its owner. «لا تحذف بيانات الإنتاج بشكل أعمى.» The fault was
 * that one client surface still read a field the product no longer offers.
 *
 * ## WHAT IT IS NOW
 *
 * The same thing `/banana_market` leads with, in miniature: the price, what it
 * did, that it is live, and the shape it made getting there. One loud number
 * and a way in — a home strip is a shop window, not a second market.
 *
 * Under it, the three things the market actually does, as one row of equal
 * segments rather than three buttons arguing about which is the important one.
 * All three go to the same page, because that page is where all three happen.
 */
export function HomeBananaMarket() {
  const { snapshot, isPending } = useBananaMarket("1D");
  const { t } = useI18n();

  const price = snapshot?.price ?? 0;
  const changePct = snapshot?.changePct ?? 0;
  const down = changePct < 0;
  const rewards = Array.isArray(snapshot?.rewards) ? snapshot.rewards.slice(0, 5) : [];

  if (isPending && !snapshot) {
    return (
      <div className="flex justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full space-y-8 overflow-hidden">
      <section className="mt-8 w-full max-w-full px-4 sm:px-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <BananaIcon className="h-5 w-5 text-banana drop-shadow-sm" solid />
            <h3 className="text-lg font-black tracking-tight text-foreground">{t("سوق الموز")}</h3>
          </div>
          <Link
            to="/banana_market"
            data-ui-sound="klick"
            className="flex shrink-0 items-center gap-1 rounded-full border border-banana/30 bg-banana/15 px-3 py-1.5 text-[11px] font-black text-foreground transition-colors hover:bg-banana/25"
          >
            {t("دخول السوق")}
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        {/* The one number worth being loud about, exactly as the market page shows it. */}
        <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[12px] font-bold text-muted-foreground">
                {t("سعر موزة واحدة")}
              </h4>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  dir="ltr"
                  className="text-[28px] font-black leading-none tracking-[-0.04em] tabular-nums text-foreground"
                >
                  {formatPrice(price)}
                </span>
                <span className="text-[12px] font-bold text-muted-foreground">{t("د.ع")}</span>
                <span
                  dir="ltr"
                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-black tabular-nums ${
                    down ? "bg-rind/15 text-rind" : "bg-leaf/15 text-leaf"
                  }`}
                >
                  {down ? (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  )}
                  {changePct > 0 ? "+" : ""}
                  {changePct}%
                </span>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-leaf/10 px-2.5 py-1 text-[11px] font-black text-leaf">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-leaf" />
              </span>
              {t("السوق مباشر")}
            </span>
          </div>

          {/*
            The same lazy chart the market page uses, so recharts is fetched
            once for both and the home page's initial payload does not carry it.
          */}
          <div className="-mx-1 mt-3 h-[96px]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                </div>
              }
            >
              <BananaPriceChart data={snapshot?.chart ?? []} tooltip={<span />} />
            </Suspense>
          </div>

          {/* The three things the market does. All one page, so all one link. */}
          <div className="mt-3 flex gap-0.5 rounded-2xl bg-muted/70 p-1">
            {[
              { label: t("بيع الموز"), icon: BananaIcon },
              { label: t("تذاكر"), icon: Ticket },
              { label: t("جوائز"), icon: Gift },
            ].map((entry) => (
              <Link
                key={entry.label}
                to="/banana_market"
                data-ui-sound="klick"
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-black text-foreground transition-colors hover:bg-card"
              >
                <entry.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {entry.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── Rewards ──────────────────────────────
          Kept, because it is the one part of the old section that was never
          about the deleted marketplace — it reads `snapshot.rewards`, which is
          the same array `/banana_market` feeds its own shelf. The «عرض الكل»
          link moves off `/banana_redeem`, which is now only a redirect. */}
      <section className="w-full max-w-full overflow-hidden pb-8">
        <div className="mb-4 flex items-center justify-between gap-2 px-4 sm:px-8">
          <div className="flex items-center gap-1.5">
            <Gift className="h-5 w-5 text-leaf drop-shadow-sm" aria-hidden="true" />
            <h3 className="text-lg font-black tracking-tight text-foreground">
              {t("جوائز الاستبدال")}
            </h3>
          </div>
          <Link
            to="/banana_market"
            data-ui-sound="klick"
            className="flex shrink-0 items-center gap-1 rounded-full border border-leaf/30 bg-leaf/10 px-3 py-1.5 text-[11px] font-black text-foreground transition-colors hover:bg-leaf/20"
          >
            {t("عرض الكل")}
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <div className="flex w-full max-w-full snap-x gap-3 overflow-x-auto px-4 pb-4 no-scrollbar sm:px-8">
          {rewards.map((reward, i) => (
            <Link
              to="/banana_market"
              key={reward.id || i}
              data-ui-sound="klick"
              className="group flex min-w-[140px] shrink-0 snap-start flex-col items-center rounded-2xl border border-border bg-card p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-leaf/30 hover:shadow-md"
            >
              <div className="mb-3 text-3xl transition-transform duration-300 group-hover:scale-110">
                {reward.icon}
              </div>
              <h5 className="mb-1 text-xs font-bold leading-tight text-foreground">
                {reward.title}
              </h5>
              <div className="mt-auto flex w-full items-center justify-center gap-1 rounded-lg border border-banana/20 bg-banana/10 px-2.5 py-1.5 pt-2 text-foreground">
                <span className="text-sm font-black tabular-nums">{reward.cost}</span>
                <BananaIcon className="h-3.5 w-3.5 drop-shadow-sm" solid />
              </div>
            </Link>
          ))}
          {rewards.length === 0 ? (
            <div className="w-full rounded-2xl border-2 border-dashed border-border bg-muted/30 py-6 text-center">
              <p className="text-xs font-medium text-muted-foreground">
                {t("لا توجد جوائز حالياً")}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
