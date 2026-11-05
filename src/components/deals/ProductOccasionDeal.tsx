import { CalendarClock, Zap } from "lucide-react";

import {
  OCCASIONS,
  OCCASION_KEYS,
  costFloor,
  dealPrice,
  occasionTheme,
  readProductDealOverride,
  safePercent,
  type OccasionKey,
  type ProductDealOverride,
} from "@/lib/deals";

/**
 * «خصم المناسبة» on a product's edit page.
 *
 * A product follows the store-wide campaigns («العروض والمناسبات»), sits them
 * out, or carries its own occasion, percentage and dates. Saved as
 * `occasionDeal`; the stored price is never touched — the storefront shows the
 * old price struck through beside the new one while the deal is live.
 */

function toLocalInput(value?: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

const MODES: [ProductDealOverride["mode"], string, string][] = [
  ["inherit", "يتبع العروض العامة", "يأخذ خصم أي عرض فعّال يشمله"],
  ["custom", "عرض خاص لهذا المنتج", "مناسبة ونسبة وتواريخ لهذا المنتج فقط"],
  ["exclude", "مستثنى من العروض", "يبقى بسعره دائماً"],
];

export function ProductOccasionDeal({
  product,
  onChange,
}: {
  product: Record<string, unknown>;
  onChange: (value: ProductDealOverride) => void;
}) {
  const value = readProductDealOverride(product);
  const theme = occasionTheme(value.occasion ?? "custom");
  const price = Number(product["price"]) || 0;
  const cost = Number(product["cost"]) || 0;
  const percent = value.percent ?? 0;
  const effective = percent ? safePercent(product, percent) : 0;
  const lowered = effective ? dealPrice(price, effective, costFloor(cost)) : price;

  const set = (patch: Partial<ProductDealOverride>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm" dir="rtl">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <Zap className="h-4 w-4 text-amber-500" />
          خصم المناسبة (Occasion deal)
        </h2>
        <span className="text-[11px] text-muted-foreground">
          يعمل عندما تكون العروض مشغّلة في «العروض والمناسبات»
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map(([mode, label, hint]) => (
          <button
            key={mode}
            type="button"
            onClick={() =>
              mode === "custom"
                ? onChange({
                    mode,
                    occasion: value.occasion ?? "black_friday",
                    label: value.label ?? "",
                    percent: value.percent || 15,
                    startsAt: value.startsAt ?? "",
                    endsAt: value.endsAt ?? "",
                  })
                : onChange({ mode })
            }
            className={`rounded-xl border px-3 py-2 text-start ${
              value.mode === mode ? "border-primary bg-primary/10" : "border-border bg-background"
            }`}
          >
            <span className="block text-sm font-bold">{label}</span>
            <span className="block text-[11px] text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      {value.mode === "custom" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-bold">المناسبة</span>
            <select
              value={value.occasion ?? "black_friday"}
              onChange={(e) => set({ occasion: e.target.value as OccasionKey })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {OCCASION_KEYS.map((key) => (
                <option key={key} value={key}>
                  {OCCASIONS[key].emoji} {OCCASIONS[key].ar} — {OCCASIONS[key].en}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">الاسم الظاهر (اختياري)</span>
            <input
              value={value.label ?? ""}
              onChange={(e) => set({ label: e.target.value })}
              placeholder={theme.ar}
              maxLength={60}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">نسبة الخصم %</span>
            <input
              type="number"
              min={1}
              max={90}
              value={percent || ""}
              onChange={(e) => set({ percent: Math.floor(Number(e.target.value) || 0) })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
              dir="ltr"
            />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-bold">المعاينة</span>
            <div
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-black"
              style={{ background: theme.background, color: theme.foreground }}
            >
              <span className="truncate">
                {theme.emoji} {value.label || theme.ar}
              </span>
              <span className="tabular-nums" dir="ltr">
                <span className="me-1.5 text-[11px] line-through opacity-75">
                  {price.toLocaleString("en-US")}
                </span>
                {lowered.toLocaleString("en-US")} د.ع
              </span>
            </div>
            {percent && effective < percent ? (
              <p className="text-[11px] font-bold text-amber-600">
                {effective
                  ? `سيُطبَّق ${effective}% فقط حتى لا يُباع تحت سعر التكلفة.`
                  : "لا يمكن الخصم: السعر قريب جداً من التكلفة."}
              </p>
            ) : null}
          </div>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-bold">
              <CalendarClock className="h-3.5 w-3.5" /> يبدأ
            </span>
            <input
              type="datetime-local"
              value={toLocalInput(value.startsAt)}
              onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              dir="ltr"
            />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-bold">
              <CalendarClock className="h-3.5 w-3.5" /> ينتهي
            </span>
            <input
              type="datetime-local"
              value={toLocalInput(value.endsAt)}
              onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              dir="ltr"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
