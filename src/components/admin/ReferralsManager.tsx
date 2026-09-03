import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Check,
  Gift,
  Loader2,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Referral programme administration.
 *
 * Two things live here: the queue of rewards, with everything behind each one,
 * and the programme's settings. Every manual action posts to
 * `/api/admin/referrals`, which writes an admin audit entry — a person
 * overriding an automatic decision is exactly what has to be attributable
 * afterwards.
 *
 * Note what the table does *not* show: no device string, no address, no
 * fingerprint. The server sends "device match: yes" and nothing else, because
 * a screen that renders the identifier is a screen that puts it in a
 * screenshot.
 */

interface AdminReward {
  id: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  productId: string;
  referralCode: string | null;
  referrerUserId: string;
  referrerName: string;
  referrerUsername: string;
  buyerUserId: string;
  buyerName: string;
  buyerUsername: string;
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  reversedAmountIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  status: string;
  riskScore: number;
  riskVerdict: string | null;
  blockedReason: string | null;
  walletTransactionId: string | null;
  deviceMatch: boolean;
  ipMatch: boolean;
  createdAt: string;
  approvedAt: string | null;
  reversedAt: string | null;
  attributionId: string | null;
}

interface AdminSettings {
  enabled: boolean;
  buyerPercent: number;
  referrerPercent: number;
  maxRewardIqd: number;
  linkTtlDays: number;
  eligibleCategories: string[];
  stackWithCoupon: boolean;
  holdDays: number;
  dailyInviteLimit: number;
  dailyRewardCapIqd: number;
  monthlyRewardCapIqd: number;
  blockSameIp: boolean;
}

interface ListPayload {
  rewards: AdminReward[];
  totals: {
    total: number;
    pendingIqd: number;
    approvedIqd: number;
    reversedIqd: number;
    discountIqd: number;
  };
  blocked: { userId: string; name: string; username: string; reason: string; createdAt: string }[];
  refusals: AdminRefusal[];
  settings: AdminSettings;
}

/**
 * A referral that was refused and never became a reward.
 *
 * Until this existed the owner could not see one at all: the table on this
 * screen is built from `referral_rewards`, and a code refused before checkout
 * never gets that far. The only record was a risk event nothing displayed —
 * so "my link does not work" had no answer anywhere in the admin.
 */
interface AdminRefusal {
  id: string;
  eventType: string;
  riskScore: number;
  createdAt: string;
  orderId: string | null;
  orderCode: string;
  referrerName: string;
  referrerUsername: string;
  buyerName: string;
  buyerUsername: string;
  stage: string;
  reasons: string[];
}

interface DetailPayload {
  reward: AdminReward;
  events: {
    id: string;
    eventType: string;
    riskScore: number;
    metadata: Record<string, unknown>;
    createdAt: string;
  }[];
  walletTransaction: Record<string, unknown> | null;
}

const STATUS_LABEL: Record<string, string> = {
  eligible: "مؤهلة",
  pending: "قيد المراجعة",
  approved: "معتمدة",
  blocked: "ممنوعة",
  reversed: "معكوسة",
  expired: "منتهية",
};

const STATUS_TONE: Record<string, string> = {
  eligible: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
  reversed: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/25",
  expired: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25",
};

/** Every anti-abuse reason, in the admin's language. */
const REASON_LABEL: Record<string, string> = {
  self_referral: "إحالة ذاتية",
  same_device: "نفس نوع الجهاز",
  same_device_id: "نفس الجهاز",
  same_ip: "نفس عنوان الشبكة",
  same_phone: "نفس رقم الهاتف",
  same_email: "نفس البريد",
  same_telegram: "نفس حساب تليكرام",
  same_session: "نفس الجلسة",
  circular_referral: "إحالة دائرية",
  referrer_blocked: "صاحب الإحالة محظور",
  buyer_blocked: "المشتري محظور",
  code_inactive: "كود معطّل",
  not_first_purchase: "ليست أول عملية شراء",
  daily_invite_limit: "تجاوز حد الدعوات اليومي",
  daily_reward_cap: "تجاوز الحد اليومي للمكافآت",
  monthly_reward_cap: "تجاوز الحد الشهري للمكافآت",
  attribution_expired: "انتهت صلاحية الإحالة",
  clear: "لا توجد ملاحظات",
  /*
    The other half of "refused": nothing was wrong with the two members, the
    purchase itself was never in the programme. These arrive by a different
    route and read identically to the customer, so the admin screen has to be
    able to tell them apart.
  */
  programme_disabled: "البرنامج متوقف",
  product_excluded: "المنتج خارج البرنامج",
  category_excluded: "القسم خارج البرنامج",
  kind_excluded: "نوع المنتج غير مؤهل",
  marketplace_item: "منتج من السوق وليس من المتجر",
  not_offline_account: "الخصم للحسابات الأوفلاين فقط",
  no_price: "لا يوجد سعر للمنتج",
  not_the_shared_product: "ليست اللعبة التي تمت مشاركتها",
  no_eligible_line: "لا توجد لعبة مؤهلة في السلة",
};

/** Which stage refused it, in the admin's language. */
const REFUSAL_EVENT_LABEL: Record<string, string> = {
  capture_blocked: "عند فتح الرابط",
  bind_blocked: "عند تسجيل الدخول",
  checkout_not_applicable: "عند الدفع — غير مؤهلة",
  checkout_limit_blocked: "عند الدفع — تجاوز الحدود",
};

function verdictLabels(verdict: string | null): string[] {
  if (!verdict) return [];
  return verdict
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => REASON_LABEL[part] ?? part);
}

const iqd = (value: number) => `${Number(value || 0).toLocaleString("en-US")} د.ع`;

export default function ReferralsManager() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [openReward, setOpenReward] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AdminSettings | null>(null);

  const { data, isLoading } = useQuery<ListPayload>({
    queryKey: ["admin-referrals", query, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/referrals?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as ListPayload;
    },
  });

  const { data: detail } = useQuery<DetailPayload>({
    queryKey: ["admin-referral", openReward],
    queryFn: async () => {
      const res = await fetch(`/api/admin/referrals?reward=${encodeURIComponent(openReward!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as DetailPayload;
    },
    enabled: Boolean(openReward),
  });

  const act = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/admin/referrals", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; ok?: boolean } | null;
      if (!res.ok) throw new Error(body?.error || "فشل تنفيذ الإجراء");
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-referrals"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-referral"] });
      toast.success("تم تنفيذ الإجراء");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const settings = settingsDraft ?? data?.settings ?? null;
  const patchSettings = (patch: Partial<AdminSettings>) => {
    if (!data?.settings) return;
    setSettingsDraft({ ...(settingsDraft ?? data.settings), ...patch });
  };

  return (
    <div className="w-full space-y-5 p-2 sm:p-6" dir="rtl">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600">
          <Gift className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-black text-foreground">إدارة الإحالات — دعوة صديق</h2>
          <p className="truncate text-[12px] text-muted-foreground">
            المكافآت، فحص التلاعب، والإعدادات العامة للبرنامج
          </p>
        </div>
      </header>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {[
          { label: "إجمالي الإحالات", value: String(data?.totals.total ?? 0) },
          { label: "مكافآت معلقة", value: iqd(data?.totals.pendingIqd ?? 0) },
          { label: "مكافآت معتمدة", value: iqd(data?.totals.approvedIqd ?? 0) },
          { label: "مكافآت معكوسة", value: iqd(data?.totals.reversedIqd ?? 0) },
          { label: "خصومات المشترين", value: iqd(data?.totals.discountIqd ?? 0) },
        ].map((card) => (
          <div key={card.label} className="min-w-0 rounded-2xl border border-border bg-card p-3">
            <p className="truncate text-[11px] font-bold text-muted-foreground">{card.label}</p>
            <p className="truncate text-base font-black text-foreground" dir="ltr">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && setQuery(search.trim())}
            placeholder="بحث بالكود أو رقم الطلب أو اسم المستخدم"
            className="w-full rounded-xl border border-border bg-background py-2.5 pr-10 pl-3 text-sm outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        >
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setQuery(search.trim())}
          className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-bold text-background"
        >
          بحث
        </button>
      </div>

      {/* The queue */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-right text-[12px]">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-3 font-bold">الطلب</th>
              <th className="p-3 font-bold">صاحب الإحالة</th>
              <th className="p-3 font-bold">المدعو</th>
              <th className="p-3 font-bold">السعر الأصلي</th>
              <th className="p-3 font-bold">الخصم</th>
              <th className="p-3 font-bold">المكافأة</th>
              <th className="p-3 font-bold">الحالة</th>
              <th className="p-3 font-bold">الفحص</th>
              <th className="p-3 font-bold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : !data?.rewards.length ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  لا توجد إحالات بعد
                </td>
              </tr>
            ) : (
              data.rewards.map((reward) => (
                <tr key={reward.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => setOpenReward(reward.id)}
                      className="font-bold text-foreground underline-offset-2 hover:underline"
                    >
                      {reward.orderCode || reward.orderId}
                    </button>
                    <p className="text-[10px] text-muted-foreground">{reward.referralCode ?? "—"}</p>
                  </td>
                  <td className="p-3">
                    <p className="truncate font-bold text-foreground">{reward.referrerName || "—"}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      @{reward.referrerUsername || reward.referrerUserId}
                    </p>
                  </td>
                  <td className="p-3">
                    <p className="truncate font-bold text-foreground">{reward.buyerName || "—"}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      @{reward.buyerUsername || reward.buyerUserId}
                    </p>
                  </td>
                  <td className="p-3 font-bold" dir="ltr">
                    {iqd(reward.originalPriceIqd)}
                  </td>
                  <td className="p-3 text-emerald-600 dark:text-emerald-400" dir="ltr">
                    {iqd(reward.buyerDiscountIqd)}
                  </td>
                  <td className="p-3 font-bold" dir="ltr">
                    {iqd(reward.referrerRewardIqd)}
                    {reward.reversedAmountIqd > 0 ? (
                      <span className="block text-[10px] text-red-600">
                        −{iqd(reward.reversedAmountIqd)}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        STATUS_TONE[reward.status] ?? STATUS_TONE["expired"]
                      }`}
                    >
                      {STATUS_LABEL[reward.status] ?? reward.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          reward.riskScore >= 70
                            ? "bg-red-500/10 text-red-600"
                            : reward.riskScore >= 40
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-emerald-500/10 text-emerald-600"
                        }`}
                        dir="ltr"
                      >
                        {reward.riskScore}
                      </span>
                      {reward.deviceMatch ? (
                        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                          جهاز
                        </span>
                      ) : null}
                      {reward.ipMatch ? (
                        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                          IP
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reward.status === "pending" || reward.status === "eligible" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => act.mutate({ action: "approve", rewardId: reward.id })}
                            disabled={act.isPending}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                          >
                            <Check className="inline h-3 w-3" /> اعتماد
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              act.mutate({
                                action: "block",
                                rewardId: reward.id,
                                reason: "admin_review",
                              })
                            }
                            disabled={act.isPending}
                            className="rounded-lg border border-red-500/40 px-2.5 py-1 text-[11px] font-bold text-red-600 disabled:opacity-50"
                          >
                            <Ban className="inline h-3 w-3" /> منع
                          </button>
                        </>
                      ) : null}
                      {reward.status === "approved" ? (
                        <button
                          type="button"
                          onClick={() =>
                            act.mutate({
                              action: "reverse",
                              rewardId: reward.id,
                              reason: "admin_reversal",
                            })
                          }
                          disabled={act.isPending}
                          className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-bold text-amber-600 disabled:opacity-50"
                        >
                          <Undo2 className="inline h-3 w-3" /> عكس
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          act.mutate({
                            action: "block_user",
                            userId: reward.referrerUserId,
                            reason: "admin_block",
                          })
                        }
                        disabled={act.isPending}
                        className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground disabled:opacity-50"
                      >
                        <ShieldAlert className="inline h-3 w-3" /> حظر المستخدم
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* One referral in full */}
      {openReward && detail ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-foreground">
              سجل الأحداث — {detail.reward.orderCode || detail.reward.orderId}
            </h3>
            <button
              type="button"
              onClick={() => setOpenReward(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold"
            >
              إغلاق
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {verdictLabels(detail.reward.riskVerdict).map((label) => (
              <span
                key={label}
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
              >
                <AlertTriangle className="inline h-3 w-3" /> {label}
              </span>
            ))}
          </div>

          {detail.walletTransaction ? (
            <p className="text-[12px] text-muted-foreground">
              حركة المحفظة:{" "}
              <span className="font-bold text-foreground" dir="ltr">
                {String(detail.walletTransaction["id"])}
              </span>{" "}
              — {iqd(Number(detail.walletTransaction["amount"] ?? 0))}
            </p>
          ) : null}

          <ol className="space-y-1.5">
            {detail.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-[11px]"
              >
                <span className="font-bold text-foreground">{event.eventType}</span>
                <span className="text-muted-foreground" dir="ltr">
                  {event.createdAt}
                </span>
                {Array.isArray(event.metadata["reasons"]) ? (
                  <span className="text-amber-600">
                    {(event.metadata["reasons"] as string[])
                      .map((reason) => REASON_LABEL[reason] ?? reason)
                      .join("، ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Refusals that never became a reward */}
      {data?.refusals?.length ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-1 text-sm font-black text-foreground">محاولات لم تُقبل</h3>
          <p className="mb-3 text-[11px] font-bold text-muted-foreground">
            العميل يرى جملة واحدة فقط عند الرفض. هنا السبب الحقيقي لكل محاولة.
          </p>
          <ol className="space-y-2">
            {data.refusals.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-background px-3 py-2 text-[11px]"
              >
                <span className="font-black text-foreground">
                  {REFUSAL_EVENT_LABEL[entry.eventType] ?? entry.eventType}
                </span>
                {entry.referrerName || entry.referrerUsername ? (
                  <span className="text-muted-foreground">
                    صاحب الرابط: {entry.referrerName || entry.referrerUsername}
                  </span>
                ) : null}
                {entry.buyerName || entry.buyerUsername ? (
                  <span className="text-muted-foreground">
                    الصديق: {entry.buyerName || entry.buyerUsername}
                  </span>
                ) : (
                  <span className="text-muted-foreground">الصديق: زائر</span>
                )}
                {entry.orderCode ? (
                  <span className="text-muted-foreground">الطلب: {entry.orderCode}</span>
                ) : null}
                {entry.reasons.length ? (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-700 dark:text-amber-300">
                    {entry.reasons.map((reason) => REASON_LABEL[reason] ?? reason).join("، ")}
                  </span>
                ) : null}
                <span className="ms-auto text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Blocked members */}
      {data?.blocked.length ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-black text-foreground">محظورون من البرنامج</h3>
          <div className="flex flex-wrap gap-2">
            {data.blocked.map((entry) => (
              <span
                key={entry.userId}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px]"
              >
                <span className="font-bold text-foreground">
                  {entry.name || entry.username || entry.userId}
                </span>
                <button
                  type="button"
                  onClick={() => act.mutate({ action: "unblock_user", userId: entry.userId })}
                  className="text-emerald-600"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Settings */}
      {settings ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-black text-foreground">إعدادات برنامج الإحالة</h3>

          <label className="flex items-center gap-2 text-[13px] font-bold text-foreground">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => patchSettings({ enabled: event.target.checked })}
              className="h-4 w-4"
            />
            تشغيل نظام الإحالة
          </label>

          <p className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold text-muted-foreground">
            مكافأة صاحب الإحالة ثابتة 5% من قيمة المنتجات المؤهلة، على أول طلب
            وعلى كل طلب بعده. خصم المشتري 10% مرة واحدة فقط طوال عمر الحساب.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["buyerPercent", "نسبة خصم المشتري (%)"],
                // The referrer's share is fixed at 5% in code, so there is no
                // field for it: an input that cannot change the payout would
                // only invite somebody to try.
                ["maxRewardIqd", "الحد الأقصى للمكافأة (د.ع)"],
                ["linkTtlDays", "مدة صلاحية رابط الإحالة (يوم)"],
                ["holdDays", "مدة تعليق المكافأة (يوم)"],
                ["dailyInviteLimit", "حد الدعوات اليومي"],
                ["dailyRewardCapIqd", "الحد اليومي للمكافآت (د.ع)"],
                ["monthlyRewardCapIqd", "الحد الشهري للمكافآت (د.ع)"],
              ] as [keyof AdminSettings, string][]
            ).map(([key, label]) => (
              <label key={String(key)} className="block">
                <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
                  {label}
                </span>
                <input
                  type="number"
                  min={0}
                  value={Number(settings[key] ?? 0)}
                  onChange={(event) =>
                    patchSettings({ [key]: Number(event.target.value) } as Partial<AdminSettings>)
                  }
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  dir="ltr"
                />
              </label>
            ))}
          </div>

          {/*
            "أول عملية شراء فقط" used to be a switch here and is now a rule:
            the buyer's discount is once per account for ever, and the
            referrer earns on every order after it. Neither half is
            configurable, so a control for it would do nothing.
          */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={settings.stackWithCoupon}
                onChange={(event) => patchSettings({ stackWithCoupon: event.target.checked })}
                className="h-4 w-4"
              />
              السماح بدمج الإحالة مع الكوبون
            </label>
          </div>

          <div className="rounded-xl border border-border bg-background p-3">
            <label className="flex items-center gap-2 text-[13px] font-bold text-foreground">
              <input
                type="checkbox"
                checked={settings.blockSameIp !== false}
                onChange={(event) => patchSettings({ blockSameIp: event.target.checked })}
                className="h-4 w-4"
              />
              منع الإحالة عند تطابق عنوان الشبكة (IP)
            </label>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              مُفعّل افتراضياً. انتبه: شبكات الهاتف في العراق تضع آلاف المشتركين خلف عنوان واحد،
              لذلك قد يمنع هذا إحالات صادقة كثيرة. فحص الجهاز يبقى فعّالاً في الحالتين وهو الأدق.
            </p>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">
              الفئات المؤهلة
            </span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["game", "ألعاب"],
                  ["bundle", "حزم"],
                  ["hardware", "أجهزة"],
                  ["accessory", "إكسسوارات"],
                  ["amiibo", "أميبو"],
                  ["gift_card", "بطاقات"],
                  ["used", "مستعمل"],
                ] as [string, string][]
              ).map(([value, label]) => {
                const active = settings.eligibleCategories.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      patchSettings({
                        eligibleCategories: active
                          ? settings.eligibleCategories.filter((entry) => entry !== value)
                          : [...settings.eligibleCategories, value],
                      })
                    }
                    className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold transition ${
                      active
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-border bg-background text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => act.mutate({ action: "save_settings", settings })}
            disabled={act.isPending}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {act.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            حفظ الإعدادات
          </button>
        </section>
      ) : null}
    </div>
  );
}
