import React, { useState } from "react";
import { Star, CheckCircle, Send, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface RatingCardProps {
  orderId?: string;
  orderCode?: string;
  items?: Array<{ id?: string; title?: string; image?: string; productId?: string | number }>;
  text?: string;
  locale?: "ar" | "en";
  onSubmitted?: (rating: number, comment: string) => void;
}

const STAR_LABELS_AR = ["", "سيء", "مقبول", "جيد", "ممتاز", "تجربة رائعة وفورية 🚀"];
const STAR_LABELS_EN = ["", "Poor", "Fair", "Good", "Excellent", "Amazing Experience 🚀"];

const QUICK_TAGS_AR = [
  "⚡ تسليم فوري وسريع",
  "🎮 حساب أصلي ومضمون",
  "💬 دعم متعاون",
  "🔒 أمان وراحة بال",
];
const QUICK_TAGS_EN = [
  "⚡ Instant Delivery",
  "🎮 Verified Genuine",
  "💬 Great Support",
  "🔒 Safe & Secure",
];

export function RatingCard({
  orderId,
  orderCode,
  items = [],
  text,
  locale = "ar",
  onSubmitted,
}: RatingCardProps) {
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const isAr = locale === "ar";
  const starLabels = isAr ? STAR_LABELS_AR : STAR_LABELS_EN;
  const quickTags = isAr ? QUICK_TAGS_AR : QUICK_TAGS_EN;
  const activeStar = hoverRating || rating;

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      toast.error(isAr ? "يرجى تحديد عدد النجوم أولاً" : "Please select a star rating");
      return;
    }

    setIsSubmitting(true);
    try {
      const firstProductId = items[0]?.productId ? String(items[0].productId) : "general";
      const fullComment = [
        comment.trim(),
        selectedTags.length > 0 ? `(${selectedTags.join(" | ")})` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: firstProductId,
          rating,
          comment: fullComment,
          orderId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || (isAr ? "فشل إرسال التقييم" : "Failed to submit review"));
      }

      setIsSubmitted(true);
      toast.success(isAr ? "شكراً جزيلاً لتقييمك! ⭐" : "Thank you for your rating! ⭐");
      onSubmitted?.(rating, fullComment);
    } catch (err: any) {
      toast.error(
        err?.message || (isAr ? "حدث خطأ أثناء إرسال التقييم" : "Error submitting review"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="w-full max-w-sm my-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-foreground shadow-xs animate-in fade-in"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-xs text-foreground">
              {isAr ? "تم تسجيل تقييمك بنجاح!" : "Review Submitted!"}
            </h4>
            <div className="flex items-center gap-1 mt-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-3.5 h-3.5 ${
                    star <= rating
                      ? "fill-amber-400 text-amber-400"
                      : "fill-muted text-muted-foreground/30"
                  }`}
                />
              ))}
              <span className="text-[11px] text-muted-foreground font-bold ms-1">({rating}/5)</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {isAr
                ? "شكراً لمشاركتك تجربتك معنا، رأيك يساعدنا على تحسين الخدمة دائماً."
                : "Thank you for sharing your experience with us."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="w-full max-w-md my-2 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-card via-card to-amber-500/5 p-4 text-foreground shadow-sm space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs text-foreground">
              {isAr ? "تقييم الطلب وتجربة الاستلام" : "Order & Delivery Review"}
            </h4>
            {orderCode && (
              <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                #{orderCode}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
          {isAr ? "تسليم مكتمل" : "Delivered"}
        </span>
      </div>

      {text && <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>}

      {/* Items Preview if available */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-xl bg-muted/40 border border-border/50">
          {items[0]?.image && (
            <img
              src={items[0].image}
              alt={items[0].title || "Product"}
              className="w-8 h-8 rounded-lg object-cover bg-muted shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-bold text-foreground truncate block">
              {items[0]?.title}
            </span>
            {items.length > 1 && (
              <span className="text-[10px] text-muted-foreground">
                {isAr ? `+ ${items.length - 1} عناصر أخرى` : `+ ${items.length - 1} other items`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Star Selector */}
      <div className="space-y-1.5 text-center py-1">
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className="p-1 transition-transform hover:scale-125 active:scale-95 cursor-pointer focus:outline-hidden"
              title={`${star} ${isAr ? "نجوم" : "stars"}`}
            >
              <Star
                className={`w-7 h-7 transition-colors ${
                  star <= activeStar
                    ? "fill-amber-400 text-amber-400 drop-shadow-xs"
                    : "fill-muted text-muted-foreground/30 hover:text-amber-300"
                }`}
              />
            </button>
          ))}
        </div>
        <div className="text-xs font-bold text-amber-600 dark:text-amber-400 h-4">
          {starLabels[activeStar] || ""}
        </div>
      </div>

      {/* Quick Tags */}
      <div className="space-y-1">
        <span className="text-[10px] text-muted-foreground font-semibold block">
          {isAr ? "أبرز ما أعجبك (اختياري):" : "What did you like? (optional):"}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {quickTags.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/40 shadow-2xs"
                    : "bg-muted/40 text-muted-foreground hover:text-foreground border-border/60"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* Form with Comment and Submit */}
      <form onSubmit={handleSubmit} className="space-y-2.5 pt-1">
        <div className="relative">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              isAr
                ? "اكتب تقييمك وملاحظاتك حول سرعة التسليم وجودة الخدمة (اختياري)..."
                : "Write your review about the delivery speed and service (optional)..."
            }
            rows={2}
            className="w-full text-xs bg-background/80 border border-border rounded-xl px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-amber-500/50 resize-none"
          />
          <MessageSquare className="w-3.5 h-3.5 absolute top-2.5 end-2.5 text-muted-foreground/50 pointer-events-none" />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !rating}
          className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5 rtl:rotate-180" />
          )}
          <span>{isAr ? "إرسال التقييم ⭐" : "Submit Review ⭐"}</span>
        </button>
      </form>
    </div>
  );
}

export default RatingCard;
