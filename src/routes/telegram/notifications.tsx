/**
 * Which messages the member gets, for real.
 *
 * This screen was a mock: four toggles over local component state, a fake
 * half-second spinner, and a comment reading "In a real app, fetch actual
 * notification settings here". A member who turned promotional messages off
 * watched the switch slide across and kept receiving them — and had no way to
 * find out that it had done nothing.
 *
 * It reads and writes the member's own settings now, and every member-facing
 * Telegram send goes through `memberAllowsNotification`, so the switch is a
 * fact about the shop rather than a claim on a screen.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TelegramLayout } from "@/components/telegram/TelegramLayout";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Bell, ShieldAlert, ShoppingBag, Gift, MessageSquare, Check, Loader2 } from "lucide-react";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  readNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notification-preferences";

export const Route = createFileRoute("/telegram/notifications")({
  component: NotificationsCenter,
});

type SwitchableKey = keyof NotificationPreferences;

/** What each switch turns off, said accurately rather than aspirationally. */
const ROWS: {
  key: SwitchableKey;
  title: string;
  detail: string;
  icon: typeof ShoppingBag;
  tint: string;
}[] = [
  {
    key: "orders",
    title: "تحديثات الطلبات",
    detail: "إنشاء الطلب، تغيّر الحالة، تسليم الحساب، والموافقة على تعبئة المحفظة",
    icon: ShoppingBag,
    tint: "text-green-600 bg-green-500/10 border-green-500/20",
  },
  {
    key: "messages",
    title: "رسائل الدعم الفني",
    detail: "إشعار تليكرام عند رد خدمة العملاء (تبقى الرسالة في المحادثة دائماً)",
    icon: MessageSquare,
    tint: "text-[#0088cc] bg-[#0088cc]/10 border-[#0088cc]/20",
  },
  {
    key: "promotions",
    title: "تنبيهات انخفاض الأسعار",
    detail: "عند تغيّر سعر منتج في قائمة مفضّلاتك",
    icon: Gift,
    tint: "text-purple-500 bg-purple-500/10 border-purple-500/20",
  },
];

function NotificationsCenter() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [saving, setSaving] = useState<SwitchableKey | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (cancelled) return;
        setSettings(readNotificationPreferences(res.user?.settings));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // The defaults are what the shop does anyway, so a failed read shows
        // the truth rather than an empty screen.
        setLoading(false);
        setError("تعذّر تحميل تفضيلاتك. أعد المحاولة لاحقاً.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSetting = async (key: SwitchableKey) => {
    if (saving) return;
    const next = { ...settings, [key]: !settings[key] };
    /*
      Moved first, then saved. A switch that waits for the network before it
      moves reads as broken on a slow connection — and if the save fails the
      switch moves back, which is the honest outcome: it is not off until the
      server says it is.
    */
    setSettings(next);
    setSaving(key);
    setError("");
    try {
      const res = await api.updateProfile({ settings: { notifications: next } });
      // Read it back from what the server stored, not from what was sent:
      // the switch shows the shop's answer, not the browser's hope.
      setSettings(readNotificationPreferences(res.user?.settings));
      setSavedAt(Date.now());
    } catch {
      setSettings(settings);
      setError("لم يتم حفظ التغيير. تحقّق من اتصالك وأعد المحاولة.");
    } finally {
      setSaving(null);
    }
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

        {error && (
          <p className="text-xs font-bold text-[var(--brand-red)] text-center bg-[var(--brand-red)]/5 border border-[var(--brand-red)]/20 rounded-2xl p-3">
            {error}
          </p>
        )}
        {!error && savedAt > 0 && (
          <p className="text-xs font-bold text-green-600 text-center flex items-center justify-center gap-1">
            <Check className="w-4 h-4" /> تم الحفظ
          </p>
        )}

        <div className="bg-surface-3 rounded-[24px] border border-line-2 overflow-hidden">
          {ROWS.map((row) => {
            const Icon = row.icon;
            const on = settings[row.key];
            return (
              <div
                key={row.key}
                className="w-full flex items-center justify-between p-4 border-b border-line-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${row.tint}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-right min-w-0">
                    <p className="font-bold text-[var(--ink-base)] text-sm">{row.title}</p>
                    <p className="text-xs font-bold text-[var(--ink-mute)]">{row.detail}</p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={row.title}
                  aria-pressed={on}
                  disabled={saving !== null}
                  onClick={() => void toggleSetting(row.key)}
                  className={`w-12 h-6 shrink-0 rounded-full transition-colors relative disabled:opacity-60 ${
                    on ? "bg-green-500" : "bg-line-2"
                  }`}
                >
                  {saving === row.key ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white absolute top-1 left-4" />
                  ) : (
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
                        on ? "left-0.5" : "left-[26px]"
                      }`}
                    />
                  )}
                </button>
              </div>
            );
          })}

          <div className="w-full flex items-center justify-between p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--brand-red)]/10 flex items-center justify-center border border-[var(--brand-red)]/20">
                <ShieldAlert className="w-5 h-5 text-[var(--brand-red)]" />
              </div>
              <div className="text-right min-w-0">
                <p className="font-bold text-[var(--ink-base)] text-sm">تنبيهات الأمان</p>
                <p className="text-xs font-bold text-[var(--ink-mute)]">
                  رمز تسجيل الدخول والتحقق — دائماً مفعّلة
                </p>
              </div>
            </div>
            <span className="text-[11px] font-black text-[var(--brand-red)] bg-[var(--brand-red)]/10 border border-[var(--brand-red)]/20 rounded-full px-3 py-1 shrink-0">
              إلزامي
            </span>
          </div>
        </div>

        <p className="text-xs font-bold text-[var(--ink-mute)] text-center pt-2">
          {/*
            The reason, not just the rule. The sign-in code arrives over
            Telegram: a member who could switch it off would be a member who
            cannot sign in, and would never connect the two.
          */}
          رمز تسجيل الدخول يصلك عبر تليكرام، لذلك لا يمكن إيقاف تنبيهات الأمان — إيقافها يعني
          تعذّر دخولك إلى حسابك.
        </p>
      </div>
    </TelegramLayout>
  );
}
