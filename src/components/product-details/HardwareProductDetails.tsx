/**
 * The product page for hardware: a console, a dock, anything sold on its spec
 * sheet.
 *
 * ## Empty means hidden
 *
 * Every section here exists only when the record has something to put in it,
 * and the sections are one list (`sections` below): the body renders the ones
 * that have content and the rail lists the same ones, so a chip can never
 * point at a section that was dropped. Rows without a value are filtered out
 * before a table sees them, and a spec group left without rows goes too.
 *
 * The game-performance explorer joins the list only once the catalogue
 * confirms games with performance records for this device. A device nobody has
 * measured a game on gets no explorer — not a box saying there is nothing.
 *
 * ## Copy
 *
 * Arabic, written for the shop's customers in Iraq. The technical tokens the
 * market reads as they are (FPS, HDR, VRR, 4K, Wi-Fi, USB-C, DLSS…) stay
 * Latin, and a value that leads with one is isolated with `dir="auto"`, so
 * «60 FPS» never comes out as «FPS 60» inside a right-to-left line.
 *
 * ## Clay
 *
 * Sections are cards (`Section`), facts are pressed tiles, links are small
 * raised pieces, and buying is one purchase card: the price, whether it is in
 * stock, the button. Colours come from the theme tokens, so every pack — light
 * or dark — draws the page correctly.
 */

import {
  BadgeCheck,
  BatteryCharging,
  Cable,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  HardDrive,
  Hash,
  Info,
  MemoryStick,
  Monitor,
  Package,
  Palette,
  Play,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { useCurrency } from "@/context/CurrencyContext";
import { useActiveSection } from "@/hub/hooks/useActiveSection";
import { useTranslation } from "@/i18n";
import { slugifyDevice } from "@/lib/devicePerformance";
import type { DeviceModePerformance, DevicePerformance } from "@/lib/devicePerformance";
import { formatDate } from "@/lib/i18n";
import { buildProductView } from "@/lib/productImport/productView";
import type { ProductView } from "@/lib/productImport/productView";
import type { ProductSchema } from "@/lib/productImport/types";
import { resolvePurchaseImage } from "@/lib/nintendoImages";
import { useCartStore } from "@/store/useCartStore";
import { ReleaseAlertPanel } from "@/components/ReleaseAlertPanel";
import { isAwaitingRelease } from "@/lib/release";

import { ProductGallery } from "./ProductGallery";
import { BulletList, Section, SpecTable } from "./Section";

type Record_ = Record<string, any>;
type Row = { label: string; value: string; note?: string; icon?: LucideIcon };
type RowDef = readonly [key: string, label: string, fallback?: string, icon?: LucideIcon];
type LinkItem = { title: string; detail?: string; url: string };

/** Keyboard focus, drawn the same way on every control of the page. */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40";

const ARABIC = /[\u0600-\u06FF]/;

/** A field as one line of copy — empty when the record has nothing to say. */
const value = (input: unknown): string => {
  if (input === true) return "نعم";
  if (input === false) return "لا";
  if (Array.isArray(input)) {
    const parts = input.map(value).filter(Boolean);
    // Arabic words take the Arabic comma; a list of Latin tokens keeps its own.
    return parts.join(parts.some((part) => ARABIC.test(part)) ? "، " : ", ");
  }
  if (input == null || typeof input === "object") return "";
  return String(input).trim();
};

/**
 * Labelled rows for the fields this record fills, in definition order. The
 * icon travels with its row, so dropping an empty row cannot shift the icons
 * of the rows after it.
 */
const rows = (product: Record_, definitions: readonly RowDef[]): Row[] =>
  definitions
    .map(([key, label, fallback, icon]) => ({
      label,
      icon,
      value: value(product[key]) || (fallback ? value(product[fallback]) : ""),
    }))
    .filter((row) => row.value);

const list = <T,>(input: unknown): T[] => (Array.isArray(input) ? input.filter(Boolean) : []);

/** An enum code nobody has translated yet, made readable instead of printed raw. */
const prettyStatus = (input: string) =>
  input.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** The site a link leads to, the way a reader recognises it. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Availability worth a line of its own; in or out of stock is the pill's job. */
const NOTEWORTHY_AVAILABILITY = new Set(["preorder", "backorder", "discontinued", "coming_soon"]);

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Facts as pressed tiles: a label (with its icon) over the value. Two to a row
 * even on a phone — one per row turned a dozen short facts into a long scroll.
 */
function InfoCards({ items }: { items: Row[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={`${item.label}-${item.value}`}
            className="min-w-0 rounded-[18px] bg-muted/50 px-3.5 py-3 sm:px-4 sm:py-3.5"
          >
            <dt className="flex items-start gap-1.5 text-[12px] font-bold leading-snug text-muted-foreground">
              {Icon ? (
                <Icon
                  className="mt-px h-4 w-4 shrink-0 text-[var(--brand-red)]"
                  aria-hidden="true"
                />
              ) : null}
              {item.label}
            </dt>
            <dd className="mt-1.5 text-[14px] font-bold leading-relaxed text-foreground [overflow-wrap:anywhere]">
              <span dir="auto">{item.value}</span>
              {item.note ? (
                <span className="mt-1 block text-[12px] font-medium text-muted-foreground">
                  {item.note}
                </span>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Outbound links as small raised pieces of clay: what it is, and where it goes. */
function LinkCards({ items }: { items: LinkItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {items.map((item, index) => (
        <li key={`${item.url}-${index}`} className="min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className={`flex min-h-14 min-w-0 items-center gap-3 rounded-[18px] border border-[var(--clay-rim)] bg-card px-4 py-3 text-foreground shadow-sm ${FOCUS_RING}`}
          >
            <FileText className="h-5 w-5 shrink-0 text-[var(--brand-red)]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[14px] font-bold [overflow-wrap:anywhere]">
                {item.title}
              </span>
              {item.detail && item.detail !== item.title ? (
                <span className="block text-[12px] text-muted-foreground">{item.detail}</span>
              ) : null}
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A titled block inside a section card. */
function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

/**
 * The section rail — the same control as the shared `SectionNav`: a floating
 * track with the section in view raised out of it. It lists exactly the
 * sections that rendered, and is not drawn for fewer than two: one chip is a
 * label, not navigation.
 */
function SectionRail({ items }: { items: { id: string; label: string }[] }) {
  const key = items.map((item) => item.id).join(" ");
  // A fresh array each render would restart the observer on every paint.
  const ids = useMemo(() => (key ? key.split(" ") : []), [key]);
  const active = useActiveSection(ids);

  if (items.length < 2) return null;

  return (
    <nav aria-label="أقسام الصفحة" className="sticky top-[var(--header-h)] z-20 pt-2">
      <div className="w-full min-w-0 overflow-x-auto rounded-full border border-[var(--clay-rim)] bg-[var(--page,var(--background))]/85 p-1 shadow-md backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max gap-0.5">
          {items.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex min-h-9 items-center whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-bold transition-colors ${FOCUS_RING} ${
                    isActive
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Game performance                                                           */
/* -------------------------------------------------------------------------- */

interface LinkedGame {
  id: string;
  title: string;
  image: string;
  performance: DevicePerformance;
}

interface GamesPage {
  items: LinkedGame[];
  total: number;
  totalPages: number;
}

interface GamesQuery {
  page: number;
  search: string;
  filters: string[];
  sort: string;
}

const GAMES_PAGE_SIZE = 24;
const FIRST_GAMES_PAGE: GamesQuery = { page: 1, search: "", filters: [], sort: "alphabetical" };

/**
 * The filter chips. `value` is the API's own token (see `performanceMatches`)
 * and is sent as it is; only `label` is for the reader.
 */
const PERFORMANCE_FILTERS: { value: string; label: string }[] = [
  { value: "30", label: "30 FPS" },
  { value: "40", label: "40 FPS" },
  { value: "60", label: "60 FPS" },
  { value: "120", label: "120 FPS" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "4K", label: "4K" },
  { value: "HDR", label: "HDR" },
  { value: "VRR", label: "VRR" },
  { value: "Handheld", label: "الوضع المحمول" },
  { value: "TV", label: "وضع التلفاز" },
  { value: "Performance Mode", label: "وضع الأداء" },
  { value: "Quality Mode", label: "وضع الجودة" },
  { value: "DLSS", label: "DLSS" },
  { value: "Ray Tracing", label: "تتبّع الأشعة" },
];

/**
 * The mode names game records use most, in Arabic. A name not listed here is
 * the record's own wording and is shown as it is.
 */
const MODE_NAMES: Record<string, string> = {
  "performance mode": "وضع الأداء",
  "quality mode": "وضع الجودة",
  "balanced mode": "الوضع المتوازن",
};

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "alphabetical", label: "أبجدياً" },
  { value: "highest_fps", label: "أعلى معدل إطارات" },
  { value: "highest_resolution", label: "أعلى دقة" },
  { value: "recently_verified", label: "الأحدث تحققاً" },
  { value: "newest", label: "أحدث الألعاب" },
];

/** One page of the games measured on a device, cached per query. */
function gamesQuery(deviceSlug: string, query: GamesQuery) {
  return queryOptions({
    queryKey: ["hardware-games", deviceSlug, query],
    queryFn: async ({ signal }): Promise<GamesPage> => {
      const params = new URLSearchParams({
        page: String(query.page),
        limit: String(GAMES_PAGE_SIZE),
        search: query.search,
        filters: query.filters.join(","),
        sort: query.sort,
      });
      const response = await fetch(
        `/api/hardware/${encodeURIComponent(deviceSlug)}/games?${params}`,
        { signal },
      );
      if (!response.ok) throw new Error(`[hardware-performance] ${response.status}`);
      return (await response.json()) as GamesPage;
    },
  });
}

/** `input`, once it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(input: T, delay: number): T {
  const [settled, setSettled] = useState(input);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(input), delay);
    return () => window.clearTimeout(timer);
  }, [input, delay]);
  return settled;
}

/** One play mode on a game card: its numbers, «غير مدعوم», or nothing at all. */
function ModeRow({ label, mode }: { label: string; mode?: DeviceModePerformance | undefined }) {
  if (!mode) return null;
  const unsupported = mode.supported === false;
  const fps = value(mode.fps);
  const badges = unsupported
    ? []
    : [
        value(mode.outputResolution) || value(mode.resolution),
        fps && !/fps/i.test(fps) ? `${fps} FPS` : fps,
        mode.hdr === true ? "HDR" : "",
        mode.vrr === true ? "VRR" : "",
      ].filter(Boolean);
  if (!unsupported && badges.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-[12px] font-bold text-muted-foreground">{label}</p>
      {unsupported ? (
        <p className="text-[12px] font-bold text-muted-foreground">غير مدعوم</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span
              key={badge}
              dir="auto"
              className="rounded-full bg-muted/70 px-2.5 py-0.5 text-[12px] font-bold text-foreground"
            >
              {badge}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({ game }: { game: LinkedGame }) {
  const modes = (game.performance.modes ?? [])
    .map((mode) => value(mode.name))
    .filter(Boolean)
    .map((name) => MODE_NAMES[name.toLowerCase()] ?? name);
  return (
    <a
      href={`/product/${game.id}`}
      className={`flex h-full min-w-0 gap-3 rounded-[18px] border border-[var(--clay-rim)] bg-card p-3 text-foreground shadow-sm ${FOCUS_RING}`}
    >
      {game.image ? (
        <img
          src={game.image}
          alt=""
          loading="lazy"
          className="aspect-[3/4] w-[72px] shrink-0 self-start rounded-[12px] object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-[14px] font-bold leading-snug [overflow-wrap:anywhere]">
          {game.title}
        </h3>
        <ModeRow label="الوضع المحمول" mode={game.performance.handheld} />
        <ModeRow label="وضع التلفاز" mode={game.performance.tv} />
        {modes.length ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-bold">الأوضاع:</span> <span dir="auto">{modes.join(" · ")}</span>
          </p>
        ) : null}
      </div>
    </a>
  );
}

/**
 * Every game whose record carries performance numbers for this device —
 * searched, filtered and sorted on the server. Mounted only once the first
 * page is known to hold games, and that page comes from the same cache entry
 * the page used to decide it, so it opens without a second request.
 */
function GamePerformanceExplorer({ deviceSlug }: { deviceSlug: string }) {
  const { dir } = useTranslation();
  const [search, setSearch] = useState(FIRST_GAMES_PAGE.search);
  const [filters, setFilters] = useState<string[]>(FIRST_GAMES_PAGE.filters);
  const [sort, setSort] = useState(FIRST_GAMES_PAGE.sort);
  const [page, setPage] = useState(FIRST_GAMES_PAGE.page);

  const query = useMemo<GamesQuery>(
    () => ({ page, search: search.trim(), filters, sort }),
    [page, search, filters, sort],
  );
  // One request per pause — not one per keystroke, or per chip tapped in a row.
  const settled = useDebouncedValue(query, 180);
  const games = useQuery({ ...gamesQuery(deviceSlug, settled), placeholderData: keepPreviousData });
  const result = games.data;
  const busy = query !== settled || games.isPlaceholderData;
  const narrowed = filters.length > 0 || search.trim() !== "";

  const toggleFilter = (filter: string) => {
    setFilters((current) =>
      current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter],
    );
    setPage(1);
  };
  const clearAll = () => {
    setSearch("");
    setFilters([]);
    setPage(1);
  };

  const PrevIcon = dir === "rtl" ? ChevronRight : ChevronLeft;
  const NextIcon = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        الأداء الفعلي كما هو مسجّل في بيانات كل لعبة، وليس مستنتجاً من أقصى قدرات الجهاز.
      </p>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label className="clay-well flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[16px] bg-muted/50 px-3.5 focus-within:ring-2 focus-within:ring-[var(--brand-red)]/40">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="ابحث عن لعبة"
            aria-label="ابحث عن لعبة"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
          aria-label="ترتيب الألعاب"
          className={`h-11 rounded-[16px] bg-muted/50 px-3.5 text-[13px] font-bold text-foreground ${FOCUS_RING}`}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div
        role="group"
        aria-label="تصفية الألعاب حسب الأداء"
        className="flex flex-wrap gap-1 rounded-[22px] bg-muted/70 p-1"
      >
        {PERFORMANCE_FILTERS.map((filter) => {
          const selected = filters.includes(filter.value);
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleFilter(filter.value)}
              className={`flex min-h-10 items-center rounded-full px-3.5 text-[12.5px] font-bold transition-colors ${FOCUS_RING} ${
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span dir="auto">{filter.label}</span>
            </button>
          );
        })}
      </div>

      {result && result.items.length > 0 ? (
        <ul
          aria-busy={busy}
          className={`grid gap-2.5 sm:grid-cols-2 motion-safe:transition-opacity ${busy ? "opacity-60" : ""}`}
        >
          {result.items.map((game) => (
            <li key={game.id} className="min-w-0">
              <GameCard game={game} />
            </li>
          ))}
        </ul>
      ) : result && narrowed && !busy ? (
        /*
          The device has games — only this search or filter matched none of
          them. Said once, with the way back.
        */
        <div className="flex flex-col items-center gap-3 rounded-[18px] bg-muted/50 px-4 py-6 text-center">
          <p className="text-[14px] text-muted-foreground">لا توجد ألعاب تطابق هذا البحث.</p>
          <button
            type="button"
            onClick={clearAll}
            className={`h-11 rounded-[16px] border border-[var(--clay-rim)] bg-card px-4 text-[13px] font-bold text-foreground shadow-sm ${FOCUS_RING}`}
          >
            مسح البحث والفلاتر
          </button>
        </div>
      ) : null}

      {result && result.totalPages > 1 ? (
        <nav aria-label="صفحات الألعاب" className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            aria-label="الصفحة السابقة"
            className={`flex h-11 w-11 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
          >
            <PrevIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-14 text-center text-[13px] font-bold tabular-nums" dir="ltr">
            {page} / {result.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= result.totalPages}
            onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
            aria-label="الصفحة التالية"
            className={`flex h-11 w-11 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
          >
            <NextIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/** One section of the page; `show` decides both its card and its chip in the rail. */
interface PageSection {
  id: string;
  title: string;
  /** Its label in the section rail — set only on the sections worth jumping to. */
  nav?: string;
  show: boolean;
  body: () => ReactNode;
}

export function HardwareProductDetails({
  product,
  schema,
}: {
  product: Record_;
  schema: ProductSchema;
}) {
  const { locale } = useTranslation();
  const view = useMemo(() => buildProductView(product, locale, schema), [locale, product, schema]);
  if (!view) return null;
  return <HardwareDetailsBody product={product} view={view} />;
}

function HardwareDetailsBody({ product, view }: { product: Record_; view: ProductView }) {
  const { locale, dir, t } = useTranslation();
  const { formatIQDPrice } = useCurrency();
  const addToCart = useCartStore((state) => state.add);

  const deviceSlug = slugifyDevice(product.slug || product.title || product.shortName);
  /*
    Has anyone measured a game on this device? Asked once, as the explorer's
    own first page: the explorer then reads this cached answer rather than
    fetching it again, and until the answer is yes there is no section, no
    heading and no chip for it.
  */
  const firstGamesPage = useQuery({
    ...gamesQuery(deviceSlug, FIRST_GAMES_PAGE),
    enabled: deviceSlug !== "",
  });
  const hasGames = (firstGamesPage.data?.total ?? 0) > 0;

  const enumLabel = (namespace: string, code: string | undefined) => {
    if (!code) return "";
    const label = t(`enums.${namespace}.${code}` as never);
    return label && !label.startsWith("enums.") ? label : prettyStatus(code);
  };

  const gaming = (product.gamingCapability || {}) as Record_;
  const handheldCapability = (gaming.handheld || {}) as Record_;
  const tvCapability = (gaming.tv || {}) as Record_;
  const rating = value(product.reviewScore || product.userScore || product.rating);
  const eyebrow = [view.brand, value(product.series), value(product.generation)].filter(Boolean);
  const releaseDate = value(product.releaseDate);
  // The longer text only when it says something the overview did not.
  const description = view.descriptionFull !== view.overview ? view.descriptionFull : "";

  /*
    The facts a buyer checks before the price, each with its label — the model
    number and the release date included, which used to sit there as bare
    chips nobody could name.
  */
  const facts: Row[] = [
    ...rows(product, [
      ["storageCapacity", "التخزين", "internalStorage", HardDrive],
      ["screenSpecs", "الشاشة", "nativeResolution", Monitor],
      ["batteryLife", "البطارية", "runtime", BatteryCharging],
      ["connectivity", "الاتصال", "wifiStandard", Wifi],
      ["model", "الموديل", "hardwareModel", Tag],
      ["modelNumber", "رقم الموديل", undefined, Hash],
      ["colorEdition", "نسخة اللون", undefined, Palette],
    ]),
    ...(releaseDate
      ? [
          {
            label: "تاريخ الإصدار",
            value: formatDate(locale, releaseDate) || releaseDate,
            icon: CalendarDays,
          },
        ]
      : []),
  ];

  const overview = rows(product, [
    ["processor", "المعالج", "soc", Cpu],
    ["cpu", "المعالج المركزي (CPU)", undefined, Cpu],
    ["gpu", "معالج الرسوميات (GPU)", undefined, Gauge],
    ["ram", "الذاكرة العشوائية (RAM)", "memory", MemoryStick],
    ["internalStorage", "التخزين الداخلي", "storageCapacity", HardDrive],
    ["expandableStorage", "توسعة التخزين", undefined, HardDrive],
    ["displaySize", "حجم الشاشة", undefined, Monitor],
    ["displayType", "نوع الشاشة", "panelType", Monitor],
    ["nativeResolution", "دقة الشاشة", "resolution", Monitor],
    ["refreshRate", "معدل التحديث", undefined, Gauge],
    ["hdr", "دعم HDR", undefined, Sparkles],
    ["batteryLife", "البطارية", "runtime", BatteryCharging],
    ["cooling", "التبريد", undefined, Gauge],
    ["audioOutput", "الصوت", undefined, Cable],
    ["connectivity", "الاتصال", undefined, Wifi],
  ]);

  const displayRows = rows(product, [
    ["displaySize", "حجم الشاشة"],
    ["panelType", "نوع الشاشة", "displayType"],
    ["nativeResolution", "الدقة الأصلية", "resolution"],
    ["refreshRate", "معدل التحديث"],
    ["vrr", "دعم VRR"],
    ["vrrRange", "نطاق VRR"],
    ["hdr", "دعم HDR"],
    ["hdrFormat", "صيغة HDR"],
    ["touchSupport", "دعم اللمس"],
    ["maximumHandheldFps", "أعلى معدل إطارات في الوضع المحمول", "handheldMaxFps"],
  ]);
  const tvRows = rows(product, [
    ["tvMaxResolution", "أعلى دقة على التلفاز"],
    ["supportedOutputResolutions", "دقات الإخراج المدعومة"],
    ["tvMaxRefreshRate", "أعلى معدل تحديث"],
    ["tvHdr", "دعم HDR"],
    ["tvMaxFps", "أعلى معدل إطارات"],
    ["hdmiVersion", "إصدار HDMI"],
    ["tvOutputNotes", "ملاحظات الإخراج إلى التلفاز"],
  ]);
  const processorRows = rows(product, [
    ["soc", "المعالج (SoC)", "processor"],
    ["cpuArchitecture", "معمارية المعالج المركزي"],
    ["cpuCores", "أنوية المعالج المركزي"],
    ["gpuArchitecture", "معمارية معالج الرسوميات"],
    ["gpuCores", "أنوية معالج الرسوميات"],
    ["ram", "الذاكرة العشوائية (RAM)", "memory"],
    ["ramType", "نوع الذاكرة"],
    ["memoryBandwidth", "عرض نطاق الذاكرة"],
    ["storageType", "نوع التخزين"],
    ["readSpeed", "سرعة القراءة"],
    ["cooling", "التبريد"],
    ["performanceModes", "أوضاع الأداء"],
  ]);
  const storageRows = rows(product, [
    ["internalStorage", "التخزين الداخلي", "storageCapacity"],
    ["usableStorage", "المساحة المتاحة للاستخدام"],
    ["storageType", "تقنية التخزين"],
    ["expandableStorage", "توسعة التخزين"],
    ["storageCardType", "نوع بطاقة الذاكرة المدعومة"],
    ["storageMaxCapacity", "أقصى سعة مدعومة"],
    ["gameStorageNotes", "ملاحظات حول تثبيت الألعاب والتخزين"],
  ]);
  const connectivityRows = rows(product, [
    ["wifi", "Wi-Fi"],
    ["wifiStandard", "معيار Wi-Fi"],
    ["wifiBands", "نطاقات Wi-Fi"],
    ["bluetooth", "Bluetooth"],
    ["bluetoothVersion", "إصدار Bluetooth"],
    ["ethernet", "إيثرنت"],
    ["usb", "USB"],
    ["usbC", "USB-C"],
    ["hdmi", "HDMI"],
    ["audioJack", "منفذ السماعة"],
    ["nfc", "NFC"],
    ["wirelessProtocols", "بروتوكولات الاتصال اللاسلكي"],
  ]);
  const powerRows = rows(product, [
    ["batteryCapacity", "سعة البطارية"],
    ["batteryType", "نوع البطارية"],
    ["runtime", "مدة تشغيل البطارية", "batteryLife"],
    ["chargingTime", "مدة الشحن"],
    ["powerAdapter", "محوّل الطاقة"],
    ["inputVoltage", "جهد الدخل"],
    ["inputFrequency", "تردد الدخل"],
    ["maximumPower", "أقصى استهلاك للطاقة"],
    ["standbyPower", "الاستهلاك في وضع الاستعداد"],
    ["connectorType", "نوع الموصّل"],
  ]);
  const physicalRows = rows(product, [
    ["productDimensions", "أبعاد الجهاز"],
    ["productWeight", "الوزن"],
    ["material", "الخامة"],
    ["finish", "التشطيب"],
    ["availableColors", "الألوان المتوفرة", "color"],
  ]);
  const softwareRows = rows(product, [
    ["operatingSystem", "نظام التشغيل"],
    ["firmwareVersion", "إصدار البرنامج الثابت"],
    ["companionApp", "التطبيق المرافق", "software"],
    ["internetRequired", "يتطلب اتصالاً بالإنترنت"],
    ["accountRequired", "يتطلب حساباً"],
    ["drivers", "التعريفات"],
    ["certifications", "الشهادات"],
  ]);
  const requirementRows = rows(product, [
    ["minimumRequirements", "الحد الأدنى من المتطلبات"],
    ["recommendedRequirements", "المتطلبات الموصى بها"],
  ]);
  const warrantyRows = rows(product, [
    ["warranty", "الضمان"],
    ["warrantyType", "نوع الضمان"],
    ["warrantyNotes", "ملاحظات الضمان"],
    ["repairability", "قابلية الإصلاح"],
    ["sparePartsAvailable", "توفر قطع الغيار"],
    ["serviceNotes", "ملاحظات الصيانة"],
  ]);
  const capabilityRows: Row[] = [
    {
      label: "أعلى دقة في الوضع المحمول",
      value: value(handheldCapability.maxResolution) || value(product.handheldMaxResolution),
    },
    {
      label: "أعلى معدل تحديث في الوضع المحمول",
      value: value(handheldCapability.maxRefreshRate) || value(product.handheldMaxRefreshRate),
    },
    {
      label: "أعلى معدل إطارات في الوضع المحمول",
      value: value(handheldCapability.maxFps) || value(product.handheldMaxFps),
    },
    {
      label: "دعم HDR في الوضع المحمول",
      value: value(handheldCapability.hdr ?? product.handheldHdr),
    },
    {
      label: "دعم VRR في الوضع المحمول",
      value: value(handheldCapability.vrr ?? product.handheldVrr),
    },
    {
      label: "أعلى دقة على التلفاز",
      value: value(tvCapability.maxResolution || product.tvMaxResolution),
    },
    {
      label: "أعلى معدل تحديث على التلفاز",
      value: value(tvCapability.maxRefreshRate || product.tvMaxRefreshRate),
    },
    {
      label: "أعلى معدل إطارات على التلفاز",
      value: value(tvCapability.maxFps || product.tvMaxFps),
    },
    { label: "دعم HDR على التلفاز", value: value(tvCapability.hdr ?? product.tvHdr) },
    { label: "دعم VRR على التلفاز", value: value(tvCapability.vrr ?? product.tvVrr) },
    { label: "دعم تتبّع الأشعة (Ray Tracing)", value: value(gaming.rayTracing) },
    { label: "تقنيات رفع الدقة", value: value(list<string>(gaming.upscaling)) },
  ]
    .map((row) => ({ ...row, icon: Gauge }))
    .filter((row) => row.value);

  // A port, or a component, with nothing but an empty name is not a row.
  const ports = list<Record_>(product.ports).filter(
    (port) => value(port.type) || value(port.version) || value(port.notes),
  );
  const componentRows: Row[] = list<Record_>(product.componentDimensions)
    .map((component, index) => ({
      label: value(component.name) || `القطعة ${index + 1}`,
      value: [value(component.dimensions), value(component.weight)].filter(Boolean).join(" · "),
      note: value(component.notes),
      icon: Package,
    }))
    .filter((row) => row.value);
  const specGroups = view.specGroups
    .map((group) => ({ label: group.label, specs: group.specs.filter((spec) => spec.value) }))
    .filter((group) => group.specs.length > 0);

  const supportUrl = value(product.supportUrl);
  const supportLinks: LinkItem[] = [
    ...view.documents.map((doc) => ({
      title: doc.title || doc.url,
      detail: enumLabel("documentType", doc.type),
      url: doc.url,
    })),
    ...(supportUrl ? [{ title: "الدعم الرسمي", detail: hostOf(supportUrl), url: supportUrl }] : []),
  ];
  const updates = view.updates
    .filter((update) => update.title || update.version || update.changes)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  // Sources carry a `name`, not a `title` — reading `title` printed bare URLs.
  const sourceLinks: LinkItem[] = view.sources.map((source) => ({
    title: source.name || source.url,
    detail: enumLabel("sourceType", source.type),
    url: source.url,
  }));

  const sections: PageSection[] = [
    {
      id: "overview",
      title: "نظرة عامة على الجهاز",
      nav: "نظرة عامة",
      show: Boolean(view.overview || description || overview.length),
      body: () => (
        <div className="space-y-5">
          {view.overview || description ? (
            <div className="space-y-3 whitespace-pre-line text-[14px] leading-relaxed text-foreground/80">
              {view.overview ? <p>{view.overview}</p> : null}
              {description ? <p>{description}</p> : null}
            </div>
          ) : null}
          <InfoCards items={overview} />
        </div>
      ),
    },
    {
      id: "performance",
      title: "قدرات الجهاز في الألعاب",
      nav: "قدرات الجهاز",
      show: capabilityRows.length > 0,
      body: () => (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-[18px] bg-muted/50 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {hasGames ? (
              <span>
                هذه أقصى ما يدعمه الجهاز. أداء كل لعبة مذكور في قسم{" "}
                <a href="#games" className="font-bold text-foreground underline underline-offset-2">
                  أداء الألعاب
                </a>{" "}
                كما سُجّل لها، ولا يُستنتج من هذه القيم.
              </span>
            ) : (
              <span>هذه أقصى ما يدعمه الجهاز، والأداء الفعلي يختلف من لعبة إلى أخرى.</span>
            )}
          </p>
          <InfoCards items={capabilityRows} />
        </div>
      ),
    },
    {
      id: "display",
      title: "الشاشة والرسوميات",
      nav: "الشاشة",
      show: displayRows.length + tvRows.length > 0,
      body: () => (
        <div className="grid gap-5 xl:grid-cols-2">
          {displayRows.length ? (
            <SubSection title="الشاشة في الوضع المحمول">
              <SpecTable rows={displayRows} />
            </SubSection>
          ) : null}
          {tvRows.length ? (
            <SubSection title="الإخراج إلى التلفاز (وضع القاعدة)">
              <SpecTable rows={tvRows} />
            </SubSection>
          ) : null}
        </div>
      ),
    },
    {
      id: "hardware",
      title: "المعالج والأداء",
      nav: "المعالج",
      show: processorRows.length > 0,
      body: () => <SpecTable rows={processorRows} />,
    },
    {
      id: "storage",
      title: "التخزين",
      nav: "التخزين",
      show: storageRows.length > 0,
      body: () => <SpecTable rows={storageRows} />,
    },
    {
      id: "connectivity",
      title: "الاتصال والمنافذ",
      nav: "الاتصال",
      show: connectivityRows.length + ports.length > 0,
      body: () => (
        <div className="space-y-4">
          {connectivityRows.length ? <SpecTable rows={connectivityRows} /> : null}
          {ports.length ? (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {ports.map((port, index) => (
                <li
                  key={`${value(port.type)}-${index}`}
                  className="min-w-0 rounded-[18px] bg-muted/50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[14px] font-bold">
                      <span dir="auto">{value(port.type) || "منفذ"}</span>
                    </strong>
                    {value(port.count) ? (
                      <span
                        className="rounded-full bg-card px-2.5 py-0.5 text-[12px] font-black shadow-sm"
                        dir="ltr"
                      >
                        ×{value(port.count)}
                      </span>
                    ) : null}
                  </div>
                  {value(port.version) ? (
                    <p className="mt-1.5 text-[13px] text-foreground/80">
                      الإصدار: <span dir="auto">{value(port.version)}</span>
                    </p>
                  ) : null}
                  {value(port.notes) ? (
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      {value(port.notes)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ),
    },
    {
      id: "battery",
      title: "البطارية والطاقة",
      nav: "البطارية",
      show: powerRows.length > 0,
      body: () => <SpecTable rows={powerRows} />,
    },
    {
      id: "dimensions",
      title: "الأبعاد والوزن",
      show: physicalRows.length + componentRows.length > 0,
      body: () => (
        <div className="space-y-4">
          {physicalRows.length ? <SpecTable rows={physicalRows} /> : null}
          <InfoCards items={componentRows} />
        </div>
      ),
    },
    {
      id: "box",
      title: "محتويات العلبة",
      nav: "محتويات العلبة",
      show: view.boxContents.length > 0,
      body: () => (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {view.boxContents.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex min-w-0 items-center gap-3 rounded-[18px] bg-muted/50 p-3"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-[12px] bg-card object-contain"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-foreground">{item.name}</p>
                {item.notes ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {item.notes}
                  </p>
                ) : null}
              </div>
              {item.quantity ? (
                <span
                  className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-[12px] font-black shadow-sm"
                  dir="ltr"
                >
                  ×{item.quantity}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "compatibility",
      title: "التوافق",
      nav: "التوافق",
      show: view.compatibility.length > 0,
      body: () => (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {view.compatibility.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="min-w-0 rounded-[18px] bg-muted/50 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-bold text-foreground">{item.name}</span>
                {item.status ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
                      item.status === "compatible"
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : item.status === "incompatible"
                          ? "bg-red-500/12 text-red-700 dark:text-red-300"
                          : "bg-card text-muted-foreground shadow-sm"
                    }`}
                  >
                    {enumLabel("compatibility", item.status)}
                  </span>
                ) : null}
              </div>
              {item.notes ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {item.notes}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "software",
      title: "البرمجيات والنظام",
      show: softwareRows.length + requirementRows.length + view.usageSteps.length > 0,
      body: () => (
        <div className="space-y-5">
          {softwareRows.length ? <SpecTable rows={softwareRows} /> : null}
          {requirementRows.length ? (
            <SubSection title="المتطلبات">
              <SpecTable rows={requirementRows} />
            </SubSection>
          ) : null}
          {view.usageSteps.length ? (
            <SubSection title="خطوات الإعداد">
              <ol className="grid gap-2.5 sm:grid-cols-2">
                {view.usageSteps.map((step, index) => (
                  <li
                    key={`${step}-${index}`}
                    className="flex min-w-0 items-start gap-3 rounded-[18px] bg-muted/50 px-4 py-3 text-[14px] leading-relaxed"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-[12px] font-black text-foreground shadow-sm"
                      dir="ltr"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>
            </SubSection>
          ) : null}
        </div>
      ),
    },
    {
      id: "games",
      title: "أداء الألعاب",
      nav: "الألعاب",
      show: hasGames,
      body: () => <GamePerformanceExplorer key={deviceSlug} deviceSlug={deviceSlug} />,
    },
    {
      id: "gallery",
      title: "معرض الصور",
      nav: "الصور",
      show: view.gallery.length > 0,
      body: () => (
        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {view.gallery.map((item, index) => (
            <figure
              key={`${item.url}-${index}`}
              className="min-w-0 overflow-hidden rounded-[18px] bg-muted/50"
            >
              {/*
                `contain`: these are photographs of one object at whatever
                aspect it was shot, and cropping them cuts the product.
              */}
              <img
                src={item.url}
                alt={item.title || view.title}
                loading="lazy"
                className="aspect-video w-full object-contain"
              />
              {item.title || item.description ? (
                <figcaption className="px-3.5 py-2.5 text-[13px]">
                  {item.title ? <span className="block font-bold">{item.title}</span> : null}
                  {item.description ? (
                    <span className="block text-muted-foreground">{item.description}</span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ),
    },
    {
      id: "videos",
      title: "الفيديوهات",
      show: view.videos.length > 0,
      body: () => (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {view.videos.map((video, index) => (
            <li key={`${video.url}-${index}`} className="min-w-0">
              <a
                href={video.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`flex min-h-14 min-w-0 items-center gap-3 rounded-[18px] border border-[var(--clay-rim)] bg-card px-3.5 py-2.5 text-foreground shadow-sm ${FOCUS_RING}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-red)]/12 text-[var(--brand-red)]">
                  <Play className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  {/*
                    Wrapped, not truncated: in a right-to-left line an
                    ellipsis cuts a Latin title from its first word.
                  */}
                  <span className="block break-words text-[14px] font-bold [overflow-wrap:anywhere]">
                    {video.title || video.url}
                  </span>
                  {video.type ? (
                    <span className="block text-[12px] text-muted-foreground">
                      {enumLabel("videoType", video.type)}
                    </span>
                  ) : null}
                </span>
                <ExternalLink
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "specifications",
      title: "المواصفات الكاملة",
      nav: "المواصفات",
      show: specGroups.length > 0,
      body: () => (
        <div className="grid gap-5 xl:grid-cols-2">
          {specGroups.map((group, index) =>
            group.label ? (
              <SubSection key={`${group.label}-${index}`} title={group.label}>
                <SpecTable rows={group.specs} />
              </SubSection>
            ) : (
              <SpecTable key={`group-${index}`} rows={group.specs} />
            ),
          )}
        </div>
      ),
    },
    {
      id: "support",
      title: "الدعم والمستندات",
      nav: "الدعم",
      show: supportLinks.length + updates.length + warrantyRows.length > 0,
      body: () => (
        <div className="space-y-6">
          <LinkCards items={supportLinks} />
          {updates.length ? (
            <SubSection title="تحديثات النظام">
              <ol className="space-y-2.5">
                {updates.map((update, index) => {
                  const heading =
                    update.title || (update.version ? `الإصدار ${update.version}` : "");
                  return (
                    <li
                      key={`${update.version}-${index}`}
                      className="min-w-0 rounded-[18px] bg-muted/50 px-4 py-3"
                    >
                      {heading || update.date ? (
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          {heading ? (
                            <strong className="text-[14px] font-bold text-foreground">
                              {heading}
                            </strong>
                          ) : null}
                          {update.date ? (
                            <time className="text-[12px] text-muted-foreground">
                              {formatDate(locale, update.date) || update.date}
                            </time>
                          ) : null}
                        </div>
                      ) : null}
                      {update.changes ? (
                        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-foreground/80">
                          {update.changes}
                        </p>
                      ) : null}
                      {update.url ? (
                        <a
                          href={update.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-2 inline-flex items-center gap-1 rounded-[8px] text-[12px] font-bold text-[var(--brand-red)] hover:underline"
                        >
                          المصدر
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </SubSection>
          ) : null}
          {warrantyRows.length ? (
            <SubSection title="الضمان والإصلاح">
              <SpecTable rows={warrantyRows} />
            </SubSection>
          ) : null}
        </div>
      ),
    },
    {
      id: "reviews",
      title: "المراجعات والتقييم",
      show:
        view.externalReviews.length + view.pros.length + view.cons.length + (rating ? 1 : 0) > 0,
      body: () => (
        <div className="space-y-5">
          {rating ? (
            <p className="inline-flex items-center gap-2 rounded-[18px] bg-muted/50 px-4 py-2.5 text-[20px] font-black text-foreground">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span className="sr-only">التقييم</span>
              <span dir="ltr">{rating}</span>
            </p>
          ) : null}
          {view.externalReviews.length ? (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {view.externalReviews.map((review, index) => (
                <li key={`${review.source}-${index}`} className="min-w-0">
                  <blockquote className="h-full rounded-[18px] bg-muted/50 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <cite className="text-[14px] font-bold not-italic text-foreground">
                        {review.source}
                      </cite>
                      {review.score ? (
                        <span
                          className="shrink-0 text-[14px] font-black text-[var(--brand-red)]"
                          dir="ltr"
                        >
                          {review.score}
                        </span>
                      ) : null}
                    </div>
                    {review.quote ? (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                        {review.quote}
                      </p>
                    ) : null}
                  </blockquote>
                </li>
              ))}
            </ul>
          ) : null}
          {view.pros.length || view.cons.length ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {view.pros.length ? (
                <SubSection title="الإيجابيات">
                  <BulletList items={view.pros} tone="good" />
                </SubSection>
              ) : null}
              {view.cons.length ? (
                <SubSection title="السلبيات">
                  <BulletList items={view.cons} tone="bad" />
                </SubSection>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "faq",
      title: "الأسئلة الشائعة",
      nav: "الأسئلة الشائعة",
      show: view.faq.length > 0,
      body: () => (
        <div className="space-y-2">
          {view.faq.map((item, index) => (
            <details
              key={`${item.question}-${index}`}
              className="min-w-0 rounded-[18px] bg-muted/50 px-4 py-3"
            >
              <summary
                className={`cursor-pointer rounded-[10px] text-[14px] font-bold text-foreground ${FOCUS_RING}`}
              >
                {item.question}
              </summary>
              <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      ),
    },
    {
      id: "sources",
      title: "المصادر",
      show: sourceLinks.length > 0,
      body: () => <LinkCards items={sourceLinks} />,
    },
  ];
  const visibleSections = sections.filter((section) => section.show);
  const railItems = visibleSections.flatMap((section) =>
    section.nav ? [{ id: section.id, label: section.nav }] : [],
  );
  const hasSpecs = specGroups.length > 0;

  /*
    Hardware is announced before it ships too, and the same rule applies: a
    console with a future release date is not for sale yet. The server refuses
    the order either way — this keeps the page from offering something the
    checkout will reject.
  */
  const awaitingRelease = isAwaitingRelease(product);
  const soldOut = view.stock <= 0 && !view.isInfiniteStock;
  const availabilityNote =
    !soldOut && !awaitingRelease && NOTEWORTHY_AVAILABILITY.has(view.availability)
      ? enumLabel("availability", view.availability)
      : "";
  const showPriceRow = view.price > 0 || !awaitingRelease;

  const handleCart = () => {
    if (view.stock <= 0 && !view.isInfiniteStock) {
      toast.error(t("errors.productOutOfStock"));
      return;
    }
    if (awaitingRelease) {
      toast.error("هذا المنتج لم يصدر بعد — فعّل التنبيه وسنخبرك فور توفره");
      return;
    }
    addToCart({
      productId: String(product.id || ""),
      title: view.title,
      image: resolvePurchaseImage(product).url,
      price: view.price,
      kind: "hardware",
      requiresAddress: true,
    });
    toast.success(t("product.addedToCart") || "أُضيف إلى السلة");
  };

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-6xl px-4 pt-4 pb-16 sm:px-6 sm:pt-6 lg:px-8 [overflow-wrap:anywhere]"
      dir={dir}
    >
      {/* ------------------------------ hero ------------------------------ */}
      <div className="grid min-w-0 grid-cols-1 gap-6 pb-4 pt-2 lg:grid-cols-2 lg:gap-10 lg:pt-4">
        <div className="min-w-0">
          <ProductGallery images={view.images} alt={view.title} />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            {eyebrow.length ? (
              <p className="text-[12px] font-bold text-muted-foreground">{eyebrow.join(" · ")}</p>
            ) : null}
            <h1 className="text-[26px] font-black leading-[1.12] tracking-[-0.02em] text-foreground text-balance sm:text-[32px]">
              {view.title}
            </h1>
            {view.subtitle ? (
              <p className="text-[15px] text-muted-foreground">{view.subtitle}</p>
            ) : null}
            {rating ? (
              <p className="flex items-center gap-1.5 pt-1 text-[14px] font-bold text-foreground">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                <span className="sr-only">التقييم</span>
                <span dir="ltr">{rating}</span>
              </p>
            ) : null}
          </div>

          {/* The facts strip: sideways on a phone, a grid from `sm` up. */}
          {facts.length ? (
            <dl className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
              {facts.map((fact) => {
                const Icon = fact.icon;
                return (
                  <div
                    key={fact.label}
                    className="flex min-w-[8.5rem] max-w-[13rem] shrink-0 flex-col gap-1 rounded-[18px] bg-muted/50 px-3.5 py-3 sm:min-w-0 sm:max-w-none"
                  >
                    <dt className="flex items-center gap-1.5 text-[11.5px] font-bold text-muted-foreground">
                      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                      <span className="truncate">{fact.label}</span>
                    </dt>
                    <dd className="text-[14px] font-black leading-snug text-foreground [overflow-wrap:anywhere]">
                      <span dir="auto">{fact.value}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}

          {view.highlights.length ? <BulletList items={view.highlights.slice(0, 5)} /> : null}

          {/*
            Everything the purchase needs, in one piece of clay: the price,
            whether it is in stock, and the button — or, before launch, the
            release alert in its place.
          */}
          <div className="rounded-[28px] border border-[var(--clay-rim)] bg-card p-4 shadow-lg sm:p-5">
            {showPriceRow ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                {view.price > 0 ? (
                  <span
                    className="text-[30px] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground"
                    dir="ltr"
                  >
                    {formatIQDPrice(view.price)}
                  </span>
                ) : null}
                {!awaitingRelease ? (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${
                      soldOut
                        ? "bg-red-500/12 text-red-700 dark:text-red-300"
                        : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {soldOut ? t("product.outOfStock") : t("product.inStock")}
                  </span>
                ) : null}
              </div>
            ) : null}
            {availabilityNote ? (
              <p className="mt-1.5 text-[12px] font-bold text-muted-foreground">
                {availabilityNote}
              </p>
            ) : null}

            {awaitingRelease ? (
              <div className={showPriceRow ? "mt-4" : ""}>
                <ReleaseAlertPanel product={product as Record<string, unknown>} />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleCart}
                disabled={soldOut}
                className={`mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--brand-red)] px-5 text-[15px] font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-card`}
              >
                <ShoppingCart className="h-5 w-5" aria-hidden="true" />
                {t("product.addToCart")}
              </button>
            )}

            {hasSpecs ? (
              <a
                href="#specifications"
                className={`mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-[var(--clay-rim)] bg-card px-4 text-[14px] font-bold text-foreground shadow-sm ${FOCUS_RING}`}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                عرض المواصفات الكاملة
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <SectionRail items={railItems} />

      {/* ---------------------------- sections ---------------------------- */}
      <div className="min-w-0">
        {visibleSections.map((section) => (
          <Section key={section.id} id={section.id} title={section.title}>
            {section.body()}
          </Section>
        ))}
      </div>
    </div>
  );
}
