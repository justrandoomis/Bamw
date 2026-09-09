import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  PauseCircle,
  RefreshCw,
  Flag,
  Settings2,
  ShieldCheck,
  Tag,
  XCircle,
} from "lucide-react";

import {
  loadUsedReports,
  loadUsedReviewQueue,
  resolveUsedReport,
  reviewUsedListing,
  saveUsedMarketplaceConfig,
  sweepExpiredUsedListings,
} from "@/lib/used-marketplace.functions";
import {
  CONDITION_LABEL_AR,
  GUARANTEE_LABEL_AR,
  REPORT_REASON_LABEL_AR,
  PACKAGING_LABEL_AR,
  RETURNED_BADGE_AR,
  STATUS_LABEL_AR,
  USED_TYPE_LABEL_AR,
  type UsedListingStatus,
} from "@/lib/used-marketplace";

/**
 * Review desk for member-submitted used items.
 *
 * The buttons offered for a listing come from the state machine itself
 * (`nextStatuses`), not from a list written here — an admin can never be shown
 * a move the server would refuse, and a new transition appears in the UI the
 * moment it is added to the machine.
 */

const STATUS_STYLE: Record<UsedListingStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  UNDER_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  NEEDS_CHANGES: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  REJECTED: "bg-destructive/10 text-destructive",
  EXPIRED: "bg-muted text-muted-foreground",
  SOLD: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  PAUSED: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

const ACTION_LABEL: Partial<Record<UsedListingStatus, string>> = {
  UNDER_REVIEW: "بدء المراجعة",
  APPROVED: "نشر",
  NEEDS_CHANGES: "طلب تعديل",
  REJECTED: "رفض",
  PAUSED: "إيقاف مؤقت",
  EXPIRED: "إنهاء",
  SOLD: "تم البيع",
};

/** Moves that change nothing for the seller but a note, and moves that cost money. */
const DESTRUCTIVE: readonly UsedListingStatus[] = ["REJECTED"];

const iqd = (value: number) => `${Math.round(value).toLocaleString("en-US")} د.ع`;

export default function UsedListingsManager() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"queue" | UsedListingStatus>("queue");
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Per-listing override of the مسترجع flag, applied with the next decision. */
  const [returned, setReturned] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-used-listings", filter],
    queryFn: () => loadUsedReviewQueue({ data: filter === "queue" ? {} : { status: filter } }),
  });

  const listings = data?.listings ?? [];
  const config = data?.config;

  const decide = useMutation({
    mutationFn: (input: {
      listingId: string;
      to: UsedListingStatus;
      note?: string;
      isReturned?: boolean;
    }) => reviewUsedListing({ data: input }),
    onSuccess: (result: any, input) => {
      if (!result?.success) {
        toast.error(errorText(result?.error));
        return;
      }
      toast.success(`تم: ${STATUS_LABEL_AR[input.to]}`);
      setNotes((prev) => ({ ...prev, [input.listingId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["admin-used-listings"] });
    },
    onError: () => toast.error("تعذّر تنفيذ الإجراء"),
  });

  const reports = useQuery({
    queryKey: ["admin-used-reports"],
    queryFn: () => loadUsedReports({ data: undefined as never }),
  });

  const sweep = useMutation({
    mutationFn: () => sweepExpiredUsedListings({ data: undefined as never }),
    onSuccess: (result: any) => {
      toast.success(`انتهت صلاحية ${result?.expired?.length ?? 0} عرض`);
      void queryClient.invalidateQueries({ queryKey: ["admin-used-listings"] });
    },
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Tag className="h-5 w-5 text-amber-600" />
            سوق المستعمل والمسترجع
          </h2>
          <p className="text-xs text-muted-foreground">
            {config
              ? `الرسوم ${iqd(config.listingFeeIqd)} لكل ${config.listingDurationDays} يوماً · ${config.enabled ? "مُفعّل" : "متوقف"}`
              : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted"
          >
            <RefreshCw className="inline h-3.5 w-3.5 ms-1" />
            تحديث
          </button>
          <button
            type="button"
            disabled={sweep.isPending}
            onClick={() => sweep.mutate()}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted disabled:opacity-50"
          >
            <Clock className="inline h-3.5 w-3.5 ms-1" />
            إنهاء المنتهية
          </button>
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted"
          >
            <Settings2 className="inline h-3.5 w-3.5 ms-1" />
            الإعدادات
          </button>
        </div>
      </div>

      {showConfig && config && <ConfigPanel config={config} onSaved={() => void refetch()} />}

      <ReportsPanel
        reports={reports.data?.reports ?? []}
        onResolved={() => {
          void reports.refetch();
          void refetch();
        }}
        onOpenListing={(listingId, listingStatus) => {
          /*
            The filter has to move with it. A report is nearly always about a
            published listing while the desk is sitting on the review queue, so
            expanding the row alone expanded something that was not on screen —
            the button did nothing, twice out of three.
          */
          if (listingStatus) setFilter(listingStatus as UsedListingStatus);
          setExpanded(listingId);
        }}
      />

      <div className="flex flex-wrap gap-2">
        {(["queue", "APPROVED", "PAUSED", "SOLD", "EXPIRED", "REJECTED"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              filter === key
                ? "bg-foreground text-background"
                : "border border-border hover:bg-muted"
            }`}
          >
            {key === "queue" ? "بانتظار القرار" : STATUS_LABEL_AR[key]}
            {key === "queue" && listings.length > 0 && filter === "queue"
              ? ` (${listings.length})`
              : ""}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري التحميل…
        </div>
      )}

      {!isLoading && listings.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          لا توجد عروض في هذه القائمة.
        </div>
      )}

      <div className="space-y-3">
        {listings.map((listing: any) => {
          const open = expanded === listing.id;
          return (
            <div key={listing.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[listing.status as UsedListingStatus]}`}
                    >
                      {STATUS_LABEL_AR[listing.status as UsedListingStatus]}
                    </span>
                    {listing.isReturned && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                        {RETURNED_BADGE_AR}
                      </span>
                    )}
                    <h3 className="truncate text-sm font-bold">{listing.title}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {listing.seller?.name ?? listing.sellerUserId} · {iqd(listing.priceIqd)}
                    {listing.conditionGrade
                      ? ` · ${CONDITION_LABEL_AR[listing.conditionGrade as keyof typeof CONDITION_LABEL_AR] ?? listing.conditionGrade}`
                      : ""}
                    {listing.usedType
                      ? ` · ${USED_TYPE_LABEL_AR[listing.usedType as keyof typeof USED_TYPE_LABEL_AR] ?? listing.usedType}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : listing.id)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                >
                  <Eye className="inline h-3.5 w-3.5 ms-1" />
                  {open ? "إخفاء" : "التفاصيل"}
                </button>
              </div>

              {open && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {listing.photos?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {listing.photos.map((photo: string) => (
                        <a key={photo} href={photo} target="_blank" rel="noreferrer">
                          <img
                            src={photo}
                            alt=""
                            loading="lazy"
                            className="h-24 w-24 rounded-lg border border-border object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                    <Field label="حالة التغليف">
                      {PACKAGING_LABEL_AR[listing.packaging as keyof typeof PACKAGING_LABEL_AR] ??
                        "—"}
                    </Field>
                    <Field label="الضمان">
                      {GUARANTEE_LABEL_AR[listing.guarantee as keyof typeof GUARANTEE_LABEL_AR] ??
                        "—"}
                    </Field>
                    <Field label="المنصة">{listing.platform ?? "—"}</Field>
                    <Field label="الكمية">{listing.quantity}</Field>
                    <Field label="الرسوم المدفوعة">
                      {listing.feeAmount ? iqd(listing.feeAmount) : "—"}
                    </Field>
                    <Field label="ينتهي في">
                      {listing.expiresAt ? listing.expiresAt.slice(0, 10) : "—"}
                    </Field>
                    <Field label="السياسة">
                      {listing.policyVersion
                        ? `${listing.policyVersion} · ${String(listing.policyAcceptedAt).slice(0, 10)}`
                        : "لم تُقبل"}
                    </Field>
                    <Field label="المنتج المرتبط">{listing.canonicalProductId ?? "—"}</Field>
                  </dl>
                  {listing.conditionNotes && (
                    <div className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                      <span className="font-bold">ملاحظات الحالة: </span>
                      {listing.conditionNotes}
                    </div>
                  )}
                  {listing.description && (
                    <div className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                      {listing.description}
                    </div>
                  )}
                  {listing.reviewNotes && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-500/30 dark:bg-orange-500/10">
                      <span className="font-bold">آخر ملاحظة للبائع: </span>
                      {listing.reviewNotes}
                    </div>
                  )}
                </div>
              )}

              {listing.nextStatuses?.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <textarea
                    value={notes[listing.id] ?? ""}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [listing.id]: event.target.value }))
                    }
                    rows={2}
                    placeholder="ملاحظة للبائع — تُرسل مع الرفض أو طلب التعديل"
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs"
                  />
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={returned[listing.id] ?? Boolean(listing.isReturned)}
                      onChange={(event) =>
                        setReturned((prev) => ({ ...prev, [listing.id]: event.target.checked }))
                      }
                    />
                    قطعة {RETURNED_BADGE_AR} من المتجر — يظهر شارة للزبون
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {listing.nextStatuses.map((next: UsedListingStatus) => {
                      const needsNote = next === "NEEDS_CHANGES" || next === "REJECTED";
                      const note = (notes[listing.id] ?? "").trim();
                      return (
                        <button
                          key={next}
                          type="button"
                          disabled={decide.isPending || (needsNote && note.length < 3)}
                          title={
                            needsNote && note.length < 3
                              ? "اكتب سبباً للبائع قبل هذا الإجراء"
                              : undefined
                          }
                          onClick={() =>
                            decide.mutate({
                              listingId: listing.id,
                              to: next,
                              note: note || undefined,
                              isReturned: returned[listing.id],
                            })
                          }
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity disabled:opacity-40 ${
                            next === "APPROVED"
                              ? "bg-emerald-600 text-white hover:opacity-90"
                              : DESTRUCTIVE.includes(next)
                                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                                : "border border-border hover:bg-muted"
                          }`}
                        >
                          {next === "APPROVED" && (
                            <CheckCircle2 className="inline h-3.5 w-3.5 ms-1" />
                          )}
                          {next === "REJECTED" && <XCircle className="inline h-3.5 w-3.5 ms-1" />}
                          {next === "PAUSED" && <PauseCircle className="inline h-3.5 w-3.5 ms-1" />}
                          {ACTION_LABEL[next] ?? STATUS_LABEL_AR[next]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What members have reported, and nothing more.
 *
 * A report never hides a listing — a seller who has stopped answering and a
 * seller a rival wants gone read the same from a database — so this panel
 * shows the complaint and leaves the decision here, next to the buttons that
 * can act on it. «تمت المعالجة» closes the report, whatever was decided about
 * the listing, so the queue reflects attention paid rather than outcomes.
 */
function ReportsPanel({
  reports,
  onResolved,
  onOpenListing,
}: {
  reports: any[];
  onResolved: () => void;
  onOpenListing: (listingId: string, listingStatus: string) => void;
}) {
  const resolve = useMutation({
    mutationFn: (reportId: string) => resolveUsedReport({ data: { reportId } }),
    onSuccess: () => {
      toast.success("أُغلق البلاغ");
      onResolved();
    },
    onError: () => toast.error("تعذّر إغلاق البلاغ"),
  });

  if (reports.length === 0) return null;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-destructive">
        <Flag className="h-4 w-4" />
        بلاغات على العروض ({reports.length})
      </h3>
      <div className="mt-3 space-y-2">
        {reports.map((report: any) => (
          <div
            key={report.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold">
                {report.listingTitle || report.listingId}
                <span className="ms-2 font-normal text-muted-foreground">
                  {REPORT_REASON_LABEL_AR[
                    report.reason as keyof typeof REPORT_REASON_LABEL_AR
                  ] ?? report.reason}
                </span>
              </p>
              {report.note && (
                <p className="mt-1 text-[11px] text-muted-foreground">{report.note}</p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {String(report.createdAt ?? "").slice(0, 16).replace("T", " ")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenListing(String(report.listingId), String(report.listingStatus))}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
              >
                <Eye className="inline h-3.5 w-3.5 ms-1" />
                افتح العرض
              </button>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(String(report.id))}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-background disabled:opacity-40"
              >
                تمت المعالجة
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const ERROR_TEXT: Record<string, string> = {
  TRANSITION_NOT_ALLOWED: "هذا الإجراء غير مسموح من الحالة الحالية",
  LISTING_CHANGED_CONCURRENTLY: "غيّر مشرف آخر هذا العرض للتو — حدّث القائمة",
  LISTING_NOT_FOUND: "العرض غير موجود",
  USED_MARKETPLACE_DISABLED: "سوق المستعمل متوقف حالياً",
};

function errorText(code: unknown): string {
  return ERROR_TEXT[String(code)] ?? "تعذّر تنفيذ الإجراء";
}

function ConfigPanel({ config, onSaved }: { config: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    enabled: Boolean(config.enabled),
    listingFeeIqd: Number(config.listingFeeIqd),
    listingDurationDays: Number(config.listingDurationDays),
    maxActiveListingsPerSeller: Number(config.maxActiveListingsPerSeller),
    maxPhotos: Number(config.maxPhotos),
    minPriceIqd: Number(config.minPriceIqd),
    maxPriceIqd: Number(config.maxPriceIqd),
    refundFeeOnReject: Boolean(config.refundFeeOnReject),
  });

  const save = useMutation({
    mutationFn: () => saveUsedMarketplaceConfig({ data: form }),
    onSuccess: () => {
      toast.success("تم حفظ الإعدادات");
      onSaved();
    },
    onError: () => toast.error("تعذّر حفظ الإعدادات"),
  });

  const number = (key: keyof typeof form, label: string, hint?: string) => (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="number"
        value={String(form[key])}
        onChange={(event) => setForm((prev) => ({ ...prev, [key]: Number(event.target.value) }))}
        className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
      />
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {number("listingFeeIqd", "رسوم العرض (د.ع)", "0 يعني مجاناً")}
        {number("listingDurationDays", "مدة النشر (أيام)")}
        {number("maxActiveListingsPerSeller", "أقصى عروض لكل بائع")}
        {number("maxPhotos", "أقصى عدد صور")}
        {number("minPriceIqd", "أقل سعر (د.ع)")}
        {number("maxPriceIqd", "أعلى سعر (د.ع)")}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          السوق مُفعّل
        </label>
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={form.refundFeeOnReject}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, refundFeeOnReject: event.target.checked }))
            }
          />
          إرجاع الرسوم عند الرفض
        </label>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="ms-auto rounded-lg bg-foreground px-4 py-2 text-xs font-bold text-background disabled:opacity-50"
        >
          {save.isPending ? "جاري الحفظ…" : "حفظ"}
        </button>
      </div>
      {form.listingFeeIqd === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          رسوم صفر تعني أن أي عضو يستطيع فتح عروض بلا تكلفة — تأكد أن هذا مقصود.
        </p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        لا يُنشر أي عرض قبل موافقة مشرف، مهما كانت هذه الإعدادات.
      </p>
    </div>
  );
}
