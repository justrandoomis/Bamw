import PageHeader from "@/components/PageHeader";
import { readTradePricing } from "@/lib/trade-pricing";
import { TRADE_MAIN_FLOW, TRADE_PRICING_MODE_BADGE_STYLE } from "@/lib/trade-calc";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  Gamepad2,
  History,
  Info,
  PlusCircle,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  Banknote,
  X,
  ShieldCheck,
  HelpCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { loadSiteContent } from "@/lib/content.functions";
import { localized, statusCopy } from "@/lib/content";
import type { DiscTradeData } from "@/lib/content";
import {
  CATEGORY_LABEL_AR,
  TRADE_STATUS_LABEL_AR,
  TRADE_STATUS_BADGE_STYLE,
  normalizeTradeStatus,
  canTransition,
  groupRulesByCategory,
  orderedCategories,
  type TradeRule,
  type TradeStatus,
} from "@/lib/trade-calc";
import {
  Badge,
  ChoiceCard,
  Chip,
  LoginGate,
  Skeleton,
  StatusTimeline,
  Stepper,
  formatIqd,
} from "@/components/services/ServiceBits";

export const Route = createFileRoute("/disc_trade")({
  loader: async () => await loadSiteContent(),
  head: () => ({
    meta: [
      { title: "استبدال ومقايضة الأقراص — بنانتو" },
      {
        name: "description",
        content: "قيّم لعبتك المستعملة خطوة بخطوة واحصل على قيمة استبدال نقداً أو رصيد متجر.",
      },
      { property: "og:title", content: "استبدال ومقايضة الأقراص — بنانتو" },
      {
        property: "og:description",
        content: "ابحث عن لعبتك، حدد حالتها، وشاهد قيمة الاستبدال المتوقعة قبل الإرسال.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DiscTradePage,
});

/**
 * The stepper follows the canonical lifecycle, not the editable copy list.
 *
 * It used to be its own hardcoded array of the old status keys, and the labels
 * came from `status_content` in the store settings — so a store whose settings
 * still held the previous keys rendered raw identifiers like `waiting_review`
 * straight to the customer. Deriving the steps from `TRADE_MAIN_FLOW` and
 * falling back to the built-in Arabic labels means the stepper is right even
 * when the editable copy has not been updated.
 */
const FLOW = TRADE_MAIN_FLOW;

interface CatalogGame {
  game_id: string;
  title: string;
  canonical_name?: string;
  platform?: string;
  cover_url?: string;
  trade_value_iqd?: number;
  store_offer_bonus_iqd?: number;
  switch_version?: string;
  edition?: string;
  region?: string;
  is_custom?: boolean;
}

interface TradeRow {
  id: string;
  game_name: string;
  platform?: string;
  status: string;
  created_at: string;
  final_iqd?: number | null;
  admin_valuation_iqd?: number | null;
  cover_url?: string | null;
  admin_notes?: string | null;
}

function DiscTradePage() {
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const content = Route.useLoaderData();
  const cfg = content.discTrade as DiscTradeData;
  const L = (key: string) => localized(cfg as unknown as Record<string, unknown>, key, lang);
  const visible = (key: string) => cfg.section_visibility?.[key] !== false;

  const [step, setStep] = useState(0);
  const [term, setTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | "switch2" | "switch1" | "top">(
    "all",
  );
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CatalogGame[]>([]);
  const [game, setGame] = useState<CatalogGame | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  /*
    The customer's own answer, not a constant.

    This was `const payout = "store_credit"` and was sent for every request, so
    the column said store credit on every row — including the rows where the
    member picked cash in the condition step, and where the quote they accepted
    was calculated from that choice. Settlement now reads the selection, and so
    does this: one answer, in one place.
  */
  const payout = selections["payout_method"] === "cash" ? "cash" : "store_credit";
  const [accepted, setAccepted] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const maxPhotos = Math.max(1, Number(cfg.photos_max) || 5);

  const { data: rulesData } = useQuery({
    queryKey: ["trade_rules"],
    queryFn: async () => (await fetch("/api/game-catalog?mode=rules")).json(),
  });
  const rules = (rulesData?.rules || []) as TradeRule[];
  const grouped = useMemo(() => groupRulesByCategory(rules), [rules]);
  const categories = useMemo(() => orderedCategories(rules), [rules]);

  // Featured / catalog list from official dataset
  const { data: featuredData } = useQuery({
    queryKey: ["trade_catalog_featured"],
    queryFn: async () => {
      const res = await fetch("/api/game-catalog?mode=search&q=&limit=60");
      return res.json();
    },
  });
  const featuredGames = (featuredData?.items || []) as CatalogGame[];

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/game-catalog?mode=search&q=${encodeURIComponent(q)}&limit=24`,
        );
        const data = await res.json();
        if (!cancelled) setResults((data.items || []) as CatalogGame[]);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const displayedGames = useMemo(() => {
    const source = term.trim().length >= 2 ? results : featuredGames;
    if (platformFilter === "switch2") {
      return source.filter(
        (g) =>
          g.switch_version?.includes("2") ||
          g.title?.toLowerCase().includes("switch 2") ||
          g.canonical_name?.toLowerCase().includes("switch 2"),
      );
    }
    if (platformFilter === "switch1") {
      return source.filter(
        (g) =>
          !g.switch_version?.includes("2") &&
          !g.title?.toLowerCase().includes("switch 2") &&
          !g.canonical_name?.toLowerCase().includes("switch 2"),
      );
    }
    if (platformFilter === "top") {
      return [...source].sort(
        (a, b) => Number(b.trade_value_iqd || 0) - Number(a.trade_value_iqd || 0),
      );
    }
    return source;
  }, [term, results, featuredGames, platformFilter]);

  const isCustom = game?.is_custom === true;

  const answeredCategories = categories.filter((cat) => Boolean(selections[cat])).length;
  const conditionProgress = categories.length
    ? Math.round((answeredCategories / categories.length) * 100)
    : 0;

  const { data: quoteData, isFetching: quoting } = useQuery({
    queryKey: ["trade_quote", game?.game_id, selections],
    queryFn: async () => {
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quote", game_id: game?.game_id, selections }),
      });
      return res.json();
    },
    enabled: !!game?.game_id && !isCustom,
  });
  const quote = isCustom ? null : quoteData?.quote;
  const priced = isCustom ? false : Boolean(quoteData?.priced);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["my_disc_trades"],
    queryFn: async () => (await fetch("/api/disc-trade")).json(),
    enabled: !!user,
  });
  const trades = (historyData?.items || []) as TradeRow[];

  const defaults = () => {
    const next: Record<string, string> = {};
    for (const cat of categories) {
      const first = grouped[cat]?.[0];
      if (first) next[cat] = first.key;
    }
    return next;
  };

  const pickGame = (g: CatalogGame) => {
    setGame({ ...g, is_custom: false, platform: g.platform || "Nintendo Switch" });
    setSelections(defaults());
    setResults([]);
    setTerm("");
    setStep(1);
  };

  const startManual = () => {
    setGame({
      game_id: "custom",
      is_custom: true,
      title: term.trim(),
      platform: "Nintendo Switch",
    });
    setSelections(defaults());
    setResults([]);
    setStep(1);
  };

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files.slice(0, maxPhotos - photos.length)) {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("read_failed"));
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, folder: "uploads" }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          toast.error(data.error || (lang === "ar" ? "تعذر رفع الصورة" : "Failed to upload image"));
          continue;
        }
        setPhotos((prev) => [...prev, data.url as string]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      const title = (game?.title || "").trim();
      if (!title) throw new Error(lang === "ar" ? "اسم اللعبة مطلوب" : "Game title is required");
      if (cfg.photos_required !== false && photos.length === 0) {
        throw new Error(lang === "ar" ? "صور القرص مطلوبة للمعاينة" : "Photos are required");
      }
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_custom: isCustom,
          game_id: isCustom ? null : game?.game_id,
          game_name: title,
          platform: game?.platform || "Nintendo Switch",
          selections,
          notes: notes.trim() || null,
          payout_type: payout,
          photo_url: photos[0] ?? null,
          images: photos.map((url) => ({ url })),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || (lang === "ar" ? "فشل إرسال الطلب" : "Submission failed"));
      return data as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["my_disc_trades"] });
      setSubmittedId(data.id);
      toast.success(
        L("success_title") ||
          (lang === "ar" ? "تم إرسال طلب المقايضة بنجاح!" : "Trade request submitted!"),
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelTrade = useMutation({
    mutationFn: async (tradeId: string) => {
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", trade_id: tradeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my_disc_trades"] });
      toast.success(lang === "ar" ? "تم إلغاء الطلب بنجاح" : "Trade cancelled successfully");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const acceptOffer = useMutation({
    mutationFn: async (tradeId: string) => {
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", trade_id: tradeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept offer");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my_disc_trades"] });
      toast.success(
        lang === "ar"
          ? "تم قبول العرض! بانتظار تسليم اللعبة للمحل أو الشحن"
          : "Offer accepted! Awaiting game dropoff or shipment",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reset = () => {
    setSubmittedId(null);
    setStep(0);
    setGame(null);
    setSelections({});
    setPhotos([]);
    setNotes("");
    setAccepted(false);
    setTerm("");
  };

  if (cfg.enabled === false) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-4" dir={dir}>
        <PageHeader />
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-black mb-2">
            {lang === "ar" ? "الخدمة متوقفة مؤقتاً" : "Service Paused"}
          </h1>
          <p className="text-muted-foreground">
            {lang === "ar"
              ? "سنعيد تفعيل استبدال الأقراص قريباً."
              : "We will re-enable disc trade-in shortly."}
          </p>
        </div>
      </div>
    );
  }

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const stepLabels = [
    lang === "ar" ? "اللعبة" : "Game",
    lang === "ar" ? "الحالة" : "Condition",
    lang === "ar" ? "الصور" : "Photos",
    lang === "ar" ? "العرض" : "Offer",
  ];

  return (
    <div className="min-h-screen bg-background pb-28 selection:bg-primary/20" dir={dir}>
      <PageHeader />

      {/* Hero */}
      {visible("hero") && (
        <header className="relative overflow-hidden border-b border-border bg-gradient-to-b from-card to-background">
          <div
            className="absolute inset-0 opacity-40 pointer-events-none"
            style={{
              background:
                "radial-gradient(120% 80% at 50% -20%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 60%)",
            }}
            aria-hidden="true"
          />
          <div className="relative max-w-3xl mx-auto px-4 py-12 md:py-16 text-center">
            <Badge>{L("hero_badge") || (lang === "ar" ? "Trade-in" : "Trade-in")}</Badge>
            <h1 className="mt-4 text-3xl md:text-5xl font-black tracking-tight text-foreground flex items-center justify-center gap-3">
              <ArrowLeftRight className="w-8 h-8 text-primary" aria-hidden="true" />
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
            <a
              href="/policy?tab=trade"
              className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <Info className="w-4 h-4" aria-hidden="true" />{" "}
              {lang === "ar" ? "شروط وسياسة المقايضة المعتمدة" : "Trade-in Terms & Policy"}
            </a>
          </div>
        </header>
      )}

      <main className="max-w-3xl mx-auto px-4 mt-8 space-y-10">
        {!user ? (
          <LoginGate
            title={
              L("login_gate_title") ||
              (lang === "ar" ? "سجّل دخولك لحفظ التقييم" : "Sign in to value your game")
            }
            description={
              L("login_gate_description") ||
              (lang === "ar"
                ? "تحتاج لتسجيل الدخول لحفظ التقييم وإرسال طلب المقايضة ومتابعة رصيد المحفظة."
                : "Please sign in to proceed with disc trade-in.")
            }
            redirect="/disc_trade"
          />
        ) : submittedId ? (
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
              <span>{lang === "ar" ? "رقم الطلب:" : "Trade ID:"}</span>
              <span>{submittedId}</span>
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={reset}
                className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity shadow-sm"
              >
                {lang === "ar" ? "طلب مقايضة أخرى" : "Trade Another Game"}
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
                    <div className="relative mt-3">
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
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Filter Chips */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPlatformFilter("all")}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                        platformFilter === "all"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      {lang === "ar" ? "جميع الألعاب" : "All Games"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlatformFilter("switch2")}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                        platformFilter === "switch2"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      🎮 {lang === "ar" ? "ألعاب Switch 2" : "Switch 2 Games"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlatformFilter("switch1")}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                        platformFilter === "switch1"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      🕹️ {lang === "ar" ? "ألعاب Switch 1" : "Switch 1 Games"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlatformFilter("top")}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                        platformFilter === "top"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      💎 {lang === "ar" ? "الأعلى قيمة" : "Top Value"}
                    </button>
                  </div>

                  {searching && (
                    <div className="space-y-3" aria-busy="true">
                      <Skeleton className="h-20" />
                      <Skeleton className="h-20" />
                    </div>
                  )}

                  {!searching && displayedGames.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-muted-foreground mb-2.5 flex items-center justify-between">
                        <span>
                          {term.trim().length >= 2
                            ? `${lang === "ar" ? "نتائج البحث" : "Search results"} (${displayedGames.length})`
                            : `${lang === "ar" ? "ألعاب الكتالوج المعتمد للمقايضة" : "Accepted Games Catalog"} (${displayedGames.length})`}
                        </span>
                        <span className="text-[11px] text-primary font-bold">
                          {lang === "ar" ? "تسعير رسمي معتمد" : "Official Pricing"}
                        </span>
                      </div>

                      <ul className="divide-y divide-border rounded-2xl border border-border overflow-hidden max-h-[460px] overflow-y-auto bg-background shadow-sm">
                        {displayedGames.map((g) => {
                          const baseVal = Number(g.trade_value_iqd || 0);
                          const bonusVal = Number(g.store_offer_bonus_iqd || 0);
                          const totalCredit = baseVal + bonusVal;

                          return (
                            <li key={g.game_id || g.title}>
                              <button
                                type="button"
                                onClick={() => pickGame(g)}
                                className="w-full flex items-center gap-4 p-3.5 text-start hover:bg-muted/50 transition-colors"
                              >
                                {g.cover_url ? (
                                  <img
                                    src={g.cover_url}
                                    alt={g.title}
                                    loading="lazy"
                                    className="w-12 h-16 rounded-lg object-cover shrink-0 shadow-sm"
                                  />
                                ) : (
                                  <span className="grid place-items-center w-12 h-16 rounded-lg bg-muted shrink-0">
                                    <Gamepad2
                                      className="w-5 h-5 text-muted-foreground"
                                      aria-hidden="true"
                                    />
                                  </span>
                                )}
                                <span className="flex-1 min-w-0">
                                  <span className="block font-bold text-sm text-foreground truncate">
                                    {g.canonical_name || g.title}
                                  </span>
                                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                                    {g.switch_version ? (
                                      <span className="bg-primary/10 text-primary font-bold text-[10px] px-2 py-0.5 rounded">
                                        {g.switch_version}
                                      </span>
                                    ) : (
                                      <span>{g.platform || "Nintendo Switch"}</span>
                                    )}
                                    {baseVal > 0 ? (
                                      <span className="font-black text-amber-600 dark:text-amber-400">
                                        {formatIqd(baseVal)}
                                      </span>
                                    ) : (
                                      <span>
                                        {lang === "ar"
                                          ? "السعر بعد الفحص"
                                          : "Price upon inspection"}
                                      </span>
                                    )}
                                    {bonusVal > 0 && (
                                      <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] px-2 py-0.5 rounded">
                                        +{formatIqd(bonusVal)}{" "}
                                        {lang === "ar" ? "مكافأة متجر" : "Store Bonus"}
                                      </span>
                                    )}
                                  </span>
                                </span>

                                <div className="text-end shrink-0">
                                  {totalCredit > 0 && (
                                    <div className="text-xs font-black text-foreground">
                                      {formatIqd(totalCredit)}
                                    </div>
                                  )}
                                  <ChevronRight
                                    className={`w-4 h-4 text-muted-foreground inline-block mt-1 ${
                                      dir === "rtl" ? "rotate-180" : ""
                                    }`}
                                    aria-hidden="true"
                                  />
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-2xl border border-dashed border-border p-6 text-center bg-muted/20">
                    <PlusCircle className="w-6 h-6 text-primary mx-auto" aria-hidden="true" />
                    <p className="mt-2 font-bold text-sm text-foreground">{L("no_game_title")}</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                      {L("no_game_description")}
                    </p>
                    <button
                      type="button"
                      onClick={startManual}
                      className="mt-4 px-6 py-2.5 rounded-xl bg-foreground text-background font-bold text-xs hover:opacity-90 transition-opacity shadow-sm"
                    >
                      {L("manual_entry_title") ||
                        (lang === "ar" ? "إدخال يدوي مباشر" : "Manual Entry")}
                    </button>
                  </div>
                </motion.div>
              )}

              {step === 1 && game && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6 space-y-6"
                >
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-3.5 border border-border">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {game.cover_url ? (
                        <img
                          src={game.cover_url}
                          alt={game.title}
                          loading="lazy"
                          className="w-11 h-14 rounded-lg object-cover shrink-0 shadow-sm"
                        />
                      ) : (
                        <span className="grid place-items-center w-11 h-14 rounded-lg bg-background shrink-0">
                          <Gamepad2 className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        {isCustom ? (
                          <input
                            type="text"
                            aria-label="اسم اللعبة"
                            value={game.title}
                            maxLength={120}
                            onChange={(e) =>
                              setGame((g) => (g ? { ...g, title: e.target.value } : g))
                            }
                            placeholder={lang === "ar" ? "اكتب اسم اللعبة..." : "Game title..."}
                            className="w-full bg-background border border-border rounded-xl px-3 py-1.5 text-sm outline-none focus:border-primary"
                          />
                        ) : (
                          <p className="font-bold text-sm truncate text-foreground">{game.title}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">{game.platform}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(0)}
                      className="text-xs font-bold text-primary hover:underline shrink-0 px-2"
                    >
                      {lang === "ar" ? "تغيير" : "Change"}
                    </button>
                  </div>

                  <div>
                    <h2 className="font-black text-lg text-foreground">{L("condition_title")}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {L("condition_description")}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${conditionProgress}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-muted-foreground tabular-nums">
                        {answeredCategories}/{categories.length || 0}
                      </span>
                    </div>
                  </div>

                  {categories.length === 0 ? (
                    <div className="space-y-2">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ) : (
                    categories.map((cat) => {
                      const override = cfg.condition_category_content?.[cat];
                      const options = grouped[cat] ?? [];
                      if (!options.length) return null;
                      const answered = Boolean(selections[cat]);
                      return (
                        <fieldset
                          key={cat}
                          className="rounded-2xl border border-border bg-background p-4 shadow-sm"
                        >
                          <legend className="px-1 text-xs font-bold text-foreground inline-flex items-center gap-1.5">
                            {answered && (
                              <CheckCircle2
                                className="w-3.5 h-3.5 text-primary"
                                aria-hidden="true"
                              />
                            )}
                            {override?.title_ar || CATEGORY_LABEL_AR[cat] || cat}
                          </legend>
                          {override?.description_ar && (
                            <p className="text-xs text-muted-foreground mb-2">
                              {override.description_ar}
                            </p>
                          )}
                          <div className="grid sm:grid-cols-2 gap-2 mt-1">
                            {options.map((r) => (
                              <ChoiceCard
                                key={r.key}
                                selected={selections[cat] === r.key}
                                title={r.label_ar}
                                hint={
                                  Number(r.percent) !== 0
                                    ? `${Number(r.percent) > 0 ? "+" : ""}${r.percent}%`
                                    : undefined
                                }
                                onSelect={() => setSelections((s) => ({ ...s, [cat]: r.key }))}
                              />
                            ))}
                          </div>
                        </fieldset>
                      );
                    })
                  )}

                  {/* Sticky Price Preview Widget */}
                  <div className="sticky bottom-20 rounded-2xl border border-primary/30 bg-card/95 backdrop-blur p-4 shadow-lg">
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {lang === "ar" ? "القيمة التقديرية الحالية" : "Current Estimated Value"}
                    </p>
                    {isCustom ? (
                      <p className="mt-1 text-sm font-bold text-foreground">
                        {lang === "ar"
                          ? "السعر بعد المراجعة من فريق بنانتو"
                          : "Price confirmed after review"}
                      </p>
                    ) : quoting ? (
                      <Skeleton className="mt-2 h-8 w-32" />
                    ) : priced && quote ? (
                      <p className="mt-1 text-2xl font-black text-foreground">
                        {formatIqd(Number(quote.final_iqd))}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm font-bold text-foreground">
                        {lang === "ar"
                          ? "السعر بعد المراجعة من فريق بنانتو"
                          : "Price confirmed after review"}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                      {lang === "ar"
                        ? "تُضاف القيمة إلى محفظتك بعد فحص القرص"
                        : "Credited to wallet after disc verification"}
                    </p>
                  </div>

                  <div className="flex gap-3">
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
                      disabled={!game.title.trim()}
                      onClick={() => setStep(2)}
                      className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity shadow-sm"
                    >
                      {lang === "ar" ? "متابعة" : "Continue"}
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
                    <h2 className="font-black text-lg text-foreground">{L("photos_title")}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{L("photos_description")}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {photos.map((url) => (
                      <div
                        key={url}
                        className="relative rounded-2xl overflow-hidden border border-border aspect-square shadow-sm"
                      >
                        <img src={url} alt="صورة اللعبة" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          aria-label="حذف الصورة"
                          onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                          className="absolute top-1.5 end-1.5 grid place-items-center w-7 h-7 rounded-full bg-background/90 text-foreground hover:bg-rose-500 hover:text-white transition-colors shadow-sm"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                    {photos.length < maxPhotos && (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        className="aspect-square rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-60 bg-muted/20"
                      >
                        <Camera className="w-6 h-6" aria-hidden="true" />
                        <span className="text-xs font-bold mt-1.5">
                          {uploading
                            ? lang === "ar"
                              ? "جارٍ الرفع…"
                              : "Uploading…"
                            : lang === "ar"
                              ? "إضافة صورة"
                              : "Add Photo"}
                        </span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onPickFiles}
                  />

                  <fieldset>
                    <legend className="text-xs font-bold text-foreground mb-2">
                      {lang === "ar" ? "ملاحظات إضافية (اختياري)" : "Notes (Optional)"}
                    </legend>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={
                        lang === "ar"
                          ? "أي تفاصيل إضافية حول حالة الغلاف أو القرص..."
                          : "Any details about the disc or case..."
                      }
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 outline-none focus:border-primary text-sm resize-none shadow-sm"
                    />
                  </fieldset>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="flex-1 py-3 rounded-2xl bg-muted font-bold text-foreground text-sm hover:bg-muted/80 transition-colors"
                    >
                      {lang === "ar" ? "رجوع" : "Back"}
                    </button>
                    <button
                      type="button"
                      disabled={cfg.photos_required !== false && photos.length === 0}
                      onClick={() => setStep(3)}
                      className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity shadow-sm"
                    >
                      {lang === "ar" ? "شاهد العرض" : "View Offer"}
                    </button>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  key="step-3"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mt-6 space-y-6"
                >
                  <h2 className="font-black text-lg text-foreground">{L("offer_title")}</h2>

                  <div className="rounded-2xl border border-border p-5 bg-background space-y-4 shadow-sm">
                    {quoting ? (
                      <Skeleton className="h-10 w-40" />
                    ) : priced && quote ? (
                      <>
                        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border pb-4">
                          <div>
                            <span className="text-xs font-bold text-muted-foreground block">
                              {lang === "ar"
                                ? "قيمة الاستبدال المقدرة (رصيد المحفظة):"
                                : "Estimated Trade Value (Wallet Credit):"}
                            </span>
                            <span className="text-3xl font-black text-foreground">
                              {formatIqd(Number(quote.final_iqd))}
                            </span>
                          </div>

                          {Number(quote.store_offer_bonus_iqd) > 0 && (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3.5 py-2">
                              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 block">
                                {lang === "ar"
                                  ? "مكافأة مشتريات المتجر الإضافية:"
                                  : "Store Purchase Bonus:"}
                              </span>
                              <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                                +{formatIqd(Number(quote.store_offer_bonus_iqd))}
                              </span>
                            </div>
                          )}
                        </div>

                        <ul className="space-y-2 pt-1">
                          <li className="flex justify-between text-xs text-muted-foreground">
                            <span>
                              {lang === "ar" ? "القيمة الأساسية للعبة" : "Base Game Value"}
                            </span>
                            <span className="font-bold">{formatIqd(Number(quote.base_iqd))}</span>
                          </li>
                          {(quote.lines ?? []).map(
                            (l: {
                              key: string;
                              label: string;
                              percent: number;
                              amount_iqd: number;
                            }) => (
                              <li
                                key={`${l.key}-${l.label}`}
                                className="flex justify-between text-xs text-muted-foreground"
                              >
                                <span>
                                  {l.label} ({l.percent > 0 ? "+" : ""}
                                  {l.percent}%)
                                </span>
                                <span className="font-bold">{formatIqd(l.amount_iqd)}</span>
                              </li>
                            ),
                          )}

                          {Number(quote.store_offer_bonus_iqd) > 0 && (
                            <li className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 pt-2 border-t border-dashed border-border font-bold">
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" />
                                {lang === "ar"
                                  ? "إجمالي القيمة عند الشراء من المتجر:"
                                  : "Total Value for Store Purchases:"}
                              </span>
                              <span>
                                {formatIqd(
                                  Number(
                                    quote.store_offer_total_iqd ||
                                      quote.final_iqd + quote.store_offer_bonus_iqd,
                                  ),
                                )}
                              </span>
                            </li>
                          )}
                        </ul>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-foreground">
                        {lang === "ar"
                          ? "السعر النهائي يتم تحديده بعد مراجعة وفحص القرص من فريق بنانتو."
                          : "Final price will be determined after inspection."}
                      </p>
                    )}
                    <p className="mt-4 text-xs text-muted-foreground bg-muted/40 p-3 rounded-xl">
                      {L("valuation_notice")}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
                    <Wallet className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {lang === "ar" ? "الدفع عبر المحفظة المعتمدة" : "Wallet Credit Payout"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {lang === "ar"
                          ? "تُضاف القيمة المعتمدة إلى رصيد محفظتك في بنانتو بعد إتمام الفحص الفني. لا يوجد دفع نقدي لهذه الخدمة."
                          : "The approved amount will be credited to your Bananto wallet upon physical verification."}
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 text-xs text-foreground cursor-pointer bg-card border border-border p-3.5 rounded-xl hover:border-primary/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-primary rounded shrink-0"
                    />
                    <span className="leading-relaxed">{L("policy_checkbox")}</span>
                  </label>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="flex-1 py-3 rounded-2xl bg-muted font-bold text-foreground text-sm hover:bg-muted/80 transition-colors"
                    >
                      {lang === "ar" ? "رجوع" : "Back"}
                    </button>
                    <button
                      type="button"
                      disabled={!accepted || submit.isPending}
                      onClick={() => submit.mutate()}
                      className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity shadow-sm"
                    >
                      {submit.isPending
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

        {/* Steps / Process */}
        {visible("steps") && (cfg.steps ?? []).length > 0 && (
          <section className="space-y-4">
            <h2 className="font-black text-lg text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {lang === "ar" ? "كيف تتم عملية المقايضة؟" : "How Trade-in Works"}
            </h2>
            <div className="grid sm:grid-cols-4 gap-3.5">
              {[...(cfg.steps ?? [])]
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

        {/* Trade History */}
        {user && visible("history") && (
          <section className="space-y-4">
            <h2 className="font-black text-lg text-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-primary" aria-hidden="true" />
              {L("history_title")}
            </h2>
            {historyLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : trades.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
                <p className="font-bold text-foreground">{L("history_empty_title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {L("history_empty_description")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {trades.map((tr: any) => {
                  const normStatus = normalizeTradeStatus(tr.status) as TradeStatus;
                  const idx = FLOW.indexOf(normStatus);
                  const copy = statusCopy(cfg.status_content, normStatus, lang);
                  const terminal = normStatus === "rejected" || normStatus === "cancelled";
                  const nodes = FLOW.map((s, i) => {
                    const c = statusCopy(cfg.status_content, s, lang);
                    // Never show a raw status key: fall back to the canonical
                    // Arabic label when the editable copy has no entry.
                    const title = c.title && c.title !== s ? c.title : TRADE_STATUS_LABEL_AR[s];
                    return {
                      status: s,
                      title,
                      description: i === idx ? c.description : "",
                      done: idx > i,
                      current: idx === i,
                    };
                  });
                  // Approximate vs approved, never merged into one ambiguous figure.
                  const pricing = readTradePricing(tr);
                  const badgeStyle =
                    TRADE_STATUS_BADGE_STYLE[normStatus] || "bg-primary/10 text-primary";

                  return (
                    <article
                      key={tr.id}
                      className="rounded-3xl border border-border bg-card p-5 md:p-6 shadow-sm hover:border-primary/30 transition-colors space-y-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-foreground text-base">{tr.game_name}</h3>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              TRADE_PRICING_MODE_BADGE_STYLE[pricing.mode]
                            }`}
                          >
                            {pricing.modeLabel}
                          </span>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(tr.created_at).toLocaleDateString(
                              lang === "ar" ? "ar-EG" : "en-US",
                              { year: "numeric", month: "short", day: "numeric" },
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-3.5 py-1 text-xs font-black border ${badgeStyle}`}
                          >
                            {TRADE_STATUS_LABEL_AR[normStatus] || copy.title}
                          </span>
                        </div>
                      </div>

                      {/*
                        Two lines, always both present. The approved price shows
                        a dash until an admin has actually committed to one, so
                        an estimate is never mistaken for a final offer.
                      */}
                      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-3">
                        <div>
                          <span className="block text-[11px] font-bold text-muted-foreground">
                            {lang === "ar" ? "السعر التقريبي" : "Estimated price"}
                          </span>
                          <span
                            className={`text-sm font-black ${
                              pricing.estimateIqd !== null
                                ? "text-foreground"
                                : "text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {pricing.estimateLabel}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] font-bold text-muted-foreground">
                            {lang === "ar" ? "السعر النهائي المعتمد" : "Approved price"}
                          </span>
                          <span
                            className={`text-sm font-black ${
                              pricing.approvedIqd !== null
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {pricing.approvedLabel}
                          </span>
                        </div>
                      </div>

                      {/*
                        Said the way the member was actually paid.

                        This announced "credited to your wallet" for every
                        settled trade, including the cash ones — telling
                        somebody their money is somewhere it is not, and
                        sending them to a wallet page that would not show it.
                      */}
                      {tr.payout_credited === 1 &&
                        (tr.payoutMethod === "cash" || tr.payout_type === "cash" ? (
                          <div className="flex items-center gap-1.5 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                            <Banknote className="w-4 h-4" />
                            {lang === "ar"
                              ? `اكتملت المقايضة. مبلغ ${Number(tr.payout_amount_credited ?? pricing.approvedIqd ?? 0).toLocaleString()} د.ع يُسلَّم نقداً حسب اختيارك.`
                              : `Trade complete. ${Number(tr.payout_amount_credited ?? pricing.approvedIqd ?? 0).toLocaleString()} IQD is paid in cash, as you chose.`}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                            <span className="flex items-center gap-1.5">
                              <Wallet className="w-4 h-4" />
                              {lang === "ar"
                                ? `تم إيداع مبلغ المقايضة (${Number(tr.payout_amount_credited ?? pricing.approvedIqd ?? 0).toLocaleString()} د.ع) في محفظتك بنجاح!`
                                : `Trade payout of ${Number(tr.payout_amount_credited ?? pricing.approvedIqd ?? 0).toLocaleString()} IQD credited to your wallet!`}
                            </span>
                            <a href="/wallet" className="underline hover:opacity-80">
                              {lang === "ar" ? "عرض المحفظة" : "View Wallet"}
                            </a>
                          </div>
                        ))}

                      {terminal ? (
                        <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-xl">
                          {copy.description}
                        </p>
                      ) : (
                        <div>
                          <StatusTimeline nodes={nodes} />
                        </div>
                      )}

                      {tr.admin_notes && (
                        <p className="rounded-2xl bg-primary/5 border border-primary/15 p-3.5 text-xs text-foreground font-medium">
                          <strong className="block text-primary text-[11px] mb-0.5">
                            {lang === "ar" ? "ملاحظات الإدارة:" : "Admin Notes:"}
                          </strong>
                          {tr.admin_notes}
                        </p>
                      )}

                      {/* User Actions based on status */}
                      {normStatus === "awaiting_customer_approval" && (
                        <div className="pt-2 border-t border-border flex flex-wrap items-center justify-end gap-2.5">
                          <button
                            type="button"
                            disabled={cancelTrade.isPending}
                            onClick={() => cancelTrade.mutate(tr.id)}
                            className="px-3.5 py-1.5 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            {lang === "ar" ? "إلغاء الطلب" : "Cancel Request"}
                          </button>
                          <button
                            type="button"
                            disabled={acceptOffer.isPending}
                            onClick={() => acceptOffer.mutate(tr.id)}
                            className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity shadow-sm"
                          >
                            {acceptOffer.isPending
                              ? lang === "ar"
                                ? "جارٍ القبول..."
                                : "Accepting..."
                              : lang === "ar"
                                ? "قبول العرض وتسليم اللعبة"
                                : "Accept Offer"}
                          </button>
                        </div>
                      )}

                      {(normStatus === "awaiting_pricing" ||
                        normStatus === "priced" ||
                        normStatus === "customer_approved" ||
                        normStatus === "awaiting_receipt") && (
                        <div className="pt-2 border-t border-border flex justify-end">
                          <button
                            type="button"
                            disabled={cancelTrade.isPending}
                            onClick={() => cancelTrade.mutate(tr.id)}
                            className="text-xs text-rose-500 hover:underline font-bold px-2 py-1"
                          >
                            {cancelTrade.isPending
                              ? lang === "ar"
                                ? "جارٍ الإلغاء..."
                                : "Cancelling..."
                              : lang === "ar"
                                ? "إلغاء طلب المقايضة"
                                : "Cancel Trade Request"}
                          </button>
                        </div>
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
