import { useMutation } from "@tanstack/react-query";
import { CloudDownload, Dices, Eye, Loader2, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { adminApi } from "@/lib/api";
import type { AdminContestDetail, InstagramPreview } from "@/lib/contests.admin";
import { IG_REJECTION_LABELS, type IgFilters, type IgRejection } from "@/lib/instagramComments";

import IgFiltersFields from "./IgFiltersFields";

/**
 * «يسحب الفائز بشكل تلقائي من التعليقات في الانستغرام إذا طبق شروط»
 *
 * Three steps on one screen: bring the post's comments in (fetched from the
 * shop's connected account, or pasted from an export), see what the rules do
 * to them, then draw. The rules used are saved with the contest, and the draw
 * is published with its seed, like every other draw.
 */
export default function InstagramPanel({
  detail,
  onChanged,
}: {
  detail: AdminContestDetail;
  onChanged: () => void;
}) {
  const contest = detail.contest;
  const [filters, setFilters] = useState<IgFilters>(contest.settings.igFilters);
  const [raw, setRaw] = useState("");
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<InstagramPreview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const drawn = contest.status === "drawn";

  const fetchAll = useMutation({
    mutationFn: async (restart: boolean) => {
      let first = true;
      for (let round = 0; round < 40; round += 1) {
        const page = await adminApi.contestAction<{
          added: number;
          total: number;
          complete: boolean;
        }>({
          action: "instagram_fetch",
          contestId: contest.id,
          restart: restart && first,
        });
        first = false;
        setProgress(`جُلب ${page.total.toLocaleString("en-US")} تعليق…`);
        if (page.complete) return page;
      }
      return null;
    },
    onSuccess: (page) => {
      setProgress(null);
      toast.success(
        page ? `اكتمل الجلب: ${page.total} تعليق` : "جُلب جزء — اضغط مرة أخرى للمتابعة",
      );
      onChanged();
    },
    onError: (error: Error) => {
      setProgress(null);
      toast.error(error.message);
    },
  });

  const paste = useMutation({
    mutationFn: () =>
      adminApi.contestAction<{ added: number; total: number }>({
        action: "instagram_import",
        contestId: contest.id,
        raw,
        replace,
      }),
    onSuccess: (data) => {
      toast.success(`أُضيف ${data.added} تعليق — المجموع ${data.total}`);
      setRaw("");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const look = useMutation({
    mutationFn: () =>
      adminApi.contestAction<InstagramPreview>({
        action: "instagram_preview",
        contestId: contest.id,
        filters,
      }),
    onSuccess: setPreview,
    onError: (error: Error) => toast.error(error.message),
  });

  const draw = useMutation({
    mutationFn: () =>
      adminApi.contestAction<{ winners: number; alternates: number }>({
        action: "draw",
        contestId: contest.id,
        filters,
      }),
    onSuccess: (data) => {
      toast.success(
        `تم السحب: ${data.winners} فائز و${data.alternates} احتياط — انظر «السحب والفائزون»`,
      );
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[14px] font-black">١. التعليقات</h3>
        <p className="text-[12.5px] text-muted-foreground">
          المحفوظ الآن:{" "}
          <b className="tabular-nums text-foreground">
            {detail.instagram.comments.toLocaleString("en-US")}
          </b>{" "}
          تعليق
          {detail.instagram.fetchedAt ? (
            <>
              {" "}
              · آخر جلب{" "}
              <span dir="ltr">{new Date(detail.instagram.fetchedAt).toLocaleString("en-GB")}</span>
              {detail.instagram.complete ? " (مكتمل)" : " (غير مكتمل)"}
            </>
          ) : null}
        </p>

        {detail.instagram.configured ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={fetchAll.isPending || drawn || !contest.settings.instagramUrl}
              onClick={() => fetchAll.mutate(false)}
              className="flex min-h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-black text-background disabled:opacity-50"
            >
              {fetchAll.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              جلب التعليقات من المنشور
            </button>
            <button
              type="button"
              disabled={fetchAll.isPending || drawn}
              onClick={() => {
                if (window.confirm("حذف التعليقات المحفوظة والجلب من جديد؟")) fetchAll.mutate(true);
              }}
              className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> من جديد
            </button>
            {progress ? (
              <span className="self-center text-[12px] text-muted-foreground">{progress}</span>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/60 p-3 text-[12px] leading-relaxed">
            <p className="font-bold">حساب إنستغرام غير مربوط بالمتجر — الصق التعليقات أدناه.</p>
            <p className="mt-1 text-muted-foreground">
              للجلب التلقائي: أضف في إعدادات Cloudflare السرّ{" "}
              <code dir="ltr">INSTAGRAM_ACCESS_TOKEN</code> لحساب المتجر الاحترافي بصلاحيتي{" "}
              <code dir="ltr">instagram_business_basic</code> و
              <code dir="ltr">instagram_business_manage_comments</code>.
            </p>
          </div>
        )}

        <details className="rounded-xl border border-border bg-background p-3">
          <summary className="cursor-pointer text-[13px] font-black">لصق التعليقات يدوياً</summary>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            سطر لكل تعليق بصيغة «الحساب: النص»، أو CSV فيه عمودا username و text، أو JSON من أداة
            تصدير.
          </p>
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={6}
            dir="auto"
            placeholder={"ali_gamer: @friend1 @friend2 أتمنى الفوز\nsara.k: @x @y 🔥"}
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-[12px] outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] font-bold">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              استبدل المحفوظ
            </label>
            <button
              type="button"
              disabled={paste.isPending || !raw.trim() || drawn}
              onClick={() => paste.mutate()}
              className="flex min-h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-black text-background disabled:opacity-50"
            >
              {paste.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              إضافة التعليقات
            </button>
          </div>
        </details>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[14px] font-black">٢. الشروط</h3>
        <IgFiltersFields key={contest.id} value={filters} onChange={setFilters} />
        <button
          type="button"
          disabled={look.isPending}
          onClick={() => look.mutate()}
          className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-4 text-sm font-bold disabled:opacity-50"
        >
          {look.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          معاينة النتيجة
        </button>
        {preview ? <PreviewView preview={preview} /> : null}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-[14px] font-black">٣. السحب</h3>
        <p className="text-[12.5px] text-muted-foreground">
          {contest.settings.winnersCount} فائز و{contest.settings.alternatesCount} احتياط، بحساب
          واحد لكل فائز. تُحفظ الشروط مع المسابقة، والسحب نهائي.
        </p>
        <button
          type="button"
          disabled={draw.isPending || drawn || !detail.instagram.comments}
          onClick={() => {
            if (window.confirm("السحب نهائي ولا يُعاد. اسحب الآن بهذه الشروط؟")) draw.mutate();
          }}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] px-5 text-sm font-black text-white disabled:opacity-50"
        >
          {draw.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Dices className="h-4 w-4" />
          )}
          {drawn ? "تم السحب" : "اسحب الفائزين من التعليقات"}
        </button>
      </section>
    </div>
  );
}

function PreviewView({ preview }: { preview: InstagramPreview }) {
  const { stats } = preview;
  return (
    <div className="space-y-2 rounded-xl bg-background p-3">
      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <Pill label="تعليقات" value={stats.comments} />
        <Pill label="حسابات" value={stats.accounts} />
        <Pill label="حسابات مطابقة" value={stats.qualifiedAccounts} strong />
        <Pill label="مكرر حُذف" value={stats.duplicatesDropped} />
      </div>
      {Object.keys(stats.rejected).length ? (
        <p className="text-[11.5px] text-muted-foreground">
          استُبعد:{" "}
          {Object.entries(stats.rejected)
            .map(([reason, n]) => `${IG_REJECTION_LABELS[reason as IgRejection] ?? reason} ${n}`)
            .join(" · ")}
        </p>
      ) : null}
      {preview.sample.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto text-[12px]">
          {preview.sample.map((entrant) => (
            <li key={entrant.username} className="flex gap-2 rounded-lg bg-card px-2 py-1">
              <span className="shrink-0 font-bold" dir="ltr">
                @{entrant.username}
              </span>
              <span className="min-w-0 truncate text-muted-foreground" dir="auto">
                {entrant.comment}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Pill({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${strong ? "border-leaf/40 bg-leaf/10" : "border-border"}`}
    >
      <p className="text-[10.5px] font-bold text-muted-foreground">{label}</p>
      <p className="text-[15px] font-black tabular-nums" dir="ltr">
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}
