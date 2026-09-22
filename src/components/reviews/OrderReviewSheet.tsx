import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ExternalLink,
  Instagram,
  Loader2,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api, uploadFileWithProgress } from "@/lib/api";
import { prepareServableImage } from "@/lib/imageForUpload";
import { isVideoUrl } from "@/lib/uploads";

/**
 * The review that earns the code, in the two steps the owner described.
 *
 * Step one is about the delivery: the products being reviewed, a comment, and
 * a photo or clip. Step two is the proof: open the shop's pinned Instagram
 * post, comment there, screenshot your own comment, attach it.
 *
 * One review covers every product in the order. That is why the products are
 * listed rather than picked — there is nothing to choose, and a picker would
 * be asking a question with one answer.
 *
 * Nothing here issues a code. Submitting says so plainly: the admin approves,
 * and then it arrives.
 */

export interface OrderReviewSheetProps {
  orderId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

interface SheetData {
  orderCode: string;
  products: { productId: string; title: string; imageUrl: string | null }[];
  submission: { status: string; rejectionReason: string | null; createdAt: string | null } | null;
  instagramPostUrl: string;
  stepOneNote: string;
  stepTwoNote: string;
  limits: { commentMin: number; commentMax: number };
}

const STAR_LABELS = ["", "سيء", "مقبول", "جيد", "ممتاز", "تجربة رائعة 🚀"];

const MB = 1024 * 1024;

/*
  Apple's two settle shapes, as the one place they are written down.

  `SETTLE` is critically damped — nothing the customer flicked, so nothing
  should overshoot. `ARRIVE` carries a little bounce and is used only where the
  surface itself arrives, which reads as a physical thing landing.
*/
const SETTLE = { type: "spring", bounce: 0, visualDuration: 0.3 } as const;
const ARRIVE = { type: "spring", bounce: 0.2, visualDuration: 0.4 } as const;

export function OrderReviewSheet({ orderId, isOpen, onClose, onSubmitted }: OrderReviewSheetProps) {
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<SheetData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [busy, setBusy] = useState<"media" | "proof" | "submit" | null>(null);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [openedInstagram, setOpenedInstagram] = useState(false);
  const mediaInput = useRef<HTMLInputElement | null>(null);
  const proofInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !orderId) return;
    let cancelled = false;
    setLoadError("");
    void (async () => {
      try {
        const result = await api.fetch<SheetData>(
          `/api/order-review?orderId=${encodeURIComponent(orderId)}`,
        );
        if (!cancelled) setData(result);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "تعذر فتح التقييم");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, orderId]);

  // A fresh sheet each time it opens: a half-written review for one order must
  // never appear over another.
  useEffect(() => {
    if (isOpen) return;
    setStep(1);
    setDone(false);
    setComment("");
    setMediaUrl("");
    setProofUrl("");
    setRating(5);
    setOpenedInstagram(false);
    setProgress(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, busy, onClose]);

  const upload = useCallback(async (file: File, slot: "media" | "proof") => {
    /*
        Re-encoded on the phone before a byte leaves it. This is what makes an
        iPhone HEIC work — Safari can decode one, the Worker cannot — and it is
        the same preparation the chat attachment does.
      */
    const isVideo = (file.type || "").toLowerCase().startsWith("video/");
    if (slot === "proof" && isVideo) {
      toast.error("إثبات التعليق يجب أن يكون صورة (لقطة شاشة).");
      return;
    }

    let toUpload = file;
    if (!isVideo) {
      const prepared = await prepareServableImage(file);
      if (!prepared.servable) {
        toast.error(
          "تعذر تحويل هذه الصورة على جهازك. أرسلها بصيغة JPG أو PNG، أو اخترها من الاستوديو بدل «الملفات».",
        );
        return;
      }
      toUpload = prepared.file;
    }

    if (!isVideo && toUpload.size > 10 * MB) {
      toast.error("الصورة كبيرة جداً. حاول إرسالها من الاستوديو لتصغيرها.");
      return;
    }
    if (isVideo && toUpload.size > 50 * MB) {
      toast.error("المقطع كبير جداً (أكثر من ٥٠ ميغابايت). أرسل مقطعاً أقصر.");
      return;
    }

    setBusy(slot);
    setProgress(0);
    try {
      const { url } = await uploadFileWithProgress(toUpload, "reviews", setProgress);
      if (slot === "media") setMediaUrl(url);
      else setProofUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل رفع الملف");
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, []);

  const commentMin = data?.limits.commentMin ?? 10;
  const commentMax = data?.limits.commentMax ?? 1200;
  const trimmed = comment.trim();
  const stepOneReady = trimmed.length >= commentMin && Boolean(mediaUrl) && rating >= 1;
  const stepTwoReady = Boolean(proofUrl);

  const submit = async () => {
    if (!stepOneReady || !stepTwoReady) return;
    setBusy("submit");
    try {
      await api.fetch("/api/order-review", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          rating,
          comment: trimmed.slice(0, commentMax),
          mediaUrl,
          instagramProofUrl: proofUrl,
        }),
      });
      setDone(true);
      onSubmitted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال التقييم");
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  const alreadyIn = data?.submission?.status === "awaiting_admin";
  const alreadyApproved = data?.submission?.status === "approved";
  const wasRejected = data?.submission?.status === "rejected";

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center sm:p-4"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="تقييم الطلب"
      >
        {/*
          A scrim, because this is a modal task: the background is pushed back
          rather than left competing for attention.
        */}
        <motion.button
          type="button"
          aria-label="إغلاق"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => !busy && onClose()}
          className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
        />

        {/*
          It arrives from the bottom and it leaves to the bottom — the same
          path, so the sheet keeps its place in the world.
        */}
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 }}
          transition={reduceMotion ? { duration: 0.2 } : ARRIVE}
          className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl sm:max-h-[88vh] sm:rounded-[28px]"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pb-3.5 pt-4">
            <div className="flex min-w-0 items-center gap-3">
              {step === 2 && !done ? (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="-ms-1 rounded-full p-1.5 text-muted-foreground transition-transform active:scale-95 hover:bg-muted hover:text-foreground"
                  aria-label="رجوع"
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
              ) : null}
              <div className="min-w-0">
                <h2 className="text-[17px] font-black leading-tight tracking-[-0.02em] text-foreground">
                  {done ? "وصل تقييمك" : "قيّم تسليم طلبك"}
                </h2>
                <p className="mt-0.5 truncate text-[11.5px] leading-relaxed text-muted-foreground">
                  {done
                    ? "بانتظار موافقة الإدارة"
                    : `#${data?.orderCode || ""} — خطوة ${step} من 2`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => !busy && onClose()}
              className="rounded-full p-1.5 text-muted-foreground transition-transform active:scale-95 hover:bg-muted hover:text-foreground"
              aria-label="إغلاق"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </header>

          {/* Where they are, without a word. */}
          {!done && (
            <div className="flex shrink-0 gap-1.5 px-5 pt-3">
              {[1, 2].map((index) => (
                <motion.span
                  key={index}
                  className="h-1 flex-1 rounded-full bg-muted"
                  animate={{ opacity: index <= step ? 1 : 0.35 }}
                  transition={SETTLE}
                >
                  <motion.span
                    className="block h-full rounded-full bg-amber-500"
                    initial={false}
                    animate={{ scaleX: index <= step ? 1 : 0 }}
                    style={{ transformOrigin: "right" }}
                    transition={reduceMotion ? { duration: 0.15 } : SETTLE}
                  />
                </motion.span>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loadError ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
                {loadError}
              </p>
            ) : !data ? (
              <div className="flex min-h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : done || alreadyIn || alreadyApproved ? (
              <SubmittedState approved={alreadyApproved && !done} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: step === 1 ? -24 : 24 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: step === 1 ? 24 : -24 }}
                  transition={reduceMotion ? { duration: 0.15 } : SETTLE}
                  className="space-y-5"
                >
                  {step === 1 ? (
                    <>
                      {wasRejected && data.submission?.rejectionReason ? (
                        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
                          <span className="font-bold">لم تُقبل محاولتك السابقة:</span>{" "}
                          {data.submission.rejectionReason}
                        </p>
                      ) : null}

                      {/*
                        Listed, not chosen. One review covers the whole order,
                        so a picker would ask a question with one answer.
                      */}
                      <section className="space-y-2">
                        <h3 className="text-[12.5px] font-bold text-foreground">
                          المنتجات التي تقيّمها
                        </h3>
                        <ul className="space-y-1.5">
                          {data.products.map((product) => (
                            <li
                              key={product.productId}
                              className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-muted/30 p-2"
                            >
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-9 w-9 shrink-0 rounded-xl object-cover"
                                />
                              ) : (
                                <span className="h-9 w-9 shrink-0 rounded-xl bg-muted" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-foreground">
                                {product.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-[12.5px] font-bold text-foreground">
                          كيف كان التسليم؟
                        </h3>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onPointerDown={() => setRating(star)}
                              onPointerEnter={() => setHoverRating(star)}
                              onPointerLeave={() => setHoverRating(0)}
                              className="rounded-full p-0.5 transition-transform active:scale-90"
                              aria-label={`${star} من 5`}
                            >
                              <Star
                                className={`h-7 w-7 transition-colors ${
                                  star <= (hoverRating || rating)
                                    ? "fill-amber-400 text-amber-400"
                                    : "fill-muted text-muted-foreground/40"
                                }`}
                              />
                            </button>
                          ))}
                          <span className="ms-1.5 text-[12px] font-bold text-muted-foreground">
                            {STAR_LABELS[hoverRating || rating]}
                          </span>
                        </div>
                      </section>

                      <section className="space-y-2">
                        <label className="block space-y-2">
                          <span className="text-[12.5px] font-bold text-foreground">
                            {data.stepOneNote || "اكتب رأيك بتسليم المنتجات."}
                          </span>
                          <textarea
                            value={comment}
                            onChange={(event) =>
                              setComment(event.target.value.slice(0, commentMax))
                            }
                            rows={4}
                            placeholder="مثال: وصلني الحساب خلال دقائق والدعم جاوبني فوراً."
                            className="w-full resize-none rounded-2xl border border-border bg-background px-3.5 py-3 text-[13px] leading-relaxed text-start outline-none transition-colors focus:border-amber-500/60"
                          />
                        </label>
                        <p
                          className={`text-[11px] font-bold ${
                            trimmed.length >= commentMin
                              ? "text-muted-foreground"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {trimmed.length}/{commentMax} — {commentMin} أحرف على الأقل
                        </p>
                      </section>

                      <Attachment
                        label="أرفق صورة أو مقطعاً للتسليم"
                        url={mediaUrl}
                        busy={busy === "media"}
                        progress={progress}
                        onPick={() => mediaInput.current?.click()}
                        onClear={() => setMediaUrl("")}
                      />
                      <input
                        ref={mediaInput}
                        type="file"
                        accept="image/*,video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void upload(file, "media");
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <p className="rounded-2xl border border-border/60 bg-muted/30 p-3.5 text-[12.5px] leading-relaxed text-foreground">
                        {data.stepTwoNote ||
                          "علّق على منشور الإنستغرام المثبّت، ثم أرفق صورة تعليقك."}
                      </p>

                      {data.instagramPostUrl ? (
                        <a
                          href={data.instagramPostUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpenedInstagram(true)}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-3.5 text-[13px] font-bold text-white shadow-sm transition-transform active:scale-[0.98]"
                        >
                          <Instagram className="h-4 w-4" />
                          <span>افتح المنشور وعلّق عليه</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                        </a>
                      ) : (
                        /*
                          No invented link. An admin has not set the post yet,
                          and sending the customer to a guess would make the
                          proof impossible to check.
                        */
                        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
                          لم تُحدَّد بعد رابط المنشور المثبّت. راسل الدعم ليزوّدك به.
                        </p>
                      )}

                      {openedInstagram ? (
                        <motion.p
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={SETTLE}
                          className="text-[11.5px] leading-relaxed text-muted-foreground"
                        >
                          بعد نشر تعليقك، التقط صورة للشاشة تظهر فيها تعليقك وأرفقها هنا.
                        </motion.p>
                      ) : null}

                      <Attachment
                        label="أرفق صورة تعليقك على المنشور"
                        url={proofUrl}
                        busy={busy === "proof"}
                        progress={progress}
                        onPick={() => proofInput.current?.click()}
                        onClear={() => setProofUrl("")}
                      />
                      <input
                        ref={proofInput}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void upload(file, "proof");
                        }}
                      />

                      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                        بعد موافقة الإدارة يصلك كود خصم ١٠٠٠ دينار صالح ٧ أيام. الكود مرة واحدة كل
                        أسبوع لكل عميل.
                      </p>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {data && !done && !alreadyIn && !alreadyApproved ? (
            <footer className="shrink-0 border-t border-border/60 bg-muted/20 px-5 py-3.5">
              {step === 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!stepOneReady || Boolean(busy)}
                  className="w-full rounded-2xl bg-foreground px-5 py-3.5 text-[13px] font-bold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
                >
                  التالي
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!stepTwoReady || Boolean(busy)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3.5 text-[13px] font-bold text-amber-950 transition-transform active:scale-[0.98] disabled:opacity-40"
                >
                  {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إرسال للموافقة
                </button>
              )}
            </footer>
          ) : null}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/** One attachment slot, with its own preview so nothing is uploaded blind. */
function Attachment({
  label,
  url,
  busy,
  progress,
  onPick,
  onClear,
}: {
  label: string;
  url: string;
  busy: boolean;
  progress: number;
  onPick: () => void;
  onClear: () => void;
}) {
  if (url) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
        {isVideoUrl(url) ? (
          <video
            src={url}
            className="h-14 w-14 shrink-0 rounded-xl object-cover"
            muted
            playsInline
          />
        ) : (
          <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        )}
        <span className="min-w-0 flex-1 text-[12px] font-bold text-emerald-800 dark:text-emerald-300">
          تم الإرفاق
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full p-1.5 text-muted-foreground transition-transform active:scale-90 hover:bg-muted hover:text-foreground"
          aria-label="إزالة المرفق"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-[12.5px] font-bold text-muted-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {/* A real percentage, because a spinner alone says nothing on a slow phone. */}
          <span>{progress > 0 ? `${progress}%` : "جارٍ الرفع..."}</span>
        </>
      ) : (
        <>
          <Camera className="h-4 w-4" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

function SubmittedState({ approved }: { approved: boolean }) {
  return (
    <div className="space-y-3 py-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={ARRIVE}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-9 w-9" />
      </motion.div>
      <h3 className="text-[15px] font-black tracking-[-0.01em] text-foreground">
        {approved ? "تمت الموافقة على تقييمك" : "وصل تقييمك"}
      </h3>
      <p className="mx-auto max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">
        {approved
          ? "شكراً لك. إن كنت مؤهلاً هذا الأسبوع فقد وصلك كود الخصم في محادثتك."
          : "بانتظار موافقة الإدارة. بعدها يصلك كود خصم ١٠٠٠ دينار صالح ٧ أيام — مرة واحدة كل أسبوع لكل عميل."}
      </p>
    </div>
  );
}

export default OrderReviewSheet;
