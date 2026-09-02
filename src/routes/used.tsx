import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  PauseCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import PageHeader from "@/components/PageHeader";
import { LoginGate, Skeleton, formatIqd } from "@/components/services/ServiceBits";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  CONDITION_GRADE_VALUES,
  CONDITION_LABEL_AR,
  GUARANTEE_LABEL_AR,
  GUARANTEE_VALUES,
  PACKAGING_LABEL_AR,
  PACKAGING_VALUES,
  RETURNED_BADGE_AR,
  STATUS_LABEL_AR,
  USED_TYPE_LABEL_AR,
  USED_TYPE_VALUES,
  type UsedListingStatus,
} from "@/lib/used-marketplace";
import {
  createUsedListing,
  loadMyUsedListings,
  loadUsedMarketplace,
  moveUsedListing,
  submitUsedListing,
  updateUsedListing,
} from "@/lib/used-marketplace.functions";

/**
 * The used & returned marketplace, from the member's side.
 *
 * One page with two halves: what is for sale, and what you are selling. The
 * selling half is deliberately blunt about the two things members get wrong —
 * the fee comes out of the wallet at submission, and nothing is published until
 * a person from the store has looked at it.
 */

export const Route = createFileRoute("/used")({
  head: () => ({
    meta: [
      { title: "سوق المستعمل والمسترجع — بنانتو" },
      {
        name: "description",
        content: "اشترِ وبِع الألعاب والأجهزة والملحقات المستعملة والمسترجعة بعد فحص فريق بنانتو.",
      },
    ],
  }),
  component: UsedMarketPage,
});

type Tab = "browse" | "mine";

function UsedMarketPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("browse");

  return (
    <div dir="rtl" className="min-h-screen bg-background pb-24">
      <PageHeader view="used" />

      <div className="mx-auto w-full max-w-5xl px-4 pt-20">
        <header className="mb-6">
          <h1 className="text-2xl font-black">سوق المستعمل والمسترجع</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            قطع مستعملة ومسترجعة — كل عرض يمر على فريق بنانتو قبل النشر.
          </p>
        </header>

        <div className="mb-6 flex gap-2">
          {(
            [
              ["browse", "المعروض للبيع"],
              ["mine", "عروضي"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                tab === id ? "bg-foreground text-background" : "border border-border hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "browse" ? <Browse /> : user ? <MyListings /> : <SellerGate />}
      </div>
    </div>
  );
}

function SellerGate() {
  return (
    <LoginGate
      title="سجّل الدخول لعرض قطعك"
      description="تحتاج حساباً لعرض قطعة مستعملة، لأن رسوم العرض تُخصم من محفظتك ونحتاج طريقة للتواصل معك."
      redirect="/used"
    />
  );
}

/* -------------------------------- browsing -------------------------------- */

function Browse() {
  const { data, isLoading } = useQuery({
    queryKey: ["used-marketplace"],
    queryFn: () => loadUsedMarketplace({ data: {} }),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    );
  }

  if (!data?.enabled) {
    return <Empty icon={Store} text="سوق المستعمل متوقف مؤقتاً." />;
  }

  const listings = data.listings ?? [];
  if (listings.length === 0) {
    return <Empty icon={Store} text="لا توجد قطع معروضة حالياً. عُد قريباً." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing: any) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

function ListingCard({ listing }: { listing: any }) {
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const photo = listing.photos?.[0];

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-[4/3] bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Camera className="h-8 w-8" />
          </div>
        )}
        <div className="absolute top-2 start-2 flex flex-wrap gap-1.5">
          {listing.isReturned && (
            <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-black text-white">
              {RETURNED_BADGE_AR}
            </span>
          )}
          {listing.conditionGrade && (
            <span className="rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-bold">
              {CONDITION_LABEL_AR[listing.conditionGrade as keyof typeof CONDITION_LABEL_AR]}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-sm font-bold leading-snug">{listing.title}</h3>
        <p className="text-xs text-muted-foreground">
          {USED_TYPE_LABEL_AR[listing.usedType as keyof typeof USED_TYPE_LABEL_AR] ?? ""}
          {listing.packaging
            ? ` · ${PACKAGING_LABEL_AR[listing.packaging as keyof typeof PACKAGING_LABEL_AR]}`
            : ""}
        </p>
        {listing.conditionNotes && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {listing.conditionNotes}
          </p>
        )}
        {listing.guarantee && (
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            {GUARANTEE_LABEL_AR[listing.guarantee as keyof typeof GUARANTEE_LABEL_AR]}
          </p>
        )}

        <div className="mt-auto space-y-2 pt-2">
          <p className="text-lg font-black">{formatIqd(listing.priceIqd)}</p>
          {/*
            A used item is sold as described by the person who owns it, so the
            buyer confirms they have read that before the store will take the
            order — the acknowledgement gates the button rather than appearing
            after it.
          */}
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <input
              type="checkbox"
              checked={policyAccepted}
              onChange={(event) => setPolicyAccepted(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              قرأت{" "}
              <a href="/policy" className="font-bold text-primary underline">
                سياسة القطع المستعملة
              </a>{" "}
              وأفهم أن القطعة تُباع بحالتها الموصوفة.
            </span>
          </label>
          <a
            href={policyAccepted ? `/chat?used=${encodeURIComponent(listing.id)}` : undefined}
            aria-disabled={!policyAccepted}
            onClick={(event) => {
              if (!policyAccepted) {
                event.preventDefault();
                toast.error("وافق على سياسة القطع المستعملة أولاً");
              }
            }}
            className={`block rounded-lg px-4 py-2 text-center text-xs font-bold transition-opacity ${
              policyAccepted
                ? "bg-foreground text-background hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
          >
            اطلب هذه القطعة
          </a>
        </div>
      </div>
    </article>
  );
}

/* --------------------------------- selling -------------------------------- */

const EMPTY_FORM = {
  title: "",
  usedType: "cartridge",
  platform: "",
  conditionGrade: "very_good",
  packaging: "",
  guarantee: "",
  priceIqd: "",
  quantity: "1",
  conditionNotes: "",
  description: "",
};

function MyListings() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["used-my-listings"],
    queryFn: () => loadMyUsedListings({ data: undefined as never }),
  });

  const move = useMutation({
    mutationFn: (input: { listingId: string; to: "DRAFT" | "PAUSED" | "APPROVED" }) =>
      moveUsedListing({ data: input }),
    onSuccess: (result: any) => {
      if (!result?.success) {
        toast.error(errorText(result?.error));
        return;
      }
      toast.success("تم التحديث");
      void queryClient.invalidateQueries({ queryKey: ["used-my-listings"] });
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!data?.enabled) return <Empty icon={Store} text="سوق المستعمل متوقف مؤقتاً." />;

  const config = data.config;
  const listings = data.listings ?? [];
  const editing = listings.find((l: any) => l.id === editingId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1 text-xs">
          <p className="flex items-center gap-1.5 font-bold">
            <Wallet className="h-4 w-4 text-primary" />
            رصيدك: {formatIqd(data.walletBalance)}
          </p>
          <p className="text-muted-foreground">
            رسوم العرض {formatIqd(config.listingFeeIqd)} لكل {config.listingDurationDays} أيام،
            تُخصم عند الإرسال للمراجعة. لا تُخصم مرة ثانية إذا طُلب منك تعديل.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setCreating(true);
          }}
          className="rounded-lg bg-foreground px-4 py-2 text-xs font-bold text-background"
        >
          <Plus className="inline h-3.5 w-3.5 ms-1" />
          اعرض قطعة
        </button>
      </div>

      {(creating || editing) && (
        <ListingForm
          config={config}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditingId(null);
            void refetch();
          }}
        />
      )}

      {listings.length === 0 && !creating && <Empty icon={Store} text="لم تعرض أي قطعة بعد." />}

      <div className="space-y-3">
        {listings.map((listing: any) => (
          <div key={listing.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={listing.status} />
                  <h3 className="truncate text-sm font-bold">{listing.title || "بدون عنوان"}</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatIqd(listing.priceIqd)}
                  {listing.expiresAt ? ` · ينتهي ${listing.expiresAt.slice(0, 10)}` : ""}
                  {listing.feeAmount ? ` · دُفع ${formatIqd(listing.feeAmount)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(listing.status === "DRAFT" || listing.status === "NEEDS_CHANGES") && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setEditingId(listing.id);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                  >
                    تعديل وإرسال
                  </button>
                )}
                {listing.status === "APPROVED" && (
                  <button
                    type="button"
                    onClick={() => move.mutate({ listingId: listing.id, to: "PAUSED" })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                  >
                    <PauseCircle className="inline h-3.5 w-3.5 ms-1" />
                    إيقاف مؤقت
                  </button>
                )}
                {listing.status === "PAUSED" && (
                  <button
                    type="button"
                    onClick={() => move.mutate({ listingId: listing.id, to: "APPROVED" })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                  >
                    استئناف
                  </button>
                )}
                {listing.status === "EXPIRED" && (
                  <button
                    type="button"
                    onClick={() => move.mutate({ listingId: listing.id, to: "DRAFT" })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                  >
                    <RefreshCw className="inline h-3.5 w-3.5 ms-1" />
                    إعادة النشر (برسوم جديدة)
                  </button>
                )}
              </div>
            </div>

            {listing.reviewNotes && listing.status === "NEEDS_CHANGES" && (
              <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-500/30 dark:bg-orange-500/10">
                <span className="font-bold">ملاحظة الفريق: </span>
                {listing.reviewNotes}
              </p>
            )}
            {listing.reviewNotes && listing.status === "REJECTED" && (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs">
                <span className="font-bold">سبب الرفض: </span>
                {listing.reviewNotes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: UsedListingStatus }) {
  const style: Record<UsedListingStatus, string> = {
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
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${style[status]}`}>
      {STATUS_LABEL_AR[status]}
    </span>
  );
}

function ListingForm({
  config,
  existing,
  onClose,
  onSaved,
}: {
  config: any;
  existing?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() =>
    existing
      ? {
          title: existing.title ?? "",
          usedType: existing.usedType ?? "cartridge",
          platform: existing.platform ?? "",
          conditionGrade: existing.conditionGrade ?? "very_good",
          packaging: existing.packaging ?? "",
          guarantee: existing.guarantee ?? "",
          priceIqd: String(existing.priceIqd ?? ""),
          quantity: String(existing.quantity ?? 1),
          conditionNotes: existing.conditionNotes ?? "",
          description: existing.description ?? "",
        }
      : { ...EMPTY_FORM },
  );
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [policy, setPolicy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const payload = useMemo(
    () => ({
      title: form.title.trim(),
      usedType: form.usedType as never,
      platform: form.platform.trim() || null,
      conditionGrade: form.conditionGrade as never,
      packaging: (form.packaging || null) as never,
      guarantee: (form.guarantee || null) as never,
      priceIqd: Number(form.priceIqd) || 0,
      quantity: Number(form.quantity) || 1,
      conditionNotes: form.conditionNotes.trim() || null,
      description: form.description.trim() || null,
      photos,
    }),
    [form, photos],
  );

  const save = useMutation({
    mutationFn: async () => {
      setIssues({});
      const saved: any = existing
        ? await updateUsedListing({ data: { listingId: existing.id, ...payload } })
        : await createUsedListing({ data: payload });
      if (!saved?.success) throw new Error(String(saved?.error ?? "UNEXPECTED_ERROR"));

      const submitted: any = await submitUsedListing({
        data: { listingId: saved.listing.id, policyAccepted: policy },
      });
      if (!submitted?.success) {
        const error = new Error(String(submitted.error));
        (error as any).issues = submitted.issues;
        throw error;
      }
      return submitted;
    },
    onSuccess: () => {
      toast.success("أُرسل عرضك للمراجعة وخُصمت الرسوم");
      onSaved();
    },
    onError: (error: any) => {
      const found: Record<string, string> = {};
      for (const issue of error?.issues ?? []) found[String(issue.field)] = String(issue.message);
      setIssues(found);
      toast.error(errorText(error?.message));
    },
  });

  const addPhoto = async (file: File) => {
    if (photos.length >= config.maxPhotos) {
      toast.error(`الحد الأقصى ${config.maxPhotos} صور`);
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read_failed"));
        reader.readAsDataURL(file);
      });
      // `uploads` namespaces the file under the member's own id, which is what
      // the server checks before it will store the URL on a listing.
      const result = await api.upload(dataUrl, "uploads");
      setPhotos((prev) => [...prev, result.url]);
    } catch {
      toast.error("تعذّر رفع الصورة");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const field = (key: keyof typeof form, label: string, extra?: React.ReactNode) => (
    <label className="block">
      <span className="text-xs font-bold">{label}</span>
      {extra ?? (
        <input
          value={form[key]}
          onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      )}
      {issues[key] && (
        <span className="mt-1 block text-[11px] text-destructive">{issues[key]}</span>
      )}
    </label>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{existing ? "تعديل العرض" : "عرض قطعة مستعملة"}</h3>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("title", "اسم القطعة")}
        {field(
          "usedType",
          "نوع القطعة",
          <select
            value={form.usedType}
            onChange={(event) => setForm((prev) => ({ ...prev, usedType: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {USED_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {USED_TYPE_LABEL_AR[value]}
              </option>
            ))}
          </select>,
        )}
        {field("platform", "المنصة")}
        {field(
          "conditionGrade",
          "درجة الحالة",
          <select
            value={form.conditionGrade}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, conditionGrade: event.target.value }))
            }
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {CONDITION_GRADE_VALUES.map((value) => (
              <option key={value} value={value}>
                {CONDITION_LABEL_AR[value]}
              </option>
            ))}
          </select>,
        )}
        {field(
          "packaging",
          "التغليف",
          <select
            value={form.packaging}
            onChange={(event) => setForm((prev) => ({ ...prev, packaging: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {PACKAGING_VALUES.map((value) => (
              <option key={value} value={value}>
                {PACKAGING_LABEL_AR[value]}
              </option>
            ))}
          </select>,
        )}
        {field(
          "guarantee",
          "الضمان",
          <select
            value={form.guarantee}
            onChange={(event) => setForm((prev) => ({ ...prev, guarantee: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {GUARANTEE_VALUES.map((value) => (
              <option key={value} value={value}>
                {GUARANTEE_LABEL_AR[value]}
              </option>
            ))}
          </select>,
        )}
        {field(
          "priceIqd",
          `السعر (بين ${formatIqd(config.minPriceIqd)} و ${formatIqd(config.maxPriceIqd)})`,
          <input
            type="number"
            inputMode="numeric"
            value={form.priceIqd}
            onChange={(event) => setForm((prev) => ({ ...prev, priceIqd: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />,
        )}
        {field(
          "quantity",
          "الكمية",
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={form.quantity}
            onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />,
        )}
      </div>

      {field(
        "conditionNotes",
        "صف الحالة بصدق — الخدوش وعلامات الاستخدام",
        <textarea
          rows={3}
          value={form.conditionNotes}
          onChange={(event) => setForm((prev) => ({ ...prev, conditionNotes: event.target.value }))}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />,
      )}
      {field(
        "description",
        "تفاصيل إضافية (اختياري)",
        <textarea
          rows={2}
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />,
      )}

      <div>
        <span className="text-xs font-bold">صور القطعة نفسها (حتى {config.maxPhotos})</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((photo) => (
            <div key={photo} className="relative">
              <img
                src={photo}
                alt=""
                className="h-20 w-20 rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => setPhotos((prev) => prev.filter((p) => p !== photo))}
                className="absolute -top-2 -end-2 rounded-full bg-destructive p-1 text-destructive-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border hover:bg-muted">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5 text-muted-foreground" />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addPhoto(file);
              }}
            />
          </label>
        </div>
        {issues.photos && (
          <span className="mt-1 block text-[11px] text-destructive">{issues.photos}</span>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
        <input
          type="checkbox"
          checked={policy}
          onChange={(event) => setPolicy(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          أوافق على{" "}
          <a href="/policy" className="font-bold text-primary underline">
            سياسة بيع القطع المستعملة
          </a>
          ، وأقر أن الوصف أعلاه صحيح وأن القطعة ملكي. أعلم أن{" "}
          <strong>{formatIqd(config.listingFeeIqd)}</strong> ستُخصم من محفظتي عند الإرسال، وأن العرض
          لا يُنشر قبل موافقة فريق بنانتو.
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          ينشر لمدة {config.listingDurationDays} أيام بعد الموافقة.
        </p>
        <button
          type="button"
          disabled={save.isPending || !policy}
          onClick={() => save.mutate()}
          className="rounded-lg bg-foreground px-6 py-2 text-xs font-bold text-background disabled:opacity-40"
        >
          {save.isPending ? (
            <>
              <Loader2 className="inline h-3.5 w-3.5 animate-spin ms-1" />
              جاري الإرسال…
            </>
          ) : (
            <>
              <CheckCircle2 className="inline h-3.5 w-3.5 ms-1" />
              إرسال للمراجعة ودفع الرسوم
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- shared --------------------------------- */

function Empty({ icon: Icon, text }: { icon: typeof Store; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

const ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_WALLET_BALANCE: "رصيد محفظتك لا يكفي لرسوم العرض — اشحن محفظتك ثم أعد المحاولة",
  LISTING_INCOMPLETE: "أكمل الحقول المعلّمة بالأحمر",
  POLICY_NOT_ACCEPTED: "وافق على سياسة البيع أولاً",
  TOO_MANY_ACTIVE_LISTINGS: "لديك عروض مفتوحة أكثر من المسموح — أوقف أحدها أولاً",
  USED_MARKETPLACE_DISABLED: "سوق المستعمل متوقف حالياً",
  NOT_YOUR_LISTING: "هذا العرض ليس لك",
  LISTING_NOT_EDITABLE: "لا يمكن تعديل العرض في حالته الحالية",
  LISTING_CHANGED_CONCURRENTLY: "تغيّر العرض للتو — حدّث الصفحة",
};

function errorText(code: unknown): string {
  return ERROR_TEXT[String(code)] ?? "تعذّر إتمام العملية";
}
