import PageHeader from "@/components/PageHeader";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Gamepad2,
  Search,
  PackageOpen,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  History,
  ShieldCheck,
  RotateCcw,
  ExternalLink,
  Store,
  Layers,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { loadSiteContent } from "@/lib/content.functions";
import { activeOptions, localized, statusCopy } from "@/lib/content";
import type { AddGameData, SelectOption } from "@/lib/content";
import type { ProductRequest } from "@/lib/types";
import { askAboutTelegramAfterOrder } from "@/lib/telegramNudge";
import {
  Badge,
  ChoiceCard,
  Chip,
  LoginGate,
  Skeleton,
  StatusTimeline,
  Stepper,
} from "@/components/services/ServiceBits";

export const Route = createFileRoute("/add_game")({
  loader: async () => await loadSiteContent(),
  head: () => ({
    meta: [
      { title: "طلب إضافة لعبة — بنانتو" },
      {
        name: "description",
        content: "ابحث عن لعبتك في متجر بنانتو، وإذا لم تكن متوفرة أرسل طلب توفيرها وتابع حالته.",
      },
      { property: "og:title", content: "طلب إضافة لعبة — بنانتو" },
      {
        property: "og:description",
        content: "ابحث عن لعبتك، وإذا لم تكن متوفرة أرسل طلب توفيرها وتابع حالته خطوة بخطوة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AddGamePage,
});

const FLOW: string[] = ["submitted", "under_review", "accepted", "sourcing", "available", "added"];

interface CatalogGame {
  game_id: string;
  title: string;
  platform?: string;
  cover_url?: string;
}
interface StoreProduct {
  id: string;
  title: string;
  price?: number;
  images?: string[];
  status?: string;
}

function AddGamePage() {
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const { user } = useAuth();
  const content = Route.useLoaderData();
  const cfg = content.addGame as AddGameData;
  const L = (key: string) => localized(cfg as unknown as Record<string, unknown>, key, lang);
  const visible = (key: string) => cfg.section_visibility?.[key] !== false;
  const optLabel = (o: SelectOption) =>
    localized(o as unknown as Record<string, unknown>, "label", lang);

  const [step, setStep] = useState(0);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [games, setGames] = useState<CatalogGame[]>([]);
  const [picked, setPicked] = useState<CatalogGame | null>(null);
  const [manualName, setManualName] = useState("");
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<ProductRequest | null>(null);

  const [form, setForm] = useState({
    requestType: "game",
    platform: "",
    preferredVersion: "",
    preferredRegion: "",
    contactMethod: "",
    notes: "",
  });

  const types = useMemo(() => activeOptions(cfg.allowed_request_types), [cfg]);
  const platforms = useMemo(() => activeOptions(cfg.platforms), [cfg]);
  const versions = useMemo(() => activeOptions(cfg.versions), [cfg]);
  const regions = useMemo(() => activeOptions(cfg.regions), [cfg]);
  const contacts = useMemo(() => activeOptions(cfg.contact_methods), [cfg]);

  // Set defaults once options load
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      requestType: prev.requestType || types[0]?.value || "game",
      platform: prev.platform || platforms[0]?.value || "",
      preferredVersion: prev.preferredVersion || versions[0]?.value || "",
      preferredRegion: prev.preferredRegion || regions[0]?.value || "",
      contactMethod: prev.contactMethod || contacts[0]?.value || "",
    }));
  }, [types, platforms, versions, regions, contacts]);

  // Live dual search (store products + catalog games)
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setProducts([]);
      setGames([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const [pRes, gRes] = await Promise.all([
          fetch(`/api/products?search=${encodeURIComponent(q)}&limit=4`).catch(() => null),
          fetch(`/api/game-catalog?mode=search&q=${encodeURIComponent(q)}&limit=6`).catch(
            () => null,
          ),
        ]);
        if (cancelled) return;
        if (pRes && pRes.ok) {
          const pData = await pRes.json();
          const items = Array.isArray(pData) ? pData : pData.items || pData.products || [];
          setProducts(items.slice(0, 4));
        } else {
          setProducts([]);
        }
        if (gRes && gRes.ok) {
          const gData = await gRes.json();
          setGames((gData.items || []) as CatalogGame[]);
        } else {
          setGames([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const loadHistory = async () => {
    if (!user) return;
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/game-requests");
      if (!res.ok) return;
      const data = await res.json();
      setRequests((data.requests || []) as ProductRequest[]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [user]);

  const startManual = () => {
    setPicked(null);
    setManualName(term.trim());
    setStep(1);
  };

  const chosenName = picked ? picked.title : manualName;

  const submit = async () => {
    const name = chosenName.trim();
    if (!name) {
      toast.error(lang === "ar" ? "يرجى تحديد أو كتابة اسم اللعبة" : "Please enter the game title");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/game-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: name,
          gameId: picked?.game_id || null,
          requestType: form.requestType || "game",
          platform: form.platform || picked?.platform || null,
          preferredVersion: form.preferredVersion || null,
          preferredRegion: form.preferredRegion || null,
          contactMethod: form.contactMethod || null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || (lang === "ar" ? "فشل إرسال الطلب" : "Failed to submit request"));
        return;
      }
      setDone(data.request as ProductRequest);
      toast.success(
        L("success_title") || (lang === "ar" ? "تم استلام طلبك بنجاح!" : "Request submitted!"),
      );
      // The answer to a request goes out on Telegram too.
      askAboutTelegramAfterOrder(String((data.request as ProductRequest)?.id ?? "game-request"));
      loadHistory();
    } catch {
      toast.error(lang === "ar" ? "حدث خطأ في الاتصال، حاول ثانية" : "Network error, please retry");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setDone(null);
    setPicked(null);
    setManualName("");
    setTerm("");
    setStep(0);
  };

  if (cfg.enabled === false) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-4" dir={dir}>
        <PageHeader />
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-black mb-2">
            {lang === "ar" ? "الخدمة متوقفة مؤقتاً" : "Service Temporarily Paused"}
          </h1>
          <p className="text-muted-foreground">
            {lang === "ar"
              ? "سنعيد تفعيل خدمة طلب الألعاب قريباً."
              : "We will re-enable game requests shortly."}
          </p>
        </div>
      </div>
    );
  }

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const Next = dir === "rtl" ? ArrowLeft : ArrowRight;
  const stepLabels = [
    lang === "ar" ? "البحث والتحقق" : "Search & Verify",
    lang === "ar" ? "تفاصيل الطلب" : "Request Details",
    lang === "ar" ? "المراجعة والتأكيد" : "Review & Submit",
  ];

  return (
    <div className="min-h-screen bg-background pb-28 selection:bg-primary/20" dir={dir}>
      <PageHeader />

      {/* Hero Section */}
      {visible("hero") && (
        <header className="relative overflow-hidden border-b border-border bg-gradient-to-b from-card to-background">
          <div
            className="absolute inset-0 opacity-40 pointer-events-none"
            style={{
              background:
                "radial-gradient(100% 80% at 50% -20%, color-mix(in oklab, var(--primary) 25%, transparent), transparent 70%)",
            }}
            aria-hidden="true"
          />
          <div className="relative max-w-3xl mx-auto px-4 py-12 md:py-16 text-center">
            <Badge>{L("hero_badge") || (lang === "ar" ? "طلب خاص" : "Special Request")}</Badge>
            <h1 className="mt-4 text-3xl md:text-5xl font-black tracking-tight text-foreground flex items-center justify-center gap-3">
              <Gamepad2 className="w-8 h-8 text-primary" aria-hidden="true" />
              {L("hero_title")}
            </h1>
            <p className="mt-4 text-muted-foreground text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              {L("hero_subtitle")}
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {(cfg.trust_items ?? []).map((it) => (
                <Chip key={it.id}>
                  {localized(it as unknown as Record<string, unknown>, "label", lang)}
                </Chip>
              ))}
            </div>
          </div>
        </header>
      )}

      <main className="max-w-3xl mx-auto px-4 mt-8 space-y-10">
        {!user ? (
          <LoginGate
            title={
              L("login_gate_title") ||
              (lang === "ar" ? "سجّل دخولك لمتابعة طلبك" : "Sign in to track your request")
            }
            description={
              L("login_gate_description") ||
              (lang === "ar"
                ? "تحتاج لتسجيل الدخول حتى تتمكن من إرسال طلب توفير اللعبة ومتابعة التحديثات."
                : "Please login to submit requests and track their status.")
            }
            redirect="/add_game"
          />
        ) : done ? (
          <motion.section
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-3xl border border-border bg-card p-8 md:p-10 text-center shadow-sm"
          >
            <div className="mx-auto mb-4 grid place-items-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
              <CheckCircle2 className="w-9 h-9" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-black text-foreground">{L("success_title")}</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
              {L("success_description")}
            </p>

            <div className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-xs font-mono font-bold text-foreground">
              <span>{lang === "ar" ? "رقم الطلب:" : "Request ID:"}</span>
              <span>{done.id}</span>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
              >
                <RotateCcw className="w-4 h-4" />
                {lang === "ar" ? "طلب لعبة أخرى" : "Request Another Game"}
              </button>
            </div>
          </motion.section>
        ) : (
          <section className="rounded-3xl border border-border bg-card p-5 md:p-8 shadow-sm">
            <Stepper steps={stepLabels} current={step} onGo={setStep} />

            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step-0"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6 space-y-6"
                >
                  <div>
                    <h2 className="font-black text-lg text-foreground">{L("search_title")}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{L("hero_subtitle")}</p>
                  </div>

                  <div className="relative">
                    <Search
                      className={`absolute ${dir === "rtl" ? "right-4" : "left-4"} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none`}
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label={L("search_title")}
                      placeholder={L("search_placeholder")}
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      className={`w-full bg-background border-2 border-border focus:border-primary rounded-2xl py-4 ${
                        dir === "rtl" ? "pr-12 pl-12" : "pl-12 pr-12"
                      } text-base outline-none transition-colors shadow-sm`}
                    />
                    {term && (
                      <button
                        type="button"
                        onClick={() => setTerm("")}
                        className={`absolute ${dir === "rtl" ? "left-4" : "right-4"} top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1`}
                        aria-label="مسح البحث"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {searching && (
                    <div className="space-y-3" aria-busy="true">
                      <Skeleton className="h-20" />
                      <Skeleton className="h-20" />
                    </div>
                  )}

                  {!searching && term.trim().length >= 2 && (
                    <div className="space-y-6">
                      {/* Section 1: In Store Products */}
                      {products.length > 0 && (
                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 md:p-5">
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                            <Store className="w-4 h-4" />
                            <h3>{L("available_title")}</h3>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {L("available_description")}
                          </p>
                          <div className="mt-3 grid sm:grid-cols-2 gap-2.5" dir="ltr">
                            {products.map((p) => (
                              <a
                                key={p.id}
                                href={`/product/${p.id}`}
                                className="flex items-center gap-3 p-3 rounded-xl bg-background border border-emerald-500/20 hover:border-emerald-500/50 transition-colors shadow-sm"
                              >
                                {p.images?.[0] ? (
                                  <img
                                    src={p.images[0]}
                                    alt={(p as any).titleEn || (p as any).english_name || p.title}
                                    loading="lazy"
                                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                                  />
                                ) : (
                                  <span className="grid place-items-center w-12 h-12 rounded-lg bg-muted shrink-0">
                                    <PackageOpen
                                      className="w-5 h-5 text-muted-foreground"
                                      aria-hidden="true"
                                    />
                                  </span>
                                )}
                                <span className="flex-1 min-w-0">
                                  <span className="block font-bold text-xs truncate text-foreground">
                                    {(p as any).titleEn || (p as any).english_name || p.title}
                                  </span>
                                  {typeof p.price === "number" && (
                                    <span className="block text-xs font-black text-primary mt-0.5">
                                      {p.price.toLocaleString("en-US")} د.ع
                                    </span>
                                  )}
                                </span>
                                <ExternalLink
                                  className="w-3.5 h-3.5 text-muted-foreground shrink-0"
                                  aria-hidden="true"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section 2: Catalog Matches */}
                      {games.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                              <Layers className="w-4 h-4 text-primary" />
                              {L("catalog_match_title")}
                            </h3>
                            <span className="text-[11px] text-muted-foreground font-bold">
                              {games.length} {lang === "ar" ? "نتائج متطابقة" : "matches"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">
                            {L("catalog_match_description")}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3" dir="ltr">
                            {games.map((g) => (
                              <div
                                key={g.game_id}
                                className="rounded-2xl border border-border bg-background p-3.5 flex flex-col justify-between gap-3 hover:border-primary/40 transition-colors shadow-sm"
                              >
                                <div className="flex gap-3">
                                  {g.cover_url ? (
                                    <img
                                      src={g.cover_url}
                                      alt={
                                        (g as any).titleEn ||
                                        (g as any).english_name ||
                                        (g as any).title ||
                                        (g as any).name ||
                                        ""
                                      }
                                      loading="lazy"
                                      className="w-12 h-16 rounded-xl object-cover shrink-0 shadow-sm"
                                    />
                                  ) : (
                                    <span className="grid place-items-center w-12 h-16 rounded-xl bg-muted shrink-0">
                                      <Gamepad2
                                        className="w-5 h-5 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                    </span>
                                  )}
                                  <span className="min-w-0">
                                    <span className="block font-bold text-sm text-foreground line-clamp-2">
                                      {(g as any).titleEn ||
                                        (g as any).english_name ||
                                        (g as any).title ||
                                        (g as any).name ||
                                        ""}
                                    </span>
                                    {g.platform && (
                                      <span className="inline-block mt-1 text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                        {g.platform}
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPicked(g);
                                    setManualName("");
                                    if (g.platform) {
                                      setForm((f) => ({
                                        ...f,
                                        platform: g.platform || f.platform,
                                      }));
                                    }
                                    setStep(1);
                                  }}
                                  className="w-full py-2.5 rounded-xl bg-primary/10 text-primary font-bold text-xs hover:bg-primary hover:text-primary-foreground transition-all"
                                >
                                  {lang === "ar" ? "اطلب توفير هذه اللعبة" : "Request This Game"}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section 3: Not Found / Custom Request */}
                      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
                        <Sparkles className="w-6 h-6 text-primary mx-auto" aria-hidden="true" />
                        <p className="mt-2 font-black text-sm text-foreground">
                          {L("not_found_title")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                          {L("not_found_description")}
                        </p>
                        <button
                          type="button"
                          onClick={startManual}
                          className="mt-4 px-6 py-2.5 rounded-xl bg-foreground text-background font-bold text-xs hover:opacity-90 transition-opacity shadow-sm"
                        >
                          {L("manual_request_cta")}
                        </button>
                      </div>
                    </div>
                  )}

                  {!searching && term.trim().length < 2 && (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center bg-muted/20">
                      <Gamepad2 className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
                      <p className="mt-3 font-bold text-sm text-foreground">
                        {lang === "ar"
                          ? "اكتب اسم اللعبة للبحث والتأكد أولاً"
                          : "Type a game name to search our database"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {lang === "ar"
                          ? "أو اضغط على زر الإدخال المباشر إذا كنت تعرف تفاصيل طلبك."
                          : "Or proceed with manual entry."}
                      </p>
                      <button
                        type="button"
                        onClick={startManual}
                        className="mt-4 px-5 py-2 rounded-xl bg-muted text-foreground font-bold text-xs hover:bg-card border border-border transition-colors"
                      >
                        {L("manual_request_cta") ||
                          (lang === "ar" ? "إدخال يدوي مباشر" : "Manual Entry")}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {step === 1 && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6 space-y-6"
                >
                  <div>
                    <h2 className="font-black text-lg text-foreground">{L("form_title")}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{L("form_helper")}</p>
                  </div>

                  {picked ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-3.5 border border-border">
                      <div className="flex items-center gap-3">
                        {picked.cover_url && (
                          <img
                            src={picked.cover_url}
                            alt={
                              (picked as any).titleEn ||
                              (picked as any).english_name ||
                              (picked as any).title ||
                              (picked as any).name ||
                              ""
                            }
                            loading="lazy"
                            className="w-11 h-14 rounded-lg object-cover shadow-sm"
                          />
                        )}
                        <div>
                          <p className="font-bold text-sm text-foreground">
                            {(picked as any).titleEn ||
                              (picked as any).english_name ||
                              (picked as any).title ||
                              (picked as any).name ||
                              ""}
                          </p>
                          <p className="text-xs text-muted-foreground">{picked.platform}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(null);
                          setStep(0);
                        }}
                        className="text-xs font-bold text-primary hover:underline px-2"
                      >
                        {lang === "ar" ? "تغيير" : "Change"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {types.length > 1 && (
                        <FieldGroup label={lang === "ar" ? "نوع الطلب" : "Request Type"}>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {types.map((o) => (
                              <ChoiceCard
                                key={o.value}
                                selected={form.requestType === o.value}
                                title={optLabel(o)}
                                onSelect={() => setForm((f) => ({ ...f, requestType: o.value }))}
                              />
                            ))}
                          </div>
                        </FieldGroup>
                      )}
                      <FieldGroup
                        label={lang === "ar" ? "اسم اللعبة أو المنتج" : "Game or Product Title"}
                      >
                        <input
                          type="text"
                          value={manualName}
                          onChange={(e) => setManualName(e.target.value)}
                          maxLength={120}
                          placeholder={
                            lang === "ar" ? "اكتب اسم اللعبة بدقة..." : "Enter full title..."
                          }
                          className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-primary text-sm shadow-sm"
                        />
                      </FieldGroup>
                    </div>
                  )}

                  {platforms.length > 0 && (
                    <FieldGroup label={lang === "ar" ? "الجهاز / المنصة" : "Platform"}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {platforms.map((o) => (
                          <ChoiceCard
                            key={o.value}
                            selected={form.platform === o.value}
                            title={optLabel(o)}
                            onSelect={() =>
                              setForm((f) => ({
                                ...f,
                                platform: f.platform === o.value ? "" : o.value,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </FieldGroup>
                  )}

                  {versions.length > 0 && (
                    <FieldGroup label={lang === "ar" ? "النسخة المفضلة" : "Preferred Edition"}>
                      <ChipRow
                        options={versions}
                        value={form.preferredVersion}
                        label={optLabel}
                        onChange={(v) => setForm((f) => ({ ...f, preferredVersion: v }))}
                      />
                    </FieldGroup>
                  )}

                  {regions.length > 0 && (
                    <FieldGroup label={lang === "ar" ? "الريجون / المنطقة" : "Region"}>
                      <ChipRow
                        options={regions}
                        value={form.preferredRegion}
                        label={optLabel}
                        onChange={(v) => setForm((f) => ({ ...f, preferredRegion: v }))}
                      />
                    </FieldGroup>
                  )}

                  {contacts.length > 0 && (
                    <FieldGroup
                      label={lang === "ar" ? "طريقة التواصل المفضلة" : "Preferred Contact Method"}
                    >
                      <ChipRow
                        options={contacts}
                        value={form.contactMethod}
                        label={optLabel}
                        onChange={(v) => setForm((f) => ({ ...f, contactMethod: v }))}
                      />
                    </FieldGroup>
                  )}

                  <FieldGroup
                    label={
                      lang === "ar" ? "ملاحظات إضافية (اختياري)" : "Additional Notes (Optional)"
                    }
                  >
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder={
                        lang === "ar"
                          ? "أي تفاصيل أخرى ترغب بإخبارنا بها..."
                          : "Any other preferences..."
                      }
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-primary text-sm resize-none shadow-sm"
                    />
                  </FieldGroup>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep(0)}
                      className="flex-1 py-3 rounded-2xl bg-muted font-bold text-foreground inline-flex items-center justify-center gap-2 hover:bg-muted/80 transition-colors text-sm"
                    >
                      <Back className="w-4 h-4" aria-hidden="true" />{" "}
                      {lang === "ar" ? "رجوع" : "Back"}
                    </button>
                    <button
                      type="button"
                      disabled={chosenName.trim().length < 2}
                      onClick={() => setStep(2)}
                      className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity text-sm shadow-sm"
                    >
                      {lang === "ar" ? "مراجعة الطلب" : "Review Request"}{" "}
                      <Next className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step-2"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6 space-y-6"
                >
                  <div>
                    <h2 className="font-black text-lg text-foreground">{L("review_title")}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {lang === "ar"
                        ? "تأكد من صحة بيانات الطلب قبل الإرسال النهائي."
                        : "Verify your details before final submission."}
                    </p>
                  </div>

                  <dl className="rounded-2xl border border-border divide-y divide-border overflow-hidden shadow-sm">
                    <Row
                      label={lang === "ar" ? "اللعبة / المنتج" : "Game / Product"}
                      value={chosenName}
                    />
                    <Row
                      label={lang === "ar" ? "المنصة" : "Platform"}
                      value={optLabelOf(platforms, form.platform, lang)}
                    />
                    <Row
                      label={lang === "ar" ? "النسخة" : "Edition"}
                      value={optLabelOf(versions, form.preferredVersion, lang)}
                    />
                    <Row
                      label={lang === "ar" ? "المنطقة" : "Region"}
                      value={optLabelOf(regions, form.preferredRegion, lang)}
                    />
                    <Row
                      label={lang === "ar" ? "طريقة التواصل" : "Contact"}
                      value={optLabelOf(contacts, form.contactMethod, lang)}
                    />
                    <Row label={lang === "ar" ? "ملاحظات" : "Notes"} value={form.notes} />
                  </dl>

                  <p className="text-xs text-muted-foreground flex items-start gap-2 bg-muted/40 p-3 rounded-xl border border-border">
                    <ShieldCheck
                      className="w-4 h-4 text-primary shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>{L("footer_note")}</span>
                  </p>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="flex-1 py-3 rounded-2xl bg-muted font-bold text-foreground text-sm hover:bg-muted/80 transition-colors"
                    >
                      {lang === "ar" ? "تعديل" : "Edit"}
                    </button>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 hover:opacity-90 transition-opacity shadow-sm"
                    >
                      {submitting
                        ? lang === "ar"
                          ? "جارٍ الإرسال…"
                          : "Submitting…"
                        : L("submit_button")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* How it Works Section */}
        {visible("how_it_works") && (cfg.how_it_works ?? []).length > 0 && (
          <section className="space-y-4">
            <h2 className="font-black text-lg text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {L("how_it_works_title")}
            </h2>
            <div className="grid sm:grid-cols-3 gap-3.5">
              {[...(cfg.how_it_works ?? [])]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((s, i) => (
                  <div
                    key={s.id}
                    className="rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-colors shadow-sm"
                  >
                    <span className="grid place-items-center w-8 h-8 rounded-xl bg-primary/10 text-primary font-black text-sm">
                      {i + 1}
                    </span>
                    <h3 className="mt-3 font-bold text-sm text-foreground">
                      {localized(s as unknown as Record<string, unknown>, "title", lang)}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {localized(s as unknown as Record<string, unknown>, "description", lang)}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Request History Section */}
        {user && visible("history") && (
          <section className="space-y-4">
            <h2 className="font-black text-lg text-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-primary" aria-hidden="true" />
              {L("history_title")}
            </h2>
            {loadingHistory ? (
              <div className="space-y-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : requests.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
                <p className="font-bold text-foreground">{L("history_empty_title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {L("history_empty_description")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((req) => {
                  const currentIdx = FLOW.indexOf(req.status);
                  const copy = statusCopy(cfg.status_content, req.status, lang);
                  const nodes = FLOW.map((s, i) => {
                    const c = statusCopy(cfg.status_content, s, lang);
                    return {
                      status: s,
                      title: c.title,
                      description: i === currentIdx ? c.description : "",
                      done: currentIdx > i,
                      current: currentIdx === i,
                    };
                  });
                  const terminal = req.status === "rejected" || req.status === "cancelled";
                  return (
                    <article
                      key={req.id}
                      className="rounded-3xl border border-border bg-card p-5 md:p-6 shadow-sm hover:border-primary/30 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-foreground text-base">{req.productName}</h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(req.createdAt).toLocaleDateString(
                              lang === "ar" ? "ar-EG" : "en-US",
                              { year: "numeric", month: "short", day: "numeric" },
                            )}
                          </p>
                        </div>
                        <span className="rounded-full bg-primary/10 text-primary px-3.5 py-1 text-xs font-black">
                          {copy.title}
                        </span>
                      </div>
                      {terminal ? (
                        <p className="mt-4 text-sm text-muted-foreground bg-muted/40 p-3 rounded-xl">
                          {copy.description}
                        </p>
                      ) : (
                        <div className="mt-5">
                          <StatusTimeline nodes={nodes} />
                        </div>
                      )}
                      {req.userVisibleNote && (
                        <p className="mt-4 rounded-2xl bg-primary/5 border border-primary/15 p-3.5 text-xs text-foreground font-medium">
                          {req.userVisibleNote}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function optLabelOf(options: SelectOption[], value: string, lang: string): string {
  const found = options.find((o) => o.value === value);
  return found ? localized(found as unknown as Record<string, unknown>, "label", lang) : value;
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-bold text-foreground mb-2">{label}</legend>
      {children}
    </fieldset>
  );
}

function ChipRow({
  options,
  value,
  label,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  label: (o: SelectOption) => string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? "" : o.value)}
            className={`rounded-full px-4 py-2 text-xs font-bold border transition-colors ${
              selected
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 bg-background">
      <dt className="text-xs font-bold text-muted-foreground">{label}</dt>
      <dd className="text-xs font-bold text-foreground text-end">{value}</dd>
    </div>
  );
}
