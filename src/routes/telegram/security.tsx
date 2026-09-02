import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Shield, Smartphone, Mail, KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/telegram/security")({
  component: SecurityCenter,
});

function SecurityCenter() {
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

  if (loading) {
    return (
      <TelegramLayout title="مركز الأمان">
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      </TelegramLayout>
    );
  }

  return (
    <TelegramLayout title="مركز الأمان">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Security Score Card */}
        <div className="bg-surface-2 rounded-[24px] p-6 border-2 border-line-2 shadow-sm text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />

          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-green-500/20">
            <Shield className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-black text-[var(--ink-base)] mb-1">حالة الأمان جيدة</h2>
          <p className="text-sm font-bold text-[var(--ink-soft)]">حسابك محمي بخطوات أمان متعددة</p>
        </div>

        {/* Security Settings List */}
        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden">
          {/* Password */}
          <button className="w-full flex items-center justify-between p-4 border-b border-line-2 hover:bg-surface-4 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center border border-line-2">
                <KeyRound className="w-5 h-5 text-[var(--ink-base)]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">كلمة المرور</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">تغيير كلمة المرور</p>
              </div>
            </div>
            <div className="w-2 h-2 rounded-full bg-line-2" />
          </button>

          {/* Telegram Linking */}
          <div className="w-full flex items-center justify-between p-4 border-b border-line-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0088cc]/10 flex items-center justify-center border border-[#0088cc]/20">
                <span className="text-xl">✈️</span>
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">ربط تلغرام</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">يستخدم للمصادقة السريعة</p>
              </div>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>

          {/* Active Sessions */}
          <button className="w-full flex items-center justify-between p-4 hover:bg-surface-4 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center border border-line-2">
                <Smartphone className="w-5 h-5 text-[var(--ink-base)]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">الأجهزة المتصلة</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">إدارة الجلسات النشطة</p>
              </div>
            </div>
            <div className="w-2 h-2 rounded-full bg-line-2" />
          </button>
        </div>

        {/* Verification Status */}
        <h3 className="font-black text-[var(--ink-soft)] text-sm px-2 pt-2">طرق التحقق</h3>
        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden">
          {/* Phone */}
          <div className="w-full flex items-center justify-between p-4 border-b border-line-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center border border-line-2">
                <Smartphone className="w-5 h-5 text-[var(--ink-base)]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">رقم الهاتف</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]" dir="ltr">
                  {user?.phone}
                </p>
              </div>
            </div>
            {user?.phoneVerifiedAt ? (
              <span className="text-xs font-bold bg-green-500/10 text-green-600 px-2 py-1 rounded-md">
                موثق
              </span>
            ) : (
              <span className="text-xs font-bold bg-amber-500/10 text-amber-600 px-2 py-1 rounded-md">
                غير موثق
              </span>
            )}
          </div>

          {/* Email */}
          <div className="w-full flex items-center justify-between p-4 hover:bg-surface-4 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center border border-line-2">
                <Mail className="w-5 h-5 text-[var(--ink-base)]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">البريد الإلكتروني</p>
                <p className="text-xs font-bold text-[var(--ink-mute)] line-clamp-1">
                  {user?.email || "غير محدد"}
                </p>
              </div>
            </div>
            {user?.emailVerifiedAt ? (
              <span className="text-xs font-bold bg-green-500/10 text-green-600 px-2 py-1 rounded-md">
                موثق
              </span>
            ) : (
              <span className="text-xs font-bold bg-amber-500/10 text-amber-600 px-2 py-1 rounded-md">
                غير موثق
              </span>
            )}
          </div>
        </div>
      </div>
    </TelegramLayout>
  );
}
