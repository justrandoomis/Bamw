import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Instagram, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { isVideoUrl } from "@/lib/uploads";

/**
 * The submissions waiting for a person, and the decision itself.
 *
 * A code is money, so nothing here is automatic. The card shows what the
 * customer actually sent — every product the review covers, their words, the
 * delivery attachment, and the screenshot of their Instagram comment — because
 * approving without seeing the proof is the same as not asking for it.
 */

export interface ReviewGroup {
  groupId: string;
  userId: string;
  userName: string | null;
  orderId: string | null;
  orderCode: string | null;
  rating: number;
  comment: string;
  screenshotUrl: string | null;
  instagramProofUrl: string | null;
  status: string;
  createdAt: string;
  products: {
    reviewId: string;
    productId: string;
    title: string | null;
    imageUrl: string | null;
  }[];
}

interface DecisionResponse {
  ok?: boolean;
  reward?: { code: string; amountIqd: number; expiresAt: string } | null;
  cooldown?: { lastIssuedAt: string; nextEligibleAt: string } | null;
}

const shortDate = (iso: string) => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

export function ReviewApprovalPanel() {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-review-submissions"],
    queryFn: () =>
      api.fetch<{ groups: ReviewGroup[]; count: number }>("/api/admin/review-submissions"),
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: (input: { groupId: string; action: "approve" | "reject"; reason?: string }) =>
      api.fetch<DecisionResponse>("/api/admin/review-submissions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-review-submissions"] });
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
      setRejecting(null);
      setReason("");
      if (variables.action === "reject") {
        toast.success("تم رفض التقييم وإبلاغ العميل بالسبب");
        return;
      }
      if (result.reward?.code) {
        toast.success(`تمت الموافقة. كود العميل: ${result.reward.code}`);
        return;
      }
      if (result.cooldown?.nextEligibleAt) {
        /*
          Approved, published, and no code — because the customer already had
          one this week. Saying so is the difference between the admin trusting
          the panel and wondering whether it worked.
        */
        toast.warning(
          `تمت الموافقة بدون كود: حصل العميل على كود خلال آخر ٧ أيام. يستحق مجدداً في ${shortDate(
            result.cooldown.nextEligibleAt,
          )}`,
        );
        return;
      }
      toast.success("تمت الموافقة على التقييم");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "تعذر تنفيذ الإجراء");
    },
  });

  const groups = data?.groups ?? [];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
        <Star className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs font-bold">لا توجد تقييمات بحاجة إلى موافقة</p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground/70">
          يصل التقييم هنا بعد أن يكتب العميل رأيه ويرفق صورة تعليقه على منشور الإنستغرام.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3" dir="rtl">
      {groups.map((group) => {
        const busy = decide.isPending && decide.variables?.groupId === group.groupId;
        return (
          <article
            key={group.groupId}
            className="space-y-3 rounded-2xl border border-border bg-card p-3.5 shadow-xs"
          >
            <header className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
              <div className="min-w-0">
                <h3 className="truncate text-xs font-bold text-foreground">
                  {group.userName || "عميل"}
                </h3>
                <p className="font-mono text-[10px] text-muted-foreground">
                  #{group.orderCode || "—"} • {shortDate(group.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-3.5 w-3.5 ${
                      star <= group.rating
                        ? "fill-amber-400 text-amber-400"
                        : "fill-muted text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
            </header>

            {/* Every product the one review covers. */}
            <ul className="flex flex-wrap gap-1.5">
              {group.products.map((product) => (
                <li
                  key={product.productId}
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1"
                >
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-5 w-5 rounded object-cover"
                    />
                  ) : null}
                  <span className="max-w-40 truncate text-[10.5px] font-bold text-foreground">
                    {product.title || product.productId}
                  </span>
                </li>
              ))}
            </ul>

            <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-2.5 text-[11.5px] leading-relaxed text-foreground">
              {group.comment || "—"}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Evidence label="التسليم" url={group.screenshotUrl} />
              <Evidence label="تعليق إنستغرام" url={group.instagramProofUrl} instagram />
            </div>

            {rejecting === group.groupId ? (
              <div className="space-y-2">
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value.slice(0, 300))}
                  rows={2}
                  placeholder="سبب الرفض — يُعرض للعميل"
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[11.5px] leading-relaxed text-start outline-none focus:border-red-500/60"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRejecting(null);
                      setReason("");
                    }}
                    className="flex-1 rounded-xl border border-border px-3 py-2 text-[11.5px] font-bold text-muted-foreground cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={reason.trim().length < 3 || busy}
                    onClick={() =>
                      decide.mutate({
                        groupId: group.groupId,
                        action: "reject",
                        reason: reason.trim(),
                      })
                    }
                    className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-40 cursor-pointer"
                  >
                    تأكيد الرفض
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejecting(group.groupId)}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11.5px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" /> رفض
                </button>
                <button
                  type="button"
                  onClick={() => decide.mutate({ groupId: group.groupId, action: "approve" })}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-40 cursor-pointer"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  موافقة وإصدار الكود
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** One attachment, opened full size in a new tab — a card is too small to judge a screenshot. */
function Evidence({
  label,
  url,
  instagram = false,
}: {
  label: string;
  url: string | null;
  instagram?: boolean;
}) {
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border text-[10.5px] font-bold text-muted-foreground">
        لا يوجد {label}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block h-24 overflow-hidden rounded-xl border border-border"
    >
      {isVideoUrl(url) ? (
        <video src={url} className="h-full w-full object-cover" muted playsInline />
      ) : (
        <img src={url} alt={label} loading="lazy" className="h-full w-full object-cover" />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
        {instagram ? <Instagram className="h-3 w-3" /> : null}
        {label}
      </span>
    </a>
  );
}

export default ReviewApprovalPanel;
