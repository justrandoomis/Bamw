import { useMemo, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  Bell,
  Calendar,
  Clock,
  Gamepad2,
  HardDrive,
  Heart,
  Languages,
  Play,
  Shapes,
  BellRing,
  ShoppingBag,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { useHub } from "./hubContext";
import { CaseStage } from "./CaseStage";
import type { Game } from "@/hub/types";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { PLATFORM_META } from "@/hub/ui/Icons";
import { SmartImage } from "@/hub/ui/Bits";
import { formatBytes, formatDate, formatRange } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import { ShareAndEarnButton } from "@/components/referral/ShareAndEarnButton";
import { isAwaitingRelease } from "@/lib/release";
import { playSound } from "@/hub/utils/audio";
import { sleeveFor } from "@/hub/services/coverArtService";
import { cdnImage } from "@/lib/img";

/**
 * Cinematic hero, built around the 3D game case.
 *
 * The composition the page is known for is preserved: the product renders in
 * three-quarter perspective on one side, its information sits beside it, and
 * the whole thing is lit by the game's own art. The backdrop is layered
 * image → blur → dark wash → gradient → vignette, in that order, so the type
 * stays legible over bright key art.
 *
 * Media is reachable without displacing the product: the trailer and gallery
 * live in a compact rail beneath the case rather than taking the stage.
 */
export function Hero() {
  const { t } = useI18n();
  const { formatConverted } = useCurrency();
  const {
    game,
    bestOffer,
    isWishlisted,
    toggleWishlist,
    openBuy,
    openAlert,
    openVideo,
    openLightbox,
    priceVerdict,
  } = useHub();

  const awaitingRelease = isAwaitingRelease(game.rawProduct ?? {});

  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  // Parallax on the backdrop only — the case itself must not drift away from
  // the type it belongs with.
  const backdropY = useTransform(scrollY, [0, 600], [0, 90]);
  const backdropScale = useTransform(scrollY, [0, 600], [1.1, 1.2]);

  const images = useMemo(() => {
    if (game.images?.length) return game.images;
    const gallery = (game as any).gallery || [];
    return gallery.map((url: string, id: number) => ({ id: `gal-${id}`, url, thumbUrl: url }));
  }, [game.images, (game as any).gallery]);

  const bannerUrl = (game as any).banner;
  const trailer = useMemo(
    () =>
      game.videos?.find((v) => v.kind === "trailer") ??
      game.videos?.find((v) => v.kind === "launch-trailer") ??
      game.videos?.[0],
    [game.videos],
  );

  /*
    `null` until the visitor actually points at a thumbnail. It used to start at
    0, so the hero opened on the first *gallery screenshot* rather than on the
    game's own hero artwork.
  */
  const [thumbIndex, setThumbIndex] = useState<number | null>(null);

  /*
    The hero background is the Cover Image role: wide, composition-friendly key
    art meant to be blurred and darkened behind the title. The Front Box Cover
    is deliberately absent from this chain — it is a tall, tightly-cropped
    photograph of a box, and stretching it across a landscape header is what
    made this look like a mistake rather than a design.
  */
  const backdropUrl =
    (thumbIndex !== null ? images[thumbIndex]?.url : undefined) ??
    game.detailCoverUrl ??
    bannerUrl ??
    game.keyArtUrl;

  /*
    Which physical SKUs actually exist. A backward-compatible Switch game runs on
    Switch 2 but still ships in a Switch 1 case, so hardware support alone does
    not earn a Switch 2 case — only a distinct Switch 2 release does.
  */
  const nin = game.nintendo;
  const hasSwitch2Sku = Boolean(nin?.switch2Only || nin?.switch2Edition?.available);
  const hasSwitch1Sku = Boolean(nin?.runsOn?.includes("switch") && !nin?.switch2Only);
  const skus = [
    ...(hasSwitch1Sku ? (["switch"] as const) : []),
    ...(hasSwitch2Sku ? (["switch2"] as const) : []),
  ];

  // Switch 2 leads when both cases exist: it is the headline SKU on a
  // Switch-2-first storefront, and the selector makes the other one one tap away.
  const [sku, setSku] = useState<"switch" | "switch2">(() =>
    hasSwitch2Sku ? "switch2" : "switch",
  );
  const isSwitch2 = sku === "switch2";

  /*
    A digital-only release has no case to show. Rendering one anyway would be a
    straightforward lie about what the buyer receives.
  */
  const hasPhysical = Boolean(
    nin?.formats?.some((format) => format === "cartridge" || format === "game-key-card"),
  );

  const stats = buildQuickStats(game, t);

  return (
    <header className="hero-dark relative isolate overflow-hidden bg-ink-950">
      {/* ---- Backdrop stack: the art itself, blurred, then only as much wash
           as the type needs. A flat black plate is what made this look cheap. ---- */}
      <motion.div
        aria-hidden
        {...(reduceMotion ? {} : { style: { y: backdropY, scale: backdropScale } })}
        className="absolute inset-0 -z-30"
      >
        {backdropUrl && (
          <>
            {/* Bloom: an over-scaled, heavily blurred copy spreads the art's own
                colour across the whole header. */}
            <img
              src={cdnImage(backdropUrl)}
              alt=""
              className="absolute inset-0 h-full w-full scale-[1.35] object-cover opacity-60 blur-[70px] saturate-150 transition-opacity duration-700"
            />
            {/* Readable layer: same art, gentler blur, slightly brighter. */}
            <img
              src={cdnImage(backdropUrl)}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-[30px] brightness-75 transition-opacity duration-700"
            />
          </>
        )}
      </motion.div>
      {/* Increased wash and layered gradients to ensure white text is always legible */}
      <div aria-hidden className="absolute inset-0 -z-20 bg-ink-950/60" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(8,9,13,0.6)_0%,rgba(11,13,19,0.4)_38%,rgba(11,13,19,0.8)_82%,rgb(11,13,19)_100%)]"
      />
      <div
        aria-hidden
        className="grain absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_50%_22%,transparent_30%,rgba(8,9,13,0.9)_100%)]"
      />

      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-8 sm:pb-12 sm:pt-12 lg:px-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)] lg:gap-12">
          {/* ================= Product ================= */}
          <div className="flex flex-col items-center justify-center min-h-[360px] sm:min-h-[440px] w-full max-w-full overflow-hidden">
            <CaseStage
              key={game.slug}
              coverUrl={game.coverUrl}
              // The 3D sleeve samples the print-resolution cover when the
              // catalogue has one; the CSS case stays on `coverUrl`.
              coverTextureUrl={game.coverTextureUrl}
              detailCoverUrl={game.detailCoverUrl}
              coverTrim={game.coverTrim}
              // Explicit artwork wins; otherwise resolve from the game code.
              sleeve={game.caseSleeve ?? sleeveFor(game.nintendoGameCode)}
              title={game.title}
              subtitle={game.subtitle}
              isSwitch2={isSwitch2}
              platform={isSwitch2 ? "ns2" : "ns1"}
              ageRating={game.ageRating}
              // Retail Switch 2 packaging prints the edition on the spine.
              editionLabel={
                isSwitch2 && nin?.switch2Edition?.available
                  ? "Nintendo Switch 2 Edition"
                  : undefined
              }
              size="lg"
              onClick={() => images[0] && openLightbox(images[0].id)}
              className="scale-90 sm:scale-100 will-change-transform max-w-full"
            />

            {/* SKU selector — only when both cases genuinely exist. */}
            {skus.length > 1 && (
              <div className="mt-4 flex gap-1 rounded-full bg-black/30 p-1">
                {skus.map((option, optIdx) => (
                  <button
                    key={`${option}-${optIdx}`}
                    onClick={() => {
                      setSku(option);
                      playSound("select");
                    }}
                    aria-pressed={sku === option}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors duration-200",
                      sku === option ? "bg-white/[0.14] text-white" : "muted hover:text-white",
                    )}
                  >
                    {PLATFORM_META[option].label}
                  </button>
                ))}
              </div>
            )}

            {!hasPhysical && <p className="mt-2 text-[11px] muted">{t("nintendo.digital")}</p>}

            {/* Media rail — trailer + stills, secondary to the product. */}
            {(trailer || images.length > 0) && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {trailer && (
                  <button
                    onClick={() => {
                      playSound("confirm");
                      openVideo(trailer);
                    }}
                    className="group flex items-center gap-2 rounded-full bg-white/[0.08] py-1.5 pe-3.5 ps-1.5 text-[11px] font-bold backdrop-blur transition-colors hover:bg-white/[0.14]"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-nin text-white transition-transform group-hover:scale-110">
                      <Play className="ms-px h-3 w-3 fill-current" />
                    </span>
                    {t("hero.watchTrailer")}
                  </button>
                )}
                {images.slice(0, 4).map((image: any, index: number) => (
                  <button
                    key={`${image.id || image.url}-${index}`}
                    onMouseEnter={() => setThumbIndex(index)}
                    onFocus={() => setThumbIndex(index)}
                    onClick={() => openLightbox(image.id)}
                    aria-label={image.alt}
                    className={cn(
                      "h-9 w-12 shrink-0 overflow-hidden rounded-md transition-all duration-300",
                      index === thumbIndex
                        ? "opacity-100 ring-1 ring-white/50"
                        : "opacity-45 hover:opacity-85",
                    )}
                  >
                    <SmartImage
                      src={cdnImage(image.thumbUrl ?? image.url)}
                      alt=""
                      wrapperClassName="h-full w-full"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ================= Information ================= */}
          <div className="min-w-0">
            <h1 className="text-[2rem] font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl">
              {game.title}
            </h1>
            {game.subtitle && (
              <p className="mt-1.5 text-lg font-bold text-nin-soft sm:text-xl">{game.subtitle}</p>
            )}

            {/* Developer / publisher — both navigable. */}
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted">
              {game.developer && (
                <StudioLink
                  kind="developer"
                  name={game.developer.name}
                  slug={game.developer.slug}
                />
              )}
              {game.developer && game.publisher && game.developer.id !== game.publisher.id && (
                <span aria-hidden>·</span>
              )}
              {game.publisher && game.publisher.id !== game.developer?.id && (
                <StudioLink
                  kind="publisher"
                  name={game.publisher.name}
                  slug={game.publisher.slug}
                />
              )}
            </p>

            {/* Platform + format badges */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {game.platforms
                .filter((p) => PLATFORM_META[p])
                .sort((a, b) => nintendoRank(a) - nintendoRank(b))
                .map((platform, platIdx) => {
                  const meta = PLATFORM_META[platform];
                  const { Icon } = meta;
                  return (
                    <span
                      key={`${platform}-${platIdx}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold",
                        meta.nintendo
                          ? "bg-nin text-white"
                          : "bg-white/[0.09] text-[rgb(var(--text))]",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.short}
                    </span>
                  );
                })}
              {game.nintendo?.formats?.map((format, fmtIdx) => (
                <span
                  key={`${format}-${fmtIdx}`}
                  className="inline-flex items-center rounded-md border border-white/12 px-2 py-1 text-[11px] font-bold muted"
                >
                  {format === "digital"
                    ? t("nintendo.digital")
                    : format === "cartridge"
                      ? t("nintendo.cartridge")
                      : t("nintendo.gameKeyCard")}
                </span>
              ))}
            </div>

            {/* Scores and facts, one line */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {game.userScore != null && (
                <Metric icon={Star} iconClass="fill-warn text-warn">
                  <b className="text-sm">{game.userScore.toFixed(1)}</b>
                  <span className="muted"> / 5</span>
                </Metric>
              )}
              {game.criticScore?.metacritic != null && (
                <Metric icon={Trophy} iconClass="text-warn">
                  <b className="text-sm">{game.criticScore.metacritic}</b>
                  <span className="muted"> {t("hero.metacritic")}</span>
                </Metric>
              )}
              {game.releaseDate && (
                <Metric icon={Calendar}>
                  <span dir="auto">{formatDate(game.releaseDate)}</span>
                </Metric>
              )}
              {game.multiplayer?.players && (
                <Metric icon={Users}>
                  <span dir="auto">
                    {formatRange(game.multiplayer.players)} {t("common.players")}
                  </span>
                </Metric>
              )}
              {game.ageRating && (
                <span
                  dir="ltr"
                  className="max-w-full truncate rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-extrabold"
                  title={`${game.ageRating.system} ${game.ageRating.label}`}
                >
                  {game.ageRating.system} {game.ageRating.label}
                </span>
              )}
            </div>

            {game.tagline && (
              <p className="mt-4 max-w-xl text-sm leading-relaxed muted">{game.tagline}</p>
            )}

            {/* ---- Price + CTAs: seamed into the hero, not boxed ---- */}
            <div className="mt-6 border-t border-white/[0.09] pt-5">
              {bestOffer ? (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="eyebrow">{t("hero.bestPrice")}</span>
                  <span className="num text-3xl font-extrabold tracking-tight text-good sm:text-4xl">
                    {formatConverted(bestOffer.offer.price)}
                  </span>
                  {bestOffer.offer.discountPercent != null && (
                    <span className="num rounded bg-good/15 px-1.5 py-0.5 text-xs font-extrabold text-good">
                      −{bestOffer.offer.discountPercent}%
                    </span>
                  )}
                  {priceVerdict && (
                    <span
                      className={cn(
                        "text-xs font-bold",
                        priceVerdict.id === "wait" ? "text-warn" : "text-good",
                      )}
                    >
                      {t(`history.verdict${capitalise(priceVerdict.id)}` as never)}
                    </span>
                  )}
                  <span className="text-[11px] muted">
                    {bestOffer.offer.storeName} · {bestOffer.offer.region}
                  </span>
                </div>
              ) : (
                <p className="text-sm muted">{t("prices.noOffers")}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    playSound("confirm");
                    openBuy();
                  }}
                  id="hero-buy-button"
                  className="btn btn-primary h-12 flex-1 px-7 text-sm sm:flex-none"
                >
                  {/*
                    Before launch this opens the release panel rather than the
                    purchase sheet, so it must not promise a sale. `openBuy`
                    itself is what enforces that; this only tells the truth
                    about what the tap will do.
                  */}
                  {awaitingRelease ? (
                    <>
                      <BellRing className="h-4 w-4" />
                      سجّل مسبقاً
                    </>
                  ) : (
                    <>
                      <ShoppingBag className="h-4 w-4" />
                      {t("hero.buyNow")}
                    </>
                  )}
                </button>
                <button
                  onClick={toggleWishlist}
                  aria-pressed={isWishlisted}
                  className={cn(
                    "inline-flex h-12 items-center gap-2 rounded-xl px-4 text-xs font-bold transition-colors active:scale-[0.97]",
                    isWishlisted
                      ? "bg-nin/15 text-nin-soft"
                      : "muted hover:bg-white/[0.07] hover:text-white",
                  )}
                >
                  <Heart className={cn("h-4 w-4", isWishlisted && "fill-current")} />
                  <span className="hidden sm:inline">
                    {isWishlisted ? t("hero.inWishlist") : t("hero.addToWishlist")}
                  </span>
                </button>
                <button
                  onClick={openAlert}
                  className="inline-flex h-12 items-center gap-2 rounded-xl px-4 text-xs font-bold muted transition-colors hover:bg-white/[0.07] hover:text-white active:scale-[0.97]"
                >
                  <Bell className="h-4 w-4 text-warn" />
                  <span className="hidden sm:inline">{t("hero.trackPrice")}</span>
                </button>
              </div>

              {/*
                Share and earn — دعوة صديق.

                A chip on its own line under the buy row: it carries a number
                worth reading, so it is not an icon, but it is the page's thin
                quiet control rather than a second call to action. On its own
                line because a fourth control inside the buy row is what starts
                the horizontal scroll this layout has fought before.
              */}
              <div className="mt-3 flex">
                <ShareAndEarnButton
                  product={(game.rawProduct ?? {}) as Record<string, unknown>}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ---- Quick stats strip: compact, seamed, full width ---- */}
        {stats.length > 0 && (
          <div className="mt-9 grid grid-cols-2 gap-2 overflow-hidden rounded-xl border border-white/15 bg-white/[0.07] p-2 backdrop-blur-md sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((stat, statIdx) => (
              <div
                key={`${stat.label}-${statIdx}`}
                className="min-w-0 rounded-lg border border-white/10 bg-white/[0.08] px-3.5 py-3"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
                  <stat.icon className="h-4 w-4 shrink-0 text-white" strokeWidth={2.25} />
                  <span className="truncate">{stat.label}</span>
                </span>
                <span
                  dir="auto"
                  title={stat.value}
                  className="mt-1 block truncate text-[13px] font-bold"
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function Metric({
  icon: Icon,
  iconClass,
  children,
}: {
  icon: typeof Star;
  iconClass?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5 muted", iconClass)} />
      {children}
    </span>
  );
}

function StudioLink({
  kind,
  name,
  slug,
}: {
  kind: "developer" | "publisher";
  name: string;
  slug?: string | undefined;
}) {
  const { t } = useI18n();
  const label = t(kind === "developer" ? "hero.developer" : "hero.publisher");
  // This storefront has no studio pages, so the credit is plain text rather
  // than a link that would dead-end.
  return (
    <span>
      {label}: <span className="font-semibold text-[rgb(var(--text))]">{name}</span>
    </span>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

/** Quick stats, built only from fields the record actually carries. */
function buildQuickStats(game: Game, t: Translate) {
  const items: Array<{ icon: typeof Clock; label: string; value: string }> = [];

  const primary =
    game.platforms.find((p) => p === "switch2" || p === "switch") ?? game.platforms[0];
  if (primary && PLATFORM_META[primary]) {
    items.push({
      icon: Gamepad2,
      label: t("glance.platform"),
      value: PLATFORM_META[primary].label,
    });
  }

  const players = formatRange(game.multiplayer?.players);
  if (players) items.push({ icon: Users, label: t("glance.players"), value: players });

  const size = formatBytes(game.storage?.downloadSizeBytes?.value);
  if (size) items.push({ icon: HardDrive, label: t("glance.downloadSize"), value: size });

  const released = formatDate(game.releaseDate);
  if (released) items.push({ icon: Calendar, label: t("glance.releaseDate"), value: released });

  if (game.languages?.length) {
    const names = game.languages
      .slice(0, 2)
      .map((l) => l.name)
      .join(" / ");
    items.push({
      icon: Languages,
      label: t("glance.languages"),
      value: game.languages.length > 2 ? `${names} +${game.languages.length - 2}` : names,
    });
  }

  const primaryGenre = game.genres?.[0];
  if (primaryGenre) {
    items.push({ icon: Shapes, label: t("glance.genre"), value: primaryGenre });
  }

  const hours = formatRange(game.completion?.mainStoryHours, t("common.hours"));
  if (hours && items.length < 6) {
    items.push({ icon: Clock, label: t("glance.playTime"), value: hours });
  }

  return items.filter((item) => item.value && item.value.trim().length > 0).slice(0, 6);
}

const nintendoRank = (platform: string) =>
  platform === "switch2" ? 0 : platform === "switch" ? 1 : 2;
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
