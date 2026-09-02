import {
  BatteryCharging,
  Box,
  Cable,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Gamepad2,
  Gauge,
  HardDrive,
  MemoryStick,
  Monitor,
  Package,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { toast } from "sonner";

import { useCurrency } from "@/context/CurrencyContext";
import { useTranslation } from "@/i18n";
import { slugifyDevice } from "@/lib/devicePerformance";
import { formatDate } from "@/lib/i18n";
import { buildProductView } from "@/lib/productImport/productView";
import type { ProductSchema } from "@/lib/productImport/types";
import { resolvePurchaseImage } from "@/lib/nintendoImages";
import { useCartStore } from "@/store/useCartStore";
import { ReleaseAlertPanel } from "@/components/ReleaseAlertPanel";
import { isAwaitingRelease } from "@/lib/release";

import { ProductGallery } from "./ProductGallery";
import { BulletList, Section, SpecTable } from "./Section";

type Record_ = Record<string, any>;
type Row = { label: string; value: string; note?: string };

const value = (input: unknown): string => {
  if (input === true) return "Yes";
  if (input === false) return "No";
  if (Array.isArray(input)) return input.map(value).filter(Boolean).join(", ");
  if (input == null || typeof input === "object") return "";
  return String(input).trim();
};
const rows = (product: Record_, definitions: [string, string, string?][]): Row[] =>
  definitions
    .map(([key, label, fallback]) => ({
      label,
      value: value(product[key]) || (fallback ? value(product[fallback]) : ""),
    }))
    .filter((row) => row.value);
const list = <T,>(input: unknown): T[] => (Array.isArray(input) ? input.filter(Boolean) : []);
const prettyStatus = (input: string) =>
  input.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function InfoCards({ items }: { items: (Row & { icon?: ComponentType<any> })[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={`${item.label}-${item.value}`}
            className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-xs"
          >
            <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" /> : null}
              {item.label}
            </dt>
            <dd className="mt-2 text-sm font-bold leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {item.value}
            </dd>
            {item.note ? <p className="mt-1 text-xs text-muted-foreground">{item.note}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

function LinkCards({ items }: { items: { title?: string; type?: string; url: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item, index) => (
        <a
          key={`${item.url}-${index}`}
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-w-0 items-center gap-3 rounded-2xl border border-border p-4 transition hover:border-primary/50"
        >
          <FileText className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block break-words font-bold [overflow-wrap:anywhere]">
              {item.title || item.url}
            </span>
            {item.type ? <span className="text-xs text-muted-foreground">{item.type}</span> : null}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        </a>
      ))}
    </div>
  );
}

interface LinkedGame {
  id: string;
  title: string;
  image: string;
  performance: {
    device?: string;
    deviceSlug?: string;
    handheld?: Record_;
    tv?: Record_;
    modes?: Record_[];
    upscaling?: string;
    rayTracing?: boolean;
    verifiedAt?: string;
  };
}

function PerformanceBadges({ mode }: { mode?: Record_ }) {
  if (!mode) return null;
  if (mode.supported === false) {
    return (
      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">Not Supported</span>
    );
  }
  const badgeValues = [
    mode.outputResolution || mode.resolution,
    mode.fps ? `${mode.fps}${/fps/i.test(String(mode.fps)) ? "" : " FPS"}` : "",
    mode.hdr === true ? "HDR" : "",
    mode.vrr === true ? "VRR" : "",
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {badgeValues.map((badge) => (
        <span
          key={String(badge)}
          className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary"
        >
          {String(badge)}
        </span>
      ))}
    </div>
  );
}

function GamePerformanceExplorer({ deviceSlug }: { deviceSlug: string }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState("alphabetical");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: LinkedGame[]; totalPages: number; total: number }>({
    items: [],
    totalPages: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          limit: "24",
          search,
          filters: filters.join(","),
          sort,
        });
        const response = await fetch(
          `/api/hardware/${encodeURIComponent(deviceSlug)}/games?${query}`,
          {
            signal: controller.signal,
          },
        );
        if (response.ok) setResult(await response.json());
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[hardware-performance]", error);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deviceSlug, filters, page, search, sort]);

  const filterOptions = [
    "30",
    "40",
    "60",
    "120",
    "1080p",
    "1440p",
    "4K",
    "HDR",
    "VRR",
    "Handheld",
    "TV",
    "Performance Mode",
    "Quality Mode",
    "DLSS",
    "Ray Tracing",
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-muted/20 p-4">
        <p className="text-sm font-semibold">Actual game performance from each game record</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          These values are not inferred from this device&apos;s maximum capabilities.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <label className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search games"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
        </label>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold"
        >
          <option value="alphabetical">Alphabetical</option>
          <option value="highest_fps">Highest FPS</option>
          <option value="highest_resolution">Highest Resolution</option>
          <option value="recently_verified">Recently Verified</option>
          <option value="newest">Newest Games</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {filterOptions.map((filter) => {
          const selected = filters.includes(filter);
          return (
            <button
              key={filter}
              type="button"
              onClick={() => {
                setFilters((current) =>
                  selected ? current.filter((item) => item !== filter) : [...current, filter],
                );
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-primary/50"
              }`}
            >
              {filter.match(/^\d+$/) ? `${filter} FPS` : filter}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((item) => (
            <div key={item} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : result.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.items.map((game) => (
            <a
              key={game.id}
              href={`/product/${game.id}`}
              className="group grid min-w-0 grid-cols-[88px_1fr] gap-4 overflow-hidden rounded-2xl border border-border bg-card p-3 transition hover:border-primary/50 hover:shadow-md"
            >
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-muted">
                {game.image ? (
                  <img
                    src={game.image}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Gamepad2 className="m-auto h-full w-8 text-muted-foreground/30" />
                )}
              </div>
              <div className="min-w-0 space-y-3 py-1">
                <h3 className="break-words text-sm font-bold leading-snug [overflow-wrap:anywhere]">
                  {game.title}
                </h3>
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">
                    Handheld
                  </p>
                  <PerformanceBadges mode={game.performance.handheld} />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">
                    TV Mode
                  </p>
                  <PerformanceBadges mode={game.performance.tv} />
                </div>
                {game.performance.modes?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Modes:{" "}
                    {game.performance.modes
                      .map((mode) => mode.name)
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No verified game performance data is available yet.
        </div>
      )}

      {result.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-xl border border-border p-2 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-bold" dir="ltr">
            {page} / {result.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= result.totalPages}
            onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
            className="rounded-xl border border-border p-2 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function HardwareProductDetails({
  product,
  schema,
}: {
  product: Record_;
  schema: ProductSchema;
}) {
  const { locale, dir, t } = useTranslation();
  const { formatIQDPrice } = useCurrency();
  const addToCart = useCartStore((state) => state.add);
  const view = useMemo(() => buildProductView(product, locale, schema), [locale, product, schema]);
  if (!view) return null;

  const gaming = (product.gamingCapability || {}) as Record_;
  const handheldCapability = (gaming.handheld || {}) as Record_;
  const tvCapability = (gaming.tv || {}) as Record_;
  const ports = list<Record_>(product.ports);
  const components = list<Record_>(product.componentDimensions);
  const rating = value(product.reviewScore || product.userScore || product.rating);
  const deviceSlug = slugifyDevice(product.slug || product.title || product.shortName);

  const overview = rows(product, [
    ["processor", "Processor", "soc"],
    ["cpu", "CPU"],
    ["gpu", "GPU"],
    ["ram", "RAM", "memory"],
    ["internalStorage", "Internal Storage", "storageCapacity"],
    ["expandableStorage", "Expandable Storage"],
    ["displaySize", "Display Size"],
    ["displayType", "Display Type", "panelType"],
    ["nativeResolution", "Resolution", "resolution"],
    ["refreshRate", "Refresh Rate"],
    ["hdr", "HDR"],
    ["batteryLife", "Battery", "runtime"],
    ["cooling", "Cooling"],
    ["audioOutput", "Audio"],
    ["connectivity", "Connectivity"],
  ]).map((row, index) => ({
    ...row,
    icon: [
      Cpu,
      Cpu,
      Gauge,
      MemoryStick,
      HardDrive,
      HardDrive,
      Monitor,
      Monitor,
      Monitor,
      Gauge,
      Sparkles,
      BatteryCharging,
      Gauge,
      Cable,
      Wifi,
    ][index],
  }));

  const displayRows = rows(product, [
    ["displaySize", "Display size"],
    ["panelType", "Panel type", "displayType"],
    ["nativeResolution", "Native resolution", "resolution"],
    ["refreshRate", "Refresh rate"],
    ["vrr", "VRR"],
    ["vrrRange", "VRR range"],
    ["hdr", "HDR"],
    ["hdrFormat", "HDR format"],
    ["touchSupport", "Touch support"],
    ["maximumHandheldFps", "Maximum handheld FPS", "handheldMaxFps"],
  ]);
  const tvRows = rows(product, [
    ["tvMaxResolution", "Maximum TV resolution"],
    ["supportedOutputResolutions", "Supported resolutions"],
    ["tvMaxRefreshRate", "Maximum refresh rate"],
    ["tvHdr", "HDR support"],
    ["tvMaxFps", "Maximum FPS"],
    ["hdmiVersion", "HDMI version"],
    ["tvOutputNotes", "TV output notes"],
  ]);
  const processorRows = rows(product, [
    ["soc", "SoC / Processor", "processor"],
    ["cpuArchitecture", "CPU architecture"],
    ["cpuCores", "CPU cores"],
    ["gpuArchitecture", "GPU architecture"],
    ["gpuCores", "GPU cores"],
    ["ram", "RAM", "memory"],
    ["ramType", "RAM type"],
    ["memoryBandwidth", "Memory bandwidth"],
    ["storageType", "Storage type"],
    ["readSpeed", "Read speed"],
    ["cooling", "Cooling"],
    ["performanceModes", "Performance modes"],
  ]);
  const storageRows = rows(product, [
    ["internalStorage", "Internal storage", "storageCapacity"],
    ["usableStorage", "Available usable storage"],
    ["storageType", "Storage technology"],
    ["expandableStorage", "Expandable storage"],
    ["storageCardType", "Supported card type"],
    ["storageMaxCapacity", "Maximum supported capacity"],
    ["gameStorageNotes", "Game installation / storage notes"],
  ]);
  const connectivityRows = rows(product, [
    ["wifi", "Wi-Fi"],
    ["wifiStandard", "Wi-Fi standard"],
    ["wifiBands", "Wi-Fi bands"],
    ["bluetooth", "Bluetooth"],
    ["bluetoothVersion", "Bluetooth version"],
    ["ethernet", "Ethernet"],
    ["usb", "USB"],
    ["usbC", "USB-C"],
    ["hdmi", "HDMI"],
    ["audioJack", "Audio jack"],
    ["nfc", "NFC"],
    ["wirelessProtocols", "Wireless protocols"],
  ]);
  const powerRows = rows(product, [
    ["batteryCapacity", "Battery capacity"],
    ["batteryType", "Battery type"],
    ["runtime", "Battery runtime", "batteryLife"],
    ["chargingTime", "Charging time"],
    ["powerAdapter", "Power adapter"],
    ["inputVoltage", "Input voltage"],
    ["inputFrequency", "Input frequency"],
    ["maximumPower", "Maximum power"],
    ["standbyPower", "Standby power"],
    ["connectorType", "Connector type"],
  ]);
  const physicalRows = rows(product, [
    ["productDimensions", "Product dimensions"],
    ["productWeight", "Weight"],
    ["material", "Material"],
    ["finish", "Finish"],
    ["availableColors", "Available colors", "color"],
  ]);
  const softwareRows = rows(product, [
    ["operatingSystem", "Operating system"],
    ["firmwareVersion", "Firmware"],
    ["companionApp", "Companion app", "software"],
    ["internetRequired", "Internet requirement"],
    ["accountRequired", "Account requirement"],
    ["drivers", "Drivers"],
    ["certifications", "Certifications"],
  ]);
  const requirementRows = rows(product, [
    ["minimumRequirements", "Minimum requirements"],
    ["recommendedRequirements", "Recommended requirements"],
  ]);
  const warrantyRows = rows(product, [
    ["warranty", "Warranty"],
    ["warrantyType", "Warranty type"],
    ["warrantyNotes", "Warranty notes"],
    ["repairability", "Repairability"],
    ["sparePartsAvailable", "Spare parts availability"],
    ["serviceNotes", "Service notes"],
  ]);
  const capabilityRows: Row[] = [
    {
      label: "Handheld maximum resolution",
      value: value(handheldCapability.maxResolution) || value(product.handheldMaxResolution),
    },
    {
      label: "Handheld maximum refresh rate",
      value: value(handheldCapability.maxRefreshRate) || value(product.handheldMaxRefreshRate),
    },
    {
      label: "Handheld maximum FPS",
      value: value(handheldCapability.maxFps) || value(product.handheldMaxFps),
    },
    { label: "Handheld HDR", value: value(handheldCapability.hdr ?? product.handheldHdr) },
    { label: "Handheld VRR", value: value(handheldCapability.vrr ?? product.handheldVrr) },
    {
      label: "TV maximum resolution",
      value: value(tvCapability.maxResolution || product.tvMaxResolution),
    },
    {
      label: "TV maximum refresh rate",
      value: value(tvCapability.maxRefreshRate || product.tvMaxRefreshRate),
    },
    { label: "TV maximum FPS", value: value(tvCapability.maxFps || product.tvMaxFps) },
    { label: "TV HDR", value: value(tvCapability.hdr ?? product.tvHdr) },
    { label: "TV VRR", value: value(tvCapability.vrr ?? product.tvVrr) },
    { label: "Ray tracing capability", value: value(gaming.rayTracing) },
    { label: "Upscaling technologies", value: list<string>(gaming.upscaling).join(", ") },
  ].filter((row) => row.value);

  const quick = rows(product, [
    ["model", "Model", "hardwareModel"],
    ["screenSpecs", "Display", "nativeResolution"],
    ["storageCapacity", "Storage", "internalStorage"],
    ["batteryLife", "Battery", "runtime"],
    ["releaseDate", "Release Date"],
    ["connectivity", "Connectivity", "wifiStandard"],
  ]);

  const nav = [
    ["overview", "Overview", Boolean(view.overview || view.descriptionFull || overview.length)],
    ["performance", "Performance", capabilityRows.length > 0],
    ["display", "Display", displayRows.length + tvRows.length > 0],
    ["hardware", "Hardware", processorRows.length > 0],
    ["storage", "Storage", storageRows.length > 0],
    ["connectivity", "Connectivity", connectivityRows.length + ports.length > 0],
    ["battery", "Battery", powerRows.length > 0],
    ["compatibility", "Compatibility", view.compatibility.length > 0],
    ["games", "Games", true],
    ["gallery", "Gallery", view.images.length + view.videos.length > 0],
    [
      "support",
      "Support",
      view.documents.length +
        view.updates.length +
        warrantyRows.length +
        (value(product.supportUrl) ? 1 : 0) >
        0,
    ],
    ["faq", "FAQ", view.faq.length > 0],
  ] as const;

  /*
    Hardware is announced before it ships too, and the same rule applies: a
    console with a future release date is not for sale yet. The server refuses
    the order either way — this keeps the page from offering something the
    checkout will reject.
  */
  const awaitingRelease = isAwaitingRelease(product);

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
    toast.success(t("product.addedToCart") || "Added to cart");
  };

  return (
    <div
      className="mx-auto max-w-7xl px-4 pt-20 pb-20 sm:pt-24 sm:px-6 lg:px-8 [overflow-wrap:anywhere]"
      dir={dir}
    >
      <div className="grid grid-cols-1 gap-6 py-6 lg:grid-cols-2 lg:gap-10">
        <ProductGallery images={view.images} alt={view.title} />
        <div className="min-w-0 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {view.brand ? <span>{view.brand}</span> : null}
              {value(product.series) ? <span>· {value(product.series)}</span> : null}
              {value(product.generation) ? <span>· {value(product.generation)}</span> : null}
            </div>
            <h1 className="mt-2 break-words text-2xl font-black leading-tight sm:text-3xl lg:text-4xl">
              {view.title}
            </h1>
            {view.subtitle ? (
              <p className="mt-2 text-muted-foreground text-sm sm:text-base">{view.subtitle}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              product.model || product.hardwareModel,
              product.modelNumber,
              product.releaseDate ? formatDate(locale, value(product.releaseDate)) : "",
              product.availabilityStatus ? prettyStatus(value(product.availabilityStatus)) : "",
              product.productStatus ? prettyStatus(value(product.productStatus)) : "",
              product.colorEdition,
            ]
              .filter(Boolean)
              .map((badge) => (
                <span
                  key={String(badge)}
                  className="rounded-full border border-border px-3 py-1 text-xs font-bold"
                >
                  {String(badge)}
                </span>
              ))}
          </div>
          {rating ? (
            <div className="flex items-center gap-2 text-sm font-bold">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span dir="ltr">{rating}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
            {rows(product, [
              ["storageCapacity", "Storage", "internalStorage"],
              ["screenSpecs", "Display", "nativeResolution"],
              ["batteryLife", "Battery", "runtime"],
            ]).map((item) => (
              <div key={item.label} className="min-w-0 rounded-2xl bg-muted/50 p-3">
                <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 break-words text-xs font-bold sm:text-sm">{item.value}</p>
              </div>
            ))}
          </div>
          {view.highlights.length ? <BulletList items={view.highlights.slice(0, 5)} /> : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            {view.price > 0 ? (
              <span className="text-2xl font-black sm:text-3xl" dir="ltr">
                {formatIQDPrice(view.price)}
              </span>
            ) : null}
            {awaitingRelease ? (
              <div className="min-w-[200px] flex-1">
                <ReleaseAlertPanel product={product as Record<string, unknown>} />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleCart}
                className="inline-flex flex-1 min-w-[200px] items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40"
                disabled={view.stock <= 0 && !view.isInfiniteStock}
              >
                <ShoppingCart className="h-5 w-5" />
                {t("product.addToCart")}
              </button>
            )}
          </div>
          <a
            href="#specifications"
            className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
          >
            View Full Specifications
          </a>
        </div>
      </div>

      <nav className="sticky top-16 z-20 my-4 overflow-x-auto rounded-2xl border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur no-scrollbar">
        <div className="flex min-w-max gap-1">
          {nav
            .filter(([, , visible]) => visible)
            .map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-xl px-3 py-1.5 text-xs font-bold transition hover:bg-muted"
              >
                {label}
              </a>
            ))}
        </div>
      </nav>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(240px,3fr)]">
        <main className="min-w-0">
          <Section
            id="overview"
            title="Hardware Overview"
            when={Boolean(view.overview || view.descriptionFull || overview.length)}
          >
            {view.overview || view.descriptionFull ? (
              <div className="mb-6 space-y-3 whitespace-pre-line leading-relaxed text-muted-foreground">
                {view.overview ? <p>{view.overview}</p> : null}
                {view.descriptionFull ? <p>{view.descriptionFull}</p> : null}
              </div>
            ) : null}
            <InfoCards items={overview} />
          </Section>

          <Section
            id="performance"
            title="Hardware Gaming Capabilities"
            when={capabilityRows.length}
          >
            <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              Maximum device capabilities. Actual game performance is listed separately and is never
              inferred from these values.
            </div>
            <InfoCards items={capabilityRows.map((item) => ({ ...item, icon: Gauge }))} />
          </Section>

          <Section
            id="display"
            title="Display & Graphics"
            when={displayRows.length + tvRows.length}
          >
            <div className="grid gap-6 xl:grid-cols-2">
              {displayRows.length ? (
                <div>
                  <h3 className="mb-3 font-bold">Handheld Display</h3>
                  <SpecTable rows={displayRows} />
                </div>
              ) : null}
              {tvRows.length ? (
                <div>
                  <h3 className="mb-3 font-bold">TV / Docked Output</h3>
                  <SpecTable rows={tvRows} />
                </div>
              ) : null}
            </div>
          </Section>

          <Section id="hardware" title="Processor & Performance" when={processorRows.length}>
            <SpecTable rows={processorRows} />
          </Section>
          <Section id="storage" title="Storage" when={storageRows.length}>
            <SpecTable rows={storageRows} />
          </Section>
          <Section
            id="connectivity"
            title="Connectivity & Ports"
            when={connectivityRows.length + ports.length}
          >
            {connectivityRows.length ? <SpecTable rows={connectivityRows} /> : null}
            {ports.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {ports.map((port, index) => (
                  <div
                    key={`${port.type}-${index}`}
                    className="rounded-2xl border border-border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{value(port.type) || "Port"}</strong>
                      {value(port.count) ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">
                          ×{value(port.count)}
                        </span>
                      ) : null}
                    </div>
                    {value(port.version) ? (
                      <p className="mt-2 text-sm">Version: {value(port.version)}</p>
                    ) : null}
                    {value(port.notes) ? (
                      <p className="mt-1 text-xs text-muted-foreground">{value(port.notes)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Section>
          <Section id="battery" title="Battery & Power" when={powerRows.length}>
            <SpecTable rows={powerRows} />
          </Section>
          <Section
            id="dimensions"
            title="Dimensions & Weight"
            when={physicalRows.length + components.length}
          >
            {physicalRows.length ? <SpecTable rows={physicalRows} /> : null}
            {components.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {components.map((component, index) => (
                  <InfoCards
                    key={index}
                    items={[
                      {
                        label: value(component.name) || `Component ${index + 1}`,
                        value: [component.dimensions, component.weight].filter(Boolean).join(" · "),
                        note: value(component.notes),
                        icon: Package,
                      },
                    ].filter((item) => item.value)}
                  />
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="box" title="What’s in the Box" when={view.boxContents.length}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {view.boxContents.map((item, index) => (
                <article
                  key={`${item.name}-${index}`}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <div className="flex aspect-video items-center justify-center bg-muted">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Box className="h-9 w-9 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between gap-2">
                      <strong>{item.name}</strong>
                      {item.quantity ? <span>×{item.quantity}</span> : null}
                    </div>
                    {item.notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section id="compatibility" title="Compatibility" when={view.compatibility.length}>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.compatibility.map((item, index) => (
                <article
                  key={`${item.name}-${index}`}
                  className="rounded-2xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{item.name}</strong>
                    {item.status ? (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                        {prettyStatus(item.status)}
                      </span>
                    ) : null}
                  </div>
                  {item.notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </Section>

          <Section
            id="software"
            title="Software & System"
            when={softwareRows.length + requirementRows.length + view.usageSteps.length}
          >
            {softwareRows.length ? <SpecTable rows={softwareRows} /> : null}
            {requirementRows.length ? (
              <div className="mt-5">
                <h3 className="mb-3 font-bold">Requirements</h3>
                <SpecTable rows={requirementRows} />
              </div>
            ) : null}
            {view.usageSteps.length ? (
              <div className="mt-5">
                <h3 className="mb-3 font-bold">Setup</h3>
                <ol className="grid gap-3 sm:grid-cols-2">
                  {view.usageSteps.map((step, index) => (
                    <li key={`${step}-${index}`} className="rounded-2xl border border-border p-4">
                      <span className="text-xs font-black text-primary">{index + 1}</span>
                      <span className="ms-2 text-sm font-semibold">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </Section>

          <Section id="games" title="Game Performance" when>
            <GamePerformanceExplorer deviceSlug={deviceSlug} />
          </Section>

          <Section id="gallery" title="Gallery" when={view.images.length + view.videos.length}>
            {view.images.length ? <ProductGallery images={view.images} alt={view.title} /> : null}
            {view.videos.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {view.videos.map((video, index) => (
                  <a
                    key={`${video.url}-${index}`}
                    href={video.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 rounded-2xl border border-border p-4 font-bold hover:border-primary/50"
                  >
                    <Gamepad2 className="h-5 w-5 text-primary" />
                    {video.title || video.url}
                    <ExternalLink className="ms-auto h-4 w-4" />
                  </a>
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="specifications" title="Full Specifications" when={view.specGroups.length}>
            <div className="grid gap-5 xl:grid-cols-2">
              {view.specGroups.map((group, index) => (
                <div key={`${group.label}-${index}`} className="min-w-0">
                  <h3 className="mb-2 font-bold">{group.label}</h3>
                  <SpecTable rows={group.specs} />
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="support"
            title="Support & Documentation"
            when={
              view.documents.length +
              view.updates.length +
              warrantyRows.length +
              (value(product.supportUrl) ? 1 : 0)
            }
          >
            {view.documents.length ? <LinkCards items={view.documents} /> : null}
            {value(product.supportUrl) ? (
              <div className="mt-3">
                <LinkCards
                  items={[
                    { title: "Official Support", type: "Support", url: value(product.supportUrl) },
                  ]}
                />
              </div>
            ) : null}
            {view.updates.length ? (
              <div className="mt-6">
                <h3 className="mb-3 font-bold">System Updates</h3>
                <ol className="relative ms-2 space-y-4 border-s border-border ps-5">
                  {[...view.updates]
                    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
                    .map((update, index) => (
                      <li
                        key={`${update.version}-${index}`}
                        className="rounded-2xl border border-border p-4 before:absolute before:-ms-[1.72rem] before:mt-1 before:h-3 before:w-3 before:rounded-full before:bg-primary"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <strong>{update.title || `Version ${update.version || ""}`}</strong>
                          {update.date ? (
                            <time className="text-xs text-muted-foreground">
                              {formatDate(locale, update.date) || update.date}
                            </time>
                          ) : null}
                        </div>
                        {update.changes ? (
                          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                            {update.changes}
                          </p>
                        ) : null}
                        {update.url ? (
                          <a
                            href={update.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary"
                          >
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </li>
                    ))}
                </ol>
              </div>
            ) : null}
            {warrantyRows.length ? (
              <div className="mt-6">
                <h3 className="mb-3 font-bold">Warranty & Repair</h3>
                <SpecTable rows={warrantyRows} />
              </div>
            ) : null}
          </Section>

          <Section
            id="reviews"
            title="Reviews & Verdict"
            when={
              view.externalReviews.length + view.pros.length + view.cons.length + (rating ? 1 : 0)
            }
          >
            {rating ? (
              <div className="mb-4 inline-flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-xl font-black">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                {rating}
              </div>
            ) : null}
            {view.externalReviews.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {view.externalReviews.map((review, index) => (
                  <blockquote
                    key={`${review.source}-${index}`}
                    className="rounded-2xl border border-border p-4"
                  >
                    <div className="flex justify-between gap-2">
                      <strong>{review.source}</strong>
                      <span>{review.score}</span>
                    </div>
                    {review.quote ? (
                      <p className="mt-2 text-sm text-muted-foreground">{review.quote}</p>
                    ) : null}
                  </blockquote>
                ))}
              </div>
            ) : null}
            {view.pros.length || view.cons.length ? (
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {view.pros.length ? (
                  <div>
                    <h3 className="mb-2 font-bold">Pros</h3>
                    <BulletList items={view.pros} tone="good" />
                  </div>
                ) : null}
                {view.cons.length ? (
                  <div>
                    <h3 className="mb-2 font-bold">Cons</h3>
                    <BulletList items={view.cons} tone="bad" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Section>

          <Section id="faq" title="FAQ" when={view.faq.length}>
            <div className="space-y-2">
              {view.faq.map((item, index) => (
                <details
                  key={`${item.question}-${index}`}
                  className="rounded-2xl border border-border p-4"
                >
                  <summary className="cursor-pointer font-bold">{item.question}</summary>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </Section>

          <Section id="sources" title="Sources" when={view.sources.length}>
            <LinkCards items={view.sources} />
          </Section>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-16 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-black">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Quick Specifications
            </h2>
            <dl className="mt-4 divide-y divide-border">
              {quick.map((item) => (
                <div key={item.label} className="py-3">
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="mt-1 break-words text-sm font-bold [overflow-wrap:anywhere]">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
