import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Gift, Ticket } from "lucide-react";

import { api } from "@/lib/api";
import { tr } from "@/i18n";

/**
 * «قسم الألعاب» — win a game, and the tickets that let you try.
 *
 * The owner placed it themselves: below the banana market, above the news.
 * It is a doorway, not the wheel — the spin itself lives at `/wheel`, where
 * there is room for it and where a member who came to play is not two
 * scrolls above the shop's news.
 *
 * The numbers it shows are the server's. How many tickets the member holds,
 * how many games are in the pool, and what the chances are all come from
 * `/api/wheel`, because a section that guessed at the odds would be the shop
 * making a promise it had not checked.
 */
export function HomeGameZone() {
  const { data } = useQuery({
    queryKey: ["wheel-summary"],
    queryFn: () =>
      api.fetch<{
        tickets: number;
        poolSize: number;
        odds: { label: string; games: number; chance: number }[];
      }>("/api/wheel"),
    /*
      A guest has no tickets and `/api/wheel` answers 401. That is not an
      error worth retrying or logging — the section still renders, it just
      invites them in rather than showing a balance.
    */
    retry: false,
    staleTime: 60_000,
  });

  const tickets = data?.tickets ?? 0;
  const poolSize = data?.poolSize ?? 0;

  return (
    <section className="mt-8 w-full max-w-full px-4 sm:px-8">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-xl font-bold text-foreground">{tr("الألعاب والجوائز")}</h3>
      </div>

      {/*
        `relative overflow-hidden` on the card itself: the home page's main
        column is `overflow-hidden`, so a glow that reached past this box
        would be clipped rather than scrolled.
      */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-card to-card p-5 shadow-xs">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -end-10 h-40 w-40 rounded-full bg-amber-400/20 blur-3xl"
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
                <Gift className="h-5 w-5" />
              </span>
              <h4 className="text-base font-black tracking-[-0.01em] text-foreground">
                {tr("اربح لعبة من المتجر")}
              </h4>
            </div>
            <p className="max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
              {tr("استبدل الموز بتذكرة، ودوّر العجلة لتربح لعبة عشوائية من المتجر.")}
            </p>
            {poolSize > 0 ? (
              <p className="text-[11.5px] font-bold text-muted-foreground">
                {poolSize.toLocaleString()} {tr("لعبة في العجلة الآن")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-background px-3 py-2">
              <Ticket className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-black text-foreground">{tickets}</span>
              <span className="text-[11px] font-bold text-muted-foreground">{tr("تذكرة")}</span>
            </div>
            <Link
              to="/wheel"
              className="rounded-2xl bg-amber-500 px-5 py-2.5 text-[13px] font-bold text-amber-950 transition-transform active:scale-[0.98]"
            >
              {tickets > 0 ? tr("دوّر العجلة") : tr("احصل على تذكرة")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HomeGameZone;
