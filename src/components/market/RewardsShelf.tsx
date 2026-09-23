import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Gift, Loader2 } from "lucide-react";

import { tr } from "@/i18n";

/**
 * The redemption shelf: what the bananas are actually for.
 *
 * «قسم الاستبدال… كل عنصر: صورة/أيقونة، الاسم، الوصف المختصر، السعر بالموز،
 *  المخزون، الحالة، زر استبدال.»
 *
 * Seven things per card, and the two easiest to drop are the two that decide
 * whether the card is honest: the stock and the state. A shelf that hides what
 * it cannot sell looks tidier and lies — a member who saw a reward yesterday
 * and cannot find it today assumes the shop removed it, or that they are
 * looking in the wrong place. So a sold-out or suspended reward stays on the
 * shelf, visibly not redeemable, with the reason written on it.
 *
 * Nothing here is redeemed on a tap. «زر استبدال» opens a confirmation that
 * states the cost and what the balance becomes, because bananas are earned
 * slowly and spent in one press, and the wheel screen already proved that a
 * spend button one thumb-width from another button needs a question in
 * between.
 *
 * The order is the caller's. The page decides what to show and in what order
 * (that is where the category filter and the sort live); this renders the list
 * it is handed, so two shelves fed the same array cannot disagree.
 */

export interface Reward {
  id: string;
  title: string;
  description?: string;
  cost: number;
  stock: number;
  icon?: string;
  category?: string;
  ticketQuantity?: number;
  active?: boolean;
}

export interface RewardsShelfProps {
  rewards: readonly Reward[];
  bananas: number;
  onRedeem: (rewardId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Negative stock is «unlimited», the way the redemption screen already reads it. */
function unlimited(stock: number): boolean {
  return stock < 0;
}

function categoryLabel(reward: Reward): string {
  if (reward.category === "wheel_ticket") return tr("تذكرة عجلة");
  if (reward.category === "vouchers") return tr("قسيمة خصم");
  if (reward.category === "digital") return tr("بطاقة رقمية");
  if (reward.category === "physical") return tr("منتج حقيقي");
  return tr("مكافأة");
}

/**
 * Why this reward cannot be redeemed right now — empty when it can.
 *
 * Ordered by what the member can do about it: an inactive or sold-out reward is
 * the shop's doing and no amount of saving fixes it, so it is said first; a
 * short balance is the member's and names the exact shortfall, because
 * «رصيدك لا يكفي» without a number is a shrug.
 */
function blockedReason(reward: Reward, bananas: number): string {
  if (reward.active === false) return tr("موقوفة مؤقتاً من الإدارة.");
  if (!unlimited(reward.stock) && reward.stock <= 0) return tr("نفد المخزون.");
  if (bananas < reward.cost) {
    const short = reward.cost - bananas;
    return `${tr("ينقصك")} ${short.toLocaleString("en-US")} ${tr("موزة")}.`;
  }
  return "";
}

export function RewardsShelf({ rewards, bananas, onRedeem }: RewardsShelfProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Checked and set in one statement, so a double tap cannot spend twice.
  const inFlightRef = useRef(false);

  const [confirming, setConfirming] = useState<Reward | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const close = useCallback(() => {
    if (inFlightRef.current) return;
    setConfirming(null);
    setError("");
    setDone(false);
  }, []);

  /*
    Escape closes the question — but not while the redemption is in flight,
    for the same reason the sell sheet refuses: hiding the outcome of a spend
    that is already happening is worse than a dialog that stays a moment.
  */
  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, close]);

  /* Focus lands on the answer, and returns to the card it came from. */
  useEffect(() => {
    if (!confirming) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const target = dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]");
    (target ?? dialogRef.current)?.focus();
    return () => restoreTo?.focus?.();
  }, [confirming]);

  const redeem = useCallback(async () => {
    if (inFlightRef.current || !confirming) return;
    inFlightRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onRedeem(confirming.id);
      if (result.ok) setDone(true);
      else setError(result.error || tr("تعذّر الاستبدال."));
    } catch (thrown) {
      setError(thrown instanceof Error && thrown.message ? thrown.message : tr("تعذّر الاستبدال."));
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [confirming, onRedeem]);

  const confirmingBlocked = confirming ? blockedReason(confirming, bananas) : "";
  const remainingAfter = confirming ? Math.max(0, bananas - confirming.cost) : 0;

  return (
    <section dir="rtl" aria-labelledby={titleId} className="text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[16px] font-black tracking-[-0.02em] text-foreground">
            {tr("استبدل موزك")}
          </h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {tr("مكافآت حقيقية مقابل رصيدك من الموز.")}
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 rounded-full border border-banana/30 bg-banana/15 px-3 py-1.5 text-[12px] font-black text-foreground">
          <span aria-hidden="true">🍌</span>
          <span dir="ltr" className="tabular-nums">
            {bananas.toLocaleString("en-US")}
          </span>
          <span className="font-bold text-muted-foreground">{tr("موزة")}</span>
        </p>
      </header>

      {rewards.length === 0 ? (
        <p className="mt-4 rounded-3xl border border-border bg-card p-6 text-center text-[12.5px] font-bold text-muted-foreground">
          {tr("لا توجد مكافآت معروضة حالياً.")}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rewards.map((reward) => {
            const reason = blockedReason(reward, bananas);
            const redeemable = reason === "";
            const suspended = reward.active === false;
            const soldOut = !unlimited(reward.stock) && reward.stock <= 0;
            return (
              <li
                key={reward.id}
                className={`flex flex-col justify-between rounded-3xl border border-border bg-card p-4 ${
                  suspended || soldOut ? "opacity-70" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    {/*
                      An emoji when the shop set one, a real icon when it did
                      not — never an empty square, which reads as a picture that
                      failed to load rather than a reward without one.
                    */}
                    <span className="text-3xl leading-none" aria-hidden="true">
                      {reward.icon ? (
                        reward.icon
                      ) : (
                        <Gift className="h-7 w-7 text-muted-foreground" />
                      )}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                      {categoryLabel(reward)}
                    </span>
                  </div>

                  <h3 className="mt-2 break-words text-[13.5px] font-black leading-snug text-foreground">
                    {reward.title}
                  </h3>
                  {reward.description ? (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-muted-foreground">
                      {reward.description}
                    </p>
                  ) : null}

                  {/*
                    «ticketQuantity» is the difference between «مكافأة» and
                    «ثلاث دورات على العجلة». A reward that grants tickets says
                    how many, or the member is buying a number they cannot see.
                  */}
                  {reward.ticketQuantity && reward.ticketQuantity > 0 ? (
                    <p className="mt-2 w-fit rounded-lg bg-banana/20 px-2 py-0.5 text-[11px] font-black text-foreground">
                      {tr("يمنحك")}{" "}
                      <span dir="ltr" className="tabular-nums">
                        {reward.ticketQuantity.toLocaleString("en-US")}
                      </span>{" "}
                      {tr("تذكرة في عجلة الحظ")}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-black text-foreground">
                      <span aria-hidden="true">🍌</span>{" "}
                      <span dir="ltr" className="tabular-nums">
                        {reward.cost.toLocaleString("en-US")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">
                      {tr("المخزون")}:{" "}
                      {unlimited(reward.stock) ? (
                        <span aria-label={tr("غير محدود")}>∞</span>
                      ) : (
                        <span dir="ltr" className="tabular-nums">
                          {reward.stock.toLocaleString("en-US")}
                        </span>
                      )}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] font-black ${
                        suspended || soldOut ? "text-muted-foreground" : "text-leaf"
                      }`}
                    >
                      {suspended ? tr("موقوفة") : soldOut ? tr("نفد المخزون") : tr("متاحة")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!redeemable}
                    data-ui-sound="klick"
                    onClick={() => {
                      setError("");
                      setDone(false);
                      setConfirming(reward);
                    }}
                    className="min-h-11 shrink-0 rounded-2xl border border-banana/40 bg-banana/15 px-4 text-[12.5px] font-black text-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
                  >
                    {tr("استبدال")}
                  </button>
                </div>

                {/* Why it is greyed out, on the card, not in a tooltip nobody opens. */}
                {reason ? (
                  <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                    {reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {confirming ? (
          <motion.div
            role="presentation"
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={close}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={dialogTitleId}
              dir="rtl"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
              transition={
                reduceMotion
                  ? { duration: 0.15 }
                  : { type: "spring", bounce: 0, visualDuration: 0.3 }
              }
              className="w-full max-w-sm space-y-4 overflow-x-hidden rounded-t-3xl border border-border bg-card p-5 pb-7 shadow-2xl sm:rounded-3xl sm:pb-5"
            >
              {done ? (
                <div className="space-y-3 text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-leaf" aria-hidden="true" />
                  <h3 id={dialogTitleId} className="text-[16px] font-black text-foreground">
                    {tr("تم الاستبدال")}
                  </h3>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {tr("ستصلك المكافأة حسب نوعها، وستجد تفاصيلها في طلباتك.")}
                  </p>
                  <button
                    type="button"
                    data-initial-focus
                    data-ui-sound="klick"
                    onClick={close}
                    className="min-h-11 w-full rounded-2xl bg-foreground px-4 py-3 text-[13px] font-black text-background"
                  >
                    {tr("تم")}
                  </button>
                </div>
              ) : (
                <>
                  <h3
                    id={dialogTitleId}
                    className="text-center text-[16px] font-black text-foreground"
                  >
                    {tr("تأكيد الاستبدال")}
                  </h3>
                  <p className="text-center text-[13px] font-bold text-foreground">
                    {confirming.title}
                  </p>

                  {/* Rows with hairlines, not a panel inside a panel. */}
                  <dl className="space-y-2 border-y border-border py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-bold text-muted-foreground">{tr("السعر")}</dt>
                      <dd className="font-black tabular-nums text-foreground">
                        <span dir="ltr">{confirming.cost.toLocaleString("en-US")}</span>{" "}
                        {tr("موزة")}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="font-bold text-muted-foreground">{tr("رصيدك الآن")}</dt>
                      <dd className="font-black tabular-nums text-foreground">
                        <span dir="ltr">{bananas.toLocaleString("en-US")}</span> {tr("موزة")}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                      <dt className="font-bold text-muted-foreground">
                        {tr("الرصيد بعد الاستبدال")}
                      </dt>
                      <dd className="font-black tabular-nums text-foreground">
                        {confirmingBlocked ? (
                          "—"
                        ) : (
                          <>
                            <span dir="ltr">{remainingAfter.toLocaleString("en-US")}</span>{" "}
                            {tr("موزة")}
                          </>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {confirmingBlocked ? (
                    <p className="text-center text-[12px] font-bold text-rind">
                      {confirmingBlocked}
                    </p>
                  ) : null}

                  {error ? (
                    <p className="text-center text-[12px] font-bold text-rind">{error}</p>
                  ) : null}

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={close}
                      disabled={pending}
                      data-ui-sound="klick"
                      className="min-h-11 flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-[13px] font-bold text-foreground disabled:opacity-50"
                    >
                      {tr("إلغاء")}
                    </button>
                    <button
                      type="button"
                      data-initial-focus
                      data-ui-sound="klick"
                      onClick={() => void redeem()}
                      disabled={pending || confirmingBlocked !== ""}
                      className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-banana px-4 py-3 text-[13px] font-black text-banana-ink transition-colors active:bg-peel disabled:opacity-50"
                    >
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {tr("تأكيد الاستبدال")}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

export default RewardsShelf;
