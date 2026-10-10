import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Copy, Dices, Loader2, ShieldCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { adminApi } from "@/lib/api";
import type { AdminContestDetail, AdminContestWinner } from "@/lib/contests.admin";

const STATUS: Record<AdminContestWinner["status"], { label: string; tone: string }> = {
  confirmed: { label: "فائز", tone: "bg-leaf/15 text-leaf" },
  pending: { label: "بانتظار تأكيدك", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  standby: { label: "احتياط", tone: "bg-muted text-muted-foreground" },
  disqualified: { label: "مستبعد", tone: "bg-rind/10 text-rind line-through" },
};

const copy = async (text: string, done = "تم النسخ") => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("تعذّر النسخ");
  }
};

/**
 * The draw, and what follows it: winners and alternates in the order the
 * system picked them, the proof, and the admin's two hands — confirm, or set
 * aside (which promotes the next alternate; it never draws again).
 */
export default function ContestDrawPanel({
  detail,
  onChanged,
}: {
  detail: AdminContestDetail;
  onChanged: () => void;
}) {
  const { contest, winners, stats } = detail;
  const instagram = contest.settings.drawSource === "instagram";
  const drawn = contest.status === "drawn";

  const draw = useMutation({
    mutationFn: () =>
      adminApi.contestAction<{ winners: number; alternates: number }>({
        action: "draw",
        contestId: contest.id,
      }),
    onSuccess: (data) => {
      toast.success(`تم السحب: ${data.winners} فائز و${data.alternates} احتياط`);
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: (winnerId: string) =>
      adminApi.contestAction({ action: "confirm_winner", winnerId }),
    onSuccess: () => {
      toast.success("تم التأكيد — أُضيفت اللعبة إلى ألعاب الفائز");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const disqualify = useMutation({
    mutationFn: (input: { winnerId: string; reason: string }) =>
      adminApi.contestAction<{ promoted: string | null }>({
        action: "disqualify_winner",
        ...input,
      }),
    onSuccess: (data) => {
      toast.success(
        data.promoted ? "استُبعد، ورُقّي الاحتياط التالي" : "استُبعد — لا احتياط متبقٍ",
      );
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const dm = (winner: AdminContestWinner) =>
    `🎉 مبروك! فزت في مسابقة «${contest.settings.title}» بلعبة ${contest.settings.prizeTitle}.\n` +
    `كود جائزتك: ${winner.claimCode}\n` +
    `ادخل حسابك في بنانتو ثم اكتب الكود في «لديك كود جائزة؟» هنا:\n${origin}/banana`;

  if (!drawn) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="text-[13px] leading-relaxed text-foreground">
          {instagram
            ? "يُسحب الفائز من تعليقات المنشور: اجلب التعليقات أو الصقها في تبويب «إنستغرام»، راجع الشروط، ثم اسحب من هناك."
            : `السحب يختار ${contest.settings.winnersCount} فائز و${contest.settings.alternatesCount} احتياط عشوائياً من ${stats.tickets} تذكرة. السحب نهائي ولا يُعاد — الاحتياط هو البديل لأي فائز يُستبعد.`}
        </p>
        {contest.settings.autoDraw && contest.settings.endsAt ? (
          <p className="text-[12px] text-muted-foreground">
            سيُسحب تلقائياً عند الانتهاء:{" "}
            <span dir="ltr">{new Date(contest.settings.endsAt).toLocaleString("en-GB")}</span>
          </p>
        ) : null}
        {!instagram ? (
          <button
            type="button"
            disabled={
              draw.isPending ||
              !stats.tickets ||
              (contest.status !== "open" && contest.status !== "closed")
            }
            onClick={() => {
              if (window.confirm("السحب نهائي: سيُغلق الدخول ويُختار الفائزون الآن. متابعة؟"))
                draw.mutate();
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-sm font-black text-background disabled:opacity-50"
          >
            {draw.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Dices className="h-4 w-4" />
            )}
            اسحب الآن
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[680px] text-right text-[12px]">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2">الترتيب</th>
              <th className="px-3 py-2">الفائز</th>
              <th className="px-3 py-2">{instagram ? "التعليق" : "التذكرة"}</th>
              <th className="px-3 py-2">الحالة</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {winners.map((winner) => {
              const status = STATUS[winner.status];
              return (
                <tr key={winner.id} className="border-b border-border/50 align-top">
                  <td className="px-3 py-2 font-black tabular-nums">
                    {winner.position}
                    {winner.alternate ? (
                      <span className="ms-1 text-[10px] text-muted-foreground">(احتياط)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {winner.source === "instagram" ? (
                      <a
                        href={`https://instagram.com/${winner.instagramUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-primary"
                        dir="ltr"
                      >
                        @{winner.instagramUsername}
                      </a>
                    ) : (
                      <span className="font-bold">{winner.name}</span>
                    )}
                    {winner.claimCode ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-black" dir="ltr">
                          {winner.claimCode}
                        </span>
                        {winner.claimedBy ? (
                          <span className="text-[10px] text-leaf">استُلمت</span>
                        ) : winner.status === "confirmed" ? (
                          <button
                            type="button"
                            onClick={() => void copy(dm(winner), "نُسخت رسالة الفائز")}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold"
                          >
                            <Copy className="h-3 w-3" /> رسالة
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[260px] px-3 py-2 text-muted-foreground">
                    {winner.source === "instagram" ? (
                      <span dir="auto" className="line-clamp-3">
                        {winner.comment}
                      </span>
                    ) : (
                      <span dir="ltr" className="tabular-nums">
                        #{winner.entryNo}
                      </span>
                    )}
                    {winner.note ? (
                      <p className="mt-1 text-[11px] text-rind">{winner.note}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-black ${status.tone}`}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="space-x-1.5 px-3 py-2 whitespace-nowrap">
                    {winner.status === "pending" ? (
                      <button
                        type="button"
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate(winner.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-leaf/15 px-2 py-1 text-[11px] font-bold text-leaf"
                      >
                        <CheckCircle2 className="h-3 w-3" /> تأكيد
                      </button>
                    ) : null}
                    {winner.status !== "disqualified" ? (
                      <button
                        type="button"
                        disabled={disqualify.isPending}
                        onClick={() => {
                          const reason = window.prompt(
                            "سبب الاستبعاد؟ (سيُرقّى الاحتياط التالي تلقائياً)",
                            "لم يطبّق الشروط",
                          );
                          if (reason === null) return;
                          disqualify.mutate({ winnerId: winner.id, reason });
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-rind/40 px-2 py-1 text-[11px] font-bold text-rind"
                      >
                        <UserX className="h-3 w-3" /> استبعاد
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contest.proof ? (
        <div className="rounded-2xl border border-border bg-card p-3 text-[12px]">
          <p className="mb-1.5 flex items-center gap-1.5 font-black">
            <ShieldCheck className="h-4 w-4 text-leaf" /> إثبات السحب (منشور للأعضاء)
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground" dir="ltr">
            <dt>tickets</dt>
            <dd className="tabular-nums">{contest.proof.poolSize}</dd>
            <dt>seed</dt>
            <dd className="break-all font-mono">{contest.proof.seed}</dd>
            <dt>pool</dt>
            <dd className="break-all font-mono">{contest.proof.poolDigest}</dd>
            <dt>drawn</dt>
            <dd>{new Date(contest.proof.drawnAt).toLocaleString("en-GB")}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
