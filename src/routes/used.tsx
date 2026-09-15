import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Facebook,
  Flag,
  Instagram,
  Loader2,
  MessageCircle,
  PauseCircle,
  Phone,
  Plus,
  RefreshCw,
  Send,
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
  CONTACT_CHANNELS,
  CONTACT_LABEL_AR,
  buildContactLink,
  type ContactChannel,
} from "@/lib/contact-links";
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
  REPORT_REASONS,
  REPORT_REASON_LABEL_AR,
  SOLD_ANSWER_LABEL_AR,
  USED_TYPE_VALUES,
  clearFieldsNotFor,
  sellerFieldsFor,
  type ReportReason,
  type SellerOptionalField,
  type UsedListingStatus,
} from "@/lib/used-marketplace";
import {
  answerUsedSoldPrompt,
  createUsedListing,
  loadMyUsedListings,
  loadUsedMarketplace,
  moveUsedListing,
  noteUsedContactClick,
  reportUsedListing,
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
  const { user } = useAuth();
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [reporting, setReporting] = useState(false);
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
          {(listing.usagePeriodMonths != null || listing.warrantyMonths != null) && (
            <p className="text-[11px] text-muted-foreground">
              {listing.usagePeriodMonths != null
                ? `استُخدمت ${listing.usagePeriodMonths} شهراً`
                : ""}
              {listing.usagePeriodMonths != null && listing.warrantyMonths != null ? " · " : ""}
              {listing.warrantyMonths != null ? `ضمان متبقٍ ${listing.warrantyMonths} شهراً` : ""}
            </p>
          )}
          {/*
            The buyer confirms they have read the policy before any way of
            reaching the seller appears. A used item is sold as its owner
            described it, and once the buttons are on screen the shop is out of
            the conversation — so the acknowledgement gates them rather than
            following them.
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
              وأفهم أن القطعة تُباع بحالتها الموصوفة، والتواصل مع البائع مباشرة.
            </span>
          </label>

          {policyAccepted ? (
            <ContactButtons listing={listing} />
          ) : (
            <button
              type="button"
              onClick={() => toast.error("وافق على سياسة القطع المستعملة أولاً")}
              className="w-full cursor-not-allowed rounded-lg bg-muted px-4 py-2 text-center text-xs font-bold text-muted-foreground"
            >
              تواصل مع البائع
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              // One report per member per listing is the rule that makes the
              // admin's queue bearable, and it needs a member to count.
              if (!user) {
                toast.error("سجّل الدخول لتتمكن من الإبلاغ");
                return;
              }
              setReporting(true);
            }}
            className="flex w-full items-center justify-center gap-1 py-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Flag className="h-3 w-3" />
            أبلغ عن هذا العرض
          </button>
        </div>
      </div>

      {reporting && <ReportDialog listingId={listing.id} onClose={() => setReporting(false)} />}
    </article>
  );
}

/**
 * The seller's own contact buttons.
 *
 * `contactLinks` arrives already built by the server from the handle the
 * seller typed — the raw text never reaches this component, and never reaches
 * an `href`. Pressing one opens the seller's app and, separately, tells the
 * shop the listing was contacted, which is what starts the three-day «did you
 * sell it?» clock. That note is deliberately not awaited: the link has already
 * opened, and a failed bookkeeping call must not look like a broken button.
 */
function ContactButtons({ listing }: { listing: any }) {
  const links: Array<{ channel: ContactChannel; href: string; label: string }> =
    listing.contactLinks ?? [];

  if (links.length === 0) {
    return (
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-center text-[11px] text-muted-foreground">
        لا توجد وسيلة تواصل على هذا العرض.
      </p>
    );
  }

  const note = () => {
    void noteUsedContactClick({ data: { listingId: listing.id } }).catch(() => {});
  };

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {links.map((link) => {
        const Icon = CHANNEL_ICON[link.channel] ?? MessageCircle;
        return (
          <a
            key={link.channel}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={note}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-[11px] font-bold hover:bg-muted"
          >
            <Icon className="h-3.5 w-3.5" />
            {link.label}
          </a>
        );
      })}
    </div>
  );
}

const CHANNEL_ICON: Record<ContactChannel, typeof Send> = {
  telegram: Send,
  whatsapp: MessageCircle,
  phone: Phone,
  facebook: Facebook,
  instagram: Instagram,
};

/**
 * Reporting a listing.
 *
 * It hides nothing by itself — an admin decides. Two people can want the same
 * listing gone for opposite reasons, so this collects the complaint and stops
 * there.
 */
function ReportDialog({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("no_reply");
  const [note, setNote] = useState("");

  const send = useMutation({
    mutationFn: () => reportUsedListing({ data: { listingId, reason, note: note.trim() } }),
    onSuccess: (result: any) => {
      if (!result?.success) {
        toast.error(errorText(result?.error));
        return;
      }
      // `recorded` is false when this member already reported this listing.
      toast.success(result.recorded ? "وصل بلاغك للفريق، شكراً" : "سبق أن أبلغت عن هذا العرض");
      onClose();
    },
    onError: () => toast.error("تعذّر إرسال البلاغ"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-bold">أبلغ عن العرض</h3>
        <div className="space-y-1.5">
          {REPORT_REASONS.map((value) => (
            <label key={value} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="report-reason"
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {REPORT_REASON_LABEL_AR[value]}
            </label>
          ))}
        </div>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="تفاصيل (اختياري)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-bold hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={send.isPending}
            onClick={() => send.mutate()}
            className="rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground disabled:opacity-40"
          >
            {send.isPending ? "جارٍ الإرسال…" : "إرسال البلاغ"}
          </button>
        </div>
      </div>
    </div>
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
  usagePeriodMonths: "",
  warrantyMonths: "",
  priceIqd: "",
  quantity: "1",
  conditionNotes: "",
  description: "",
};

/** One text box per channel, keyed the way the server expects them. */
const EMPTY_CONTACT: Record<ContactChannel, string> = {
  telegram: "",
  whatsapp: "",
  phone: "",
  facebook: "",
  instagram: "",
};

/*
  What to type in each box.

  Written as an example rather than a rule, because the rule is enforced by
  `buildContactLink` and repeating it here in prose would be a second copy to
  get wrong. A seller may paste a whole profile URL into any of them — the
  builder unwraps it — but the placeholder asks for the short thing, since that
  is what somebody has to hand.
*/
const CONTACT_HINT: Record<ContactChannel, string> = {
  telegram: "اسم المستخدم بدون @ — مثال: banantoshop",
  whatsapp: "الرقم مع مفتاح الدولة — مثال: 07701234567",
  phone: "رقم للاتصال — مثال: 07701234567",
  facebook: "اسم الصفحة أو الحساب — مثال: banan.to",
  instagram: "اسم المستخدم بدون @ — مثال: banan.to",
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
            رسوم العرض {formatIqd(config.listingFeeIqd)} لكل {config.listingDurationDays} يوماً،
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

            <SoldPrompt listing={listing} onAnswered={() => void refetch()} />

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

/**
 * «Did you sell it?», three days after somebody first pressed a contact
 * button.
 *
 * The prompt is raised by a scheduled job, not by this component — a listing
 * carries `soldPromptAt` once it is due — so an unanswered prompt survives the
 * seller closing the page. Answering «yes» pauses the listing at once so
 * nobody else contacts them about something already gone; answering «no»
 * leaves it up for the rest of its month, which is the whole point of asking
 * rather than expiring it on a guess.
 */
function SoldPrompt({ listing, onAnswered }: { listing: any; onAnswered: () => void }) {
  const answer = useMutation({
    mutationFn: (value: "sold" | "still_available") =>
      answerUsedSoldPrompt({ data: { listingId: listing.id, answer: value } }),
    onSuccess: (result: any) => {
      if (!result?.success) {
        toast.error(errorText(result?.error));
        return;
      }
      toast.success("شكراً، حدّثنا العرض");
      onAnswered();
    },
    onError: () => toast.error("تعذّر حفظ إجابتك"),
  });

  if (!listing.soldPromptAt || listing.soldPromptAnswer) return null;

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
      <p className="text-xs font-bold">
        تواصل معك مشترٍ قبل أيام — هل بعت هذه القطعة؟
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["sold", "still_available"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate(value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-40"
          >
            {SOLD_ANSWER_LABEL_AR[value]}
          </button>
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
          usagePeriodMonths:
            existing.usagePeriodMonths == null ? "" : String(existing.usagePeriodMonths),
          warrantyMonths: existing.warrantyMonths == null ? "" : String(existing.warrantyMonths),
          priceIqd: String(existing.priceIqd ?? ""),
          quantity: String(existing.quantity ?? 1),
          conditionNotes: existing.conditionNotes ?? "",
          description: existing.description ?? "",
        }
      : { ...EMPTY_FORM },
  );
  const [contact, setContact] = useState<Record<ContactChannel, string>>(() => ({
    ...EMPTY_CONTACT,
    ...(existing?.contact ?? {}),
  }));
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
      /*
        Only what this kind was actually asked. `clearFieldsNotFor` blanks a
        hidden answer the moment the kind changes, so an empty string here is a
        question that was either skipped or withdrawn — either way it is `null`
        rather than a zero, which would read as «no warranty left» instead of
        «not stated».
      */
      usagePeriodMonths: form.usagePeriodMonths === "" ? null : Number(form.usagePeriodMonths),
      warrantyMonths: form.warrantyMonths === "" ? null : Number(form.warrantyMonths),
      contact: Object.fromEntries(
        Object.entries(contact)
          .map(([channel, value]) => [channel, String(value).trim()])
          .filter(([, value]) => value !== ""),
      ),
      photos,
    }),
    [form, contact, photos],
  );

  /*
    The id of a draft this form created, so a second press updates it.

    Sending is two calls — save, then submit — and only the second one runs the
    submission checks. So a listing that fails them has already been written,
    and pressing «إرسال» again used to create a *second* draft: three attempts
    at the same console left three drafts, each counting against the seller's
    active-listing cap. Now the first press remembers what it made.
  */
  const [draftId, setDraftId] = useState<string | null>(existing?.id ?? null);

  const save = useMutation({
    mutationFn: async () => {
      setIssues({});
      const saved: any = draftId
        ? await updateUsedListing({ data: { listingId: draftId, ...payload } })
        : await createUsedListing({ data: payload });
      if (!saved?.success) throw new Error(String(saved?.error ?? "UNEXPECTED_ERROR"));
      setDraftId(String(saved.listing.id));

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

  const asked = useMemo(() => new Set(sellerFieldsFor(form.usedType)), [form.usedType]);
  const shows = (key: SellerOptionalField) => asked.has(key);

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

      {/*
        The kind comes first, and it decides the rest of the form.

        Everything below the picker is either asked of every listing or asked
        of this kind only — `sellerFieldsFor` is the one table that says which,
        and the same table blanks an answer that stops applying when the picker
        changes. Somebody selling a figurine is not asked which platform it
        runs on or how many months of warranty are left on it.
      */}
      <div>
        <span className="text-xs font-bold">ما الذي تبيعه؟</span>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {USED_TYPE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setForm((prev) => clearFieldsNotFor(value, { ...prev, usedType: value }))
              }
              className={`rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${
                form.usedType === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:bg-muted"
              }`}
            >
              {USED_TYPE_LABEL_AR[value]}
            </button>
          ))}
        </div>
        {issues.usedType && (
          <span className="mt-1 block text-[11px] text-destructive">{issues.usedType}</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("title", "اسم القطعة")}
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
        {shows("platform") && field("platform", "المنصة")}
        {shows("packaging") &&
          field(
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
        {shows("guarantee") &&
          field(
            "guarantee",
            "الضمان الذي تقدمه للمشتري",
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
        {shows("usagePeriodMonths") &&
          field(
            "usagePeriodMonths",
            "مدة الاستخدام بالأشهر (اختياري)",
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              value={form.usagePeriodMonths}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, usagePeriodMonths: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />,
          )}
        {shows("warrantyMonths") &&
          field(
            "warrantyMonths",
            "الضمان المتبقي من الشركة بالأشهر (اختياري)",
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              value={form.warrantyMonths}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, warrantyMonths: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />,
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

      {/*
        How the buyer reaches the seller.

        One box per app, and the seller types the short thing they know — a
        username, a phone number. The link is built by the shop, never taken
        from what was typed, which is what keeps a `javascript:` «handle» off a
        public page. The line under a filled box shows the address that will
        actually be published, so a seller can see their own typo before an
        admin does.
      */}
      <div>
        <span className="text-xs font-bold">
          كيف يتواصل معك المشتري؟ <span className="text-destructive">*</span>
        </span>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          املأ وسيلة واحدة على الأقل. تظهر أزرارها للمشتري بعد موافقة الفريق فقط.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {CONTACT_CHANNELS.map((channel) => {
            const typed = contact[channel].trim();
            const built = typed ? buildContactLink(channel, typed) : null;
            return (
              <label key={channel} className="block">
                <span className="text-xs font-bold">{CONTACT_LABEL_AR[channel]}</span>
                <input
                  value={contact[channel]}
                  onChange={(event) =>
                    setContact((prev) => ({ ...prev, [channel]: event.target.value }))
                  }
                  placeholder={CONTACT_HINT[channel]}
                  dir="ltr"
                  className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm ${
                    typed && !built ? "border-destructive" : "border-border"
                  }`}
                />
                {typed &&
                  (built ? (
                    <span className="mt-1 block break-all text-[11px] text-emerald-600">
                      {built.href}
                    </span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-destructive">
                      لم نتعرف على هذا — اكتب اسم المستخدم أو الرقم فقط
                    </span>
                  ))}
              </label>
            );
          })}
        </div>
        {issues.contact && (
          <span className="mt-1 block text-[11px] text-destructive">{issues.contact}</span>
        )}
      </div>

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
          ينشر لمدة {config.listingDurationDays} يوماً بعد الموافقة.
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
