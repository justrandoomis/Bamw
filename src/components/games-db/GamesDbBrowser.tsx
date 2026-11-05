/**
 * The games database: every Switch and Switch 2 title in Nintendo Europe's
 * index, searched and filtered on the server a page at a time.
 *
 * Kept out of the route file for the reason SearchResultsPage gives: the
 * router's code-splitter hands a route's `component` back as a lazy chunk, and
 * a page nobody can render in a test is a page nobody tests. The route owns
 * the URL contract (`gamesDbSearch`); this answers it.
 *
 * The URL is the source of truth for every filter, so a result set can be
 * shared, reloaded and reached with the back button. Typing replaces the
 * history entry rather than pushing one.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  MessageSquarePlus,
  RotateCcw,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
import { useI18n } from "@/i18n";
import {
  GAMES_DB_MAX_QUERY_LENGTH,
  gamesDbSearch,
  gamesDbSearchString,
  parseGamesDbQuery,
  type GamesDbFacet,
  type GamesDbListItem,
  type GamesDbListResponse,
  type GamesDbPlatform,
  type GamesDbSearch,
} from "@/lib/games-db";
import { cdnImage } from "@/lib/img";
import { gamesCountLabel, isUpcoming, productIdFromPath, releaseYear } from "./gamesDbFormat";

/** What a card says the game runs on, short enough for a phone-width card. */
const PLATFORM_SHORT: Record<GamesDbPlatform, string> = {
  switch1: "Switch",
  switch2: "Switch 2",
  both: "Switch + Switch 2",
};

/** A genre with fewer titles than this is a stray tag, not a shelf worth a chip. */
const MIN_GENRE_CHIP = 10;

const SKELETON_TILES = Array.from({ length: 12 }, (_, i) => i);

async function fetchList(qs: string, signal: AbortSignal): Promise<GamesDbListResponse> {
  // Always asked of the server, whose edge cache knows when a load finished;
  // the browser's own copy does not (src/lib/games-db.server.ts).
  const response = await fetch(`/api/games-db${qs ? `?${qs}` : ""}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`games-db ${response.status}`);
  return (await response.json()) as GamesDbListResponse;
}

export default function GamesDbBrowser({ search }: { search: GamesDbSearch }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const query = useMemo(() => parseGamesDbQuery(search as Record<string, unknown>), [search]);
  const qs = gamesDbSearchString(query);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["games-db", "list", qs],
    queryFn: ({ signal }) => fetchList(qs, signal),
    // The previous page stays on screen while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  /** One filter changed: every other filter kept, and back to page one unless the page is what changed. */
  const go = useCallback(
    (patch: Partial<GamesDbSearch>, replace = false) => {
      const next = gamesDbSearch(
        parseGamesDbQuery({ ...search, page: undefined, ...patch } as Record<string, unknown>),
      );
      void navigate({ to: "/games-db", search: next, replace });
    },
    [navigate, search],
  );

  /*
    The box follows the URL (back, forward, a cleared filter), and the URL
    follows the box after a beat. When the URL change is the one the box itself
    asked for, the box is left alone — it may already hold the next letter.
  */
  const [draft, setDraft] = useState(query.q);
  const typed = useRef<string | null>(null);
  useEffect(() => {
    if (query.q !== typed.current) setDraft(query.q);
    typed.current = null;
  }, [query.q]);
  useEffect(() => {
    const next = draft.replace(/\s+/g, " ").trim().slice(0, GAMES_DB_MAX_QUERY_LENGTH);
    if (next === query.q) return;
    const timer = setTimeout(() => {
      typed.current = next;
      go({ q: next || undefined }, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, query.q, go]);

  /* A new page starts at its top; the first render does not move anything. */
  const pageSeen = useRef(query.page);
  useEffect(() => {
    if (pageSeen.current === query.page) return;
    pageSeen.current = query.page;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [query.page]);

  const inputRef = useRef<HTMLInputElement>(null);

  /* The chips stay put while a filtered page loads: the counts are the whole database's. */
  const genres = useMemo<GamesDbFacet[]>(() => {
    const all = data?.genres ?? [];
    return all.filter((g) => g.count >= MIN_GENRE_CHIP || g.id === query.genre);
  }, [data?.genres, query.genre]);

  const filtered = Boolean(query.q || query.platform || query.genre);

  let status = "";
  if (data?.ready) {
    status = `${gamesCountLabel(data.total)}${query.q ? ` ${t("لـ")} «${query.q}»` : ""}`;
  } else if (isPending) {
    status = t("جارٍ التحميل...");
  }

  return (
    <AppShell currentView="store">
      <div className="clay-canvas min-h-screen px-4 pb-24 pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <header className="mb-4">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-[11px] font-bold text-muted-foreground">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              {t("من فهرس نينتندو الرسمي")}
            </p>
            <h1 className="mt-2 text-[24px] font-black leading-tight tracking-[-0.02em] text-foreground sm:text-[30px]">
              {t("قاعدة بيانات ألعاب نينتندو")}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {/* Spaces around «و»: glued to a Latin word, the bidi algorithm reorders the pair. */}
              {t("كل ألعاب Switch و Switch 2 بصورها ومعلوماتها. ما نبيعه يأخذك إلى صفحته في المتجر، والباقي تقدر تطلبه.")}
            </p>
          </header>

          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              inputRef.current?.blur();
              go({ q: draft.trim() || undefined });
            }}
            className="relative"
          >
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={GAMES_DB_MAX_QUERY_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("ابحث باسم اللعبة — بالإنجليزية أو العربية")}
              aria-label={t("ابحث باسم اللعبة — بالإنجليزية أو العربية")}
              className="h-12 w-full rounded-full border border-border bg-card px-5 ps-12 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors focus:border-primary/60"
            />
            <SearchIcon
              className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  inputRef.current?.focus();
                }}
                aria-label={t("مسح البحث")}
                className="absolute end-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {/* Segmented control: a pressed track, the chosen segment raised. */}
            <div className="flex rounded-full bg-muted/70 p-1" role="group" aria-label={t("الجهاز")}>
              {(
                [
                  ["", t("الكل")],
                  ["switch1", "Switch"],
                  ["switch2", "Switch 2"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id || "all"}
                  type="button"
                  aria-pressed={query.platform === id}
                  onClick={() => go({ platform: id || undefined })}
                  className={`h-8 rounded-full px-3.5 text-[12px] font-bold transition-colors ${
                    query.platform === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-full bg-muted/70 p-1" role="group" aria-label={t("الترتيب")}>
              {(
                [
                  ["new", t("الأحدث")],
                  ["soon", t("قريباً")],
                  ["az", "A–Z"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={query.sort === id}
                  onClick={() => go({ sort: id === "new" ? undefined : id })}
                  className={`h-8 rounded-full px-3.5 text-[12px] font-bold transition-colors ${
                    query.sort === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {genres.length > 0 && (
            <div className="no-scrollbar mt-3 flex w-full max-w-full gap-2 overflow-x-auto pb-1">
              {[{ id: "", label: t("كل التصنيفات"), count: 0 }, ...genres].map((genre) => (
                <button
                  key={genre.id || "all"}
                  type="button"
                  aria-pressed={query.genre === genre.id}
                  onClick={() => go({ genre: genre.id || undefined })}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    query.genre === genre.id
                      ? "border-border bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {genre.label}
                </button>
              ))}
            </div>
          )}

          {/* One live region: screen readers hear the count change. */}
          <p className="mt-3 min-h-5 text-xs font-bold text-muted-foreground" aria-live="polite">
            {status}
          </p>

          {isPending && !data ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
              {SKELETON_TILES.map((i) => (
                <div key={i} className="rounded-[22px] bg-muted/50 p-1.5">
                  <div className="aspect-square animate-pulse rounded-[16px] bg-muted" />
                  <div className="mx-1.5 mt-2.5 h-3 w-3/4 animate-pulse rounded-full bg-muted" />
                  <div className="mx-1.5 mb-1.5 mt-1.5 h-2.5 w-1/3 animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
          ) : isError && !data ? (
            <Notice
              title={t("تعذّر تحميل الألعاب")}
              body={t("حدث خطأ أثناء الاتصال. حاول مرة أخرى.")}
              action={
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-white shadow-md"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t("أعد المحاولة")}
                </button>
              }
            />
          ) : data && !data.ready ? (
            <Notice
              title={t("نجهّز قاعدة البيانات")}
              body={t("نضيف كل ألعاب نينتندو الآن. عد بعد قليل لتتصفحها.")}
            />
          ) : data && data.items.length === 0 ? (
            <Notice
              title={
                data.total > 0
                  ? t("لا توجد صفحة بهذا الرقم")
                  : query.q
                    ? `${t("لا نتائج لـ")} «${query.q}»`
                    : t("لا توجد ألعاب بهذه الفلاتر")
              }
              body={
                data.total > 0
                  ? t("عد إلى الصفحة الأولى.")
                  : t("جرّب الاسم بالإنجليزية، أو كلمة واحدة منه. ولم تجد لعبتك؟ اطلبها منا.")
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {data.total > 0 ? (
                    <button
                      type="button"
                      onClick={() => go({ page: undefined })}
                      className="inline-flex h-11 items-center rounded-full border border-[var(--clay-rim)] bg-card px-5 text-[13px] font-bold text-foreground shadow-sm"
                    >
                      {t("الصفحة الأولى")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void navigate({ to: "/add_game" })}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-white shadow-md"
                      >
                        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                        {t("اطلب لعبة")}
                      </button>
                      {filtered && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft("");
                            void navigate({ to: "/games-db", search: {} });
                          }}
                          className="inline-flex h-11 items-center rounded-full border border-[var(--clay-rim)] bg-card px-5 text-[13px] font-bold text-foreground shadow-sm"
                        >
                          {t("امسح البحث والفلاتر")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              }
            />
          ) : data ? (
            <>
              <div
                dir="ltr"
                className={`mt-4 grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 ${
                  isFetching ? "opacity-60" : ""
                }`}
              >
                {data.items.map((item) => (
                  <TitleCard key={item.slug} item={item} />
                ))}
              </div>

              {data.pages > 1 && (
                <nav aria-label={t("الصفحات")} className="mt-8 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={query.page <= 1}
                    onClick={() => go({ page: query.page - 1 })}
                    className="flex h-11 items-center gap-1 rounded-full border border-[var(--clay-rim)] bg-card px-4 text-[13px] font-bold text-foreground shadow-sm disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    {t("السابق")}
                  </button>
                  <span className="text-[12px] font-bold tabular-nums text-muted-foreground">
                    {t("صفحة")} {query.page} {t("من")} {data.pages.toLocaleString("en-US")}
                  </span>
                  <button
                    type="button"
                    disabled={query.page >= data.pages}
                    onClick={() => go({ page: query.page + 1 })}
                    className="flex h-11 items-center gap-1 rounded-full border border-[var(--clay-rim)] bg-card px-4 text-[13px] font-bold text-foreground shadow-sm disabled:opacity-40"
                  >
                    {t("التالي")}
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

/** A centred piece of clay for the states that are not a grid. */
function Notice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mt-6 rounded-3xl border border-border bg-card px-6 py-14 text-center">
      <h2 className="text-lg font-black text-foreground">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * One title: Nintendo's square card in a frame of clay, the name, the console
 * and the year. A title the shop sells goes straight to its product page — the
 * place it can actually be bought — and says so on the art.
 */
function TitleCard({ item }: { item: GamesDbListItem }) {
  const { t } = useI18n();
  const productId = productIdFromPath(item.shopPath);
  const year = releaseYear(item.releaseDate);
  const upcoming = isUpcoming(item.releaseDate);
  const className =
    "group block min-w-0 rounded-[22px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-md transition-transform duration-300 active:scale-[0.97]";

  const body = (
    <>
      <span className="relative block aspect-square overflow-hidden rounded-[16px] bg-muted/40">
        {item.image ? (
          <img
            src={cdnImage(item.image, { width: 360 })}
            srcSet={[240, 360, 500].map((w) => `${cdnImage(item.image, { width: w })} ${w}w`).join(", ")}
            sizes="(min-width: 1024px) 16vw, (min-width: 768px) 24vw, (min-width: 640px) 32vw, 48vw"
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center p-3 text-center text-[12px] font-bold text-muted-foreground">
            {item.title}
          </span>
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
        />
        {productId ? (
          <span
            dir="rtl"
            className="absolute left-1.5 top-1.5 rounded-full bg-[var(--brand-red)] px-2 py-0.5 text-[10.5px] font-black text-white shadow-sm"
          >
            {t("في المتجر")}
          </span>
        ) : null}
        {upcoming ? (
          <span
            dir="rtl"
            className="absolute right-1.5 top-1.5 rounded-full bg-card/90 px-2 py-0.5 text-[10.5px] font-black text-foreground shadow-sm backdrop-blur"
          >
            {t("قريباً")}
          </span>
        ) : null}
      </span>
      <span className="block px-1.5 pb-1 pt-2">
        <span className="line-clamp-2 min-h-[2.5em] text-[13px] font-extrabold leading-[1.25] text-foreground">
          {item.title}
        </span>
        <span className="mt-1 block truncate text-[11px] font-bold text-muted-foreground">
          {PLATFORM_SHORT[item.platform]}
          {year ? ` · ${year}` : ""}
        </span>
      </span>
    </>
  );

  return productId ? (
    <Link to="/product/$productId" params={{ productId }} className={className}>
      {body}
    </Link>
  ) : (
    <Link to="/games-db/$slug" params={{ slug: item.slug }} className={className}>
      {body}
    </Link>
  );
}
