import { useEffect, useState } from "react";
import { Instagram, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { safeHttpUrl, type ContentDoc } from "@/lib/content";

/**
 * Where the shop's pinned Instagram post is set.
 *
 * Step two of the review sends the customer to this link, and the screenshot
 * they bring back is the proof an admin approves. Without it the sheet says so
 * and refuses to guess — a wrong link makes every proof unverifiable.
 *
 * It is saved through `/api/content`, which patches key by key. It is
 * deliberately not in `store.settings`: a `/api/data` POST replaces the whole
 * settings object, so a field there is erased by the next unrelated save from
 * any admin screen that round-trips settings.
 */
export default function ReviewPromptSettings() {
  const [url, setUrl] = useState("");
  const [stepOne, setStepOne] = useState("");
  const [stepTwo, setStepTwo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const content = await api.content();
        if (cancelled) return;
        setUrl(content.reviewPrompt?.instagram_post_url ?? "");
        setStepOne(content.reviewPrompt?.step_one_note_ar ?? "");
        setStepTwo(content.reviewPrompt?.step_two_note_ar ?? "");
      } catch {
        // The section still renders; saving is what matters and it reports.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = url.trim();
  // Mirror the server: only http(s) is ever stored or rendered.
  const urlOk = trimmed === "" || Boolean(safeHttpUrl(trimmed));

  const save = async () => {
    if (!urlOk) {
      toast.error("الرابط يجب أن يبدأ بـ http أو https");
      return;
    }
    setSaving(true);
    try {
      await api.saveContent({
        reviewPrompt: {
          instagram_post_url: trimmed,
          step_one_note_ar: stepOne.trim(),
          step_two_note_ar: stepTwo.trim(),
        },
      } as Partial<ContentDoc>);
      toast.success("تم حفظ إعدادات التقييم");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" dir="rtl">
      <header className="flex items-center gap-2">
        <span className="rounded-xl bg-pink-500/10 p-2 text-pink-600 dark:text-pink-400">
          <Instagram className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-foreground">منشور التقييم على إنستغرام</h3>
          <p className="text-[11px] text-muted-foreground">
            الخطوة الثانية في نافذة التقييم تفتح هذا الرابط، والعميل يرفق صورة تعليقه عليه.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex h-16 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2.5">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">رابط المنشور المثبّت</span>
            <input
              dir="ltr"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.instagram.com/p/..."
              className={`w-full rounded-xl border bg-background px-3 py-2 text-xs text-start outline-none ${
                urlOk ? "border-border" : "border-red-500/60"
              }`}
            />
            {!urlOk ? (
              <span className="text-[10px] font-bold text-red-600">
                الرابط يجب أن يبدأ بـ http أو https
              </span>
            ) : null}
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">نص الخطوة الأولى</span>
            <input
              value={stepOne}
              onChange={(event) => setStepOne(event.target.value.slice(0, 200))}
              placeholder="اكتب رأيك بتسليم المنتجات وأرفق صورة أو مقطعاً."
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-start outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-foreground">نص الخطوة الثانية</span>
            <input
              value={stepTwo}
              onChange={(event) => setStepTwo(event.target.value.slice(0, 200))}
              placeholder="علّق على منشور الإنستغرام المثبّت، ثم أرفق صورة تعليقك."
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-start outline-none"
            />
          </label>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !urlOk}
            className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2 text-xs font-bold text-background disabled:opacity-40 cursor-pointer"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            حفظ
          </button>
        </div>
      )}
    </section>
  );
}
