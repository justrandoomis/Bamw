import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Layers,
  RotateCcw,
  Search,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import AppShell from "@/components/AppShell";
import { BundleCard } from "@/components/BundleCard";
import { api } from "@/lib/api";
import { getAccountTypeInfo } from "@/lib/bundles";
import type { AccountBundle, Product } from "@/lib/types";
import { playSound } from "@/utils/audio";

export const Route = createFileRoute("/bundles/")({
  head: () => ({
    meta: [
      { title: "حزم وبندلات الحسابات — بنانا ستور" },
      {
        name: "description",
        content:
          "وفر حتى 60% مع حزم ألعاب ننتندو سويتش. أكثر من لعبة في حساب واحد جاهز للتحميل المباشر مع تسليم فوري وضمان شامل.",
      },
      { property: "og:title", content: "حزم وبندلات الحسابات — بنانا ستور" },
      {
        property: "og:description",
        content: "مجموعات ألعاب كاملة في حساب واحد بتوفير استثنائي وتسليم فوري عبر محادثة الطلب.",
      },
    ],
  }),
  component: BundlesIndexPage,
});

/* The account types in the order the admin offers them, in the short words a filter needs. */
const ACCOUNT_TYPE_FILTERS: { id: string; label: string }[] = [
  { id: "primary", label: "حساب رئيسي" },
  { id: "secondary", label: "حساب فرعي" },
  { id: "full", label: "حساب كامل" },
  { id: "offline", label: "حساب أوفلاين" },
  { id: "online", label: "حساب أونلاين" },
];

const TRUST_POINTS = [
  { icon: Zap, title: "تسليم فوري", note: "بمحادثة الطلب" },
  { icon: ShieldCheck, title: "ضمان شامل", note: "حسابات أصلية 100%" },
  { icon: Wallet, title: "دفع بالمحفظة", note: "بدون أي عنوان شحن" },
];

function BundlesIndexPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"featured" | "price_asc" | "price_desc" | "savings">(
    "featured",
  );

  const { data: store, isLoading } = useQuery({
    queryKey: ["store", "full"],
    queryFn: () => api.store(),
  });

  const products = useMemo(() => (store?.products ?? []) as Product[], [store?.products]);
  const bundles = useMemo(() => (store?.bundles ?? []) as AccountBundle[], [store?.bundles]);

  const filteredBundles = useMemo(() => {
    let list = bundles.filter((b) => b.isActive !== false);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((b) => {
        const titleMatch = (b.title || "").toLowerCase().includes(q);
        const titleEnMatch = (b.titleEn || "").toLowerCase().includes(q);
        const descMatch = (b.description || "").toLowerCase().includes(q);
        return titleMatch || titleEnMatch || descMatch;
      });
    }

    if (selectedType !== "all") {
      list = list.filter((b) => (b.accountType || "primary") === selectedType);
    }

    if (sortBy === "price_asc") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === "savings") {
      list.sort((a, b) => {
        const saveA = (a.originalPrice || a.price) - a.price;
        const saveB = (b.originalPrice || b.price) - b.price;
        return saveB - saveA;
      });
    }

    return list;
  }, [bundles, searchQuery, selectedType, sortBy]);

  /*
    Only the account types the shelf actually carries.

    The filter itself is the one it always was — a bundle's `accountType`,
    «primary» when it has none. What changed is which choices are offered: a
    fixed list of three offered «حساب رئيسي» on a shelf of offline and online
    accounts, and every one of them led to the empty state. A shelf of one kind
    has nothing to choose between, so the control is not drawn at all.
  */
  const typeFilters = useMemo(() => {
    const present = new Set(
      bundles.filter((b) => b.isActive !== false).map((b) => String(b.accountType || "primary")),
    );
    const known = ACCOUNT_TYPE_FILTERS.filter((type) => present.has(type.id));
    const other = [...present]
      .filter((id) => !ACCOUNT_TYPE_FILTERS.some((type) => type.id === id))
      .map((id) => ({ id, label: getAccountTypeInfo(id).label }));
    return [...known, ...other];
  }, [bundles]);
  const showTypeFilter = typeFilters.length > 1 || selectedType !== "all";

  const resetFilters = () => {
    setSearchQuery("");
    setSelectedType("all");
  };

  return (
    <AppShell currentView="store" onBack={() => navigate({ to: "/" })}>
      <div className="min-h-screen pb-10">
        <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 sm:pt-5">
          <nav
            aria-label="مسار التنقل"
            className="mb-3 flex items-center gap-1.5 text-[12px] font-bold text-muted-foreground"
          >
            <Link to="/" className="transition-colors hover:text-foreground">
              الرئيسية
            </Link>
            <ChevronLeft className="h-3.5 w-3.5 shrink-0 ltr:rotate-180" aria-hidden="true" />
            <span aria-current="page" className="text-foreground">
              حزم وبندلات الحسابات
            </span>
          </nav>

          {/*
            What this shelf is, in one piece of clay: the name, one line on
            why, and the three promises as small pressed tiles.
          */}
          <header className="rounded-[28px] border border-[var(--clay-rim)] bg-card p-4 shadow-lg sm:p-5">
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="clay-btn flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[var(--brand-red)] text-primary-foreground"
              >
                <Layers className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-[var(--brand-red)]">
                  أقوى العروض والتوفير
                </p>
                <h1 className="mt-0.5 text-balance text-[24px] font-black leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[30px]">
                  حزم ألعاب ننتندو سويتش
                </h1>
                <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
                  مجموعة ألعاب سويتش بحساب رسمي واحد جاهز للتحميل من Nintendo eShop، بتوفير ودفع
                  سريع من المحفظة.
                </p>
              </div>
            </div>

            <ul className="mt-4 grid grid-cols-3 gap-2">
              {TRUST_POINTS.map((point) => (
                <li
                  key={point.title}
                  className="flex min-w-0 flex-col gap-1 rounded-[18px] bg-muted/50 px-2.5 py-2.5 sm:flex-row sm:items-center sm:gap-2.5 sm:px-3.5 sm:py-3"
                >
                  <point.icon
                    className="h-4 w-4 shrink-0 text-[var(--brand-red)]"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-black text-foreground sm:text-[13px]">
                      {point.title}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                      {point.note}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </header>

          {/*
            The toolbar: the search pressed in as a well, the order as a chip
            beside it, and the account types as a segmented control — a pressed
            track with the chosen segment raised out of it.
          */}
          <div className="mt-3 rounded-[22px] border border-[var(--clay-rim)] bg-card p-2 shadow-md">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    inputMode="search"
                    enterKeyHint="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث عن حزمة..."
                    aria-label="ابحث في الحزم"
                    className="h-11 w-full rounded-[16px] bg-muted/50 pe-10 ps-10 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="مسح البحث"
                      className="absolute end-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <div className="relative shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    aria-label="ترتيب الحزم"
                    className="h-11 cursor-pointer appearance-none rounded-full border border-[var(--clay-rim)] bg-card pe-8 ps-3.5 text-[12.5px] font-bold text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
                  >
                    <option value="featured">المميز أولاً</option>
                    <option value="savings">الأعلى توفيراً</option>
                    <option value="price_asc">الأقل سعراً</option>
                    <option value="price_desc">الأعلى سعراً</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </div>

              {showTypeFilter ? (
                <div
                  role="group"
                  aria-label="نوع الحساب"
                  className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-1 md:order-first md:shrink-0"
                >
                  {[{ id: "all", label: "الكل" }, ...typeFilters].map((type) => {
                    const isActive = selectedType === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          setSelectedType(type.id);
                          playSound("switch_click", 0.6);
                        }}
                        className={`min-h-9 flex-1 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 md:flex-none ${
                          isActive
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* The shelf */}
          <div className="mt-5">
            {isLoading ? (
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3"
                aria-hidden="true"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="h-[400px] animate-pulse rounded-[22px] bg-muted/50" />
                ))}
              </div>
            ) : filteredBundles.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                {filteredBundles.map((bundle) => (
                  <BundleCard
                    key={bundle.id}
                    bundle={bundle}
                    products={products}
                    layout="grid"
                    onSelect={() =>
                      void navigate({ to: "/bundles/$bundleId", params: { bundleId: bundle.id } })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="mx-auto flex max-w-md flex-col items-center rounded-[28px] border border-[var(--clay-rim)] bg-card px-6 py-10 text-center shadow-md">
                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-muted/70">
                  <Layers className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-[18px] font-black tracking-[-0.02em] text-foreground">
                  لا توجد حزم مطابقة
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  لم نتمكن من العثور على أي حزم حسابات تطابق خيارات البحث الحالية. جرب تغيير كلمات
                  البحث أو الفلاتر.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  إعادة ضبط الفلاتر
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
