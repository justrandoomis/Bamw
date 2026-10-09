import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Loader2, Plus, Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { adminApi } from "@/lib/api";
import { DEFAULT_CONTEST_SETTINGS, PHASE_LABELS, type ContestSettings } from "@/lib/contests";
import type { AdminContestDetail } from "@/lib/contests.admin";

import ContestDrawPanel from "./ContestDrawPanel";
import ContestEditor from "./ContestEditor";
import { EntriesPanel, TicketsPanel } from "./ContestEntriesPanel";
import InstagramPanel from "./InstagramPanel";

type DetailTab = "settings" | "entries" | "tickets" | "instagram" | "draw";

/**
 * «إدارة كاملة من صفحة الإدارة للأدمن»: every contest, and everything about
 * one — its settings, who entered, the tickets handed out, the Instagram
 * comments, the draw and its winners.
 */
export default function ContestsManager() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const list = useQuery({ queryKey: ["admin", "contests"], queryFn: () => adminApi.contests() });

  const create = useMutation({
    mutationFn: (settings: ContestSettings) =>
      adminApi.contestAction<{ id: string }>({ action: "save", settings }),
    onSuccess: (data) => {
      toast.success("أُنشئت المسابقة كمسودة — انشرها عندما تكون جاهزة");
      void queryClient.invalidateQueries({ queryKey: ["admin", "contests"] });
      setSelected(data.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (selected === "new") {
    return (
      <Shell>
        <BackBar onBack={() => setSelected(null)} title="مسابقة جديدة" />
        <ContestEditor
          initial={DEFAULT_CONTEST_SETTINGS}
          locked={false}
          saving={create.isPending}
          onSave={(settings) => create.mutate(settings)}
        />
      </Shell>
    );
  }

  if (selected) {
    return (
      <Shell>
        <ContestDetail id={selected} onBack={() => setSelected(null)} />
      </Shell>
    );
  }

  const contests = list.data?.contests ?? [];
  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
          <Trophy className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black text-foreground">المسابقات</h2>
          <p className="text-[12px] text-muted-foreground">
            مسابقات بتذاكر الموقع أو بتعليقات إنستغرام — الفائز يأخذ اللعبة في «ألعابه» ويستوردها
            مجاناً
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSelected("new")}
          className="flex min-h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-black text-background"
        >
          <Plus className="h-4 w-4" /> مسابقة جديدة
        </button>
      </header>

      {list.isPending ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : list.isError ? (
        <p className="rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">
          {(list.error as Error).message}
        </p>
      ) : !contests.length ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          لا مسابقات بعد — أنشئ أول مسابقة.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {contests.map((contest) => (
            <li key={contest.id}>
              <button
                type="button"
                onClick={() => setSelected(contest.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-start transition-colors hover:bg-muted/40"
              >
                {contest.prizeImage ? (
                  <img
                    src={contest.prizeImage}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-muted text-xl">
                    🏆
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-black">
                      {contest.status === "draft" ? "مسودة" : PHASE_LABELS[contest.phase]}
                    </span>
                    {contest.drawSource === "instagram" ? (
                      <span className="rounded-full bg-[#DD2A7B]/10 px-2 py-0.5 text-[10.5px] font-black text-[#C13584]">
                        إنستغرام
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[13.5px] font-black">
                    {contest.title || "بلا عنوان"}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    🎁 {contest.prizeTitle || "—"} · {contest.participants} مشارك ·{" "}
                    {contest.tickets} تذكرة
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full space-y-4 p-2 sm:p-6" dir="rtl">
      {children}
    </div>
  );
}

function BackBar({
  onBack,
  title,
  extra,
}: {
  onBack: () => void;
  title: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-[12.5px] font-bold"
      >
        <ArrowRight className="h-4 w-4" /> كل المسابقات
      </button>
      <h2 className="min-w-0 flex-1 truncate text-base font-black">{title}</h2>
      {extra}
    </div>
  );
}

const STATUS_NOTE: Record<string, string> = {
  draft: "مسودة — لا يراها الأعضاء حتى تنشرها.",
  open: "منشورة.",
  closed: "أُنهي الدخول — بانتظار السحب.",
  drawn: "تم السحب.",
  cancelled: "أُلغيت.",
};

function ContestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("settings");
  const detail = useQuery({
    queryKey: ["admin", "contest", id],
    queryFn: () => adminApi.contest(id),
    refetchInterval: 20_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "contest", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "contests"] });
  };

  const save = useMutation({
    mutationFn: (settings: ContestSettings) =>
      adminApi.contestAction({ action: "save", contestId: id, settings }),
    onSuccess: () => {
      toast.success("حُفظت الإعدادات");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const status = useMutation({
    mutationFn: (action: string) =>
      adminApi.contestAction<{ refunded?: number }>({ action, contestId: id }),
    onSuccess: (data, action) => {
      toast.success(
        action === "cancel" && data.refunded
          ? `أُلغيت وأُعيد ${data.refunded} موزة للمشاركين`
          : "تم",
      );
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detail.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <>
        <BackBar onBack={onBack} title="المسابقة" />
        <p className="text-sm text-muted-foreground">{(detail.error as Error)?.message}</p>
      </>
    );
  }

  const data: AdminContestDetail = detail.data;
  const contest = data.contest;
  const instagram = contest.settings.drawSource === "instagram";
  const tabs: { id: DetailTab; label: string }[] = [
    { id: "settings", label: "الإعدادات" },
    ...(instagram
      ? [{ id: "instagram" as const, label: "إنستغرام" }]
      : [
          { id: "entries" as const, label: `المشاركون (${data.stats.participants})` },
          { id: "tickets" as const, label: "التذاكر" },
        ]),
    { id: "draw", label: "السحب والفائزون" },
  ];
  const act = (action: string, question?: string) => {
    if (question && !window.confirm(question)) return;
    status.mutate(action);
  };
  const button =
    "flex min-h-9 items-center gap-1 rounded-xl px-3 text-[12.5px] font-black disabled:opacity-50";

  return (
    <>
      <BackBar
        onBack={onBack}
        title={contest.settings.title || "بلا عنوان"}
        extra={
          contest.status !== "draft" ? (
            <a
              href={`/banana_market?tab=events&contest=${contest.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-[12.5px] font-bold"
            >
              <ExternalLink className="h-4 w-4" /> كما يراها الأعضاء
            </a>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <p className="min-w-0 flex-1 text-[12.5px] font-bold">
          {contest.status === "open"
            ? `منشورة — ${PHASE_LABELS[contest.phase]}`
            : (STATUS_NOTE[contest.status] ?? "")}
        </p>
        {contest.status === "draft" ? (
          <button
            type="button"
            disabled={status.isPending}
            onClick={() => act("publish")}
            className={`${button} bg-leaf text-white`}
          >
            نشر للأعضاء
          </button>
        ) : null}
        {contest.status === "open" ? (
          <>
            <button
              type="button"
              disabled={status.isPending}
              onClick={() => act("close", "إنهاء الدخول الآن؟ (يبقى السحب بيدك)")}
              className={`${button} border border-border`}
            >
              إنهاء الدخول
            </button>
            {data.stats.tickets === 0 ? (
              <button
                type="button"
                disabled={status.isPending}
                onClick={() => act("unpublish")}
                className={`${button} border border-border`}
              >
                إخفاء (مسودة)
              </button>
            ) : null}
          </>
        ) : null}
        {contest.status === "closed" ? (
          <button
            type="button"
            disabled={status.isPending}
            onClick={() => act("reopen")}
            className={`${button} border border-border`}
          >
            إعادة فتح
          </button>
        ) : null}
        {contest.status !== "drawn" && contest.status !== "cancelled" ? (
          <button
            type="button"
            disabled={status.isPending}
            onClick={() =>
              act("cancel", "إلغاء المسابقة نهائياً؟ يُعاد موز من دخل بالموز تلقائياً.")
            }
            className={`${button} border border-rind/40 text-rind`}
          >
            إلغاء المسابقة
          </button>
        ) : null}
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-9 shrink-0 rounded-xl px-3 text-[12.5px] font-black ${
              tab === item.id ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "settings" ? (
        contest.status === "drawn" || contest.status === "cancelled" ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
            لا تُعدّل مسابقة {contest.status === "drawn" ? "تم السحب فيها" : "ملغاة"}.
          </p>
        ) : (
          <ContestEditor
            key={`${contest.id}:${contest.status}`}
            initial={contest.settings}
            locked={contest.status !== "draft"}
            saving={save.isPending}
            onSave={(settings) => save.mutate(settings)}
          />
        )
      ) : tab === "entries" ? (
        <EntriesPanel detail={data} onChanged={refresh} />
      ) : tab === "tickets" ? (
        <TicketsPanel detail={data} onChanged={refresh} />
      ) : tab === "instagram" ? (
        <InstagramPanel detail={data} onChanged={refresh} />
      ) : (
        <ContestDrawPanel detail={data} onChanged={refresh} />
      )}
    </>
  );
}
