import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, BellOff, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { releaseDayISO } from "@/lib/release";

/**
 * What a customer gets instead of a buy button before a game is out.
 *
 * The store used to sell these: a pre-order is an ordinary priced product with
 * a future release date, and nothing refused the order — so money changed
 * hands for a game nobody could hand over. The customer registers here and is
 * written to on release day; the product starts selling itself at the same
 * moment, because the gate reads the date on every request rather than waiting
 * for anyone to flip a switch.
 */

interface Alert {
  productId: string;
  productTitle: string;
  releaseDate: string | null;
}

/** Formats the release day in Arabic, falling back to the raw value. */
function formatReleaseDay(iso: string | null, lang: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ReleaseAlertPanel({
  product,
  lang = "ar",
}: {
  product: Record<string, unknown>;
  lang?: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const productId = String(product?.["id"] ?? "");
  const releaseDate = releaseDayISO(product);

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["release_alerts"],
    queryFn: async () => {
      const res = await fetch("/api/release-alerts", { credentials: "include" });
      if (!res.ok) return [];
      return ((await res.json()).alerts || []) as Alert[];
    },
    // A signed-out visitor has no list to fetch; the panel asks them to sign in.
    enabled: Boolean(user),
  });

  const registered = Boolean(alerts?.some((a) => String(a.productId) === productId));

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await fetch("/api/release-alerts", {
        method: next ? "POST" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "failed");
      }
      return next;
    },
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ["release_alerts"] });
      toast.success(
        next
          ? "تم تسجيلك — سنخبرك فور صدور اللعبة"
          : "تم إلغاء التنبيه",
      );
    },
    onError: () => toast.error("تعذر حفظ التنبيه، حاول مرة أخرى"),
  });

  return (
    <div className="rounded-2xl border border-amber-300/50 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <CalendarClock className="h-4 w-4 shrink-0" />
        <span className="text-sm font-bold">
          {releaseDate
            ? `تصدر في ${formatReleaseDay(releaseDate, lang)}`
            : "لم تصدر بعد"}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        هذه اللعبة لم تصدر بعد، لذلك لا يمكن شراؤها الآن. سجّل اهتمامك وسنرسل لك
        تنبيهاً فور صدورها، ويصبح الشراء متاحاً تلقائياً في نفس اللحظة.
      </p>

      {user ? (
        <button
          type="button"
          onClick={() => toggle.mutate(!registered)}
          disabled={toggle.isPending || !productId}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
            registered
              ? "border border-amber-400/60 bg-transparent text-amber-700 hover:bg-amber-100/60 dark:text-amber-300 dark:hover:bg-amber-500/10"
              : "bg-amber-500 text-white hover:opacity-90"
          }`}
        >
          {toggle.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : registered ? (
            <BellOff className="h-4 w-4" />
          ) : (
            <BellRing className="h-4 w-4" />
          )}
          {registered ? "أنت مسجّل — إلغاء التنبيه" : "سجّل مسبقاً وفعّل التنبيه"}
        </button>
      ) : (
        <a
          href="/auth"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-bold text-white shadow-sm transition hover:opacity-90"
        >
          <BellRing className="h-4 w-4" />
          سجّل الدخول لتفعيل التنبيه
        </a>
      )}
    </div>
  );
}

export default ReleaseAlertPanel;
