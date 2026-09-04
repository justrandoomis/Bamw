import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ImageUploadField } from "./ImageUploadField";
import type { ContentImage } from "@/lib/content";

/**
 * The picture slots of one step, section or problem.
 *
 * ## Why a slot exists before its picture
 *
 * The shop owner uploads these screenshots by hand, and a guide has fifty-six
 * steps. An editor that offers "add an image" everywhere gives no clue which
 * screenshot is missing; a slot carries `hint` — "أضف صورة الخطوة ٣ — شاشة
 * اختيار المستخدم" — so the empty box says what belongs in it.
 *
 * The customer's side is the mirror image: a slot with no `url` renders
 * nothing at all there. Not a placeholder, not a broken image, not a gap. So
 * the manual can ship complete and fill in over time without ever looking
 * half-built to a buyer.
 *
 * `alt` is the one field worth insisting on. A screenshot of a menu is the
 * whole content of a step for somebody using a screen reader, and an empty
 * alt makes that step blank for them.
 */
export function ImageSlotsEditor({
  images,
  onChange,
  folder = "guides",
  label = "صور الخطوة",
}: {
  images: ContentImage[] | undefined;
  onChange: (images: ContentImage[]) => void;
  folder?: string;
  label?: string;
}) {
  const slots = [...(images ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const write = (next: ContentImage[]) =>
    onChange(next.map((slot, index) => ({ ...slot, sort_order: index + 1 })));

  const update = (id: string, patch: Partial<ContentImage>) =>
    write(slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= slots.length) return;
    const next = [...slots];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    write(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">{label}</span>
        <button
          type="button"
          onClick={() =>
            write([
              ...slots,
              {
                id: `img_${Date.now().toString(36)}`,
                url: "",
                hint: "",
                alt: "",
                caption: "",
                sort_order: slots.length + 1,
              },
            ])
          }
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> إضافة خانة صورة
        </button>
      </div>

      {slots.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          لا توجد خانات صور لهذه الخطوة. أضف خانة ثم ارفع الصورة.
        </p>
      )}

      {slots.map((slot, index) => (
        <div key={slot.id} className="rounded-xl border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-muted-foreground">
              خانة {index + 1}
              {slot.url ? "" : " — فارغة، لا تظهر للمستخدم"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="أعلى"
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === slots.length - 1}
                aria-label="أسفل"
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => write(slots.filter((entry) => entry.id !== slot.id))}
                aria-label="حذف الخانة"
                className="rounded p-1 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/*
            The note to whoever uploads. Stored, shown here, and never rendered
            to a customer — it is an instruction, not a caption.
          */}
          <input
            type="text"
            value={slot.hint ?? ""}
            onChange={(event) => update(slot.id, { hint: event.target.value })}
            placeholder="ما الصورة المطلوبة هنا؟ (للأدمن فقط)"
            className="mb-2 w-full rounded-lg border border-dashed border-border bg-muted/40 px-2 py-1.5 text-[11px] outline-none focus:border-primary"
          />

          <ImageUploadField
            label=""
            value={slot.url}
            onChange={(url) => update(slot.id, { url })}
            folder={folder}
            aspect="auto"
            helperText={slot.hint || "ارفع صورة الخطوة"}
          />

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={slot.alt}
              onChange={(event) => update(slot.id, { alt: event.target.value })}
              placeholder="وصف الصورة لقارئ الشاشة (مطلوب)"
              className={`w-full rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary ${
                slot.url && !slot.alt.trim() ? "border-amber-500" : "border-border"
              }`}
            />
            <input
              type="text"
              value={slot.caption ?? ""}
              onChange={(event) => update(slot.id, { caption: event.target.value })}
              placeholder="تعليق تحت الصورة (اختياري)"
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>

          {slot.url && !slot.alt.trim() && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              أضف وصفاً للصورة — بدونه تكون الخطوة فارغة تماماً لمن يستخدم قارئ شاشة.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
