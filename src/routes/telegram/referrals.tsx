import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { Users, Copy, Share2, Award } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/telegram/referrals")({
  component: ReferralsCenter,
});

function ReferralsCenter() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setUser(res.user);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  const referralLink = `https://banan.to/?ref=${user?.id || "demo"}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
  };

  const handleShare = () => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("سجل في بنانا ستور واحصل على خصومات حصرية!")}`;
      tg.openTelegramLink?.(shareUrl);
    }
  };

  if (loading) {
    return (
      <TelegramLayout title="نظام الإحالة">
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      </TelegramLayout>
    );
  }

  return (
    <TelegramLayout title="نظام الإحالة">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Hero Card */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[24px] p-6 shadow-lg text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10" />

          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-white/30 backdrop-blur-sm">
            <Users className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-black text-white mb-2">ادعُ أصدقاءك واربح!</h2>
          <p className="text-sm font-bold text-indigo-100">
            احصل على 5% كاش باك من أول طلب لكل صديق يسجل عن طريقك
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">الأصدقاء المسجلين</p>
            <p className="text-2xl font-black text-[var(--ink-base)]">0</p>
          </div>
          <div className="bg-surface-3 p-4 rounded-[20px] border border-line-2 text-center">
            <p className="text-xs font-bold text-[var(--ink-mute)] mb-1">إجمالي الأرباح</p>
            <p className="text-2xl font-black text-green-600">
              0 <span className="text-sm font-bold">ر.س</span>
            </p>
          </div>
        </div>

        {/* Share Section */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-2">
          رابط الدعوة الخاص بك
        </h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 p-4 flex flex-col gap-3">
          <div className="bg-surface-2 px-4 py-3 rounded-xl border border-line-2 overflow-hidden flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--ink-soft)] truncate font-mono" dir="ltr">
              {referralLink}
            </span>
            <button
              onClick={handleCopy}
              className="p-2 -mr-2 bg-surface-3 rounded-lg hover:bg-surface-4 active:scale-95 transition-all shadow-sm border border-line-2"
            >
              <Copy className="w-4 h-4 text-[var(--ink-base)]" />
            </button>
          </div>

          <button
            onClick={handleShare}
            className="w-full bg-[#0088cc] text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-sm"
          >
            <Share2 className="w-5 h-5" />
            <span>مشاركة عبر تلغرام</span>
          </button>
        </div>

        {/* Rewards Info */}
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
              <span>شارك الرابط مع أصدقائك عبر أي منصة</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>عندما يسجل صديقك باستخدام الرابط، سيتم ربط حسابه بحسابك</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">•</span>
              <span>بمجرد إتمام صديقك لطلبه الأول، ستحصل على رصيد تلقائياً في محفظتك</span>
            </li>
          </ul>
        </div>
      </div>
    </TelegramLayout>
  );
}
