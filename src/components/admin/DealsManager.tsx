import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Save, Search, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { DealBadge, DealRibbon } from "@/components/deals/DealBadge";
import { adminApi } from "@/lib/api";
import {
  OCCASIONS,
  OCCASION_KEYS,
  applyDealToProduct,
  isWithinWindow,
  liveDealOf,
  occasionTheme,
  readDealsConfig,
  type DealCampaign,
  type DealScope,
  type DealsConfig,
  type OccasionKey,
} from "@/lib/deals";
import { listingPricing } from "@/lib/productPricing";

/**
 * «العروض والمناسبات» — the owner's switchboard for occasion deals.
 *
 * One master switch: on, every live campaign discounts its products; off, every
 * price is exactly what is stored today. Campaigns carry an occasion (each with
 * its own look on the storefront), a percentage, dates, and what they cover.
 * Nothing here edits a price: the discount is applied on the way out, never
 * below cost, and shown as the old price struck through beside the new one.
 */

const PERCENT_CHIPS = [5, 10, 15, 20, 25, 30, 40, 50];

/** ISO → the value a `datetime-local` input shows, in the admin's own clock. */
function toLocalInput(value?: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A `datetime-local` value (read as local time) → ISO, or "" when empty. */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

function newId(): string {
  return `deal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The coming Friday at midnight, local — when a Black Friday usually opens. */
function nextFriday(): Date {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  const days = (5 - at.getDay() + 7) % 7 || 7;
  at.setDate(at.getDate() + days);
  return at;
}

function campaignFor(occasion: OccasionKey): DealCampaign {
  const isBlackFriday = occasion === "black_friday" || occasion === "white_friday";
  const start = isBlackFriday ? nextFriday() : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + (occasion === "flash" ? 1 : isBlackFriday ? 4 : 7));
  return {
    id: newId(),
    occasion,
    label: "",
    percent: 15,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    scope: "games",
    active: true,
  };
}

function statusOf(campaign: DealCampaign, now: number): { text: string; tone: string } {
  if (!campaign.active) return { text: "متوقف", tone: "bg-muted text-muted-foreground" };
  if (campaign.endsAt && now >= Date.parse(campaign.endsAt)) {
    return { text: "انتهى", tone: "bg-muted text-muted-foreground" };
  }
  if (campaign.startsAt && now < Date.parse(campaign.startsAt)) {
    return { text: "مجدول", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  }
  return { text: "فعّال الآن", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
}

export default function DealsManager() {
  const queryClient = useQueryClient();
  const { data: store, isLoading } = useQuery({
    queryKey: ["admin", "deals-store"],
    queryFn: () => adminApi.store(),
  });
  const settings = useMemo(
    () => (store?.settings ?? {}) as Record<string, unknown>,
    [store?.settings],
  );
  const products = useMemo(
    () => ((store?.products ?? []) as unknown as Record<string, unknown>[]).filter(Boolean),
    [store?.products],
  );

  const [config, setConfig] = useState<DealsConfig>({ enabled: false, campaigns: [] });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerQuery, setPickerQuery] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!store || loaded) return;
    setConfig(readDealsConfig(settings));
    setLoaded(true);
  }, [store, loaded, settings]);

  const now = Date.now();
  const update = (id: string, patch: Partial<DealCampaign>) =>
    setConfig((prev) => ({
      ...prev,
      campaigns: prev.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  const remove = (id: string) =>
    setConfig((prev) => ({ ...prev, campaigns: prev.campaigns.filter((c) => c.id !== id) }));
  const add = (occasion: OccasionKey) =>
    setConfig((prev) => ({ ...prev, campaigns: [campaignFor(occasion), ...prev.campaigns] }));

  /*
    What the storefront would show right now with these settings, on the
    admin's own copy of the catalogue (which carries costs, so the preview
    respects the same floor the shop does).
  */
  const preview = useMemo(() => {
    const visible = products.filter((p) => p["isHidden"] !== true);
    let discounted = 0;
    let limited = 0;
    const samples: { product: Record<string, unknown>; dealt: Record<string, unknown> }[] = [];
    for (const product of visible) {
      const dealt = applyDealToProduct(product, config, now);
      if (dealt === product) continue;
      discounted += 1;
      const deal = liveDealOf(dealt, now);
      const wanted = config.campaigns.find((c) => c.id === deal?.id)?.percent;
      if (deal && wanted && deal.percent < wanted) limited += 1;
      if (samples.length < 6) samples.push({ product, dealt });
    }
    return { discounted, limited, samples, total: visible.length };
  }, [products, config, now]);

  const save = async () => {
    for (const c of config.campaigns) {
      if (!(c.percent >= 1 && c.percent <= 90)) {
        toast.error("نسبة الخصم يجب أن تكون بين 1% و90%");
        return;
      }
      if (c.startsAt && c.endsAt && Date.parse(c.endsAt) <= Date.parse(c.startsAt)) {
        toast.error(`تاريخ انتهاء «${c.label || occasionTheme(c.occasion).ar}» قبل بدايته`);
        return;
      }
    }
    setSaving(true);
    try {
      await adminApi.saveStore({ settings: { deals: config } as never });
      toast.success(config.enabled ? "تم الحفظ — العروض تعمل على المتجر" : "تم الحفظ — العروض متوقفة");
      await queryClient.invalidateQueries({ queryKey: ["admin", "deals-store"] });
      await queryClient.invalidateQueries({ queryKey: ["store"] });
    } catch {
      toast.error("فشل الحفظ، حاول مرة أخرى");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !loaded) {
    return <div className="p-6 text-sm text-muted-foreground">جارٍ التحميل…</div>;
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Zap className="h-7 w-7 text-amber-500" />
            العروض والمناسبات
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            خصم حقيقي على سعر اليوم، يظهر للزبون السعر القديم مشطوباً بجانب السعر الجديد مع شارة
            المناسبة. الأسعار المخزنة لا تتغير أبداً، ولا يُباع أي منتج تحت سعر تكلفته.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </div>

      {/* The master switch */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-3xl border p-5 shadow-sm ${
          config.enabled ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card"
        }`}
      >
        <div>
          <p className="text-base font-black">
            {config.enabled ? "العروض تعمل على المتجر" : "العروض متوقفة"}
          </p>
          <p className="text-xs text-muted-foreground">
            {config.enabled
              ? `يُخفَّض الآن ${preview.discounted.toLocaleString("en-US")} من ${preview.total.toLocaleString("en-US")} منتجاً حسب العروض الفعّالة.`
              : "كل الأسعار كما هي اليوم. شغّل المفتاح لتطبيق العروض الفعّالة."}
            {config.enabled && preview.limited > 0
              ? ` (${preview.limited} منتجاً بخصم أقل حتى لا يُباع تحت التكلفة)`
              : ""}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
            config.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
              config.enabled ? "right-1" : "right-7"
            }`}
          />
          <span className="sr-only">تشغيل العروض</span>
        </button>
      </div>

      {/* Start a campaign */}
      <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-black">إضافة عرض مناسبة</h2>
          <button
            type="button"
            onClick={() => add("black_friday")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-bold text-white"
          >
            🖤 الجمعة السوداء على كل الألعاب (15%)
          </button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          رفع اليوان رفع الأسعار 25%؛ خصم 15% يعيد السعر تقريباً إلى ما كان عليه قبل الرفع + 6%
          (مثلاً 13,000 ← 11,000).
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {OCCASION_KEYS.map((key) => {
            const theme = OCCASIONS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => add(key)}
                className="flex items-center justify-between gap-1 rounded-2xl px-3 py-2.5 text-start text-xs font-black shadow-sm transition-transform hover:-translate-y-0.5"
                style={{ background: theme.background, color: theme.foreground }}
              >
                <span className="truncate">
                  <span aria-hidden="true">{theme.emoji}</span> {theme.ar}
                </span>
                <Plus className="h-3.5 w-3.5 shrink-0 opacity-80" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Campaigns */}
      {config.campaigns.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          لا توجد عروض بعد. اختر مناسبة من الأعلى لإضافة عرض.
        </p>
      ) : (
        <div className="space-y-4">
          {config.campaigns.map((campaign) => {
            const theme = occasionTheme(campaign.occasion);
            const status = statusOf(campaign, now);
            const query = (pickerQuery[campaign.id] ?? "").trim().toLowerCase();
            const selected = new Set(campaign.productIds ?? []);
            const matches =
              campaign.scope === "selected" && query
                ? products
                    .filter((p) =>
                      `${p["titleEn"] ?? ""} ${p["title"] ?? ""} ${p["titleAr"] ?? ""}`
                        .toLowerCase()
                        .includes(query),
                    )
                    .slice(0, 12)
                : [];
            const live = config.enabled && campaign.active && isWithinWindow(campaign.startsAt, campaign.endsAt, now);
            return (
              <div key={campaign.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                <div
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  style={{ background: theme.background, color: theme.foreground }}
                >
                  <span className="text-sm font-black">
                    <span aria-hidden="true">{theme.emoji}</span> {campaign.label || theme.ar} —
                    <span dir="ltr"> −{campaign.percent}%</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.tone}`}>
                    {live ? "يظهر الآن للزبائن" : status.text}
                  </span>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold">المناسبة</span>
                    <select
                      value={campaign.occasion}
                      onChange={(e) => update(campaign.id, { occasion: e.target.value as OccasionKey })}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    >
                      {OCCASION_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {OCCASIONS[key].emoji} {OCCASIONS[key].ar} — {OCCASIONS[key].en}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs font-bold">الاسم الظاهر للزبون (اختياري)</span>
                    <input
                      value={campaign.label ?? ""}
                      onChange={(e) => update(campaign.id, { label: e.target.value })}
                      placeholder={theme.ar}
                      maxLength={60}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  <div className="space-y-1 md:col-span-2">
                    <span className="text-xs font-bold">نسبة الخصم</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {PERCENT_CHIPS.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => update(campaign.id, { percent: chip })}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold tabular-nums ${
                            campaign.percent === chip
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-background"
                          }`}
                          dir="ltr"
                        >
                          {chip}%
                        </button>
                      ))}
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={campaign.percent}
                        onChange={(e) => update(campaign.id, { percent: Math.floor(Number(e.target.value) || 0) })}
                        className="w-20 rounded-xl border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
                        dir="ltr"
                        aria-label="نسبة مخصصة"
                      />
                    </div>
                  </div>

                  <label className="space-y-1">
                    <span className="flex items-center gap-1 text-xs font-bold">
                      <CalendarClock className="h-3.5 w-3.5" /> يبدأ
                    </span>
                    <input
                      type="datetime-local"
                      value={toLocalInput(campaign.startsAt)}
                      onChange={(e) => update(campaign.id, { startsAt: fromLocalInput(e.target.value) })}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="flex items-center gap-1 text-xs font-bold">
                      <CalendarClock className="h-3.5 w-3.5" /> ينتهي
                    </span>
                    <input
                      type="datetime-local"
                      value={toLocalInput(campaign.endsAt)}
                      onChange={(e) => update(campaign.id, { endsAt: fromLocalInput(e.target.value) })}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      dir="ltr"
                    />
                  </label>

                  <div className="space-y-2 md:col-span-2">
                    <span className="text-xs font-bold">يشمل</span>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ["games", "كل الألعاب"],
                          ["all", "كل المنتجات"],
                          ["selected", "منتجات مختارة"],
                        ] as [DealScope, string][]
                      ).map(([scope, label]) => (
                        <button
                          key={scope}
                          type="button"
                          onClick={() => update(campaign.id, { scope })}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                            campaign.scope === scope
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-background"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {campaign.scope === "selected" ? (
                      <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3">
                        <div className="relative">
                          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <input
                            value={pickerQuery[campaign.id] ?? ""}
                            onChange={(e) =>
                              setPickerQuery((prev) => ({ ...prev, [campaign.id]: e.target.value }))
                            }
                            placeholder="ابحث عن لعبة لإضافتها…"
                            className="w-full rounded-xl border border-border bg-background py-2 pl-3 pr-9 text-sm"
                          />
                        </div>
                        {matches.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {matches.map((p) => {
                              const id = String(p["id"] ?? "");
                              const on = selected.has(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() =>
                                    update(campaign.id, {
                                      productIds: on
                                        ? [...selected].filter((x) => x !== id)
                                        : [...selected, id],
                                    })
                                  }
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                    on ? "bg-primary text-primary-foreground" : "border border-border bg-background"
                                  }`}
                                  dir="auto"
                                >
                                  {on ? "✓ " : "+ "}
                                  {String(p["titleEn"] || p["title"] || id)}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground">
                          {selected.size} منتجاً مختاراً
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-2 md:col-span-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={campaign.active}
                        onChange={(e) => update(campaign.id, { active: e.target.checked })}
                        className="h-4 w-4"
                      />
                      العرض مفعّل
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(campaign.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف العرض
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* What a shopper will see */}
      <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-base font-black">معاينة ما يراه الزبون الآن</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          بالإعدادات الحالية وقبل الحفظ. (لوحة الإدارة تعرض لك الأسعار الأصلية دائماً؛ لمشاهدة المتجر
          كما يراه الزبون افتحه من نافذة خاصة.)
        </p>
        {preview.samples.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {config.enabled ? "لا يوجد عرض فعّال الآن على أي منتج." : "العروض متوقفة — الأسعار كما هي."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {preview.samples.map(({ product, dealt }) => {
              const deal = liveDealOf(dealt, now);
              const { unitPrice, originalUnitPrice } = listingPricing(dealt);
              return (
                <div key={String(product["id"])} className="overflow-hidden rounded-2xl border border-border">
                  <div className="relative flex aspect-square items-center justify-center bg-muted/40 p-2 text-center text-[11px] font-bold" dir="auto">
                    {String(product["titleEn"] || product["title"] || "")}
                    {deal ? <DealRibbon deal={deal} /> : null}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-1.5 p-2 text-xs font-black tabular-nums" dir="ltr">
                    <span className="text-[10px] font-semibold text-muted-foreground line-through">
                      {originalUnitPrice.toLocaleString("en-US")}
                    </span>
                    <span className="text-[var(--brand-red,#e60012)]">{unitPrice.toLocaleString("en-US")} د.ع</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {preview.samples[0] ? (
          <div className="mt-4">
            {(() => {
              const deal = liveDealOf(preview.samples[0]!.dealt, now);
              return deal ? <DealBadge deal={deal} /> : null;
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
