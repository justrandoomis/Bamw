import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Clock,
  Copy,
  Gift,
  Loader2,
  Share2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/context/CurrencyContext";

/**
 * "دعوة صديق" — the member's own referral page.
 *
 * Shows their code, their link, and what the programme has earned them. It
 * deliberately shows *no* information about the friends themselves: counts and
 * totals only, never a name, a handle, an order or a game. What a friend
 * bought is the friend's business, and a page that lists it is a page that
 * leaks it to anyone looking over a shoulder.
 */

export const Route = createFileRoute("/refer")({
  head: () => ({
    meta: [
      { title: "دعوة صديق — بنانتو" },
      {
        name: "description",
        content: "شارك رابط دعوتك واحصل على رصيد في محفظتك عن كل صديق يكمل أول عملية شراء.",
      },
      { property: "og:title", content: "دعوة صديق — بنانتو" },
    ],
  }),
  component: ReferPage,
});

interface ReferralPayload {
  terms: {
    enabled: boolean;
    buyerPercent: number;
    referrerPercent: number;
    linkTtlDays: number;
    firstPurchaseOnly: boolean;
    stackWithCoupon: boolean;
    maxRewardIqd: number;
  };
  share: { code: string; alias: string | null; link: string } | null;
  stats: {
    invites: number;
    completed: number;
    pendingIqd: number;
    approvedIqd: number;
    reversedIqd: number;
    totalEarnedIqd: number;
  } | null;
}

function StatCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const tones = {
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  } as const;
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="truncate text-[11px] font-bold">{label}</span>
      </div>
      <p className={`truncate text-lg font-black ${tones[tone]}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

function ReferPage() {
  const { user, isLoading } = useAuth();
  const { formatIQDPrice } = useCurrency();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const { data, isLoading: loadingReferral } = useQuery<ReferralPayload>({
    queryKey: ["referral-page"],
    queryFn: async () => {
      const res = await fetch("/api/referral", { credentials: "include" });
      if (!res.ok) throw new Error("referral_unavailable");
      return (await res.json()) as ReferralPayload;
    },
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const copy = async (value: string, what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
      toast.success(what === "code" ? "تم نسخ الكود" : "تم نسخ الرابط");
    } catch {
      toast.error("تعذر النسخ، انسخ الرابط يدوياً");
    }
  };

  const share = async () => {
    const link = data?.share?.link;
    if (!link) return;
    const text = `انضم إلى بنانتو عبر رابط دعوتي واحصل على خصم ${data?.terms.buyerPercent ?? 10}% على أول لعبة`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "دعوة صديق — بنانتو", text, url: link });
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
      }
    }
    await copy(link, "link");
  };

  if (isLoading || (loadingReferral && user)) {
    return (
      <AppShell currentView="profile">
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-red)]" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell currentView="profile">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <Gift className="h-12 w-12 text-emerald-500" />
          <h1 className="text-xl font-black text-foreground">دعوة صديق</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            سجّل الدخول للحصول على رابط دعوتك الخاص، واربح رصيداً في محفظتك عن كل صديق يكمل أول
            عملية شراء.
          </p>
          <a
            href="/auth"
            className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white transition hover:opacity-90"
          >
            تسجيل الدخول
          </a>
        </div>
      </AppShell>
    );
  }

  const terms = data?.terms;
  const stats = data?.stats;
  const shareInfo = data?.share;

  if (terms && !terms.enabled) {
    return (
      <AppShell currentView="profile">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <Gift className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-black text-foreground">دعوة صديق</h1>
          <p className="text-sm text-muted-foreground">
            برنامج الإحالة متوقف مؤقتاً. سنعلن عند عودته.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentView="profile">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-28 pt-5" dir="rtl">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
            <Gift className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-foreground">دعوة صديق</h1>
            <p className="truncate text-[12px] text-muted-foreground">
              اربح {terms?.referrerPercent ?? 10}% رصيداً عن كل صديق يكمل أول عملية شراء
            </p>
          </div>
        </header>

        {/* The code and the link */}
        <section className="space-y-3 rounded-3xl border border-border/70 bg-card p-4">
          <div>
            <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">كود الإحالة</p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-black tracking-widest text-foreground"
                dir="ltr"
              >
                {shareInfo?.code ?? "—"}
              </code>
              <button
                type="button"
                id="referral-copy-code-btn"
                onClick={() => shareInfo?.code && copy(shareInfo.code, "code")}
                disabled={!shareInfo?.code}
                aria-label="نسخ الكود"
                className="shrink-0 rounded-xl border border-border p-2.5 text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {copied === "code" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold text-muted-foreground">رابط الدعوة العام</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareInfo?.link ?? ""}
                dir="ltr"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-[12px] text-foreground outline-none"
              />
              <button
                type="button"
                id="referral-copy-link-btn"
                onClick={() => shareInfo?.link && copy(shareInfo.link, "link")}
                disabled={!shareInfo?.link}
                aria-label="نسخ الرابط"
                className="shrink-0 rounded-xl border border-border p-2.5 text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {copied === "link" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            id="referral-share-page-btn"
            onClick={() => void share()}
            disabled={!shareInfo?.link}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            مشاركة الرابط
          </button>
        </section>

        {/* The totals */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <StatCard
            icon={<Users className="h-3.5 w-3.5" />}
            label="عدد الدعوات"
            value={String(stats?.invites ?? 0)}
          />
          <StatCard
            icon={<Check className="h-3.5 w-3.5" />}
            label="الدعوات المكتملة"
            value={String(stats?.completed ?? 0)}
            tone="good"
          />
          <StatCard
            icon={<Clock className="h-3.5 w-3.5" />}
            label="مكافآت معلقة"
            value={formatIQDPrice(stats?.pendingIqd ?? 0)}
            tone="warn"
          />
          <StatCard
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="مكافآت معتمدة"
            value={formatIQDPrice(stats?.approvedIqd ?? 0)}
            tone="good"
          />
          <StatCard
            icon={<XCircle className="h-3.5 w-3.5" />}
            label="مكافآت ملغاة"
            value={formatIQDPrice(stats?.reversedIqd ?? 0)}
            tone="bad"
          />
          <StatCard
            icon={<Gift className="h-3.5 w-3.5" />}
            label="إجمالي الرصيد المكتسب"
            value={formatIQDPrice(stats?.totalEarnedIqd ?? 0)}
            tone="good"
          />
        </section>

        {/* The terms, in plain language */}
        <section className="rounded-3xl border border-border/70 bg-card p-4">
          <h2 className="mb-2.5 text-sm font-black text-foreground">الشروط</h2>
          <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
            <li>
              • يحصل صديقك على خصم {terms?.buyerPercent ?? 10}% وتحصل أنت على{" "}
              {terms?.referrerPercent ?? 10}% رصيداً في المحفظة.
            </li>
            <li>• تُحتسب المكافأة من السعر الأصلي للعبة قبل الخصم.</li>
            <li>• الخصم يعمل على الألعاب بحساب أوفلاين فقط (عادي أو مع الإضافات).</li>
            {terms?.firstPurchaseOnly ? (
              <li>• تُحتسب الإحالة على أول عملية شراء مكتملة لكل صديق.</li>
            ) : null}
            {terms && !terms.stackWithCoupon ? (
              <li>• لا تُجمع الإحالة مع كوبون خصم آخر — يُطبَّق الأفضل لك.</li>
            ) : null}
            <li>• صلاحية رابط الدعوة {terms?.linkTtlDays ?? 30} يوماً من فتحه.</li>
            {terms?.maxRewardIqd ? (
              <li>• الحد الأقصى للمكافأة {formatIQDPrice(terms.maxRewardIqd)} لكل إحالة.</li>
            ) : null}
            <li>• تُضاف المكافأة كرصيد متجر بعد إكمال الطلب، وتُلغى إذا أُلغي الطلب أو استُرجع.</li>
            <li>
              • لا تُحتسب الإحالة بين حسابين لنفس الشخص أو على نفس الجهاز أو نفس الاتصال.
            </li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
