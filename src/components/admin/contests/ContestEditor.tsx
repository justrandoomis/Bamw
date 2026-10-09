import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save, Search } from "lucide-react";
import { useMemo, useState } from "react";

import NintendoCover from "@/components/NintendoCover";
import { adminApi } from "@/lib/api";
import {
  CONTEST_LIMITS,
  ENTRY_METHOD_LABELS,
  fromLocalInput,
  toLocalInput,
  type ContestEntryMethod,
  type ContestSettings,
} from "@/lib/contests";
import { isUnderMaintenance } from "@/lib/maintenance";
import { buildProductIndex, searchProducts } from "@/lib/search/products";
import type { Product } from "@/lib/types";

import IgFiltersFields from "./IgFiltersFields";

const METHODS: { id: ContestEntryMethod; hint: string }[] = [
  { id: "free", hint: "تذكرة واحدة مجانية لكل عضو" },
  { id: "bananas", hint: "يشتري العضو تذاكر بالموز" },
  { id: "ticket", hint: "كود تذكرة تنشئه وتسلّمه يدوياً (مثلاً مقابل تنفيذ شروط إنستغرام)" },
  { id: "referral", hint: "تذكرة عن كل صديق جلبه برابط إحالته بعد بدء المسابقة" },
];

/**
 * Everything the admin decides about one contest, on one form.
 *
 * The prize is picked from the catalogue rather than typed: its title,
 * picture and value are read off the product on the server, so a contest can
 * only ever give away a game the shop actually sells.
 */
export default function ContestEditor({
  initial,
  locked,
  saving,
  onSave,
}: {
  initial: ContestSettings;
  /** published: the draw source can no longer change */
  locked: boolean;
  saving: boolean;
  onSave: (settings: ContestSettings) => void;
}) {
  const [draft, setDraft] = useState<ContestSettings>(initial);
  const set = (patch: Partial<ContestSettings>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const toggleMethod = (method: ContestEntryMethod, on: boolean) =>
    set({
      entryMethods: on
        ? [...new Set([...draft.entryMethods, method])]
        : draft.entryMethods.filter((m) => m !== method),
    });
  const instagram = draft.drawSource === "instagram";

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <Section title="المسابقة">
        <Field label="العنوان">
          <input
            value={draft.title}
            maxLength={CONTEST_LIMITS.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="مثال: مسابقة ماريو كارت الأسبوعية"
            className={INPUT}
          />
        </Field>
        <Field label="الوصف — يظهر للأعضاء كما تكتبه">
          <textarea
            value={draft.description}
            maxLength={CONTEST_LIMITS.description}
            onChange={(event) => set({ description: event.target.value })}
            rows={4}
            placeholder="اكتب قصة المسابقة وما يربحه الفائز…"
            className={INPUT}
          />
        </Field>
        <Field label="الشروط — شرط في كل سطر">
          <textarea
            value={draft.conditions.join("\n")}
            onChange={(event) => set({ conditions: event.target.value.split("\n") })}
            rows={4}
            placeholder={
              "تابع حساب بنانتو على إنستغرام\nعلّق على المنشور وتاغ صديقين\nشارك المنشور في الستوري مع تاغ للبيج\nأرسل لنا لقطة شاشة لتحصل على تذكرتك"
            }
            className={INPUT}
          />
        </Field>
        <Field
          label={
            instagram
              ? "رابط منشور إنستغرام (مطلوب — منه تُسحب التعليقات)"
              : "رابط منشور إنستغرام (اختياري، يظهر زر «افتح المنشور»)"
          }
        >
          <input
            value={draft.instagramUrl}
            onChange={(event) => set({ instagramUrl: event.target.value })}
            placeholder="https://www.instagram.com/p/…"
            dir="ltr"
            className={INPUT}
          />
        </Field>
      </Section>

      <Section title="الجائزة">
        <ProductPicker
          productId={draft.productId}
          onPick={(product) =>
            set({
              productId: String(product.id),
              prizeTitle: String(product.title ?? ""),
              prizeImage: String(product.image ?? ""),
            })
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ملاحظة الجائزة (النسخة أو نوع الحساب)">
            <input
              value={draft.prizeNote}
              onChange={(event) => set({ prizeNote: event.target.value })}
              placeholder="مثال: حساب أونلاين"
              className={INPUT}
            />
          </Field>
          <Field label="عدد الفائزين">
            <input
              type="number"
              min={1}
              max={CONTEST_LIMITS.winners}
              value={draft.winnersCount}
              onChange={(event) => set({ winnersCount: Number(event.target.value) || 1 })}
              className={INPUT}
            />
          </Field>
          <Field label="عدد الاحتياط (يُرقّى إن استُبعد فائز)">
            <input
              type="number"
              min={0}
              max={CONTEST_LIMITS.alternates}
              value={draft.alternatesCount}
              onChange={(event) => set({ alternatesCount: Number(event.target.value) || 0 })}
              className={INPUT}
            />
          </Field>
        </div>
      </Section>

      <Section title="من أين يُسحب الفائز">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["site", "تذاكر الموقع", "يدخل الأعضاء من الموقع بالطرق التي تختارها أدناه"],
              ["instagram", "تعليقات إنستغرام", "يُسحب الفائز من تعليقات منشور إنستغرام حسب شروطك"],
            ] as const
          ).map(([id, label, hint]) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-[13px] ${
                draft.drawSource === id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background"
              } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="drawSource"
                disabled={locked}
                checked={draft.drawSource === id}
                onChange={() => set({ drawSource: id })}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block font-black">{label}</span>
                <span className="text-[11.5px] text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {locked ? (
          <p className="text-[11.5px] text-muted-foreground">لا يتغير مصدر السحب بعد النشر.</p>
        ) : null}
      </Section>

      {instagram ? (
        <Section title="شروط تعليقات إنستغرام">
          <IgFiltersFields value={draft.igFilters} onChange={(igFilters) => set({ igFilters })} />
        </Section>
      ) : (
        <Section title="طرق الدخول">
          <div className="space-y-2">
            {METHODS.map(({ id, hint }) => (
              <div key={id} className="rounded-xl border border-border bg-background p-3">
                <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={draft.entryMethods.includes(id)}
                    onChange={(event) => toggleMethod(id, event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block font-black">{ENTRY_METHOD_LABELS[id]}</span>
                    <span className="text-[11.5px] text-muted-foreground">{hint}</span>
                  </span>
                </label>
                {id === "bananas" && draft.entryMethods.includes("bananas") ? (
                  <div className="mt-2 space-y-2 ps-6">
                    <Field label="سعر التذكرة بالموز">
                      <input
                        type="number"
                        min={1}
                        value={draft.bananaCost || ""}
                        onChange={(event) => set({ bananaCost: Number(event.target.value) || 0 })}
                        className={INPUT}
                      />
                    </Field>
                    {isUnderMaintenance("bananas") ? (
                      <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-[11.5px] font-bold">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        الموز تحت الصيانة الآن: الدخول بالموز سيظهر للأعضاء متوقفاً حتى يُعاد تشغيل
                        الموز.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {id === "referral" && draft.entryMethods.includes("referral") ? (
                  <div className="mt-2 ps-6">
                    <Field label="متى يُحسب الصديق">
                      <select
                        value={draft.referralQualifier}
                        onChange={(event) =>
                          set({
                            referralQualifier:
                              event.target.value === "signup" ? "signup" : "purchase",
                          })
                        }
                        className={INPUT}
                      >
                        <option value="purchase">
                          عندما يشتري أول طلب (أقوى ضد الحسابات الوهمية)
                        </option>
                        <option value="signup">بمجرد أن يسجّل حساباً</option>
                      </select>
                    </Field>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="الحدود والشروط الإضافية">
        <div className="grid gap-3 sm:grid-cols-2">
          {!instagram ? (
            <>
              <Field label="أقصى عدد تذاكر لكل مشارك (كل الطرق معاً)">
                <input
                  type="number"
                  min={1}
                  max={CONTEST_LIMITS.entriesPerUser}
                  value={draft.maxEntriesPerUser}
                  onChange={(event) => set({ maxEntriesPerUser: Number(event.target.value) || 1 })}
                  className={INPUT}
                />
              </Field>
              <Field label="أقصى عدد مشاركين (0 = بلا حد)">
                <input
                  type="number"
                  min={0}
                  value={draft.maxParticipants}
                  onChange={(event) => set({ maxParticipants: Number(event.target.value) || 0 })}
                  className={INPUT}
                />
              </Field>
              <Field label="أقل عدد طلبات مكتملة للدخول (0 = للجميع)">
                <input
                  type="number"
                  min={0}
                  value={draft.minCompletedOrders}
                  onChange={(event) => set({ minCompletedOrders: Number(event.target.value) || 0 })}
                  className={INPUT}
                />
              </Field>
              <Field label="أقل عمر للحساب بالأيام (ضد الحسابات الجديدة الوهمية)">
                <input
                  type="number"
                  min={0}
                  value={draft.minAccountAgeDays}
                  onChange={(event) => set({ minAccountAgeDays: Number(event.target.value) || 0 })}
                  className={INPUT}
                />
              </Field>
              <Check
                label="يتطلب حساباً مربوطاً بتلغرام (ليصل خبر الفوز)"
                checked={draft.requireTelegram}
                onChange={(requireTelegram) => set({ requireTelegram })}
              />
              <Check
                label="إظهار عدد المشاركين للأعضاء"
                checked={draft.showEntrants}
                onChange={(showEntrants) => set({ showEntrants })}
              />
            </>
          ) : null}
          <Check
            label="فوز واحد لكل مشارك (التذاكر الإضافية ترفع الفرصة فقط)"
            checked={draft.oneWinPerUser}
            onChange={(oneWinPerUser) => set({ oneWinPerUser })}
          />
          <Check
            label="تأكيد الفائز يدوياً قبل منحه اللعبة (للتحقق من الستوري والتاغ)"
            checked={draft.requireConfirmation}
            onChange={(requireConfirmation) => set({ requireConfirmation })}
          />
        </div>
      </Section>

      <Section title="التوقيت">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="تبدأ في (فارغ = عند النشر)">
            <input
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={(event) => set({ startsAt: fromLocalInput(event.target.value) })}
              className={INPUT}
            />
          </Field>
          <Field label="تنتهي في (فارغ = تنهيها يدوياً)">
            <input
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={(event) => set({ endsAt: fromLocalInput(event.target.value) })}
              className={INPUT}
            />
          </Field>
        </div>
        <Check
          label="اسحب الفائز تلقائياً عند الانتهاء"
          checked={draft.autoDraw}
          onChange={(autoDraw) => set({ autoDraw })}
        />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end bg-gradient-to-t from-background via-background/95 to-transparent px-1 pb-1 pt-4">
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-sm font-black text-background disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ الإعدادات
        </button>
      </div>
    </form>
  );
}

const INPUT =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h3 className="text-[14px] font-black text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-bold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-background px-3 py-2 text-[13px] font-bold">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      {label}
    </label>
  );
}

/** The catalogue, searchable in Arabic and English, to pick the game given away. */
function ProductPicker({
  productId,
  onPick,
}: {
  productId: string;
  onPick: (product: Product) => void;
}) {
  const [query, setQuery] = useState("");
  const catalogue = useQuery({
    queryKey: ["admin", "contest-catalogue"],
    queryFn: ({ signal }) => adminApi.catalogue(signal),
    staleTime: 60_000,
  });
  const games = useMemo(
    () =>
      ((catalogue.data?.products ?? []) as Product[]).filter(
        (p) => p.kind !== "hardware" && p.kind !== "accessory" && p.kind !== "device",
      ),
    [catalogue.data?.products],
  );
  const index = useMemo(
    () => buildProductIndex(games as unknown as Record<string, unknown>[]),
    [games],
  );
  const results = useMemo(
    () =>
      query.trim()
        ? searchProducts(index, query, { limit: 12 }).map((r) => r.product as unknown as Product)
        : [],
    [index, query],
  );
  const selected = games.find((p) => String(p.id) === productId);

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-2">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg">
            <NintendoCover
              product={selected}
              usage="listing-card"
              ratio={null}
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-black">{selected.title}</p>
            <p className="text-[11px] text-muted-foreground">اللعبة الجائزة</p>
          </div>
        </div>
      ) : productId ? (
        <p className="text-[12px] text-muted-foreground">اللعبة المختارة: {productId}</p>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن اللعبة الجائزة — ماريو كارت، zelda…"
          className="w-full rounded-xl border border-border bg-background py-2 pe-3 ps-10 text-sm outline-none"
        />
      </div>
      {catalogue.isPending ? (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ تحميل الكتالوج…
        </p>
      ) : results.length ? (
        <ul className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {results.map((product) => (
            <li key={String(product.id)}>
              <button
                type="button"
                onClick={() => {
                  onPick(product);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-border bg-background p-1.5 text-start hover:bg-muted/50"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md">
                  <NintendoCover
                    product={product}
                    usage="listing-card"
                    ratio={null}
                    className="h-full w-full"
                  />
                </div>
                <span className="min-w-0 truncate text-[12.5px] font-bold">{product.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="text-[12px] text-muted-foreground">لا نتائج.</p>
      ) : null}
    </div>
  );
}
