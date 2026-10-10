import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  normalizePromotions,
  quoteBuy3Get1,
  type Buy3Get1Settings,
  type PromotionsData,
} from "@/lib/promotions";
import { cn } from "@/lib/utils";

import { AdminPageHeader } from "./AdminPageHeader";

const money = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ع`;

/** The admin's own read: never the browser's copy of a public answer. */
async function readPromotions(): Promise<PromotionsData> {
  const res = await fetch("/api/promotions", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("تعذّر تحميل العروض");
  return normalizePromotions(await res.json());
}

/**
 * «العروض» — offers that apply on their own, with no code to type.
 *
 * One today: «اشتري ثلاثة ألعاب وأحصل على الرابعة مجانا». The switch is the
 * whole of it; the rest of the card says exactly what the switch does, so an
 * admin never has to turn it on to find out — what counts as a game, how it
 * sits with a coupon, and a worked example with numbers they can change.
 */
export default function PromotionsManager() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "promotions"], queryFn: readPromotions });
  const [draft, setDraft] = useState<Buy3Get1Settings | null>(null);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.buy3get1);
  }, [query.data, draft]);

  const saved = query.data?.buy3get1;
  const dirty =
    Boolean(draft && saved) &&
    (draft!.enabled !== saved!.enabled || draft!.repeat !== saved!.repeat);

  const save = useMutation({
    mutationFn: async (next: Buy3Get1Settings) => {
      const answer = await api.saveContent({ promotions: { buy3get1: next } });
      return normalizePromotions(answer.data?.promotions);
    },
    onSuccess: (stored) => {
      queryClient.setQueryData(["admin", "promotions"], stored);
      void queryClient.invalidateQueries({ queryKey: ["promotions"] });
      setDraft(stored.buy3get1);
      toast.success(stored.buy3get1.enabled ? "العرض مفعّل الآن في السلة" : "تم إيقاف العرض");
    },
    onError: (error: Error) => toast.error(error.message || "تعذّر حفظ العرض"),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="العروض"
        description="عروض تُطبَّق وحدها في السلة وعند الدفع، دون كود يكتبه الزبون. الخادم يحسبها من جديد عند كل طلب، فلا يمكن لأحد أن يفرضها على سلة لا تستحقها."
      />

      {query.isPending || !draft ? (
        <div className="flex justify-center rounded-3xl border border-border bg-card py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        </div>
      ) : query.error ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          تعذّر تحميل العروض. أعد تحميل الصفحة.
        </p>
      ) : (
        <section
          aria-labelledby="offer-buy3get1"
          className="overflow-hidden rounded-3xl border border-border bg-card"
        >
          <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
            <span
              className={cn(
                "grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors",
                draft.enabled ? "bg-banana text-banana-ink" : "bg-muted text-muted-foreground",
              )}
            >
              <Gift className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="offer-buy3get1" className="text-[18px] font-black tracking-[-0.01em]">
                اشترِ 3 ألعاب واحصل على الرابعة مجاناً
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                عندما يضع الزبون أربع ألعاب في السلة، تصير أرخصها مجاناً. تظهر اللعبة المجانية
                باسمها في السلة، ويُسجَّل العرض على الطلب.
              </p>
              <p
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-black",
                  saved?.enabled ? "bg-leaf/15 text-leaf" : "bg-muted text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    saved?.enabled ? "bg-leaf" : "bg-muted-foreground/60",
                  )}
                  aria-hidden="true"
                />
                {saved?.enabled ? "مفعّل الآن للزبائن" : "متوقف — لا يراه الزبائن"}
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
              label="تفعيل عرض اشترِ 3 واحصل على الرابعة مجاناً"
            />
          </div>

          <div className="grid gap-px border-t border-border bg-border md:grid-cols-2">
            <div
              role="radiogroup"
              aria-labelledby="buy3get1-repeat-label"
              className="bg-card p-5 sm:p-6"
            >
              <p id="buy3get1-repeat-label" className="mb-2 text-[13px] font-black">
                كم لعبة مجانية في الطلب؟
              </p>
              <div className="space-y-2">
                <Choice
                  checked={draft.repeat}
                  onSelect={() => setDraft({ ...draft, repeat: true })}
                  title="لعبة مجانية لكل 4 ألعاب"
                  hint="8 ألعاب = لعبتان مجانيتان، الأرخص بينها."
                />
                <Choice
                  checked={!draft.repeat}
                  onSelect={() => setDraft({ ...draft, repeat: false })}
                  title="لعبة مجانية واحدة لكل طلب"
                  hint="مهما زاد عدد الألعاب."
                />
              </div>
            </div>
            <div className="space-y-3 bg-card p-5 text-[12.5px] leading-relaxed sm:p-6">
              <Rule title="ما الذي يُحسب لعبة؟">
                الألعاب والحسابات (أوفلاين وأونلاين) والطلبات المسبقة. لا تُحسب الحزم، ولا بطاقات
                الشحن والأكواد، ولا الأجهزة والإكسسوارات والمستعمل.
              </Rule>
              <Rule title="مع الكوبون ودعوة صديق">
                يُحسبان على الألعاب المدفوعة فقط، فلا تُخصم اللعبة المجانية مرتين، ولا يُحتسب للداعي
                نصيب منها.
              </Rule>
              <Rule title="الموز">لا موز على اللعبة المجانية — يُكسب الموز على ما دُفع فقط.</Rule>
            </div>
          </div>

          <Example settings={draft} />

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur sm:px-6">
            <p className="text-[12px] text-muted-foreground" aria-live="polite">
              {dirty ? "لديك تغييرات لم تُحفظ." : "كل شيء محفوظ."}
            </p>
            <div className="flex gap-2">
              {dirty ? (
                <button
                  type="button"
                  onClick={() => saved && setDraft(saved)}
                  className="min-h-10 rounded-xl px-4 text-[13px] font-bold text-muted-foreground hover:bg-muted"
                >
                  تراجع
                </button>
              ) : null}
              <button
                type="button"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(draft)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-foreground px-5 text-[13px] font-black text-background transition-opacity disabled:opacity-40"
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-4 w-4" aria-hidden="true" />
                )}
                حفظ العرض
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        checked ? "bg-leaf" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-200 motion-reduce:transition-none",
          checked ? "start-7" : "start-1",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors",
        checked ? "border-foreground/30 bg-muted/60" : "border-border hover:bg-muted/40",
      )}
    >
      <input
        type="radio"
        name="buy3get1-repeat"
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 accent-[var(--leaf)]"
      />
      <span>
        <span className="block text-[13px] font-black">{title}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-black text-foreground">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

const SAMPLE = [12_000, 10_000, 9_000, 8_000];

/** The rule on numbers the admin can change — the same function the cart runs. */
function Example({ settings }: { settings: Buy3Get1Settings }) {
  const [prices, setPrices] = useState<number[]>(SAMPLE);
  const quote = useMemo(
    () =>
      quoteBuy3Get1(
        prices.map((price, i) => ({
          key: String(i),
          productId: String(i),
          title: `لعبة ${i + 1}`,
          kind: "game",
          unitPrice: price,
          quantity: 1,
        })),
        { ...settings, enabled: true },
      ),
    [prices, settings],
  );
  const total = prices.reduce((sum, price) => sum + (price > 0 ? price : 0), 0);
  const freeIndex = quote.free[0] ? Number(quote.free[0].key) : -1;

  return (
    <div className="border-t border-border p-5 sm:p-6">
      <p className="text-[13px] font-black">جرّبه بأرقام من عندك</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        أسعار أربع ألعاب في سلة — غيّر أي سعر لترى أيها يصير مجاناً.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {prices.map((price, i) => (
          <label
            key={i}
            className={cn(
              "rounded-2xl border p-2.5 transition-colors",
              i === freeIndex ? "border-banana bg-banana/15" : "border-border",
            )}
          >
            <span className="flex items-center justify-between text-[11.5px] font-bold text-muted-foreground">
              لعبة {i + 1}
              {i === freeIndex ? (
                <span className="rounded-full bg-banana px-1.5 text-[10.5px] font-black text-banana-ink">
                  مجانية
                </span>
              ) : null}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={price}
              onChange={(event) => {
                const next = [...prices];
                next[i] = Math.max(0, Number(event.target.value) || 0);
                setPrices(next);
              }}
              dir="ltr"
              className="mt-1 w-full bg-transparent text-[15px] font-black tabular-nums outline-none"
              aria-label={`سعر اللعبة ${i + 1} بالدينار`}
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-[13px]" aria-live="polite">
        {quote.applied ? (
          <>
            يدفع الزبون{" "}
            <span className="font-black tabular-nums">{money(total - quote.discount)}</span> بدل{" "}
            <span className="tabular-nums text-muted-foreground line-through">{money(total)}</span>{" "}
            — وفّر{" "}
            <span className="font-black tabular-nums text-leaf">{money(quote.discount)}</span>.
          </>
        ) : (
          <span className="text-muted-foreground">أدخل أسعاراً أكبر من صفر لأربع ألعاب.</span>
        )}
      </p>
    </div>
  );
}
