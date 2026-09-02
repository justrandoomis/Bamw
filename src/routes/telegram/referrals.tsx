import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Award, Copy, Share2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { TelegramLayout } from "@/components/telegram/TelegramLayout";

/**
 * "دعوة صديق" inside the Telegram Mini App.
 *
 * This screen used to be a mock-up: a link built as `?ref=<user id>` that the
 * server had never heard of, a promise of "5% cash back", counters hard-coded
 * to zero and a total in Saudi riyals. It now reads the same `/api/referral`
 * the storefront page does, so the code, the link and the totals here are the
 * real ones — and the rates come from the programme's settings rather than
 * from a sentence in the markup that nothing kept in step.
 */

export const Route = createFileRoute("/telegram/referrals")({
  component: ReferralsCenter,
});

interface ReferralPayload {
  terms: { enabled: boolean; buyerPercent: number; referrerPercent: number };
  share: { code: string; alias: string | null; link: string } | null;
  stats: {
    invites: number;
    completed: number;
    pendingIqd: number;
    approvedIqd: number;
    totalEarnedIqd: number;
  } | null;
}

const iqd = (value: number) => Number(value || 0).toLocaleString("en-US");

function ReferralsCenter() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<ReferralPayload>({
    queryKey: ["referral-page"],
    queryFn: async () => {
      const res = await fetch("/api/referral", { credentials: "include" });
      if (!res.ok) throw new Error("referral_unavailable");
      return (await res.json()) as ReferralPayload;
    },
    staleTime: 60_000,
  });

  const link = data?.share?.link ?? "";
  const referrerPercent = data?.terms?.referrerPercent ?? 10;
  const buyerPercent = data?.terms?.buyerPercent ?? 10;

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("تم نسخ الرابط");
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  const handleShare = () => {
    if (!link) return;
    const text = `سجل في بنانتو عبر رابط دعوتي واحصل على خصم ${buyerPercent}% على أول لعبة`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    const telegram = window.Telegram?.WebApp;
    if (telegram?.openTelegramLink) telegram.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener");
  };

  if (isLoading) {
    return (
      <TelegramLayout title="دعوة صديق">
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      </TelegramLayout>
    );
  }

  if (data?.terms && !data.terms.enabled) {
    return (
      <TelegramLayout title="دعوة صديق">
        <p className="py-12 text-center text-sm font-bold text-[var(--ink-mute)]">
          برنامج الإحالة متوقف مؤقتاً.
        </p>
      </TelegramLayout>
    );
  }

  return (
    <TelegramLayout title="دعوة صديق">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Hero */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[24px] p-6 shadow-lg text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10" />
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-white/30 backdrop-blur-sm">
            <Users className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-black text-white mb-2">ادعُ أصدقاءك واربح!</h2>
          <p className="text-sm font-bold text-indigo-100">
            صديقك يحصل على خصم {buyerPercent}% وأنت تحصل على {referrerPercent}% رصيداً في محفظتك
          </p>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">الدعوات</p>
            <p className="text-2xl font-black text-[var(--ink-base)]" dir="ltr">
              {data?.stats?.invites ?? 0}
            </p>
          </div>
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">إجمالي الأرباح</p>
            <p className="text-2xl font-black text-green-600" dir="ltr">
              {iqd(data?.stats?.totalEarnedIqd ?? 0)}{" "}
              <span className="text-sm font-bold">د.ع</span>
            </p>
          </div>
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">دعوات مكتملة</p>
            <p className="text-2xl font-black text-[var(--ink-base)]" dir="ltr">
              {data?.stats?.completed ?? 0}
            </p>
          </div>
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">مكافآت معلقة</p>
            <p className="text-2xl font-black text-amber-600" dir="ltr">
              {iqd(data?.stats?.pendingIqd ?? 0)} <span className="text-sm font-bold">د.ع</span>
            </p>
          </div>
        </div>

        {/* Share */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-2">
          رابط الدعوة الخاص بك
        </h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 p-4 flex flex-col gap-3">
          <div className="bg-surface-2 px-4 py-3 rounded-xl border border-line-2 overflow-hidden flex items-center justify-between gap-2">
            <span
              className="min-w-0 flex-1 truncate text-xs font-bold text-[var(--ink-soft)] font-mono"
              dir="ltr"
            >
              {link || "—"}
            </span>
            <button
              onClick={() => void handleCopy()}
              disabled={!link}
              aria-label="نسخ الرابط"
              className="shrink-0 p-2 bg-surface-3 rounded-lg hover:bg-surface-4 active:scale-95 transition-all shadow-sm border border-line-2 disabled:opacity-50"
            >
              <Copy className="w-4 h-4 text-[var(--ink-base)]" />
            </button>
          </div>
          {copied ? (
            <p className="text-[11px] font-bold text-green-600">تم نسخ الرابط</p>
          ) : null}

          <button
            onClick={handleShare}
            disabled={!link}
            className="w-full bg-[#0088cc] text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-sm disabled:opacity-50"
          >
            <Share2 className="w-5 h-5" />
            <span>مشاركة عبر تلغرام</span>
          </button>
        </div>

        {/* How it works */}
        <div className="bg-surface-2 rounded-[24px] border-2 border-line-2 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Award className="w-4 h-4 text-amber-600" />
            </div>
            <h3 className="font-black text-[var(--ink-base)]">كيف يعمل نظام الإحالة؟</h3>
          </div>

          <ul className="space-y-3 text-sm font-bold text-[var(--ink-soft)]">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>شارك الرابط مع أصدقائك عبر أي منصة.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>
                عند فتح صديقك للرابط يُحفظ الإسناد تلقائياً، ويبقى محفوظاً بعد تسجيل الدخول أو
                إنشاء الحساب.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>
                الخصم يعمل على الألعاب بحساب أوفلاين، على أول عملية شراء مكتملة لكل صديق.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>
                تُضاف مكافأتك ({referrerPercent}%) كرصيد متجر بعد إكمال الطلب، وتُلغى إذا أُلغي
                الطلب أو استُرجع.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </TelegramLayout>
  );
}
