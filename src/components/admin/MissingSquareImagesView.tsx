import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImageOff, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { ImageUploadField } from "./ImageUploadField";

/**
 * The square-image queue: one job, done many times.
 *
 * «لإضافة الصورة المربعة فقط من دون التفاصيل الثانية» — so every row offers
 * exactly one field, and saving it moves the row off the list. The full
 * product editor is one click away and deliberately not on this screen: a
 * queue of hundreds is worked by doing one small thing repeatedly, and a form
 * with forty fields is how it stops being worked.
 */

interface QueueRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  currentImage: string | null;
  hidden: boolean;
}

export default function MissingSquareImagesView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["missing-square-images", search],
    queryFn: () =>
      api.fetch<{ total: number; shown: number; products: QueueRow[] }>(
        `/api/admin/missing-square-images?limit=200${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  const save = useMutation({
    mutationFn: (input: { productId: string; imageUrl: string }) =>
      api.fetch("/api/admin/missing-square-images", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_result, input) => {
      toast.success("تمت إضافة الصورة المربعة");
      setDrafts((current) => {
        const next = { ...current };
        delete next[input.productId];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["missing-square-images"] });
      // The shelf sorts by the same predicate, so its order changed too.
      void queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ الصورة");
    },
  });

  const rows = data?.products ?? [];

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <span className="rounded-xl bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
          <ImageOff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-foreground">ألعاب بلا صورة مربعة</h2>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            الصورة المربعة هي التي تظهر على الكارتلج وفي أشرطة الألعاب. أضفها هنا فقط — لا شيء آخر
            مطلوب.
          </p>
        </div>
        <span className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground">
          {data?.total ?? 0} لعبة
        </span>
      </header>

      <div className="relative">
        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث عن لعبة بالاسم..."
          className="w-full rounded-xl border border-border bg-card px-3 py-2.5 pe-9 text-[16px] text-start outline-none sm:text-xs"
        />
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="text-xs font-bold text-foreground">
            {search ? "لا توجد نتائج مطابقة" : "كل الألعاب لديها صورة مربعة"}
          </p>
        </div>
      ) : (
        <>
          {data && data.total > data.shown ? (
            /*
              Said rather than hidden. A list capped at 200 that does not admit
              it is a list the admin will believe they finished.
            */
            <p className="text-[11px] font-bold text-muted-foreground">
              يعرض {data.shown} من {data.total} — أضف صوراً أو ابحث لتضييق القائمة.
            </p>
          ) : null}

          <div className="space-y-2.5">
            {rows.map((row) => {
              const draft = drafts[row.id] ?? "";
              const busy = save.isPending && save.variables?.productId === row.id;
              return (
                <article
                  key={row.id}
                  className="space-y-2.5 rounded-2xl border border-border bg-card p-3.5"
                >
                  <div className="flex items-start gap-3">
                    {row.currentImage ? (
                      <img
                        src={row.currentImage}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <ImageOff className="h-4 w-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xs font-bold text-foreground">{row.title}</h3>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {row.price.toLocaleString()} د.ع{row.hidden ? " • مخفي" : ""}
                      </p>
                    </div>
                  </div>

                  <ImageUploadField
                    productId={row.id}
                    imageType="nintendo_card_image"
                    label="الصورة المربعة"
                    value={draft}
                    onChange={(url) => setDrafts((current) => ({ ...current, [row.id]: url }))}
                    folder="covers"
                    aspect="square"
                    helperText="صورة مربعة تقريباً — هي ما يظهر داخل الكارتلج."
                  />

                  <button
                    type="button"
                    disabled={!draft.trim() || busy}
                    onClick={() => save.mutate({ productId: row.id, imageUrl: draft.trim() })}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    حفظ الصورة
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
