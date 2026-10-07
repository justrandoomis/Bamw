import { Camera, Clock, Loader2 } from "lucide-react";

import { deliveryStep } from "@/lib/chatDelivery";
import { cn } from "@/lib/utils";

/**
 * Where an order stands, at the top of its conversation.
 *
 * A member receiving a game account walks the same four steps every time: the
 * shop prepares it, they sign in with the details, the shop sends a code, they
 * enter it and play. The banner here used to say only the current step, in a
 * colour of its own for each — amber, then a blue the cream theme has nowhere
 * else, then green — so nobody could tell how far along they were or what
 * came next. Now it is one strip in the theme's own colours: four segments
 * that fill as the order moves, the step's name under each, one sentence
 * saying what to do now, and the one button that does it.
 */

type Copy = { ar: string; en: string };

const STEPS: readonly Copy[] = [
  { ar: "التجهيز", en: "Preparing" },
  { ar: "الدخول", en: "Sign in" },
  { ar: "الكود", en: "Code" },
  { ar: "التشغيل", en: "Play" },
];

export function DeliveryTracker({
  stage,
  position,
  aheadCount,
  etaText,
  itemTitle,
  itemNumber,
  itemCount,
  busy,
  onAttachProof,
  locale,
}: {
  stage?: string;
  /** The order's place in the preparation queue; 1 is "now". */
  position: number;
  aheadCount?: number;
  etaText?: string;
  /** The account being delivered, when the order has one in hand. */
  itemTitle?: string;
  itemNumber?: number;
  itemCount?: number;
  busy: boolean;
  onAttachProof: () => void;
  locale: "ar" | "en";
}) {
  const ar = locale === "ar";
  const say = (copy: Copy) => (ar ? copy.ar : copy.en);
  const { index, done } = deliveryStep(stage);

  const title: string =
    index === 0
      ? position <= 1
        ? say({
            ar: "دورك الآن — المشرف يجهّز طلبك",
            en: "It's your turn — your order is being prepared",
          })
        : say({
            ar: `طلبك في الطابور — الدور ${position}`,
            en: `Your order is in the queue — number ${position}`,
          })
      : stage === "awaiting_login_proof"
        ? say({ ar: "سجّل الدخول وأرسل صورة الإثبات", en: "Sign in, then send a photo as proof" })
        : index === 2
          ? say({
              ar: "وصلت صورتك — بانتظار كود التحقق",
              en: "Photo received — your code is on its way",
            })
          : done
            ? say({ ar: "اكتمل التسليم", en: "Delivery complete" })
            : say({
                ar: "وصلك الكود — أدخله لتشغيل اللعبة",
                en: "Your code is here — enter it to play",
              });

  /* The second line: how long, while waiting; which account, once one is in hand. */
  const meta: string | null =
    index === 0
      ? [
          aheadCount && aheadCount > 0
            ? say({ ar: `أمامك ${aheadCount}`, en: `${aheadCount} ahead` })
            : null,
          etaText || null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      : itemTitle
        ? itemCount && itemCount > 1 && itemNumber
          ? `${itemTitle} · ${say({ ar: `الحساب ${itemNumber} من ${itemCount}`, en: `account ${itemNumber} of ${itemCount}` })}`
          : itemTitle
        : null;

  return (
    <div
      className="relative z-20 border-b border-[var(--line)] bg-[var(--surface-2)] px-3.5 pb-2.5 pt-2"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-3xl">
        <ol
          className="grid grid-cols-4 gap-1"
          aria-label={say({ ar: "مراحل تسليم الطلب", en: "Order delivery steps" })}
        >
          {STEPS.map((step, i) => {
            const finished = i < index || (i === index && done);
            const current = i === index && !done;
            return (
              <li key={step.en} className="min-w-0" aria-current={current ? "step" : undefined}>
                {/*
                The step under way is half filled, from the side the reading
                starts on — a tint of the primary turned muddy on a dark
                theme, and read as a fourth colour rather than "in progress".
              */}
                <span
                  className={cn(
                    "block h-1 overflow-hidden rounded-full",
                    finished ? "bg-primary" : "bg-[var(--line)]",
                  )}
                >
                  {current && <span className="block h-full w-1/2 rounded-full bg-primary" />}
                </span>
                <span
                  className={cn(
                    "mt-1 block truncate text-[10px] leading-none",
                    current
                      ? "font-bold text-[var(--ink)]"
                      : finished
                        ? "font-semibold text-[var(--ink)]/70"
                        : "font-medium text-[var(--muted-ink)]",
                  )}
                >
                  {say(step)}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-2 flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12.5px] font-bold leading-snug text-[var(--ink)]">
              {title}
            </p>
            {meta && (
              <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-[var(--muted-ink)]">
                {index === 0 && <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />}
                <span className="truncate">{meta}</span>
              </p>
            )}
          </div>

          {stage === "awaiting_login_proof" ? (
            <button
              type="button"
              onClick={onAttachProof}
              disabled={busy}
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3.5 text-[12px] font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {say({ ar: "إرفاق الإثبات", en: "Attach proof" })}
            </button>
          ) : stage === "proof_received" ? (
            <button
              type="button"
              onClick={onAttachProof}
              disabled={busy}
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--line)] bg-card px-3 text-[12px] font-bold text-[var(--ink)] transition-colors hover:bg-[var(--surface-3)] active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {say({ ar: "تغيير الصورة", en: "Change photo" })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
