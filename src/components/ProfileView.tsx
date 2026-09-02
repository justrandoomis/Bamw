import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSettingsStore } from "../store/useSettingsStore";
import {
  User,
  Volume2,
  VolumeX,
  Music,
  CreditCard,
  History,
  LogOut,
  ChevronDown,
  Send,
  AtSign,
  Gamepad2,
  Calendar,
  Zap,
  CheckCircle2,
  Coins,
  Gift,
  Palette,
  Shield,
} from "lucide-react";
import { useI18n } from "../i18n";
import { playSound } from "../utils/audio";
import { THEME_PACKS, availableThemes } from "../lib/themes";
import { THEME_COOKIE, writeCookie } from "../lib/prefs";
import { useCurrency } from "../context/CurrencyContext";
import { useNavigate } from "@tanstack/react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useBananaMarket } from "../hooks/useBananaMarket";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { getDefaultRadioTracks } from "../config/publicAssets";

export default function ProfileView() {
  const navigate = useNavigate();
  const { user, updateProfile, logout, isLoading } = useAuth();
  const {
    soundEnabled,
    musicEnabled,
    liteMotion,
    musicTrack,
    setSoundEnabled,
    setMusicEnabled,
    setLiteMotion,
    setMusicTrack,
  } = useSettingsStore();
  const { t, lang } = useI18n();
  const { setCurrency, currency: currentCurrency } = useCurrency();
  const { snapshot } = useBananaMarket();
  const { data: store } = useQuery({
    queryKey: ["catalogue"],
    queryFn: async () => {
      const res = await fetch("/api/data?slim=1");
      return res.json();
    },
  });

  // Telegram linking powers OTP delivery over Telegram as a second channel.
  const queryClient = useQueryClient();
  const telegram = useQuery({
    queryKey: ["telegram-link"],
    queryFn: () => api.telegramStatus(),
    enabled: !!user,
    retry: false,
  });
  const linkTelegram = useMutation({
    mutationFn: () => api.telegramLink(),
    onSuccess: (data) => {
      window.open(data.deep_link, "_blank", "noopener");
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["telegram-link"] }), 8000);
    },
  });
  const unlinkTelegram = useMutation({
    mutationFn: () => api.telegramUnlink(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telegram-link"] }),
  });

  const [localName, setLocalName] = useState(user?.name || "");
  const [localUsername, setLocalUsername] = useState(user?.username || "");
  const [localFriendId, setLocalFriendId] = useState(user?.friendId || "");
  const [localBirthDate, setLocalBirthDate] = useState(user?.birthDate || "");

  useEffect(() => {
    if (user) {
      setLocalName(user.name || "");
      setLocalUsername(user.username || "");
      setLocalFriendId(user.friendId || "");
      setLocalBirthDate(user.birthDate || "");
    }
  }, [user]);

  const themes = availableThemes(snapshot?.unlockedThemes);

  const optimisticUpdate = async (fields: any) => {
    try {
      await updateProfile.mutateAsync(fields);
      playSound("bumper_end", 0.6);
    } catch (err) {
      console.error("Update failed", err);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 pb-24 h-full flex flex-col items-center justify-center max-w-3xl mx-auto pt-24">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse mb-4" />
        <div className="h-6 w-48 bg-muted animate-pulse rounded mb-2" />
        <div className="h-4 w-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  const handleUpdateAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        updateProfile.mutate({ avatar: data.url });
        playSound("bumper_end", 0.6);
      }
    } catch (err) {
      console.error("Avatar upload failed", err);
    }
  };

  return (
    <div className="p-4 sm:p-6 pb-24 h-full flex flex-col max-w-3xl mx-auto animate-in fade-in duration-300 pt-24">
      <div className="flex flex-col items-center mb-8">
        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg mb-4 relative group cursor-pointer">
          {user?.avatar ? (
            <img src={user.avatar} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <User className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
          <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
            <span className="text-white text-[10px] font-bold uppercase">{t("تغيير")}</span>
            <input type="file" className="hidden" accept="image/*" onChange={handleUpdateAvatar} />
          </label>
        </div>

        <h1 className="text-2xl font-bold text-foreground">
          {user?.name || user?.username || t("مستخدم بنانا")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {user?.username ? `@${user.username}` : user?.email || user?.phone}
        </p>
        {user?.memberNo && (
          <div className="mt-1 px-3 py-1 bg-yellow-500/10 text-yellow-600 rounded-full text-[10px] font-black tracking-widest border border-yellow-500/20 uppercase">
            {t("رقم العضوية")}: {user.memberNo}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            {t("المعلومات الأساسية")}
          </h2>
          <div className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                <User className="w-3 h-3" /> {t("الاسم الكامل")}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={() => optimisticUpdate({ name: localName })}
                  className="w-full bg-muted/50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder={t("ادخل اسمك")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                <AtSign className="w-3 h-3" /> {t("اسم المستخدم")}
              </label>
              <input
                type="text"
                value={localUsername}
                onChange={(e) => setLocalUsername(e.target.value)}
                onBlur={() => optimisticUpdate({ username: localUsername })}
                className="w-full bg-muted/50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder={t("username")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                  <Calendar className="w-3 h-3" /> {t("تاريخ الميلاد")}
                </label>
                <input
                  type="date"
                  value={localBirthDate}
                  onChange={(e) => setLocalBirthDate(e.target.value)}
                  onBlur={() => optimisticUpdate({ birthDate: localBirthDate })}
                  className="w-full bg-muted/50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                  <Coins className="w-3 h-3" /> {t("العملة")}
                </label>
                <Select
                  value={currentCurrency}
                  onValueChange={(val) => {
                    setCurrency(val as any);
                    optimisticUpdate({ settings: { currency: val } });
                  }}
                >
                  <SelectTrigger className="w-full bg-muted/50 border-none rounded-2xl h-[44px] px-4 text-sm focus:ring-2 focus:ring-blue-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD ($) - {t("دولار أمريكي")}</SelectItem>
                    <SelectItem value="IQD">IQD (د.ع) - {t("دينار عراقي")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2 flex items-center justify-between">
            {t("التواصل والنينتندو")}
          </h2>
          <div className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-4">
            <div className="rounded-2xl bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Send className="w-4 h-4 text-blue-500" />
                  {t("ربط تلغرام لاستلام رمز التحقق")}
                </div>
                {telegram.data?.linked ? (
                  <span className="text-[11px] font-bold text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("مرتبط")}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-muted-foreground">
                    {t("غير مرتبط")}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {telegram.data?.linked
                  ? t("سيصلك رمز التحقق والإشعارات على تلغرام عند اختيار هذه القناة.")
                  : t("اضغط على الزر ثم أرسل /start للبوت لإكمال الربط خلال ١٥ دقيقة.")}
              </p>
              {telegram.data?.linked ? (
                <button
                  type="button"
                  disabled={unlinkTelegram.isPending}
                  onClick={() => unlinkTelegram.mutate()}
                  className="w-full rounded-2xl bg-destructive/10 text-destructive py-2.5 text-xs font-bold disabled:opacity-50"
                >
                  {unlinkTelegram.isPending ? t("جارٍ الإلغاء...") : t("إلغاء الربط")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={linkTelegram.isPending}
                  onClick={() => linkTelegram.mutate()}
                  className="w-full rounded-2xl bg-blue-500 text-white py-2.5 text-xs font-bold disabled:opacity-50"
                >
                  {linkTelegram.isPending ? t("جارٍ التحضير...") : t("ربط حساب تلغرام")}
                </button>
              )}
              {linkTelegram.isError && (
                <p className="text-[11px] text-destructive">
                  {t("تعذر إنشاء رابط الربط، حاول مجدداً.")}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                <Gamepad2 className="w-3 h-3 text-red-500" /> {t("Nintendo Friend ID")}
              </label>
              <input
                type="text"
                value={localFriendId}
                onChange={(e) => setLocalFriendId(e.target.value)}
                onBlur={() => optimisticUpdate({ friendId: localFriendId })}
                className="w-full bg-muted/50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="SW-1234-5678-9012"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            {t("المظهر")}
          </h2>
          <div className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground px-1 flex items-center gap-2">
                <Palette className="w-3 h-3" /> {t("تنسيق الموقع")}
              </label>
              <Select
                value={user?.settings?.theme || "cream"}
                onValueChange={(val) => {
                  const pack = THEME_PACKS.find((p) => p.id === val);
                  if (pack) {
                    writeCookie(THEME_COOKIE, pack.id);
                    document.documentElement.dataset["theme"] = pack.id;
                    document.documentElement.classList.toggle("dark", pack.dark);
                    document.documentElement.style.colorScheme = pack.dark ? "dark" : "light";
                    optimisticUpdate({ settings: { theme: val } });
                  }
                }}
              >
                <SelectTrigger className="w-full bg-muted/50 border-none rounded-2xl h-[44px] px-4 text-sm focus:ring-2 focus:ring-blue-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full border border-white/20"
                          style={{ backgroundColor: p.swatch[0] }}
                        />
                        <span>{p.name}</span>
                        {p.dark && <span className="text-[10px] opacity-50">🌙</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-full ${liteMotion ? "bg-amber-100 text-amber-600" : "bg-muted text-muted-foreground"}`}
                >
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold">{t("حركة مخففة")}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {t("تقليل التأثيرات البصرية")}
                  </div>
                </div>
              </div>
              <button
                onPointerDown={() => playSound(liteMotion ? "turn_off" : "turn_on", 0.8, true)}
                onClick={() => {
                  const newState = !liteMotion;
                  setLiteMotion(newState);
                  optimisticUpdate({ settings: { liteMotion: newState } });
                }}
                className={`w-12 h-6 shrink-0 rounded-full transition-colors relative flex items-center px-1 ${liteMotion ? "bg-amber-500" : "bg-muted"}`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-card transition-transform duration-300 shadow-sm ${liteMotion ? (lang === "en" ? "translate-x-[24px]" : "translate-x-[-24px]") : "translate-x-0"}`}
                />
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            {t("الاعدادات الصوتية")}
          </h2>
          <div className="bg-card rounded-3xl p-2 shadow-sm border border-border space-y-1">
            <div className="flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                <div
                  className={`shrink-0 p-3 rounded-full ${soundEnabled ? "bg-blue-100 text-blue-600" : "bg-muted text-muted-foreground"}`}
                >
                  {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </div>
                <div>
                  <div className="font-bold text-foreground">{t("تشغيل الأصوات")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("أصوات الأزرار والتفاعلات")}
                  </div>
                </div>
              </div>

              <button
                onPointerDown={() => playSound(soundEnabled ? "turn_off" : "turn_on", 0.8, true)}
                onClick={() => {
                  const newState = !soundEnabled;
                  setSoundEnabled(newState);
                }}
                className={`w-14 h-8 shrink-0 rounded-full transition-colors relative flex items-center px-1 ${soundEnabled ? "bg-blue-600" : "bg-muted"}`}
              >
                <div
                  className={`w-6 h-6 rounded-full bg-card transition-transform duration-300 shadow-sm ${soundEnabled ? (lang === "en" ? "translate-x-[24px]" : "translate-x-[-24px]") : "translate-x-0"}`}
                />
              </button>
            </div>

            <div className="w-full h-px bg-muted" />

            <div className="flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                <div
                  className={`shrink-0 p-3 rounded-full ${musicEnabled ? "bg-purple-100 text-purple-600" : "bg-muted text-muted-foreground"}`}
                >
                  <Music className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-foreground">{t("تشغيل الموسيقى")}</div>
                  <div className="text-xs text-muted-foreground">{t("موسيقى الخلفية")}</div>

                  {musicEnabled &&
                    (() => {
                      const activeCustom = store?.musicList?.filter((m: any) => m.active) || [];
                      const tracksToDisplay =
                        activeCustom.length > 0 ? activeCustom : getDefaultRadioTracks();
                      return (
                        <div className="mt-2">
                          <Select
                            value={musicTrack || tracksToDisplay[0]?.id}
                            onValueChange={(val) => {
                              setMusicTrack(val);
                              optimisticUpdate({ settings: { musicTrack: val } });
                            }}
                          >
                            <SelectTrigger className="w-full bg-muted/50 border-none rounded-xl h-[36px] px-3 text-xs focus:ring-2 focus:ring-purple-500">
                              <SelectValue placeholder={t("اختر الموسيقى")} />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {tracksToDisplay.map((m: any) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })()}
                </div>
              </div>

              <button
                onPointerDown={() => playSound(musicEnabled ? "turn_off" : "turn_on", 0.8, true)}
                onClick={() => {
                  const newState = !musicEnabled;
                  setMusicEnabled(newState);
                }}
                className={`w-14 h-8 shrink-0 rounded-full transition-colors relative flex items-center px-1 ${musicEnabled ? "bg-purple-600" : "bg-muted"}`}
              >
                <div
                  className={`w-6 h-6 rounded-full bg-card transition-transform duration-300 shadow-sm ${musicEnabled ? (lang === "en" ? "translate-x-[24px]" : "translate-x-[-24px]") : "translate-x-0"}`}
                />
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            {t("الحساب")}
          </h2>
          <div className="bg-card rounded-3xl p-2 shadow-sm border border-border space-y-1">
            <button
              onClick={() => {
                playSound("hover_s", 0.5);
                void navigate({ to: "/wallet" as any });
              }}
              className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors text-right"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-foreground">{t("المحفظة")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("الرصيد الحقيقي")}: {user?.walletBalance || 0} $
                  </div>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-muted-foreground ${lang === "ar" ? "rotate-90" : "-rotate-90"}`}
              />
            </button>

            <div className="w-full h-px bg-muted" />

            <button className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors text-right">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-muted text-muted-foreground rounded-full">
                  <CreditCard className="w-5 h-5" />
                </div>
                <span className="font-bold text-foreground">{t("طرق الدفع")}</span>
              </div>
            </button>

            <div className="w-full h-px bg-muted" />

            <button
              onClick={() => {
                playSound("hover_s", 0.5);
                void navigate({ to: "/refer" as any });
              }}
              className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors text-right"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="shrink-0 p-3 bg-emerald-100 text-emerald-600 rounded-full">
                  <Gift className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-foreground">{t("دعوة صديق")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t("اربح رصيداً عن كل صديق يكمل أول عملية شراء")}
                  </div>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 shrink-0 text-muted-foreground ${lang === "ar" ? "rotate-90" : "-rotate-90"}`}
              />
            </button>

            <div className="w-full h-px bg-muted" />

            <button
              onClick={() => void navigate({ to: "/orders" })}
              className="w-full flex items-center justify-between p-3 hover:bg-muted rounded-2xl transition-colors text-right"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-muted text-muted-foreground rounded-full">
                  <History className="w-5 h-5" />
                </div>
                <span className="font-bold text-foreground">{t("سجل الطلبات")}</span>
              </div>
            </button>

            <div className="w-full h-px bg-muted" />

            <button
              onClick={() => {
                playSound("turn_off", 0.6);
                logout.mutate();
              }}
              className="w-full flex items-center justify-between p-3 hover:bg-red-50 rounded-2xl transition-colors text-right group"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                <div
                  className={`shrink-0 p-3 rounded-full ${soundEnabled ? "bg-red-100 text-red-500" : "bg-muted text-muted-foreground"}`}
                >
                  <LogOut className="w-5 h-5" />
                </div>
                <span className="font-bold text-red-500">{t("تسجيل الخروج")}</span>
              </div>
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            {t("تواصل معنا")}
          </h2>
          <div className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-3">
            <input
              id="contact-subject"
              type="text"
              placeholder={t("الموضوع")}
              className="w-full p-3 rounded-xl border border-border focus:outline-none focus:border-blue-500"
            />
            <textarea
              id="contact-body"
              placeholder={t("رسالتك")}
              className="w-full p-3 rounded-xl border border-border focus:outline-none focus:border-blue-500 min-h-[100px]"
            ></textarea>
            <button
              onPointerDown={() => playSound("loading", 0.6)}
              onClick={async () => {
                const subjectEl = document.getElementById("contact-subject") as HTMLInputElement;
                const bodyEl = document.getElementById("contact-body") as HTMLTextAreaElement;
                if (!subjectEl.value || !bodyEl.value) return;

                const btn = document.getElementById("contact-btn");
                if (btn) {
                  btn.innerText = t("جاري الإرسال...");
                  btn.setAttribute("disabled", "true");
                }

                try {
                  await fetch("/api/send-message", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      sender: user?.name || "مجهول",
                      subject: subjectEl.value,
                      body: bodyEl.value,
                    }),
                  });
                  playSound("bumper_end", 0.6);
                  if (btn) {
                    btn.innerText = t("تم الإرسال بنجاح");
                    btn.classList.add("bg-green-600");
                    btn.classList.remove("bg-blue-600");
                  }
                  setTimeout(() => {
                    subjectEl.value = "";
                    bodyEl.value = "";
                    if (btn) {
                      btn.innerText = t("إرسال الرسالة");
                      btn.classList.remove("bg-green-600");
                      btn.classList.add("bg-blue-600");
                      btn.removeAttribute("disabled");
                    }
                  }, 2000);
                } catch (e) {
                  playSound("error", 0.6);
                  if (btn) {
                    btn.innerText = t("إرسال الرسالة");
                    btn.removeAttribute("disabled");
                  }
                }
              }}
              id="contact-btn"
              className="w-full bg-blue-600 text-white font-bold rounded-xl py-3 shadow-md hover:bg-blue-700 transition-colors"
            >
              {t("إرسال الرسالة")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
