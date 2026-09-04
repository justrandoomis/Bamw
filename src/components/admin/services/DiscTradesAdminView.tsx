import React, { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  RefreshCw,
  Search,
  Clock,
  Save,
  Edit3,
  Loader2,
  CheckCircle,
  XCircle,
  PlusCircle,
  Image as ImageIcon,
  ExternalLink,
  Gamepad2,
  FileText,
  Sliders,
  SlidersHorizontal,
  ListFilter,
  ArrowLeftRight,
  Wallet,
  ChevronDown,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { readTradePricing } from "@/lib/trade-pricing";
import {
  TRADE_PRICING_MODE_BADGE_STYLE,
  tradePrimaryAction,
  TRADE_STATUS_LABEL_AR,
  TRADE_STATUS_BADGE_STYLE,
  canTransition,
  normalizeTradeStatus,
  CATEGORY_LABEL_AR,
  type TradeStatus,
  TRADE_STATUSES,
} from "@/lib/trade-calc";
import { DiscTradePageEditor } from "./editors/DiscTradePageEditor";
import TradeRulesManager from "./TradeRulesManager";

export default function DiscTradesAdminView() {
  const t = useI18n((s) => s.t);
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"trades" | "rules" | "settings">("trades");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  /*
    The search reaches the database now, so it is not sent on every keystroke.

    250ms is long enough that typing "زيلدا" is one request rather than five,
    and short enough that the list feels like it is answering the box.
  */
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  /*
    Pages, not the newest two hundred.

    This screen asked for `scope=admin` and nothing else, took the two hundred
    rows the endpoint capped at, and filtered them in the browser. A shop with
    more than two hundred trades could not reach the older ones at all, and the
    status filter searched only that window — so "بانتظار المراجعة" could come
    back empty while trades sat waiting for a price.

    Both now happen in the database, over every trade, and the cursor walks
    back through the rest.
  */
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["admin_disc_trades", filterStatus, debouncedSearch],
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ scope: "admin", limit: "50" });
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/disc-trade?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    getNextPageParam: (lastPage: { nextCursor?: string | null }) => lastPage?.nextCursor ?? undefined,
  });

  const updateTrade = useMutation({
    mutationFn: async (vars: any) => {
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_update", trade_id: vars.id, ...vars }),
      });
      const payload = await res.json().catch(() => ({}));
      /*
        The server's own words, not "Failed to update".

        Every refusal this endpoint makes is a sentence written for the person
        clicking — "لا يمكن إرسال العرض قبل إدخال السعر واعتماده", "انتقال غير
        مسموح: …". Throwing a generic message discarded all of it, and with no
        `onError` at all the button simply did nothing: the admin pressed
        "اعتماد السعر" on an unpriced request and watched the screen stay
        exactly as it was, with no way to learn why.
      */
      if (!res.ok) {
        throw new Error(
          String((payload as { error?: string })?.error || "تعذّر حفظ التعديل، حاول مرة أخرى."),
        );
      }
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_disc_trades"] });
      setEditingId(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /*
    The server answered the filter and the search, so nothing is re-filtered
    here: doing it again over the loaded pages is what hid the older trades in
    the first place, and a second copy of the predicate is a second place for
    it to drift.
  */
  const trades: any[] = (data?.pages ?? []).flatMap((page: any) => page?.items ?? []);

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <ArrowLeftRight className="w-6 h-6 text-primary" /> {t("خدمة استبدال ومقايضة الأقراص")}
          </h1>
          <p className="text-muted-foreground text-xs mt-1">
            {t("مراجعة وتسعير طلبات المقايضة وتعديل إعدادات ونصوص واجهة صفحة الاستبدال.")}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-muted p-1 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setViewMode("trades")}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "trades"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListFilter className="w-4 h-4" />
            {t("طلبات الاستبدال")} ({trades.length}
            {hasNextPage ? "+" : ""})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("rules")}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "rules"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            {t("نسب وقواعد التقييم")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("settings")}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "settings"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sliders className="w-4 h-4 text-muted-foreground" />
            {t("تخصيص نصوص الصفحة")}
          </button>
        </div>
      </div>

      {viewMode === "rules" ? (
        <TradeRulesManager />
      ) : viewMode === "settings" ? (
        <DiscTradePageEditor />
      ) : (
        <>
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search
                className={`absolute ${dir === "rtl" ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`}
              />
              <input
                type="text"
                placeholder={t("بحث باسم اللعبة، المنصة، رقم الطلب...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full bg-card border border-border rounded-xl py-2.5 ${
                  dir === "rtl" ? "pr-10 pl-4" : "pl-10 pr-4"
                } text-sm focus:border-primary focus:outline-none`}
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-card border border-border rounded-xl px-4 py-2 text-sm focus:border-primary focus:outline-none font-bold"
            >
              {/*
                Built from the statuses that exist, rather than typed out.

                These options were the previous generation of names —
                waiting_review, waiting_shipment, received, approved,
                coupon_issued, cash_paid. `normalizeTradeStatus` maps every one
                of them away, so six of the nine could never match a row and
                selecting one emptied the list. Worse, there was no option for
                `awaiting_pricing` or `priced` — the two states a request
                waiting for a price actually sits in, which is what the shop
                owner opens this screen to find.
              */}
              <option value="all">{t("كل الحالات")}</option>
              {TRADE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(TRADE_STATUS_LABEL_AR[status])}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {trades.map((trade: any) => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  isEditing={editingId === trade.id}
                  onEdit={() => setEditingId(trade.id)}
                  onCancel={() => setEditingId(null)}
                  onSave={(updates: any) => updateTrade.mutate({ id: trade.id, ...updates })}
                  isSaving={updateTrade.isPending}
                  t={t}
                />
              ))}
              {trades.length === 0 && (
                <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-2xl">
                  {t("لا توجد مقايضات تطابق بحثك.")}
                </div>
              )}
              {hasNextPage && (
                <button
                  type="button"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full py-3 rounded-2xl border border-border bg-card text-sm font-bold flex items-center justify-center gap-2 hover:border-primary disabled:opacity-60"
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  {t("عرض المزيد")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TradeCard({ trade, isEditing, onEdit, onCancel, onSave, isSaving, t }: any) {
  const normStatus = normalizeTradeStatus(trade.status) as TradeStatus;
  const pricing = readTradePricing(trade);
  const primaryAction = tradePrimaryAction(normStatus);
  const [adminValuation, setAdminValuation] = useState(
    trade.approved_iqd ?? trade.admin_valuation_iqd ?? trade.valuation_iqd ?? "",
  );
  const [adminNotes, setAdminNotes] = useState(trade.admin_notes || "");
  const isCustom = !trade.game_id || trade.game_id === "custom";

  /*
    The current status is the default, not a remembered one.

    This used to default to a `useState` initialised from the prop when the
    card first mounted. The list refetches, so a request the customer accepted
    two minutes ago still carried its old status in that state — and "حفظ فقط",
    which is meant to save a price and a note, sent it back and rewound the
    request to a stage it had already passed.
  */
  const handleSave = (nextStatus: string = normStatus) => {
    onSave({
      status: nextStatus,
      approved_iqd:
        adminValuation !== "" && adminValuation !== null ? Number(adminValuation) : null,
      admin_notes: adminNotes,
    });
  };

  /*
    One button, and it says what happens next.

    The status used to be a dropdown of every reachable state, which put the
    burden of knowing the workflow on whoever was clicking and let the same
    stage be recorded three different ways. The status is now a consequence of
    the action, so it cannot be set to something the work has not reached.
  */
  const runPrimaryAction = () => {
    if (!primaryAction) return;
    handleSave(primaryAction.next);
  };

  const badgeStyle = TRADE_STATUS_BADGE_STYLE[normStatus] || "bg-muted text-muted-foreground";

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-lg text-foreground">{trade.game_name}</h3>
            {/* Which of the two pricing flows this request is on. */}
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold border ${
                TRADE_PRICING_MODE_BADGE_STYLE[pricing.mode]
              }`}
            >
              {pricing.modeLabel}
            </span>
            {isCustom && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                <PlusCircle className="w-3 h-3" />
                {t("إضافة يدوية")}
              </span>
            )}
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-muted text-muted-foreground">
              {trade.platform || "Nintendo Switch"}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeStyle}`}>
              {TRADE_STATUS_LABEL_AR[normStatus] || normStatus}
            </span>
            {trade.payout_credited === 1 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                {t("تم إيداع الرصيد بالمحفظة")}
              </span>
            )}
            <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
              #{trade.id.slice(0, 8)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {new Date(trade.created_at).toLocaleString()}
            </span>
            {trade.user_id && (
              <span className="font-mono text-[11px]">User ID: {trade.user_id.slice(0, 10)}</span>
            )}
          </div>
        </div>

        {!isEditing && (
          <button
            onClick={onEdit}
            className="text-primary hover:bg-primary/10 px-3.5 py-1.5 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors border border-primary/20"
          >
            <Edit3 className="w-4 h-4" /> {t("تسعير وإدارة")}
          </button>
        )}
      </div>

      {/* Grid of Key Values */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 py-3 border-y border-border">
        {/*
          Two numbers, never conflated: what the site estimated, and what the
          business actually committed to. A manual request with no estimate says
          so explicitly rather than showing a bare "غير مسعر", which read as an
          error rather than as "a person still has to price this".
        */}
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("السعر التقريبي")}
          </span>
          <div
            className={`text-sm font-bold ${
              pricing.estimateIqd !== null ? "text-primary" : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {pricing.estimateLabel}
          </div>
        </div>
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("السعر النهائي المعتمد")}
          </span>
          <div
            className={`text-sm font-bold ${
              pricing.approvedIqd !== null ? "text-emerald-500" : "text-muted-foreground"
            }`}
          >
            {pricing.approvedLabel}
          </div>
        </div>
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("نوع التعويض")}
          </span>
          {/*
            `preferred_trade` is store credit on every row: the form hardcodes
            it and sends it regardless. The customer's real answer is the
            `payout_method` they picked in the condition step — and it is the
            one the quote was calculated from, so settling on the column would
            pay a cash request in store credit.
          */}
          <div className="text-sm font-bold flex items-center gap-1">
            {(trade.payoutMethod ?? trade.preferred_trade) === "cash" ? (
              t("نقداً")
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t("رصيد متجر")}
                {Number(trade.store_offer_bonus_iqd) > 0 && (
                  <span className="text-xs font-normal text-muted-foreground mr-1">
                    (+{Number(trade.store_offer_bonus_iqd).toLocaleString()} بونص)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Selections & Details Info */}
      <div className="flex flex-wrap gap-4 items-start text-xs">
        {/*
          The disc's condition, which is the whole reason this screen exists.

          This panel used to be unreachable. `selections` arrives from D1 as
          the JSON *string* it was written as, and the guard here asked for
          `typeof === "object"` — never true — so the shop owner was asked to
          price a disc with nothing on screen about the disc. Under that, the
          stored values are rule keys, so even parsed it would have printed
          `cart_scratched`. The server resolves both now and sends finished
          labels with the percentage each answer moves the price.
        */}
        {Array.isArray(trade.conditionAnswers) && trade.conditionAnswers.length > 0 && (
          <div className="flex-1 bg-muted/40 p-3 rounded-xl space-y-1">
            <span className="font-bold text-muted-foreground block mb-1">
              {t("خيارات الحالة:")}
            </span>
            <div className="flex flex-wrap gap-2">
              {trade.conditionAnswers.map((answer: any) => (
                <span
                  key={answer.category}
                  className="bg-background border border-border px-2 py-1 rounded-lg text-foreground font-medium"
                >
                  <span className="text-muted-foreground">{answer.categoryLabel}: </span>
                  <strong>{answer.valueLabel}</strong>
                  {Number(answer.percent) !== 0 && (
                    <span
                      className={`text-[10px] font-bold mr-1 ${
                        Number(answer.percent) > 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {Number(answer.percent) > 0 ? "+" : ""}
                      {Number(answer.percent)}%
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/*
          Every photo the customer sent, not just the first.

          They may upload up to five. The rest went into `disc_trade_images`,
          a table nothing in the repository had ever read — so the close-up of
          the scratch, usually the one shot that decides the price, was in the
          database and unreachable. `photos` carries them all now, thumbnail
          included and never twice.
        */}
        {Array.isArray(trade.photos) && trade.photos.length > 0 && (
          <div className="flex items-center gap-2 bg-muted/40 p-2 rounded-xl">
            <div className="flex gap-1.5 flex-wrap">
              {trade.photos.map((photo: any, index: number) => (
                <a
                  key={`${photo.url}-${index}`}
                  href={photo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative group w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0"
                >
                  <img
                    src={photo.url}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    alt=""
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </div>
                </a>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-bold text-foreground block">
                {trade.photos.length > 1
                  ? `${trade.photos.length} ${t("صور مرفقة")}`
                  : t("صورة مرفقة")}
              </span>
              <span>{t("اضغط أي صورة لعرضها بالحجم الكامل")}</span>
            </div>
          </div>
        )}

        {/*
          What the catalogue says the disc is worth, beside what the customer
          is being offered. A manual price is a judgement, and it was being
          asked for with no reference number on the screen.
        */}
        {(trade.catalogValuationIqd !== null && trade.catalogValuationIqd !== undefined) && (
          <div className="bg-muted/40 p-3 rounded-xl">
            <span className="font-bold text-muted-foreground block mb-1">
              {t("قيمة الكتالوج المرجعية")}
            </span>
            <div className="text-sm font-bold text-foreground">
              {Number(trade.catalogValuationIqd).toLocaleString()} {t("د.ع")}
            </div>
            {Number(trade.catalogBonusIqd) > 0 && (
              <div className="text-[11px] text-muted-foreground">
                +{Number(trade.catalogBonusIqd).toLocaleString()} {t("بونص رصيد المتجر")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Notes */}
      {trade.notes && (
        <div className="text-xs bg-muted/60 p-3 rounded-xl text-foreground">
          <strong className="block text-muted-foreground mb-0.5">{t("ملاحظات العميل:")}</strong>
          {trade.notes}
        </div>
      )}

      {/* Editing Form */}
      {isEditing ? (
        <div className="bg-muted p-5 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 border border-primary/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1.5">{t("الحالة الحالية")}</label>
              {/*
                Read-only. The status follows from the action taken, so there is
                nothing to choose here — the primary button below is what moves
                it, and only ever to the next step.
              */}
              <div className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold text-muted-foreground">
                {TRADE_STATUS_LABEL_AR[normStatus] || normStatus}
                {primaryAction ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {" "}
                    ← {primaryAction.label}
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5 text-emerald-600 dark:text-emerald-400">
                {pricing.mode === "manual"
                  ? t("أدخل السعر يدوياً (د.ع)")
                  : t("راجع أو عدّل السعر المعتمد (د.ع)")}
              </label>
              <input
                type="number"
                placeholder={
                  pricing.mode === "manual"
                    ? t("لا يوجد سعر تلقائي — أدخل القيمة")
                    : t("القيمة المعتمدة بالدينار")
                }
                value={adminValuation}
                onChange={(e) => setAdminValuation(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:border-primary outline-none font-bold"
              />
              {pricing.needsManualPricing && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {t("هذا الطلب بانتظار التسعير اليدوي قبل إرساله للعميل.")}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 text-primary">
              {t("ملاحظات للإدارة وتوضيح للعميل")}
            </label>
            <textarea
              placeholder={t("اكتب أي توضيح للعميل بخصوص التقييم، الاستلام أو حالة القرص...")}
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:border-primary outline-none min-h-[70px]"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-background rounded-xl transition-colors"
            >
              {t("إلغاء")}
            </button>
            <button
              onClick={() => handleSave()}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-bold text-foreground border border-border rounded-xl hover:bg-background transition-colors flex items-center gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}{" "}
              {t("حفظ فقط")}
            </button>
            {/*
              The single primary action. Its label is the next step of the
              workflow, and taking it is what moves the status — there is no
              way to set a status the work has not reached.
            */}
            {/*
              Abandoning a request, which the server has always allowed and no
              screen offered.

              `canTransition` lets an admin reject or cancel at any point before
              a trade is finished, and the card had one button: the next step.
              So a disc that turned out to be unsellable, or a customer who
              changed their mind, left a request sitting in the queue for ever —
              and the member was never told why nothing happened. The note is
              required because it is the only thing they will be shown.
            */}
            {normStatus !== "completed" &&
              normStatus !== "rejected" &&
              normStatus !== "cancelled" && (
                <>
                  <button
                    onClick={() => {
                      if (!adminNotes.trim()) {
                        window.alert(t("اكتب سبب الرفض في ملاحظات الإدارة أولاً — العميل سيقرأه."));
                        return;
                      }
                      if (window.confirm(t("رفض هذا الطلب نهائياً؟"))) handleSave("rejected");
                    }}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm font-bold text-rose-600 border border-rose-500/30 rounded-xl hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                  >
                    {t("رفض الطلب")}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(t("إلغاء هذا الطلب؟"))) handleSave("cancelled");
                    }}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm font-bold text-muted-foreground border border-border rounded-xl hover:bg-background transition-colors disabled:opacity-40"
                  >
                    {t("إلغاء الطلب")}
                  </button>
                </>
              )}

            {primaryAction && (
              <button
                onClick={runPrimaryAction}
                disabled={isSaving || (pricing.needsManualPricing && adminValuation === "")}
                className="px-5 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}{" "}
                {t(primaryAction.label)}
              </button>
            )}
          </div>
        </div>
      ) : (
        trade.admin_notes && (
          <div className="text-sm bg-primary/10 text-primary p-3.5 rounded-xl border border-primary/20">
            <strong className="block mb-1 text-xs font-bold">{t("رسالة الإدارة للعميل:")}</strong>
            {trade.admin_notes}
          </div>
        )
      )}
    </div>
  );
}
