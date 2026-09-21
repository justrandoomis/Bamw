import { useState } from "react";
import { Sparkles, Star } from "lucide-react";

import OrderReviewSheet from "@/components/reviews/OrderReviewSheet";

export interface RatingCardProps {
  orderId?: string;
  orderCode?: string;
  items?: Array<{ id?: string; title?: string; image?: string; productId?: string | number }>;
  text?: string;
  locale?: "ar" | "en";
  onSubmitted?: (rating: number, comment: string) => void;
}

/**
 * The card in the conversation that the Telegram invitation points at.
 *
 * It used to be the whole review: stars, quick tags, one product picked from a
 * dropdown, and a coupon returned the instant it was submitted. That is what
 * the owner changed — the code is earned now, through a two-step submission an
 * admin approves — so this is the invitation and
 * {@link OrderReviewSheet} is the review.
 *
 * The products are shown rather than chosen: one review covers the whole
 * order.
 */
export function RatingCard({
  orderId,
  orderCode,
  items = [],
  text,
  locale = "ar",
  onSubmitted,
}: RatingCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [wasSubmitted, setWasSubmitted] = useState(false);
  const isAr = locale !== "en";

  return (
    <>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="my-2 w-full max-w-md space-y-3 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-card via-card to-amber-500/5 p-4 text-foreground shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-500/15 p-1.5 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-foreground">
                {isAr
                  ? "يرجى التقييم للحصول على كود خصم ألف دينار"
                  : "Review your order for a 1,000 IQD code"}
              </h4>
              {orderCode ? (
                <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                  #{orderCode}
                </span>
              ) : null}
            </div>
          </div>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
            {isAr ? "تسليم مكتمل" : "Delivered"}
          </span>
        </div>

        {text ? <p className="text-xs leading-relaxed text-muted-foreground">{text}</p> : null}

        {items.length > 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/40 p-2">
            {items[0]?.image ? (
              <img
                src={items[0].image}
                alt=""
                loading="lazy"
                className="h-8 w-8 shrink-0 rounded-lg bg-muted object-cover"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-foreground">
              {items.length > 1
                ? isAr
                  ? `${items[0]?.title} و${items.length - 1} منتج آخر`
                  : `${items[0]?.title} +${items.length - 1} more`
                : items[0]?.title}
            </span>
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isAr
            ? "خطوتان: اكتب رأيك بالتسليم مع صورة أو مقطع، ثم علّق على منشور الإنستغرام وأرفق صورة تعليقك. بعد موافقة الإدارة يصلك الكود."
            : "Two steps: tell us about the delivery with a photo or clip, then comment on our Instagram post and attach a screenshot of it."}
        </p>

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          disabled={!orderId || wasSubmitted}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Star className="h-4 w-4 fill-current" />
          <span>
            {wasSubmitted
              ? isAr
                ? "بانتظار موافقة الإدارة"
                : "Waiting for approval"
              : isAr
                ? "قيّم طلبك الآن"
                : "Review your order"}
          </span>
        </button>
      </div>

      {orderId ? (
        <OrderReviewSheet
          orderId={orderId}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onSubmitted={() => {
            setWasSubmitted(true);
            /*
              The old signature promised the rating and the comment. Neither is
              this card's to know any more — the sheet owns them — and the one
              caller only refreshes, so it is told that much.
            */
            onSubmitted?.(0, "");
          }}
        />
      ) : null}
    </>
  );
}

export default RatingCard;
