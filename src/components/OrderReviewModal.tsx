import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Star,
  Upload,
  CheckCircle2,
  X,
  ExternalLink,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api, fileToDataUrl } from "@/lib/api";
import type { Order } from "@/lib/types";
import ReviewRewardCode, { type ReviewRewardData } from "@/components/reviews/ReviewRewardCode";

interface OrderReviewModalProps {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

const RATING_LABELS = ["يحتاج تحسين 😕", "مقبول 😐", "جيد 👍", "جيد جداً 😊", "ممتاز جداً 🤩"];

const INSTAGRAM_PROMO_URL = "https://www.instagram.com/p/DZXqXw3tosE/?igsi=MTVrdjg0cGlrbmNlbw==";

export default function OrderReviewModal({
  order,
  isOpen,
  onClose,
  onSubmitted,
}: OrderReviewModalProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>(
    String(order.items[0]?.productId || ""),
  );
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [reward, setReward] = useState<ReviewRewardData | null>(null);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploading(true);
      const dataUrl = await fileToDataUrl(file);
      const { url } = await api.upload(dataUrl, "reviews");
      setImageUrl(url);
      toast.success("تم رفع الصورة بنجاح");
    } catch {
      toast.error("فشل رفع الصورة");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedProductId) {
      toast.error("يرجى تحديد المنتج");
      return;
    }
    if (rating <= 0) {
      toast.error("يرجى اختيار التقييم بالنجوم");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await api.fetch<{ reward?: ReviewRewardData | null }>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          productId: selectedProductId,
          orderId: order.id,
          rating,
          comment: comment.trim(),
          imageUrl: imageUrl || undefined,
        }),
      });

      setReward(result.reward ?? null);
      setIsSuccess(true);
      toast.success("شكراً لك! تم إرسال تقييمك بنجاح ⭐");
      onSubmitted?.();
    } catch (err: any) {
      toast.error(err?.message || "فشل إرسال التقييم");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-xs"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-[var(--card)] border border-border shadow-2xl z-10 max-h-[90vh] flex flex-col"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-5 py-4 bg-muted/30">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                <Star className="h-5 w-5 fill-current" />
              </div>
              <div>
                <h3 className="text-base font-black text-foreground">
                  تقييم الطلب والحساب ({order.code})
                </h3>
                <p className="text-xs text-muted-foreground">
                  رأيك يهمنا ويساعدنا في تحسين وتطوير خدماتنا
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto p-5 space-y-5">
            {isSuccess ? (
              <div className="py-6 text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-10 w-10 stroke-[2.5]" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-foreground">تم استلام تقييمك بنجاح!</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    شكراً لثقتك بنا وتعاملك مع متجر بنانتو 🍌
                  </p>
                </div>

                {reward ? (
                  <ReviewRewardCode reward={reward} />
                ) : (
                  <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                    تم نشر تقييمك. إذا كان كود الطلب قد استُخدم أو انتهت صلاحيته فلن يُنشأ كود بديل.
                  </p>
                )}

                {/* Instagram Promo Callout */}
                <div className="mt-6 rounded-2xl border border-pink-500/20 bg-linear-to-br from-pink-500/5 to-purple-500/5 p-4 text-right space-y-3">
                  <div className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-bold text-sm">
                    <Sparkles className="h-4 w-4" />
                    <span>احصل على كود خصم إضافي لطلبك القادم! 🎁</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    علّق على منشورنا في إنستغرام بكلمة عن تجربتك، وسنقوم بتزويدك بكود خصم فوري.
                  </p>
                  <a
                    href={INSTAGRAM_PROMO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-pink-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 transition-opacity"
                  >
                    <span>التعليق على منشور إنستغرام</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <button
                  onClick={onClose}
                  className="w-full rounded-xl bg-muted px-4 py-2.5 text-xs font-bold text-foreground hover:bg-muted/80 transition-colors"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <>
                {/* Product Selection if multiple */}
                {order.items.length > 1 && (
                  <div>
                    <label className="block text-xs font-bold text-foreground mb-1.5">
                      اختر المنتج المراد تقييمه:
                    </label>
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground outline-hidden focus:border-primary"
                    >
                      {order.items.map((item) => (
                        <option key={item.id} value={String(item.productId)}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Rating Stars */}
                <div className="text-center space-y-2 py-2">
                  <span className="block text-xs font-bold text-muted-foreground">
                    درجة التقييم
                  </span>
                  <div className="flex items-center justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const active = (hoverRating || rating) >= star;
                      return (
                        <button
                          key={star}
                          type="button"
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setRating(star)}
                          className="p-1 text-2xl transition-transform hover:scale-110 active:scale-95"
                        >
                          <Star
                            className={`h-8 w-8 ${
                              active
                                ? "fill-amber-400 text-amber-400 filter drop-shadow-xs"
                                : "text-border fill-transparent"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs font-black text-amber-600 dark:text-amber-400">
                    {RATING_LABELS[Math.max(0, (hoverRating || rating) - 1)]}
                  </p>
                </div>

                {/* Feedback Comment */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-foreground">
                    رأيك وتجربتك (اختياري):
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="اكتب تفاصيل تجربتك وسرعة استلام الحساب والخدمة..."
                    className="w-full rounded-2xl border border-border bg-muted/40 p-3 text-xs outline-hidden focus:border-primary focus:bg-card transition-colors resize-none"
                  />
                </div>

                {/* Optional Image Upload */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-foreground">
                    إرفاق صورة / سكرين شوت (اختياري):
                  </label>
                  {imageUrl ? (
                    <div className="relative inline-block overflow-hidden rounded-xl border border-border">
                      <img src={imageUrl} alt="مرفق" className="h-20 w-20 object-cover" />
                      <button
                        type="button"
                        onClick={() => setImageUrl("")}
                        className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 py-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors">
                      <Upload className="h-4 w-4" />
                      <span>{isUploading ? "جاري الرفع..." : "اختر صورة أو لقطة شاشة"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageChange}
                        disabled={isUploading}
                      />
                    </label>
                  )}
                </div>

                {/* Instagram Promo Box */}
                <div className="rounded-2xl border border-pink-500/20 bg-linear-to-br from-pink-500/5 to-purple-500/5 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-pink-600 dark:text-pink-400">
                      <Sparkles className="h-3.5 w-3.5" />
                      عرض كود الخصم في إنستغرام
                    </span>
                    <a
                      href={INSTAGRAM_PROMO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 hover:underline"
                    >
                      <span>فتح المنشور</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    علّق على منشورنا للحصول على كود خصم خاص يمكنك استخدامه في طلبك القادم.
                  </p>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || isUploading}
                    className="flex-1 rounded-2xl bg-primary py-3 text-xs font-black text-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "جاري الإرسال..." : "إرسال التقييم"}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="rounded-2xl bg-muted px-5 py-3 text-xs font-bold text-foreground hover:bg-muted/80 transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
