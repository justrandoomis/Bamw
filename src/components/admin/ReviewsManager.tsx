import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, EyeOff, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface AdminReview {
  id: string;
  product_id: string;
  user_id: string;
  order_id: string | null;
  rating: number;
  comment: string;
  screenshot_url?: string | null;
  status: string;
  is_buyer?: number | boolean;
  created_at: string;
  user_name?: string | null;
}

/** Admin moderation for member product reviews stored in Cloudflare D1. */
export default function ReviewsManager() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "hidden">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reviews?scope=all", { credentials: "include" });
      if (!res.ok) throw new Error("تعذر تحميل التقييمات");
      const data = (await res.json()) as { reviews?: AdminReview[] };
      setReviews(data.reviews ?? []);
    } catch (error) {
      setReviews([]);
      toast.error(error instanceof Error ? error.message : "تعذر تحميل التقييمات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "hide" | "delete") => {
    const res = await fetch("/api/reviews", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      toast.error(data.message || data.error || "تعذر تحديث التقييم");
      return;
    }
    await load();
  };

  const pendingCount = useMemo(
    () => reviews.filter((r) => r.status === "pending").length,
    [reviews],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return reviews.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!term) return true;
      return `${r.comment} ${r.user_name ?? ""} ${r.product_id}`.toLowerCase().includes(term);
    });
  }, [reviews, query, filter]);

  const average = rows.length
    ? Math.round((rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length) * 10) / 10
    : 0;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث في التقييمات أو اسم المستخدم أو معرف المنتج..."
          className="min-w-[200px] flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm"
        />
        {(
          [
            { id: "pending", label: `بانتظار الموافقة (${pendingCount})` },
            { id: "approved", label: "المنشورة" },
            { id: "hidden", label: "المخفية" },
            { id: "all", label: "الكل" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
              filter === item.id
                ? "bg-[var(--brand-red)] text-white"
                : "border border-border bg-card text-foreground hover:bg-muted/10"
            }`}
          >
            {item.label}
          </button>
        ))}
        <span className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold">
          {rows.length} تقييم · معدل {average} ★
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground p-8 text-center bg-card rounded-2xl border border-border">
          لا توجد تقييمات مطابقة لهذا الفلتر.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-border bg-card p-4 space-y-2 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground text-sm">
                    {r.user_name || r.user_id.slice(0, 8)}
                  </span>
                  {r.is_buyer || r.order_id ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 border border-emerald-500/20">
                      <ShieldCheck className="w-3 h-3" />
                      مشتري موثق
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      عضو
                    </span>
                  )}
                  <span className="rounded-lg bg-[var(--page-2)] px-2 py-0.5 text-[11px] text-muted-foreground">
                    المنتج: {r.product_id}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">
                    {"★".repeat(Math.max(1, Math.min(5, r.rating)))}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("ar")}
                  </span>
                  {r.status === "pending" && (
                    <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-amber-600 font-bold">
                      بانتظار الموافقة
                    </span>
                  )}
                  {r.status === "approved" && (
                    <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-emerald-600 font-bold">
                      منشور
                    </span>
                  )}
                  {r.status === "hidden" && (
                    <span className="rounded-lg bg-red-500/15 px-2 py-0.5 text-red-500 font-bold">
                      مخفي
                    </span>
                  )}
                </div>
              </div>

              <p className="whitespace-pre-wrap text-sm text-foreground bg-[var(--page-2)] p-3 rounded-xl">
                {r.comment || "— لا يوجد تعليق نصي —"}
              </p>

              {r.screenshot_url && (
                <a
                  href={r.screenshot_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-fit overflow-hidden rounded-xl border border-border"
                >
                  <img
                    src={r.screenshot_url}
                    alt="صورة مرفقة بالتقييم"
                    loading="lazy"
                    className="max-h-64 w-auto max-w-full object-contain"
                  />
                </a>
              )}

              <div className="flex gap-2 pt-1">
                {r.status !== "approved" && (
                  <button
                    onClick={() => void act(r.id, "approve")}
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    موافقة ونشر
                  </button>
                )}
                {r.status !== "hidden" && (
                  <button
                    onClick={() => void act(r.id, "hide")}
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-foreground hover:bg-muted/20 active:scale-95 transition-all"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    إخفاء
                  </button>
                )}
                <button
                  onClick={() => void act(r.id, "delete")}
                  className="inline-flex items-center gap-1 rounded-xl bg-red-600/10 text-red-600 px-3.5 py-1.5 text-xs font-bold hover:bg-red-600 hover:text-white active:scale-95 transition-all border border-red-600/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
