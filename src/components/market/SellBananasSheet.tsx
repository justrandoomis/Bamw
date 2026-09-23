import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Loader2, X } from "lucide-react";

import { tr } from "@/i18n";
import { useCurrency } from "@/context/CurrencyContext";
import { dinars } from "@/lib/banana-price";

/**
 * Selling bananas to the shop, without leaving the market.
 *
 * «زر بيع الموز يفتح Modal / Bottom Sheet عصري داخل نفس الصفحة. لا ينتقل إلى
 *  صفحة ثانية.» — so this is a sheet and never a route. It rises from the
 * bottom edge on a phone, where the thumb is, and becomes a centred dialog from
 * `sm:` up, where a full-width sheet would be a stripe across a desk monitor.
 *
 * ## The price on this screen is a quote, and nothing more
 *
 * «السعر المستخدم في التنفيذ النهائي يجب أن يأتي من السيرفر لحظة تنفيذ البيع.
 *  لا تثق بالسعر أو الناتج أو الرصيد القادم من Client… ويجب أن يعرض الرد السعر
 *  الفعلي الذي تم التنفيذ به.»
 *
 * `pricePerBanana` exists to be multiplied in front of the member while they
 * decide. It is never sent anywhere: `onSell` carries a quantity and an id, and
 * `sellBananas` in `src/lib/banana-sell.server.ts` recomputes the spot price at
 * the instant it executes. That is why the receipt below is built ONLY from the
 * resolved value, and why a difference between the quote and the executed price
 * is stated in words rather than quietly absorbed — a member who watched
 * «0.000377» and was paid at «0.000300» has been told, not surprised.
 *
 * ## One press, one request id
 *
 * The server's table `banana_direct_sales` carries a unique index on
 * (user_id, request_id) and answers a repeat with the receipt of the first
 * sale. That protection only works if the browser sends the SAME id for a
 * retry of one press and a DIFFERENT id for a second, deliberate sale — so the
 * id is minted once per press, kept across a failed attempt, and thrown away
 * the moment the quantity changes (a new quantity is a new sale, and reusing
 * the id there would replay the old receipt instead of selling anything).
 *
 * ## Two money formatters on one sheet
 *
 * `formatIQDPrice` is the shop's formatter and the one that follows the
 * currency the member chose in settings — but it rounds an IQD amount to the
 * whole dinar. That is right for a 45,000 د.ع game and a lie here: a banana is
 * worth 0.000377 د.ع, which it prints as «0 د.ع». So the parts of the
 * calculation that are smaller than a dinar go through `dinars()`, the market's
 * own formatter (`src/lib/banana-price.ts`, which exists for exactly this
 * sub-fils price), and `formatIQDPrice` prints what the member is actually paid
 * — an integer number of dinars, because the server floors it, so nothing is
 * rounded away and a member reading in USD still sees their own currency.
 */

export interface SellBananasSheetProps {
  open: boolean;
  onClose: () => void;
  balance: number; // bananas the member holds
  pricePerBanana: number; // the server's current quote, for the preview only
  enabled: boolean; // false when the admin closed direct selling
  minQuantity: number;
  /** Executes the sale. Resolves with what the SERVER actually did. */
  onSell: (
    quantity: number,
    requestId: string,
  ) => Promise<
    | { ok: true; quantity: number; pricePerBanana: number; proceeds: number }
    | { ok: false; error: string }
  >;
}

/** What the server said it did — the only numbers the receipt may print. */
type ExecutedSale = Extract<Awaited<ReturnType<SellBananasSheetProps["onSell"]>>, { ok: true }>;

/** «Quick selections 25% 50% 75% 100%», of the balance. */
const QUICK_PERCENTAGES = [25, 50, 75, 100] as const;

/*
  Apple's two settle shapes, as `OrderReviewSheet` writes them: nothing was
  flicked, so nothing overshoots, except the surface itself arriving.
*/
const ARRIVE = { type: "spring", bounce: 0.2, visualDuration: 0.4 } as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An id for one press.
 *
 * `crypto.randomUUID` is not everywhere — an older in-app browser (Telegram's,
 * which is most of this shop's traffic) can be missing it, and falling over
 * there would mean no sale at all. The fallback does not need to be
 * unguessable: the server scopes the id to the member, so the worst a collision
 * with one's own earlier id could do is replay one's own receipt.
 */
function newRequestId(): string {
  const source = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (source && typeof source.randomUUID === "function") return `sell-${source.randomUUID()}`;
  return `sell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Floored to whole bananas, because a quarter of a banana is not a thing. */
function quickQuantity(balance: number, percent: number): number {
  if (!(balance > 0)) return 0;
  return Math.floor((balance * percent) / 100);
}

/** Prices are floats from two machines; an exact `!==` would cry wolf. */
function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-12;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[12px] font-bold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-end text-[13px] font-black text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function SellBananasSheet({
  open,
  onClose,
  balance,
  pricePerBanana,
  enabled,
  minQuantity,
  onSell,
}: SellBananasSheetProps) {
  const reduceMotion = useReducedMotion();
  const { formatIQDPrice } = useCurrency();
  const titleId = useId();
  const inputId = useId();

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef("");
  /*
    The lock is a ref, not the `pending` state, because state is not a lock:
    two taps inside one frame both read the state as it was rendered and both
    would pass. This is checked and set in the same synchronous statement, so
    the second tap has nothing to enter.
  */
  const inFlightRef = useRef(false);

  const [raw, setRaw] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ExecutedSale | null>(null);

  // A sheet that opens is a fresh sale — never the leftovers of the last one.
  useEffect(() => {
    if (!open) return;
    setRaw("");
    setError("");
    setReceipt(null);
    setPending(false);
    inFlightRef.current = false;
    requestIdRef.current = "";
  }, [open]);

  /*
    Escape closes it, as every dialog on the web should — but not while the
    sale is in flight, because closing then would hide the outcome of a charge
    that is already happening.
  */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || inFlightRef.current) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Focus enters the sheet and returns where it came from when the sheet goes. */
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    const first = sheet?.querySelector<HTMLElement>("[data-initial-focus]") ?? sheet;
    first?.focus();
    return () => restoreTo?.focus?.();
  }, [open]);

  const text = raw.trim();
  const quantity = text === "" ? null : Number(text);

  /**
   * Which rule the typed quantity breaks, in one sentence.
   *
   * Naming the rule is the whole point: «الكمية غير صالحة» tells a member they
   * are wrong and nothing else, while «أقل كمية للبيع 100 موزة» tells them what
   * to type next. The order matters too — a fraction is reported as a fraction
   * before it is reported as being below the minimum.
   */
  let problem = "";
  if (quantity !== null) {
    if (!Number.isFinite(quantity)) problem = tr("اكتب رقماً.");
    else if (!Number.isInteger(quantity)) problem = tr("الموزة لا تتجزأ — اكتب عدداً صحيحاً.");
    else if (quantity <= 0) problem = tr("اكتب كمية أكبر من صفر.");
    else if (quantity < minQuantity)
      problem = `${tr("أقل كمية للبيع")} ${minQuantity.toLocaleString("en-US")} ${tr("موزة")}.`;
    else if (quantity > balance)
      problem = `${tr("رصيدك")} ${balance.toLocaleString("en-US")} ${tr("موزة")} — ${tr("لا يمكنك بيع أكثر من رصيدك")}.`;
  }

  const valid = quantity !== null && problem === "";
  const canSell = enabled && valid && !pending && receipt === null;

  const previewQuantity = valid && quantity !== null ? quantity : 0;
  const gross = previewQuantity * pricePerBanana;
  /*
    Floored exactly the way the server floors it — `Math.floor(quantity *
    pricePerBanana)` in `sellBananas` — including the float behaviour, so this
    preview cannot promise a dinar the sale will not pay.
  */
  const payable = Math.floor(gross);

  /** The quantity is the sale's identity, so a new one cannot inherit the id. */
  const changeQuantity = (next: string) => {
    setRaw(next);
    setError("");
    requestIdRef.current = "";
  };

  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!enabled || quantity === null || !Number.isInteger(quantity)) return;
    if (quantity < minQuantity || quantity > balance || quantity <= 0) return;

    inFlightRef.current = true;
    // Minted once, kept through a failure: a retry of THIS press is the same
    // sale to the server, and it answers the second one with the first receipt.
    if (!requestIdRef.current) requestIdRef.current = newRequestId();
    setPending(true);
    setError("");
    try {
      const result = await onSell(quantity, requestIdRef.current);
      if (result.ok) {
        setReceipt(result);
        requestIdRef.current = "";
      } else {
        setError(result.error || tr("تعذّر إتمام البيع."));
      }
    } catch (thrown) {
      setError(
        thrown instanceof Error && thrown.message ? thrown.message : tr("تعذّر إتمام البيع."),
      );
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }, [balance, enabled, minQuantity, onSell, quantity]);

  /**
   * Tab stays inside the sheet.
   *
   * No visibility filtering: jsdom has no layout, so an `offsetParent` check
   * would drop every element under test while claiming to be careful. The
   * selector already excludes what actually matters — disabled controls.
   */
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const items = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const priceMoved = receipt !== null && !samePrice(receipt.pricePerBanana, pricePerBanana);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="presentation"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          onClick={() => {
            if (!inFlightRef.current) onClose();
          }}
        >
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            dir="rtl"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={trapTab}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: "100%" }}
            transition={reduceMotion ? { duration: 0.15 } : ARRIVE}
            className="relative z-10 max-h-[92vh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-t-3xl border border-border bg-card p-5 pb-7 text-foreground shadow-2xl sm:max-h-[88vh] sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-[17px] font-black leading-tight tracking-[-0.02em] text-foreground"
                >
                  {tr("بيع الموز")}
                </h2>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {tr("تبيع للمتجر مباشرة بسعر السوق لحظة التنفيذ.")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!inFlightRef.current) onClose();
                }}
                aria-label={tr("إغلاق")}
                className="-me-1.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </header>

            {/*
              «رصيدك 75,215 موزة · سعر السوق 0.000377 د.ع / موزة» — the two
              figures the decision rests on, above the field that uses them.
              Numbers read LTR inside an RTL sentence, so 75,215 is not
              reassembled backwards by the bidi algorithm.
            */}
            <dl className="mt-4 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-2xl border border-border bg-muted/40 p-3">
                <dt className="text-[11px] font-bold text-muted-foreground">{tr("رصيدك")}</dt>
                <dd className="mt-0.5 break-words text-[15px] font-black text-foreground">
                  <span dir="ltr" className="tabular-nums">
                    {balance.toLocaleString("en-US")}
                  </span>{" "}
                  <span className="text-[11px] font-bold text-muted-foreground">{tr("موزة")}</span>
                </dd>
              </div>
              <div className="min-w-0 rounded-2xl border border-border bg-muted/40 p-3">
                <dt className="text-[11px] font-bold text-muted-foreground">{tr("سعر السوق")}</dt>
                <dd className="mt-0.5 break-words text-[15px] font-black text-foreground">
                  <span dir="ltr" className="tabular-nums">
                    {dinars(pricePerBanana)}
                  </span>{" "}
                  <span className="text-[11px] font-bold text-muted-foreground">
                    / {tr("موزة")}
                  </span>
                </dd>
              </div>
            </dl>

            {!enabled ? (
              /*
                «تعطيل/تفعيل البيع المباشر عند الحاجة» — the admin's switch, as
                the member meets it. No field and no button: offering a control
                that is guaranteed to be refused is worse than saying plainly
                that the door is shut, and the balance is stated so nobody
                suspects their bananas went with it.
              */
              <p className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[12.5px] font-bold leading-relaxed text-amber-900 dark:text-amber-200">
                {tr(
                  "البيع المباشر متوقف مؤقتاً من الإدارة. رصيدك من الموز كما هو، وسيعود البيع فور إعادة تفعيله.",
                )}
              </p>
            ) : receipt ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-[14px] font-black text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  {tr("تم تنفيذ البيع")}
                </div>

                {/*
                  Every figure here is the server's answer. Not one of them is
                  recomputed from the props above, which is the entire point of
                  «ويجب أن يعرض الرد السعر الفعلي الذي تم التنفيذ به».
                */}
                <dl
                  data-testid="sell-receipt"
                  className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3.5"
                >
                  <Line label={tr("الكمية المنفَّذة")}>
                    <span dir="ltr" className="tabular-nums">
                      {receipt.quantity.toLocaleString("en-US")}
                    </span>{" "}
                    {tr("موزة")}
                  </Line>
                  <Line label={tr("السعر المنفَّذ به")}>
                    <span dir="ltr" className="tabular-nums">
                      {dinars(receipt.pricePerBanana)}
                    </span>
                  </Line>
                  <div className="border-t border-border pt-2">
                    <Line label={tr("المبلغ المستلم")}>
                      <span
                        dir="ltr"
                        className="tabular-nums text-emerald-600 dark:text-emerald-400"
                      >
                        {formatIQDPrice(receipt.proceeds)}
                      </span>
                    </Line>
                  </div>
                </dl>

                {priceMoved ? (
                  <p
                    data-testid="sell-price-moved"
                    className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] font-bold leading-relaxed text-amber-900 dark:text-amber-200"
                  >
                    {tr("تغيّر السعر بين العرض والتنفيذ: المعروض كان")}{" "}
                    <span dir="ltr" className="tabular-nums">
                      {dinars(pricePerBanana)}
                    </span>{" "}
                    {tr("ونُفّذ بـ")}{" "}
                    <span dir="ltr" className="tabular-nums">
                      {dinars(receipt.pricePerBanana)}
                    </span>
                    . {tr("المعتمد هو سعر السيرفر لحظة التنفيذ.")}
                  </p>
                ) : null}

                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setReceipt(null);
                      setRaw("");
                      setError("");
                      requestIdRef.current = "";
                    }}
                    className="min-h-11 flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-[13px] font-bold text-foreground"
                  >
                    {tr("بيع كمية أخرى")}
                  </button>
                  <button
                    type="button"
                    data-initial-focus
                    onClick={onClose}
                    className="min-h-11 flex-1 rounded-2xl bg-foreground px-4 py-3 text-[13px] font-black text-background transition-transform active:scale-[0.98]"
                  >
                    {tr("تم")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor={inputId}
                    className="block text-[12.5px] font-bold text-foreground"
                  >
                    {tr("كم موزة تريد بيعها؟")}
                  </label>
                  <input
                    id={inputId}
                    data-initial-focus
                    value={raw}
                    onChange={(event) => changeQuantity(event.target.value)}
                    disabled={pending}
                    /*
                      A text field with a numeric keypad, not `type="number"`:
                      a number input silently swallows what it dislikes, and a
                      member who pastes «1.5» or «-20» is owed the sentence
                      underneath explaining which rule they broke.
                    */
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    placeholder={String(minQuantity)}
                    aria-invalid={problem !== ""}
                    className="mt-2 h-12 w-full rounded-2xl border border-border bg-background px-4 text-center text-[17px] font-black tabular-nums text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-amber-500 disabled:opacity-60"
                  />
                </div>

                {/* «Quick selections 25% 50% 75% 100%» — of the balance. */}
                <div className="grid grid-cols-4 gap-2">
                  {QUICK_PERCENTAGES.map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      disabled={pending || !(balance > 0)}
                      onClick={() => changeQuantity(String(quickQuantity(balance, percent)))}
                      className="min-h-11 rounded-2xl border border-border bg-muted/40 px-1 text-[13px] font-black tabular-nums text-foreground transition-transform active:scale-95 hover:border-amber-500/60 disabled:opacity-50"
                    >
                      {percent}%
                    </button>
                  ))}
                </div>

                {problem ? (
                  <p className="text-[12px] font-bold leading-relaxed text-red-500">{problem}</p>
                ) : null}

                {/*
                  «ويظهر الحساب مباشرة: 100,000 موزة × 0.000377 د.ع = 37.7 د.ع»

                  Written as the multiplication rather than as a total, because
                  a member who can see all three parts can check the shop's
                  arithmetic — and the shop that shows its working is the one
                  worth checking.
                */}
                {previewQuantity > 0 ? (
                  <div
                    data-testid="sell-preview"
                    aria-live="polite"
                    className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5"
                  >
                    <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[13px] font-bold text-foreground">
                      <span dir="ltr" className="tabular-nums">
                        {previewQuantity.toLocaleString("en-US")}
                      </span>
                      <span>{tr("موزة")}</span>
                      <span>×</span>
                      <span dir="ltr" className="tabular-nums">
                        {dinars(pricePerBanana)}
                      </span>
                      <span>=</span>
                      <span dir="ltr" className="tabular-nums font-black">
                        {dinars(gross)}
                      </span>
                    </p>
                    <p className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 border-t border-amber-500/20 pt-2 text-center text-[12.5px] font-bold text-foreground">
                      <span className="text-muted-foreground">{tr("يُدفع لك")}</span>
                      <span dir="ltr" className="tabular-nums text-[14px] font-black">
                        {formatIQDPrice(payable)}
                      </span>
                    </p>
                    {payable !== gross ? (
                      <p className="mt-1 text-center text-[11px] font-bold text-muted-foreground">
                        {tr("يُدفع بالدينار الصحيح — الكسر يُقرَّب للأسفل.")}
                      </p>
                    ) : null}
                    {/*
                      A quantity worth less than one dinar is refused by the
                      server («too_small»), and the button is still offered.
                      That is deliberate: what is on screen is a QUOTE, the
                      price is recomputed at execution, and a quote that has
                      since risen can carry this sale over the line. Disabling
                      on a stale number would block a sale the server would
                      have taken.
                    */}
                    {payable <= 0 ? (
                      <p className="mt-1 text-center text-[11px] font-bold text-amber-700 dark:text-amber-300">
                        {tr("بهذه الكمية لا يبلغ العائد ديناراً واحداً بالسعر الحالي.")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {error ? (
                  <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] font-bold leading-relaxed text-red-600 dark:text-red-300">
                    {error}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSell}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-[14px] font-black text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {tr("بيع الآن")}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default SellBananasSheet;
