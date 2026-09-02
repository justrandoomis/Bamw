import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { User, Copy, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/telegram/account")({
  component: AccountCenter,
});

function AccountCenter() {
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

  const handleCopyId = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      // Optional: show a small toast or visual feedback here
    }
  };

  if (loading) {
    return (
      <TelegramLayout title="حسابي">
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      </TelegramLayout>
    );
  }

  return (
    <TelegramLayout title="حسابي">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Profile Card */}
        <div className="bg-surface-2 rounded-[24px] p-6 border-2 border-line-2 shadow-sm text-center">
          <div className="w-20 h-20 bg-surface-3 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-line-2 relative">
            <User className="w-10 h-10 text-[var(--ink-soft)]" />
            <div className="absolute bottom-0 right-0 w-5 h-5 bg-green-500 rounded-full border-2 border-surface-2" />
          </div>
          <h2 className="text-xl font-black text-[var(--ink-base)] mb-1">
            {user?.name || "مستخدم بنانتو"}
          </h2>

          <div className="inline-flex items-center gap-2 bg-surface-3 px-3 py-1.5 rounded-lg border border-line-2 mt-2">
            <span className="text-xs font-black text-[var(--ink-soft)]">معرف الحساب:</span>
            <span className="text-xs font-bold text-[var(--ink-base)] font-mono" dir="ltr">
              {user?.id?.substring(0, 8)}...
            </span>
            <button
              onClick={handleCopyId}
              className="p-1 hover:bg-surface-4 rounded active:scale-95 transition-all text-[var(--ink-soft)]"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Basic Info */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-2">المعلومات الشخصية</h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden">
          <div className="w-full flex flex-col p-4 border-b border-line-2">
            <span className="text-xs font-bold text-[var(--ink-mute)] mb-1">الاسم الكامل</span>
            <span className="font-bold text-[var(--ink-base)] text-sm">
              {user?.name || "غير محدد"}
            </span>
          </div>

          <div className="w-full flex flex-col p-4 border-b border-line-2">
            <span className="text-xs font-bold text-[var(--ink-mute)] mb-1">رقم الهاتف</span>
            <span className="font-bold text-[var(--ink-base)] text-sm" dir="ltr">
              {user?.phone}
            </span>
          </div>

          <div className="w-full flex flex-col p-4 border-b border-line-2">
            <span className="text-xs font-bold text-[var(--ink-mute)] mb-1">تاريخ التسجيل</span>
            <span className="font-bold text-[var(--ink-base)] text-sm">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString("ar-SA") : "غير معروف"}
            </span>
          </div>
        </div>

        {/* Support */}
        <div className="mt-4">
          <button className="w-full bg-surface-3 text-[var(--ink-base)] py-4 rounded-[20px] font-black border-2 border-line-2 shadow-sm cursor-pointer flex items-center justify-center gap-2 hover:bg-surface-4 active:scale-95 transition-all">
            <HelpCircle className="w-5 h-5 text-[#0088cc]" />
            <span>التواصل مع الدعم الفني</span>
          </button>
        </div>
      </div>
    </TelegramLayout>
  );
}
