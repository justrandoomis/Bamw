/**
 * The results page.
 *
 * Kept out of the route file on purpose: a route module is rewritten by the
 * router's code-splitter, which hands `component` back as a lazily-loaded
 * chunk — so a test that renders it suspends on a module it cannot await, and
 * the page nobody can render in a test is the page nobody tests. The route
 * keeps what only a route can own — the URL contract and the page metadata —
 * and reads `q` out of the URL for this component to answer.
 */
import { Search as SearchIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import AppShell from "@/components/AppShell";
import { ProductCard } from "@/components/ProductCard";
import { useI18n } from "@/i18n";
import { getProductCategory, type CategoryType } from "@/lib/productSection";
import { filterPurchasable } from "@/lib/purchasable";
import { buildProductIndex, searchProducts } from "@/lib/search/products";
import { useStoreData } from "@/hooks/useStoreData";
import { playSound } from "@/utils/audio";

const SECTION_LABELS: Record<CategoryType, string> = {
  game: "الألعاب",
  hardware: "الأجهزة",
  accessory: "الملحقات",
  amiibo: "أميبو",
  gift_card: "بطاقات الشحن",
  used: "المستعمل",
  bundle: "الحزم",
};

/** Shown when the box is empty, and when a query found nothing. */
const SUGGESTIONS = ["زيلدا", "ماريو كارت", "بوكيمون", "بطاقة شحن", "سويتش 2", "أميبو"];

export default function SearchResultsPage({ q = "" }: { q?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [draft, setDraft] = useState(q);
  const [section, setSection] = useState<CategoryType | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  /* The URL is the source of truth; a back or forward navigation rewrites the box. */
  useEffect(() => setDraft(q), [q]);

  /*
    Typing rewrites the URL after a beat, replacing the entry rather than
    pushing one. `replace` is the whole reason this is bearable: without it a
    six-letter query buries the page the customer came from under six history
    entries.
  */
  useEffect(() => {
    if (draft === q) return;
    const timer = setTimeout(() => {
      void navigate({ to: "/search", search: draft ? { q: draft } : {}, replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, q, navigate]);

  const { data: store, isPending } = useStoreData();

  const products = useMemo(
    () =>
      filterPurchasable<Record<string, unknown>>(
        (store?.products ?? []) as Record<string, unknown>[],
      ),
    [store?.products],
  );

  /* Indexing the catalogue costs about twice what answering a query does, so
     it happens once per catalogue rather than once per keystroke. */
  const index = useMemo(() => buildProductIndex(products), [products]);

  const results = useMemo(
    () => (q.trim() ? searchProducts(index, q, { limit: 60 }) : []),
    [index, q],
  );

  const sections = useMemo(() => {
    const counts = new Map<CategoryType, number>();
    for (const row of results) {
      const key = getProductCategory(row.product);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  /* A filter that survived its own result set would show an empty page. */
  useEffect(() => {
    if (section !== "all" && !sections.some(([key]) => key === section)) setSection("all");
  }, [sections, section]);

  const shown = useMemo(
    () =>
      section === "all"
        ? results
        : results.filter((row) => getProductCategory(row.product) === section),
    [results, section],
  );

  const submit = (value: string) => {
    const next = value.trim();
    inputRef.current?.blur();
    void navigate({ to: "/search", search: next ? { q: next } : {} });
  };

  const askFor = (suggestion: string) => {
    playSound("bumper_end", 0.5);
    setDraft(suggestion);
    submit(suggestion);
  };

  return (
    <AppShell currentView="store">
      <div className="min-h-screen bg-[var(--page)] px-4 pt-6 pb-24">
        <div className="mx-auto w-full max-w-6xl">
          <h1 className="sr-only">{t("البحث")}</h1>

          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
            className="relative"
          >
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("ابحث عن لعبة أو بطاقة أو جهاز...")}
              aria-label={t("ابحث عن لعبة أو بطاقة أو جهاز...")}
              className="h-12 w-full rounded-full border border-border bg-card px-5 ps-12 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors focus:border-primary/60"
            />
            <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  inputRef.current?.focus();
                }}
                aria-label={t("مسح البحث")}
                className="absolute end-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>

          {/* One live region for the whole page: screen readers hear the count change. */}
          <p className="mt-3 min-h-5 text-xs font-bold text-muted-foreground" aria-live="polite">
            {!q.trim()
              ? t("اكتب اسم اللعبة التي تبحث عنها")
              : isPending && products.length === 0
                ? t("جارٍ البحث...")
                : results.length === 0
                  ? `${t("لا توجد نتائج لـ")} «${q}»`
                  : `${results.length} ${t("نتيجة لـ")} «${q}»`}
          </p>

          {sections.length > 1 && (
            <div className="no-scrollbar mt-3 flex w-full max-w-full gap-2 overflow-x-auto pb-1">
              {[["all", results.length] as const, ...sections].map(([key, count]) => (
                <button
                  key={key}
                  onPointerDown={() => playSound("bumper_end", 0.5)}
                  onClick={() => setSection(key as CategoryType | "all")}
                  aria-pressed={section === key}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    section === key
                      ? "border-border bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {key === "all" ? t("كل النتائج") : t(SECTION_LABELS[key as CategoryType])} (
                  {count})
                </button>
              ))}
            </div>
          )}

          {isPending && products.length === 0 ? (
            <div className="flex justify-center py-24">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-red-500" />
            </div>
          ) : shown.length > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4" dir="ltr">
              {shown.map((row) => (
                <ProductCard
                  key={String(row.product["id"])}
                  product={row.product}
                  imageRole="front-box"
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center">
              <div className="mb-4 text-5xl">{q.trim() ? "🔍" : "🎮"}</div>
              <h2 className="mb-1 text-lg font-bold text-foreground">
                {q.trim() ? t("لم نجد ما يطابق بحثك") : t("ابحث في المتجر")}
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                {q.trim()
                  ? t("جرّب اسمًا أقصر أو الاسم بالإنجليزية")
                  : t("اكتب اسم اللعبة، أو جرّب أحد الاقتراحات")}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => askFor(suggestion)}
                    className="rounded-full border border-border bg-muted/60 px-3.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-muted"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
