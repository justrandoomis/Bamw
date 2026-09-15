import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";

import {
  duplicateNames,
  parseCatalogueCsv,
  type CatalogueParseResult,
  type CatalogueRow,
} from "@/lib/catalogueImport";

/**
 * Importing the supplier price list.
 *
 * The file is read and parsed **here**, in the browser, by the same function
 * the server uses — so what the owner is shown before pressing the button is
 * what the server will do, not a second implementation that can disagree with
 * it. Then it is posted back a batch at a time, because fifteen hundred rows
 * is more than one Worker request can finish.
 *
 * Two deliberate frictions:
 *
 * The preview runs first and writes nothing. Publishing fifteen hundred
 * products is not an action to discover the shape of by doing it, and «سيتم
 * إنشاء ١٥٣٠ وتحديث ٠» before the fact is the difference between an import and
 * an accident.
 *
 * Every row the parser refused is listed with its line number and its name. A
 * count of 1,527 out of 1,530 with no way to see which three is how a game
 * goes missing from a shop and nobody can say which one.
 */

const BATCH_SIZE = 100;

/** A 5xx is worth trying again; a 400 means the batch itself is wrong. */
const RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface BatchResponse {
  created?: number;
  updated?: number;
  skipped?: number;
  results?: Array<{ line: number; name: string; outcome: string; reason?: string }>;
  error?: string;
}

interface RunTotals {
  created: number;
  updated: number;
  skipped: number;
  failures: Array<{ line: number; name: string; reason: string }>;
}

/** What a batch came back as, with the status kept rather than thrown away. */
type BatchAttempt =
  | { ok: true; payload: BatchResponse }
  | { ok: false; status: number; message: string; retryable: boolean };

/**
 * One batch, with the response read as text before anything tries to parse it.
 *
 * This is where the owner's run actually died. The old code called
 * `response.json()` *before* checking `response.ok`, so when Cloudflare
 * answered 503 with its own HTML error page the parser threw first — and what
 * reached the screen was Safari's words for a broken JSON document, «The string
 * did not match the expected pattern», about a server error that had nothing to
 * do with JSON. A status is a fact; it is read first and reported as itself.
 */
async function postBatch(payload: unknown): Promise<BatchAttempt> {
  let response: Response;
  try {
    response = await fetch("/api/admin/catalogue-import", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // The request never completed: no status to report, and worth retrying.
    return { ok: false, status: 0, message: "تعذّر الوصول إلى الخادم", retryable: true };
  }

  const raw = await response.text().catch(() => "");
  let parsed: BatchResponse | null = null;
  try {
    parsed = raw ? (JSON.parse(raw) as BatchResponse) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    /*
      A 503 from Cloudflare is the Worker being cut off mid-request — usually
      because it ran out of CPU — and the next attempt very often succeeds. A
      400 is this batch being wrong and will be wrong again.
    */
    const retryable = response.status === 0 || response.status >= 500 || response.status === 429;
    const detail =
      parsed?.error ||
      (raw.trimStart().startsWith("<")
        ? "ردّ الخادم صفحة خطأ بدل البيانات"
        : raw.slice(0, 120).trim());
    return {
      ok: false,
      status: response.status,
      message: `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      retryable,
    };
  }
  if (!parsed) {
    return { ok: false, status: response.status, message: "ردّ غير مفهوم من الخادم", retryable: true };
  }
  return { ok: true, payload: parsed };
}

export default function CatalogueImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<CatalogueParseResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [preview, setPreview] = useState<RunTotals | null>(null);
  const [applied, setApplied] = useState<RunTotals | null>(null);
  const [error, setError] = useState("");
  /*
    Where to pick up after a run that stopped.

    Every batch is an upsert and the import only ever adds, so resuming is the
    same action as starting — but starting again re-posts a thousand rows the
    server will only answer «موجود مسبقاً» to, and the owner watching the bar
    cannot tell that from no progress at all. Remembering the batch that failed
    makes the retry cost what is left rather than the whole file.
  */
  const [resumeAt, setResumeAt] = useState(0);
  /*
    Off by default, and a separate decision from importing.

    The import only ever adds games; a game already in the shop is left exactly
    as it is, because the shop is where somebody decided it should be hidden,
    out of stock, or priced differently. Ticking this lets the sheet move the
    price and the cost of listings this importer created — and nothing else, on
    nothing else.
  */
  const [refreshPrices, setRefreshPrices] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setError("");
    setPreview(null);
    setApplied(null);
    setResumeAt(0);
    setPhase("idle");
    try {
      const text = await file.text();
      const result = parseCatalogueCsv(text);
      setFileName(file.name);
      setParsed(result);
      if (result.rows.length === 0 && result.issues.length > 0) {
        setError(result.issues[0]!.message);
      }
    } catch {
      setError("تعذّرت قراءة الملف");
    }
  };

  /**
   * Posts the rows in batches and adds up what came back.
   *
   * A batch that fails is retried before the run gives up: a 503 is the Worker
   * being cut off, not the file being wrong, and the previous version turned
   * one of those into a dead run with fourteen batches left. When it does give
   * up it says which batch and with what status, remembers where to resume, and
   * still runs the compaction — what was written stays written, and leaving the
   * granular rows behind is what makes the *next* load of the shop slower.
   */
  const run = async (
    rows: CatalogueRow[],
    apply: boolean,
    from = 0,
  ): Promise<RunTotals | null> => {
    const totals: RunTotals = { created: 0, updated: 0, skipped: 0, failures: [] };
    const batches = Math.ceil(rows.length / BATCH_SIZE);
    setProgress({ done: from, total: batches });

    for (let i = from; i < batches; i++) {
      const slice = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      let attempt: BatchAttempt | null = null;
      for (let tries = 0; tries < RETRIES; tries++) {
        attempt = await postBatch({
          rows: slice,
          apply,
          mode: refreshPrices ? "refresh-prices" : "create-only",
        });
        if (attempt.ok || !attempt.retryable) break;
        /*
          Long enough for an overloaded Worker to have finished whatever was
          holding it. Two seconds, then four.
        */
        if (tries < RETRIES - 1) await sleep(2000 * 2 ** tries);
      }

      if (!attempt || !attempt.ok) {
        setResumeAt(i);
        setError(
          `توقف عند الدفعة ${i + 1} من ${batches}: ${attempt?.message ?? "خطأ غير معروف"}` +
            (apply ? ` — ما حُفظ محفوظ، واضغط «إكمال من حيث توقف» للمتابعة.` : ""),
        );
        if (apply) await compact();
        return null;
      }

      const payload = attempt.payload;
      totals.created += Number(payload.created ?? 0);
      totals.updated += Number(payload.updated ?? 0);
      totals.skipped += Number(payload.skipped ?? 0);
      for (const row of payload.results ?? []) {
        if (row.outcome === "skipped") {
          totals.failures.push({
            line: row.line,
            name: row.name,
            reason: row.reason || "غير معروف",
          });
        }
      }
      setProgress({ done: i + 1, total: batches });
    }

    if (apply) {
      setResumeAt(0);
      await compact();
    }
    return totals;
  };

  /*
    The sweep that follows a run, successful or not.

    Earlier versions of this importer saved each product as its own granular
    row, and those are read and re-parsed on every cold load of the shop until
    a full write folds them in. The endpoint no longer writes them, but the
    rows an interrupted run left are still there — and the run that leaves them
    is exactly the run that used to skip this step.

    A failure here is reported and nothing else: the games are saved and
    correct either way.
  */
  const compact = async () => {
    const attempt = await postBatch({ finalize: true });
    if (!attempt.ok) {
      setError(
        (previous) =>
          `${previous ? `${previous} ` : ""}حُفظت الألعاب، لكن فشلت خطوة الدمج النهائية (${
            attempt.message
          }). أعد تشغيل الاستيراد لإتمامها — لن يُنشئ نسخاً مكررة.`,
      );
    }
  };

  const startPreview = async () => {
    if (!parsed?.rows.length) return;
    setPhase("previewing");
    setError("");
    const totals = await run(parsed.rows, false);
    setPreview(totals);
    setPhase("idle");
  };

  const startApply = async (from = 0) => {
    if (!parsed?.rows.length) return;
    setPhase("applying");
    setError("");
    const totals = await run(parsed.rows, true, from);
    if (totals) {
      setApplied(totals);
      setPhase("done");
      onImported();
    } else {
      /*
        The rows that did land are in the shop whatever happens next, so the
        table behind the modal is already out of date.
      */
      onImported();
      setPhase("idle");
    }
  };

  const busy = phase === "previewing" || phase === "applying";
  const dupes = parsed ? duplicateNames(parsed.rows) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              استيراد قائمة الألعاب من ملف CSV
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              تُنشر كل لعبة باسمها وسعر حساب الأوفلاين فقط. الاسم الصيني والتكلفة للأدمن وحده،
              ولا يظهران للعميل في أي مكان. الاستيراد يضيف ولا يعدّل: أي لعبة موجودة تُترك كما هي.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-1.5 hover:bg-muted disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm font-bold hover:bg-muted">
          <Upload className="h-4 w-4" />
          {fileName || "اختر ملف CSV"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>

        {parsed && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border p-4 text-sm">
              <p className="font-bold">
                قُرئ {parsed.rows.length.toLocaleString("en-US")} صف صالح
                {parsed.issues.length > 0
                  ? ` — و${parsed.issues.length.toLocaleString("en-US")} صف مرفوض`
                  : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                الأعمدة: {parsed.headers.join(" · ")}
              </p>
              {dupes.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  اسم مكرر في الملف ({dupes.length}): {dupes.slice(0, 5).join("، ")} — سيُحفظ آخر
                  صف فقط لكل اسم.
                </p>
              )}
            </div>

            {parsed.issues.length > 0 && (
              <details className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <summary className="cursor-pointer text-xs font-bold text-destructive">
                  الصفوف المرفوضة ({parsed.issues.length}) — اضغط لعرضها
                </summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                  {parsed.issues.map((issue, i) => (
                    <li key={`${issue.line}-${i}`}>
                      سطر {issue.line}: {issue.name || "—"} — {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {busy && (
              <div className="rounded-xl border border-border p-4">
                <p className="flex items-center gap-2 text-xs font-bold">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {phase === "previewing" ? "جاري الفحص" : "جاري الاستيراد"} — دفعة{" "}
                  {progress.done} من {progress.total}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 rounded-xl border border-border p-4 text-xs leading-relaxed">
              <input
                type="checkbox"
                checked={refreshPrices}
                disabled={busy || Boolean(applied)}
                onChange={(event) => {
                  setRefreshPrices(event.target.checked);
                  // The preview described the other mode; it is no longer true.
                  setPreview(null);
                }}
                className="mt-0.5"
              />
              <span>
                <strong>حدِّث أسعار الألعاب الموجودة أيضاً.</strong> بدون هذا الخيار تُضاف الألعاب
                الجديدة فقط ولا يُمسّ أي منتج موجود. مع تفعيله يُحدَّث سعر البيع والتكلفة للألعاب
                التي أنشأها هذا الاستيراد فقط — ولا يتغيّر الإخفاء ولا المخزون ولا الخيارات ولا أي
                منتج أضفته يدوياً.
              </span>
            </label>

            {preview && !applied && (
              <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                <p className="font-bold">نتيجة الفحص — لم يُكتب شيء بعد</p>
                <p className="mt-1 text-xs">
                  ستُنشأ {preview.created.toLocaleString("en-US")} لعبة جديدة، وسيُحدَّث{" "}
                  {preview.updated.toLocaleString("en-US")} موجودة، وسيُترك{" "}
                  {preview.skipped.toLocaleString("en-US")} كما هو.
                </p>
              </div>
            )}

            {applied && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  تم الاستيراد
                </p>
                <p className="mt-1 text-xs">
                  أُنشئت {applied.created.toLocaleString("en-US")} لعبة، وحُدّثت{" "}
                  {applied.updated.toLocaleString("en-US")}، وتُركت{" "}
                  {applied.skipped.toLocaleString("en-US")} كما هي.
                </p>
                {applied.failures.length > 0 && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px]">
                    {applied.failures.map((f, i) => (
                      <li key={`${f.line}-${i}`}>
                        سطر {f.line}: {f.name} — {f.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-xs font-bold hover:bg-muted disabled:opacity-40"
          >
            {applied ? "إغلاق" : "إلغاء"}
          </button>
          <button
            type="button"
            onClick={() => void startPreview()}
            disabled={busy || !parsed?.rows.length || Boolean(applied)}
            className="rounded-lg border border-border px-4 py-2 text-xs font-bold hover:bg-muted disabled:opacity-40"
          >
            فحص بدون كتابة
          </button>
          {/*
            The apply button waits for the preview. Publishing fifteen hundred
            products to a live shop is not something to be one mis-click away
            from, and the preview costs nothing but the time it takes.
          */}
          <button
            type="button"
            onClick={() => void startApply()}
            disabled={busy || !preview || Boolean(applied) || resumeAt > 0}
            className="rounded-lg bg-foreground px-5 py-2 text-xs font-bold text-background disabled:opacity-40"
          >
            استيراد ونشر
          </button>
          {/*
            Offered only after a run stopped, and it continues rather than
            starting over: the batches already written would all come back
            «موجود مسبقاً», which costs the owner the whole file again to
            learn nothing.
          */}
          {resumeAt > 0 && !applied && (
            <button
              type="button"
              onClick={() => void startApply(resumeAt)}
              disabled={busy}
              className="rounded-lg bg-foreground px-5 py-2 text-xs font-bold text-background disabled:opacity-40"
            >
              إكمال من حيث توقف (الدفعة {resumeAt + 1})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
