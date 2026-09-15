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
   * A failed batch stops the run rather than carrying on: if the database is
   * refusing writes, the next fourteen batches will fail too, and the owner
   * should see the reason once rather than fifteen times. What was already
   * written stays written — this is an upsert, so resuming is just running it
   * again.
   */
  const run = async (rows: CatalogueRow[], apply: boolean): Promise<RunTotals | null> => {
    const totals: RunTotals = { created: 0, updated: 0, skipped: 0, failures: [] };
    const batches = Math.ceil(rows.length / BATCH_SIZE);
    setProgress({ done: 0, total: batches });

    for (let i = 0; i < batches; i++) {
      const slice = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      let payload: BatchResponse;
      try {
        const response = await fetch("/api/admin/catalogue-import", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: slice,
            apply,
            mode: refreshPrices ? "refresh-prices" : "create-only",
          }),
        });
        payload = (await response.json()) as BatchResponse;
        if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      } catch (err) {
        setError(
          `توقف عند الدفعة ${i + 1} من ${batches}: ${
            err instanceof Error ? err.message : "خطأ غير معروف"
          }`,
        );
        return null;
      }

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

    /*
      One last call, after the rows are written.

      Each batch saved its products as granular overlay rows, and those are
      read and re-parsed on every cold store load until a full write folds them
      into the catalogue document. Skipping this would leave the shop paying
      for the import on every request — see the endpoint's `finalize` branch.

      A failure here is reported but does not undo the import: the products are
      saved and correct either way, and the compaction can be re-run.
    */
    if (apply) {
      try {
        const response = await fetch("/api/admin/catalogue-import", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ finalize: true }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        setError(
          `حُفظت الألعاب، لكن فشلت خطوة الدمج النهائية (${
            err instanceof Error ? err.message : "خطأ"
          }). أعد تشغيل الاستيراد لإتمامها — لن يُنشئ نسخاً مكررة.`,
        );
      }
    }
    return totals;
  };

  const startPreview = async () => {
    if (!parsed?.rows.length) return;
    setPhase("previewing");
    setError("");
    const totals = await run(parsed.rows, false);
    setPreview(totals);
    setPhase("idle");
  };

  const startApply = async () => {
    if (!parsed?.rows.length) return;
    setPhase("applying");
    setError("");
    const totals = await run(parsed.rows, true);
    if (totals) {
      setApplied(totals);
      setPhase("done");
      onImported();
    } else {
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
            disabled={busy || !preview || Boolean(applied)}
            className="rounded-lg bg-foreground px-5 py-2 text-xs font-bold text-background disabled:opacity-40"
          >
            استيراد ونشر
          </button>
        </div>
      </div>
    </div>
  );
}
