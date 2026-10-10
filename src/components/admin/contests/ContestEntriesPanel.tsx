import { useMutation } from "@tanstack/react-query";
import { Ban, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { adminApi } from "@/lib/api";
import type { AdminContestDetail } from "@/lib/contests.admin";
import { ENTRY_METHOD_LABELS } from "@/lib/contests";

const copy = async (text: string, done = "تم النسخ") => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("تعذّر النسخ");
  }
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Who has entered, ticket by ticket, and the admin's hand on it. */
export function EntriesPanel({
  detail,
  onChanged,
}: {
  detail: AdminContestDetail;
  onChanged: () => void;
}) {
  const remove = useMutation({
    mutationFn: (input: { entryId: string; reason: string }) =>
      adminApi.contestAction({ action: "remove_entry", ...input }),
    onSuccess: () => {
      toast.success("استُبعدت التذكرة");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const { stats, entries } = detail;
  const drawn = detail.contest.status === "drawn";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Stat label="المشاركون" value={stats.participants} />
        <Stat label="التذاكر" value={stats.tickets} />
        {(["free", "bananas", "ticket", "referral"] as const).map((method) => (
          <Stat
            key={method}
            label={ENTRY_METHOD_LABELS[method]}
            value={stats.byMethod[method] ?? 0}
          />
        ))}
      </div>
      {!entries.length ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          لا مشاركين بعد.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-right text-[12px]">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">العضو</th>
                <th className="px-3 py-2">الطريقة</th>
                <th className="px-3 py-2">التفاصيل</th>
                <th className="px-3 py-2">الوقت</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-b border-border/50 ${entry.removedAt ? "opacity-50 line-through" : ""}`}
                >
                  <td className="px-3 py-2 font-black tabular-nums" dir="ltr">
                    {entry.entryNo}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-bold">{entry.name}</span>
                    {entry.username ? (
                      <span className="ms-1 text-muted-foreground" dir="ltr">
                        @{entry.username}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{ENTRY_METHOD_LABELS[entry.method]}</td>
                  <td className="px-3 py-2 text-muted-foreground" dir="ltr">
                    {entry.ticketCode ?? (entry.bananas ? `${entry.bananas} 🍌` : "")}
                    {entry.removedReason ? ` — ${entry.removedReason}` : ""}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground" dir="ltr">
                    {when(entry.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    {!entry.removedAt && !drawn ? (
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => {
                          const reason = window.prompt("سبب استبعاد هذه التذكرة؟", "مخالفة الشروط");
                          if (reason === null) return;
                          remove.mutate({ entryId: entry.id, reason });
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-rind/40 px-2 py-1 text-[11px] font-bold text-rind"
                      >
                        <Trash2 className="h-3 w-3" /> استبعاد
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length >= 400 ? (
        <p className="text-[11px] text-muted-foreground">تظهر آخر 400 تذكرة.</p>
      ) : null}
    </div>
  );
}

/** Ticket codes the admin makes and hands to people by hand. */
export function TicketsPanel({
  detail,
  onChanged,
}: {
  detail: AdminContestDetail;
  onChanged: () => void;
}) {
  const [count, setCount] = useState(5);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const contest = detail.contest;
  const enabled = contest.settings.entryMethods.includes("ticket");
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/banana?contest=${contest.id}`;
  const message = (code: string) =>
    `🎟️ تذكرتك لدخول مسابقة «${contest.settings.title}»: ${code}\nادخل من هنا واكتب الرقم في «لديك تذكرة من الإدارة؟»:\n${link}`;

  const create = useMutation({
    mutationFn: () =>
      adminApi.contestAction<{ codes: string[] }>({
        action: "create_tickets",
        contestId: contest.id,
        count,
        note,
      }),
    onSuccess: (data) => {
      setFresh(data.codes);
      toast.success(`أُنشئت ${data.codes.length} تذكرة`);
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (code: string) => adminApi.contestAction({ action: "revoke_ticket", code }),
    onSuccess: () => {
      toast.success("أُلغي الكود");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!enabled) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
        فعّل «بتذكرة» في طرق الدخول من الإعدادات لتنشئ تذاكر.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-[120px_1fr_auto] sm:items-end">
        <label className="block space-y-1">
          <span className="text-[12px] font-bold text-muted-foreground">العدد</span>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value) || 1)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] font-bold text-muted-foreground">
            لمن؟ (ملاحظة لك، مثل حساب إنستغرام)
          </span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="@username"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={create.isPending || detail.contest.status === "drawn"}
          onClick={() => create.mutate()}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-black text-background disabled:opacity-50"
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          إنشاء تذاكر
        </button>
      </div>

      {fresh.length ? (
        <div className="rounded-2xl border border-leaf/40 bg-leaf/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-black">التذاكر الجديدة — سلّم كل كود لشخص واحد</p>
            <button
              type="button"
              onClick={() => void copy(fresh.join("\n"), "نُسخت كل الأكواد")}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold"
            >
              <Copy className="h-3 w-3" /> نسخ الكل
            </button>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {fresh.map((code) => (
              <li
                key={code}
                className="flex items-center justify-between gap-2 rounded-lg bg-card px-2 py-1.5"
              >
                <span className="font-mono text-[13px] font-black tracking-wider" dir="ltr">
                  {code}
                </span>
                <button
                  type="button"
                  onClick={() => void copy(message(code), "نُسخت رسالة التذكرة")}
                  className="text-[11px] font-bold text-primary"
                >
                  نسخ رسالة
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[560px] text-right text-[12px]">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2">الكود</th>
              <th className="px-3 py-2">لمن</th>
              <th className="px-3 py-2">الحالة</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {detail.tickets.map((ticket) => (
              <tr key={ticket.code} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono font-black" dir="ltr">
                  {ticket.code}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{ticket.note || "—"}</td>
                <td className="px-3 py-2">
                  {ticket.revokedAt ? (
                    <span className="text-rind">ملغى</span>
                  ) : ticket.redeemedBy ? (
                    <span className="text-leaf">مستخدم · {when(ticket.redeemedAt)}</span>
                  ) : (
                    <span className="text-muted-foreground">لم يُستخدم</span>
                  )}
                </td>
                <td className="flex gap-1.5 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void copy(message(ticket.code), "نُسخت رسالة التذكرة")}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold"
                  >
                    <Copy className="h-3 w-3" /> رسالة
                  </button>
                  {!ticket.redeemedBy && !ticket.revokedAt ? (
                    <button
                      type="button"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(`إلغاء الكود ${ticket.code}؟`))
                          revoke.mutate(ticket.code);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rind/40 px-2 py-1 text-[11px] font-bold text-rind"
                    >
                      <Ban className="h-3 w-3" /> إلغاء
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!detail.tickets.length ? (
          <p className="p-4 text-center text-[12px] text-muted-foreground">لا تذاكر بعد.</p>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        مستخدمة {detail.stats.ticketsRedeemed} من {detail.stats.ticketsCreated}.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-2.5">
      <p className="truncate text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className="text-[16px] font-black tabular-nums" dir="ltr">
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}
