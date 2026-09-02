import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { Trophy, Gift, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/telegram/contests")({
  component: ContestsCenter,
});

function ContestsCenter() {
  // Mock data for current/past contests
  const activeContest = {
    title: "سحب على ننتندو سويتش OLED",
    endDate: "2024-12-31",
    entries: 1450,
    yourTickets: 2,
  };

  return (
    <TelegramLayout title="المسابقات">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Active Contest Banner */}
        <div className="bg-gradient-to-br from-[var(--brand-red)] to-rose-600 rounded-[24px] p-6 shadow-lg text-center relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-white/30 backdrop-blur-sm relative z-10">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-black text-white mb-2 relative z-10">المسابقات الحالية</h2>
          <p className="text-sm font-bold text-rose-100 relative z-10">
            شارك في السحوبات واربح جوائز قيمة!
          </p>
        </div>

        {/* Current Active Contest */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-2">السحب القادم</h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden flex flex-col">
          <div className="p-5 border-b border-line-2">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                <div className="bg-[var(--brand-red)] text-white text-[10px] font-black px-2 py-1 rounded-md tracking-wider">
                  نشط الآن
                </div>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-[var(--ink-mute)]">ينتهي في</p>
                <p className="text-xs font-black text-[var(--brand-red)]" dir="ltr">
                  {activeContest.endDate}
                </p>
              </div>
            </div>

            <h4 className="text-lg font-black text-[var(--ink-base)] mb-1">
              {activeContest.title}
            </h4>
            <p className="text-sm font-bold text-[var(--ink-soft)] line-clamp-2">
              كل طلب بقيمة 100 ريال يمنحك تذكرة دخول واحدة في السحب الكبير!
            </p>
          </div>

          <div className="bg-surface-2 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white w-10 h-10 rounded-xl flex items-center justify-center border border-line-2 shadow-sm">
                <span className="text-lg font-black text-[var(--ink-base)]">
                  {activeContest.yourTickets}
                </span>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--ink-mute)]">عدد تذاكرك</p>
                <p className="text-sm font-black text-[var(--ink-base)]">فرصة الفوز: جيدة</p>
              </div>
            </div>
            <button className="bg-[var(--brand-red)] text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-md active:scale-95 transition-all">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Past Winners */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-4">الفائزون السابقون</h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 p-2">
          <div className="flex items-center gap-4 p-3 hover:bg-surface-4 rounded-xl transition-colors">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center border-2 border-line-2 shrink-0">
              <span className="text-xl">🏆</span>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="font-bold text-[var(--ink-base)] text-sm truncate">أحمد العتيبي</p>
              <p className="text-xs font-bold text-[var(--ink-mute)] truncate">
                فاز بـ: حساب زيلدا تيرز أوف كينجدوم
              </p>
            </div>
            <div className="text-left shrink-0">
              <p className="text-xs font-bold text-[var(--ink-soft)]">نوفمبر 2024</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 hover:bg-surface-4 rounded-xl transition-colors">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center border-2 border-line-2 shrink-0">
              <span className="text-xl">🎁</span>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="font-bold text-[var(--ink-base)] text-sm truncate">M***88</p>
              <p className="text-xs font-bold text-[var(--ink-mute)] truncate">
                فاز بـ: بطاقة متجر 50$
              </p>
            </div>
            <div className="text-left shrink-0">
              <p className="text-xs font-bold text-[var(--ink-soft)]">أكتوبر 2024</p>
            </div>
          </div>
        </div>
      </div>
    </TelegramLayout>
  );
}
