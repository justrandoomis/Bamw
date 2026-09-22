import React from "react";
import { Link } from "@tanstack/react-router";
import { useBananaMarket } from "@/hooks/useBananaMarket";
import { BananaIcon } from "@/components/Icons";
import { Trophy, Gift, ArrowLeft } from "lucide-react";
import { useI18n } from "../i18n";

export function HomeBananaMarket() {
  const { snapshot, isPending } = useBananaMarket("1D");
  const { t } = useI18n();

  const listings = snapshot?.listings || [];
  const topListings = listings.slice(0, 10);

  const rewards = snapshot?.rewards || [];
  const latestRewards = rewards.slice(0, 5);

  if (isPending && !snapshot) {
    return <div className="animate-pulse p-4 text-center">{t("جاري تحميل العروض...")}</div>;
  }

  return (
    <div className="space-y-8 w-full max-w-full overflow-hidden">
      {/* Top 10 Listings */}
      <section className="mt-8 bg-gradient-to-b from-yellow-500/10 via-yellow-500/5 to-transparent pt-6 pb-2 relative overflow-hidden w-full max-w-full">
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center justify-between gap-2 mb-6 px-4 sm:px-8 relative z-10">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <BananaIcon className="w-5 h-5 text-yellow-500 drop-shadow-sm" solid />
              <h3 className="text-lg font-black text-foreground tracking-tight">
                {t("سوق الموز")}
              </h3>
            </div>
            <p className="text-muted-foreground text-xs max-w-[200px] leading-tight">
              {t("اكتشف أحدث العروض وأبرز المتداولين في السوق.")}
            </p>
          </div>
          <Link
            to="/banana_market"
            className="flex items-center gap-1 text-[10px] font-bold text-yellow-600 bg-yellow-500/10 hover:bg-yellow-500/20 px-3 py-1.5 rounded-full transition-colors shrink-0"
          >
            {t("دخول السوق")}
            <ArrowLeft className="w-3 h-3" />
          </Link>
        </div>

        <div className="relative z-10">
          <div className="flex items-center justify-between px-4 sm:px-8 mb-3">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-yellow-500" />
              {t("أحدث العروض (Top 10)")}
            </h4>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-4 snap-x px-4 sm:px-8 w-full max-w-full">
            {topListings.map((listing, i) => (
              <div
                key={listing.id || i}
                className="min-w-[160px] bg-card p-3 rounded-2xl border border-border shrink-0 snap-start shadow-sm cursor-pointer hover:shadow-md hover:border-yellow-500/30 transition-all group relative overflow-hidden flex flex-col"
              >
                {/* Number Badge */}
                <div className="absolute top-0 right-0 w-6 h-6 bg-yellow-500/10 flex items-center justify-center rounded-bl-xl font-black text-yellow-500/50 text-[10px]">
                  #{i + 1}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="relative">
                    {/*
                      A bot's avatar is «🤖» and a member's can be empty, and
                      both were fed straight into `src` — so every bot offer on
                      the home strip rendered a broken image. Both full-screen
                      market pages already branch on this; this one did not.
                    */}
                    {listing.avatar?.startsWith("http") ? (
                      <img
                        src={listing.avatar}
                        alt={listing.user}
                        className="w-8 h-8 rounded-full object-cover bg-muted ring-1 ring-background shadow-sm"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-base ring-1 ring-background shadow-sm">
                        {listing.avatar || "🍌"}
                      </span>
                    )}
                    {listing.verified && (
                      <div className="absolute -bottom-0.5 -right-0.5 bg-blue-500 text-white rounded-full p-[1px] border border-card shadow-sm">
                        <svg
                          className="w-2 h-2"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <h5 className="font-bold text-xs truncate text-foreground group-hover:text-yellow-600 transition-colors">
                      {listing.user}
                    </h5>
                    <p className="text-[9px] text-muted-foreground truncate">{t("متداول نشط")}</p>
                  </div>
                </div>

                <div className="flex justify-between items-end mt-auto pt-3 border-t border-border/50">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                      {t("الكمية")}
                    </span>
                    <span className="font-black text-sm text-foreground leading-none">
                      {listing.quantity}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                      {t("السعر")}
                    </span>
                    <div className="flex items-center gap-1 bg-yellow-500/10 text-yellow-600 px-2 py-0.5 rounded-md">
                      <span className="font-bold text-xs">{listing.pricePer}</span>
                      <BananaIcon className="w-3 h-3 drop-shadow-sm" solid />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {topListings.length === 0 && (
              <div className="w-full text-center py-6 border-2 border-dashed border-border rounded-2xl bg-muted/30">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("لا توجد عروض حالياً")}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Rewards / Redeem Section */}
      <section className="pb-8 w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-6 px-4 sm:px-8">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Gift className="w-5 h-5 text-green-500 drop-shadow-sm" />
              <h3 className="text-lg font-black text-foreground tracking-tight">
                {t("جوائز الاستبدال")}
              </h3>
            </div>
            <p className="text-muted-foreground text-xs max-w-[200px] leading-tight">
              {t("استبدل الموز بجوائز قيمة.")}
            </p>
          </div>
          <Link
            to="/banana_redeem"
            className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-500/10 hover:bg-green-500/20 px-3 py-1.5 rounded-full transition-colors shrink-0"
          >
            {t("عرض الكل")}
            <ArrowLeft className="w-3 h-3" />
          </Link>
        </div>

        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-4 snap-x px-4 sm:px-8 w-full max-w-full">
          {latestRewards.map((reward, i) => (
            <Link
              to="/banana_redeem"
              key={reward.id || i}
              className="min-w-[140px] bg-card p-4 rounded-2xl border border-border shrink-0 snap-start shadow-sm hover:shadow-md hover:border-green-500/30 hover:-translate-y-0.5 transition-all group relative overflow-hidden flex flex-col items-center text-center"
            >
              {/* Decorative background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-green-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-green-500/10 transition-colors"></div>

              <div className="text-3xl mb-3 transform group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300 drop-shadow-sm">
                {reward.icon}
              </div>
              <h5 className="font-bold text-xs mb-1 text-foreground group-hover:text-green-600 transition-colors leading-tight">
                {reward.title}
              </h5>

              <div className="mt-auto pt-2 w-full flex items-center justify-center gap-1 bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 text-yellow-600 px-2.5 py-1.5 rounded-lg border border-yellow-500/20 group-hover:shadow-inner transition-all">
                <span className="font-black text-sm">{reward.cost}</span>
                <BananaIcon className="w-3.5 h-3.5 drop-shadow-sm" solid />
              </div>
            </Link>
          ))}
          {latestRewards.length === 0 && (
            <div className="w-full text-center py-6 border-2 border-dashed border-border rounded-2xl bg-muted/30">
              <p className="text-muted-foreground text-xs font-medium">
                {t("لا توجد جوائز حالياً")}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
