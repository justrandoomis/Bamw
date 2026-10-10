import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  EyeOff,
  Gift,
  ImageOff,
  MessageSquare,
  Package,
  Pencil,
  ShoppingCart,
  Star,
  Tag,
  Ticket,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { financeTotals, orderFinance } from "@/lib/finance";
import { normalizePromotions } from "@/lib/promotions";
import { cn } from "@/lib/utils";

import { orderNeedsAction, threadWaitsForAdmin } from "./shell/adminNav";
import { StoreAdvisorSection } from "./StoreAdvisorSection";

type Row = Record<string, any>;

const num = (n: number) => Math.round(n || 0).toLocaleString("en-US");
const dinars = (n: number) => `${num(n)} د.ع`;

const PERIODS = [
  { id: "day", label: "اليوم", days: 1 },
  { id: "week", label: "7 أيام", days: 7 },
  { id: "month", label: "30 يوماً", days: 30 },
  { id: "year", label: "سنة", days: 365 },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "قيد الانتظار", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  processing: { label: "قيد المعالجة", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  delivering: {
    label: "قيد التسليم",
    tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  },
  awaiting_customer_confirmation: {
    label: "بانتظار تأكيد العميل",
    tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
  delivery_issue: { label: "مشكلة تسليم", tone: "bg-rind/15 text-rind" },
  completed: { label: "مكتمل", tone: "bg-leaf/15 text-leaf" },
  cancelled: { label: "ملغي", tone: "bg-muted text-muted-foreground" },
};

const createdAtOf = (row: Row) => Date.parse(String(row?.createdAt ?? row?.created_at ?? ""));

/**
 * The admin's first screen, rebuilt around one question: what is waiting on
 * me right now?
 *
 * That answer is the loud part — three numbers, each a door to the screen
 * that clears it, and calm when there is nothing. Everything below is quiet
 * and scannable: the takings for a period the admin picks, the last orders,
 * the state of the catalogue, and the shop's campaigns.
 *
 * Revenue goes through `financeTotals`, the finance screen's own reckoning:
 * goods only, never the courier's fee, and a cancelled order is not a sale.
 */
export default function AdminHome({
  changeTab,
  orders = [],
  threads = [],
  gameRequests = [],
  products = [],
  categories = [],
  catalogue,
  visits = 0,
  views = 0,
}: {
  changeTab: (tab: string) => void;
  orders?: Row[];
  threads?: Row[];
  gameRequests?: Row[];
  products?: Row[];
  categories?: Row[];
  catalogue: { total: number | null; hidden: number; unpriced: number };
  visits?: number;
  views?: number;
}) {
  const [period, setPeriod] = useState<PeriodId>("week");

  const ordersWaiting = orders.filter(orderNeedsAction).length;
  const chatsWaiting = threads.filter(threadWaitsForAdmin).length;
  const requestsWaiting = gameRequests.filter((r) => String(r?.status ?? "") === "pending").length;

  const days = PERIODS.find((p) => p.id === period)!.days;
  const since = Date.now() - days * 86_400_000;
  const inPeriod = useMemo(
    () =>
      orders.filter((o) => {
        const at = createdAtOf(o);
        return Number.isNaN(at) ? false : at >= since;
      }),
    [orders, since],
  );
  const totals = financeTotals(inPeriod as never);
  const averageOrder = totals.orders ? totals.net / totals.orders : 0;

  const recent = useMemo(
    () =>
      [...orders]
        .filter((o) => !Number.isNaN(createdAtOf(o)))
        .sort((a, b) => createdAtOf(b) - createdAtOf(a))
        .slice(0, 6),
    [orders],
  );

  const { data: reviews } = useQuery({
    queryKey: ["admin_community_reviews"],
    queryFn: async () => {
      const res = await fetch("/api/reviews?scope=all", { credentials: "include" });
      if (!res.ok) return { reviews: [] as Row[] };
      return (await res.json()) as { reviews?: Row[] };
    },
    staleTime: 30_000,
  });
  const reviewList = reviews?.reviews ?? [];
  const rating = reviewList.length
    ? reviewList.reduce((sum, r) => sum + (Number(r?.rating) || 5), 0) / reviewList.length
    : null;

  const { data: promotions } = useQuery({
    queryKey: ["admin", "promotions"],
    queryFn: async () => {
      const res = await fetch("/api/promotions", { credentials: "include", cache: "no-store" });
      return normalizePromotions(res.ok ? await res.json() : undefined);
    },
    staleTime: 30_000,
  });

  const today = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-8">
      <Greeting today={today} rating={rating} reviews={reviewList.length} changeTab={changeTab} />

      {/* ───────────────── Waiting on you — the one loud part ───────────────── */}
      <section aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="mb-3 text-[15px] font-black">
          بانتظارك الآن
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <WaitingTile
            count={ordersWaiting}
            label="طلبات تنتظر التنفيذ"
            calm="لا طلبات معلّقة"
            icon={<ShoppingCart className="h-5 w-5" aria-hidden="true" />}
            onOpen={() => changeTab("orders")}
            urgent
          />
          <WaitingTile
            count={chatsWaiting}
            label="محادثات تنتظر رداً"
            calm="لا أحد ينتظر رداً"
            icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
            onOpen={() => changeTab("messages")}
            urgent
          />
          <WaitingTile
            count={requestsWaiting}
            label="طلبات ألعاب جديدة"
            calm="لا طلبات ألعاب جديدة"
            icon={<Ticket className="h-5 w-5" aria-hidden="true" />}
            onOpen={() => changeTab("game_requests")}
          />
        </div>
      </section>

      {/* ───────────────────────────── Takings ───────────────────────────── */}
      <section aria-labelledby="sales-title" className="rounded-3xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id="sales-title" className="text-[15px] font-black">
            المبيعات
          </h2>
          <div
            role="group"
            aria-label="المدة"
            className="flex gap-0.5 rounded-xl bg-muted/70 p-0.5"
          >
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "min-h-9 rounded-[10px] px-3 text-[12.5px] font-bold transition-colors",
                  period === p.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          <Figure
            label="صافي المبيعات"
            value={dinars(totals.net)}
            hint="بعد الخصومات، دون التوصيل"
          />
          <Figure label="الطلبات" value={num(totals.orders)} hint="طلبات محسوبة كمبيعات" />
          <Figure label="متوسط الطلب" value={dinars(averageOrder)} />
          <Figure label="الخصومات" value={dinars(totals.discount)} hint="كوبونات وإحالات وعروض" />
        </dl>
        <DailyBars orders={orders} />
        <p className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
          <span className="tabular-nums">{num(views)}</span> مشاهدة ·{" "}
          <span className="tabular-nums">{num(visits)}</span> زيارة منذ البداية.{" "}
          <button
            type="button"
            onClick={() => changeTab("financial_stats")}
            className="font-bold text-foreground underline-offset-4 hover:underline"
          >
            التكلفة والأرباح بالتفصيل
          </button>
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ─────────────────────────── Last orders ─────────────────────────── */}
        <section
          aria-labelledby="recent-title"
          className="rounded-3xl border border-border bg-card"
        >
          <div className="flex items-center justify-between px-5 py-4">
            <h2 id="recent-title" className="text-[15px] font-black">
              آخر الطلبات
            </h2>
            <button
              type="button"
              onClick={() => changeTab("orders")}
              className="inline-flex min-h-9 items-center gap-1 rounded-xl px-2.5 text-[12.5px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              كل الطلبات <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          {recent.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {recent.map((order) => {
                const status = STATUS[String(order?.status ?? "")] ?? STATUS["pending"]!;
                return (
                  <li key={String(order?.id)}>
                    <button
                      type="button"
                      onClick={() => changeTab("orders")}
                      className="flex w-full items-center gap-3 px-5 py-3 text-start transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[13.5px] font-black">
                          <span dir="ltr" className="tabular-nums">
                            {String(order?.code ?? "")}
                          </span>
                          <span className="truncate font-bold text-muted-foreground">
                            {String(order?.userName ?? "")}
                          </span>
                        </p>
                        <p className="text-[11.5px] text-muted-foreground">
                          {relative(createdAtOf(order))} ·{" "}
                          {(Array.isArray(order?.items) ? order.items.length : 0).toLocaleString(
                            "en-US",
                          )}{" "}
                          منتج
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black",
                          status.tone,
                        )}
                      >
                        {status.label}
                      </span>
                      <span className="w-[92px] shrink-0 text-end text-[13px] font-black tabular-nums">
                        {num(Number(order?.total) || 0)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="border-t border-border px-5 py-10 text-center text-[13px] text-muted-foreground">
              لا طلبات بعد.
            </p>
          )}
        </section>

        <div className="space-y-6">
          {/* ─────────────────────────── Catalogue ─────────────────────────── */}
          <section
            aria-labelledby="catalogue-title"
            className="rounded-3xl border border-border bg-card"
          >
            <h2 id="catalogue-title" className="px-5 pb-2 pt-4 text-[15px] font-black">
              الكتالوج
            </h2>
            <ul className="pb-2">
              <HealthRow
                icon={<Package className="h-4 w-4" aria-hidden="true" />}
                label="منتجات في المتجر"
                value={catalogue.total}
                onOpen={() => changeTab("listings_all")}
              />
              <HealthRow
                icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
                label="مخفية عن الزبائن"
                value={catalogue.hidden}
                onOpen={() => changeTab("listings_all")}
              />
              <HealthRow
                icon={<Tag className="h-4 w-4" aria-hidden="true" />}
                label="بلا سعر"
                value={catalogue.unpriced}
                warn={catalogue.unpriced > 0}
                onOpen={() => changeTab("listings_all")}
              />
              <HealthRow
                icon={<ImageOff className="h-4 w-4" aria-hidden="true" />}
                label="ألعاب بلا صورة مربعة"
                onOpen={() => changeTab("missing_square_images")}
              />
            </ul>
          </section>

          {/* ─────────────────────────── Campaigns ─────────────────────────── */}
          <section
            aria-labelledby="growth-title"
            className="rounded-3xl border border-border bg-card"
          >
            <h2 id="growth-title" className="px-5 pb-2 pt-4 text-[15px] font-black">
              العروض والتسويق
            </h2>
            <ul className="pb-2">
              <HealthRow
                icon={<Gift className="h-4 w-4" aria-hidden="true" />}
                label="اشترِ 3 واحصل على الرابعة"
                badge={
                  promotions?.buy3get1.enabled ? (
                    <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-[11px] font-black text-leaf">
                      مفعّل
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-black text-muted-foreground">
                      متوقف
                    </span>
                  )
                }
                onOpen={() => changeTab("promotions")}
              />
              <HealthRow
                icon={<Tag className="h-4 w-4" aria-hidden="true" />}
                label="أكواد الخصم"
                onOpen={() => changeTab("coupons")}
              />
              <HealthRow
                icon={<Trophy className="h-4 w-4" aria-hidden="true" />}
                label="المسابقات"
                onOpen={() => changeTab("contests")}
              />
            </ul>
          </section>
        </div>
      </div>

      <StoreAdvisorSection
        orders={orders}
        messages={threads}
        products={products}
        categories={categories}
        changeTab={changeTab}
      />
    </div>
  );
}

function Greeting({
  today,
  rating,
  reviews,
  changeTab,
}: {
  today: string;
  rating: number | null;
  reviews: number;
  changeTab: (tab: string) => void;
}) {
  const [storeName, setStoreName] = useState("بنانتو");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/data?slim=1", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const name = data?.settings?.storeName;
        if (typeof name === "string" && name.trim()) setStoreName(name.trim());
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    const name = draft.trim();
    if (!name) return;
    setSaving(true);
    try {
      /* `/api/data` merges `settings` by key, so this touches the name alone. */
      const res = await fetch("/api/data", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { storeName: name } }),
      });
      if (!res.ok) throw new Error();
      setStoreName(name);
      setEditing(false);
      toast.success("تم حفظ اسم المتجر");
    } catch {
      toast.error("تعذّر حفظ اسم المتجر");
    } finally {
      setSaving(false);
    }
  };

  const hour = new Date().getHours();
  const greeting = hour >= 4 && hour < 12 ? "صباح الخير" : "مساء الخير";

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-bold text-muted-foreground">{today}</p>
        {editing ? (
          <form
            className="mt-1 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="sr-only" htmlFor="store-name">
              اسم المتجر
            </label>
            <input
              id="store-name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
              autoFocus
              className="min-h-10 rounded-xl border border-border bg-card px-3 text-[18px] font-black outline-none focus:ring-2 focus:ring-banana/70"
            />
            <button
              type="submit"
              disabled={saving}
              className="min-h-10 rounded-xl bg-foreground px-4 text-[13px] font-black text-background disabled:opacity-50"
            >
              {saving ? "جارٍ الحفظ…" : "حفظ"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:bg-muted"
            >
              إلغاء
            </button>
          </form>
        ) : (
          <h1 className="group mt-0.5 flex items-center gap-2 text-[24px] font-black leading-tight tracking-[-0.02em] sm:text-[28px]">
            {greeting}، {storeName}
            <button
              type="button"
              onClick={() => {
                setDraft(storeName);
                setEditing(true);
              }}
              aria-label="تعديل اسم المتجر"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:opacity-100"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          </h1>
        )}
      </div>
      <button
        type="button"
        onClick={() => changeTab("reviews")}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[13px] font-bold transition-colors hover:bg-muted"
      >
        <Star className="h-4 w-4 fill-banana text-banana" aria-hidden="true" />
        {rating !== null ? (
          <>
            <span className="font-black tabular-nums">{rating.toFixed(1)}</span>
            <span className="text-muted-foreground">
              من <span className="tabular-nums">{num(reviews)}</span> تقييم
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">لا تقييمات بعد</span>
        )}
      </button>
    </header>
  );
}

function WaitingTile({
  count,
  label,
  calm,
  icon,
  onOpen,
  urgent = false,
}: {
  count: number;
  label: string;
  calm: string;
  icon: ReactNode;
  onOpen: () => void;
  urgent?: boolean;
}) {
  const waiting = count > 0;
  // On navy a yellow wash cancels to grey, so the dark packs keep the card
  // and let the gold rim and the gold count carry the alert.
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex min-h-[112px] flex-col justify-between rounded-2xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70 sm:min-h-[128px] sm:rounded-3xl sm:p-4",
        waiting
          ? urgent
            ? "border-banana/60 bg-banana/15 hover:bg-banana/25 dark:border-banana/70 dark:bg-card dark:hover:bg-muted/50"
            : "border-border bg-card hover:bg-muted/50"
          : "border-border bg-card/60 hover:bg-card",
      )}
    >
      <span className="flex items-center justify-between text-muted-foreground">
        {icon}
        <ArrowLeft
          className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </span>
      {waiting ? (
        <span>
          <span
            className={cn(
              "block text-[32px] font-black leading-none tracking-[-0.03em] tabular-nums sm:text-[40px]",
              urgent && "dark:text-banana",
            )}
          >
            {num(count)}
          </span>
          <span className="mt-1 block text-[11.5px] font-bold leading-snug text-foreground/80 sm:text-[13px]">
            {label}
          </span>
        </span>
      ) : (
        <span className="flex items-start gap-1.5 text-[11.5px] font-bold leading-snug text-muted-foreground sm:items-center sm:text-[13.5px]">
          <Check className="h-4 w-4 shrink-0 text-leaf" aria-hidden="true" />
          {calm}
        </span>
      )}
    </button>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-[12px] font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[22px] font-black leading-tight tracking-[-0.02em] tabular-nums">
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 text-[11px] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Takings per day for the last two weeks, as bars — today on the left end. */
function DailyBars({ orders }: { orders: Row[] }) {
  const series = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => {
      const from = start.getTime() - (13 - i) * 86_400_000;
      return { from, to: from + 86_400_000, net: 0 };
    });
    for (const order of orders) {
      const at = createdAtOf(order);
      if (Number.isNaN(at)) continue;
      const day = days.find((d) => at >= d.from && at < d.to);
      if (day) day.net += orderFinance(order as never).net;
    }
    return days;
  }, [orders]);
  const max = Math.max(1, ...series.map((d) => d.net));
  const fmt = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short" });
  const total = series.reduce((sum, d) => sum + d.net, 0);

  return (
    <figure className="border-t border-border px-5 pb-4 pt-4">
      <figcaption className="mb-3 flex items-center justify-between text-[12px] font-bold text-muted-foreground">
        <span>آخر 14 يوماً</span>
        <span className="tabular-nums">{dinars(total)}</span>
      </figcaption>
      <div
        className="flex h-24 items-end gap-1"
        role="img"
        aria-label={`صافي المبيعات في آخر 14 يوماً: ${dinars(total)}`}
      >
        {series.map((day, i) => (
          <div
            key={day.from}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${fmt.format(day.from)} — ${dinars(day.net)}`}
          >
            <div
              className={cn(
                "w-full rounded-t-md",
                i === series.length - 1 ? "bg-banana" : "bg-foreground/15",
              )}
              style={{ height: `${Math.max(day.net > 0 ? 6 : 2, (day.net / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] font-bold text-muted-foreground">
        <span>{fmt.format(series[0]!.from)}</span>
        <span>اليوم</span>
      </div>
    </figure>
  );
}

function HealthRow({
  icon,
  label,
  value,
  badge,
  warn = false,
  onOpen,
}: {
  icon: ReactNode;
  label: string;
  value?: number | null;
  badge?: ReactNode;
  warn?: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full items-center gap-3 px-5 text-start text-[13.5px] transition-colors hover:bg-muted/50"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-bold">{label}</span>
        {badge}
        {value !== undefined ? (
          <span className={cn("font-black tabular-nums", warn ? "text-rind" : "text-foreground")}>
            {value === null ? "—" : num(value)}
          </span>
        ) : null}
        <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

/** «قبل 5 دقائق», «أمس», or the date — in the shop's own words. */
function relative(at: number): string {
  if (Number.isNaN(at)) return "";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} د`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.round(hours / 24);
  if (days === 1) return "أمس";
  if (days < 7) return `قبل ${days} أيام`;
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short" }).format(at);
}
