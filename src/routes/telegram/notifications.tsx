import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Bell, ShieldAlert, ShoppingBag, Gift, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/telegram/notifications")({
  component: NotificationsCenter,
});

function NotificationsCenter() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    orders: true,
    security: true,
    promotions: false,
    messages: true,
  });

  useEffect(() => {
    // In a real app, fetch actual notification settings here
    // api.getNotificationSettings().then...
    setTimeout(() => setLoading(false), 500);
  }, []);

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
    // api.updateNotificationSettings({ [key]: !settings[key] })
  };

  if (loading) {
    return (
      <TelegramLayout title="الإشعارات">
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-[var(--brand-red)] border-t-transparent rounded-full animate-spin" />
        </div>
      </TelegramLayout>
    );
  }

  return (
    <TelegramLayout title="الإشعارات">
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-surface-2 rounded-[24px] p-6 border-2 border-line-2 shadow-sm text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-amber-500/20">
            <Bell className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-black text-[var(--ink-base)] mb-1">تفضيلات الإشعارات</h2>
          <p className="text-sm font-bold text-[var(--ink-soft)]">
            تحكم في الرسائل التي تصلك عبر بوت تلغرام
          </p>
        </div>

        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden">
          <div className="w-full flex items-center justify-between p-4 border-b border-line-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center border border-green-500/20">
                <ShoppingBag className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">تحديثات الطلبات</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">
                  حالة الدفع وتسليم المنتجات
                </p>
              </div>
            </div>
            <button
              onClick={() => toggleSetting("orders")}
              className={`w-12 h-6 rounded-full transition-colors relative ${settings.orders ? "bg-green-500" : "bg-line-2"}`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${settings.orders ? "left-0.5" : "left-[26px]"}`}
              />
            </button>
          </div>

          <div className="w-full flex items-center justify-between p-4 border-b border-line-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--brand-red)]/10 flex items-center justify-center border border-[var(--brand-red)]/20">
                <ShieldAlert className="w-5 h-5 text-[var(--brand-red)]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">تنبيهات الأمان</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">
                  تسجيل الدخول وتغيير كلمة المرور
                </p>
              </div>
            </div>
            <button
              className={`w-12 h-6 rounded-full transition-colors relative bg-[var(--brand-red)] opacity-50 cursor-not-allowed`}
              disabled
            >
              <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 left-0.5`} />
            </button>
          </div>

          <div className="w-full flex items-center justify-between p-4 border-b border-line-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                <Gift className="w-5 h-5 text-purple-500" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">العروض والمسابقات</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">
                  خصومات وتنبيهات المسابقات الجديدة
                </p>
              </div>
            </div>
            <button
              onClick={() => toggleSetting("promotions")}
              className={`w-12 h-6 rounded-full transition-colors relative ${settings.promotions ? "bg-green-500" : "bg-line-2"}`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${settings.promotions ? "left-0.5" : "left-[26px]"}`}
              />
            </button>
          </div>

          <div className="w-full flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0088cc]/10 flex items-center justify-center border border-[#0088cc]/20">
                <MessageSquare className="w-5 h-5 text-[#0088cc]" />
              </div>
              <div className="text-right">
                <p className="font-bold text-[var(--ink-base)] text-sm">رسائل الدعم الفني</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">ردود خدمة العملاء</p>
              </div>
            </div>
            <button
              onClick={() => toggleSetting("messages")}
              className={`w-12 h-6 rounded-full transition-colors relative ${settings.messages ? "bg-green-500" : "bg-line-2"}`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${settings.messages ? "left-0.5" : "left-[26px]"}`}
              />
            </button>
          </div>
        </div>

        <p className="text-xs font-bold text-[var(--ink-mute)] text-center pt-2">
          ملاحظة: لا يمكن إيقاف تنبيهات الأمان حفاظاً على حسابك.
        </p>
      </div>
    </TelegramLayout>
  );
}
