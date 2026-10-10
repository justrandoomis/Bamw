import { useEffect, useState } from "react";
import { Star, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ReviewAspect, UserReview } from "@/hub/types";
import { Modal } from "@/hub/ui/Modal";
import { useI18n } from "@/hub/i18n";
import { useNotifications } from "@/hub/context/NotificationContext";
import { useUser } from "@/hub/context/UserContext";
import { playSound } from "@/hub/utils/audio";
import { cn } from "@/hub/utils/cn";

/**
 * Review composer.
 *
 * Restores the review modal the original page declared but never rendered, and
 * collects the per-aspect scores the summary already displays — otherwise the
 * aspect averages could only ever come from seeded data.
 *
 * The draft is handed back through `onSubmit` so the caller decides where it
 * goes; nothing is written to the record here.
 */
export function ReviewComposer({
  open,
  gameTitle,
  gameSlug,
  onClose,
  onSubmit,
}: {
  open: boolean;
  gameTitle: string;
  gameSlug: string;
  onClose: () => void;
  onSubmit: (review: UserReview) => void;
}) {
  const { t } = useI18n();
  const { addNotification } = useNotifications();
  const { purchased } = useUser();

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recommended, setRecommended] = useState<boolean | null>(null);
  const [aspects, setAspects] = useState<Partial<Record<ReviewAspect, number>>>({});

  useEffect(() => {
    if (!open) return;
    setRating(0);
    setTitle("");
    setBody("");
    setRecommended(null);
    setAspects({});
  }, [open]);

  const aspectRows: Array<{ key: ReviewAspect; label: string }> = [
    { key: "gameplay", label: t("verdict.gameplay") },
    { key: "story", label: t("verdict.story") },
    { key: "graphics", label: t("verdict.graphics") },
    { key: "performance", label: t("verdict.performance") },
    { key: "value", label: t("verdict.value") },
  ];

  const valid = rating > 0 && body.trim().length >= 10;

  const submit = () => {
    if (!valid) return;
    const review: UserReview = {
      id: `local_${Date.now()}`,
      author: { id: "me", name: "You" },
      rating,
      ...(title.trim() ? { title: title.trim() } : {}),
      body: body.trim(),
      createdAt: new Date().toISOString(),
      ...(Object.keys(aspects).length > 0 ? { aspects } : {}),
      ...(recommended === null ? {} : { recommended }),
      // Only claim a verified purchase when the account actually has one.
      verifiedPurchase: purchased.includes(gameSlug),
      helpfulCount: 0,
    };
    onSubmit(review);
    playSound("confirm");
    onClose();
    addNotification({ title: t("reviews.submitted"), message: gameTitle, type: "success" });
  };

  return (
    <Modal open={open} onClose={onClose} title={t("reviews.writeReview")} size="md">
      {/* Overall rating */}
      <div>
        <p className="eyebrow mb-2">{t("reviews.yourRating")}</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              onClick={() => {
                setRating(value);
                playSound("select");
              }}
              aria-label={`${value} / 5`}
              aria-pressed={rating === value}
              className="rounded-lg p-1 transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  "h-7 w-7 transition-colors",
                  value <= rating ? "fill-warn text-warn" : "text-foreground/15",
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Per-aspect scores */}
      <div className="mt-5">
        <p className="eyebrow mb-2">{t("reviews.aspects")}</p>
        <div className="space-y-2">
          {aspectRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3">
              <span className="text-xs muted">{row.label}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => setAspects((current) => ({ ...current, [row.key]: value }))}
                    aria-label={`${row.label} ${value}`}
                    className={cn(
                      "h-6 w-6 rounded-md text-[10px] font-bold transition-colors",
                      (aspects[row.key] ?? 0) >= value
                        ? "bg-warn/25 text-warn"
                        : "bg-muted/50 muted hover:bg-muted/60",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Title + body */}
      <label className="mt-5 block">
        <span className="eyebrow mb-2 block">{t("reviews.reviewTitle")}</span>
        <input
          data-autofocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={90}
          className="h-11 w-full rounded-xl border border-border/70 bg-muted/50 px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-nin/50"
        />
      </label>

      <label className="mt-4 block">
        <span className="eyebrow mb-2 block">{t("reviews.reviewBody")}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={t("reviews.reviewPlaceholder")}
          className="w-full resize-none rounded-xl border border-border/70 bg-muted/50 p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-nin/50"
        />
      </label>

      {/* Recommendation */}
      <div className="mt-4">
        <p className="eyebrow mb-2">{t("reviews.recommendQuestion")}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setRecommended(true)}
            aria-pressed={recommended === true}
            className={cn(
              "btn h-10 flex-1 text-xs",
              recommended === true ? "border border-good/40 bg-good/15 text-good" : "btn-quiet",
            )}
          >
            <ThumbsUp className="h-4 w-4" />
            {t("common.yes")}
          </button>
          <button
            onClick={() => setRecommended(false)}
            aria-pressed={recommended === false}
            className={cn(
              "btn h-10 flex-1 text-xs",
              recommended === false ? "border border-warn/40 bg-warn/15 text-warn" : "btn-quiet",
            )}
          >
            <ThumbsDown className="h-4 w-4" />
            {t("common.no")}
          </button>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!valid}
        className="btn btn-primary mt-6 h-12 w-full text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("community.post")}
      </button>
    </Modal>
  );
}
