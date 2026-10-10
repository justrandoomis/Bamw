import { useMemo, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useRouter } from "@tanstack/react-router";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  Bell,
  BellRing,
  Calendar,
  ChevronLeft,
  Clock,
  Gamepad2,
  HardDrive,
  Heart,
  Languages,
  Play,
  Shapes,
  Share2,
  ShoppingBag,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { useHub } from "./hubContext";
import type { Game } from "@/hub/types";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { useNotifications } from "@/hub/context/NotificationContext";
import { PLATFORM_META } from "@/hub/ui/Icons";
import { SmartImage } from "@/hub/ui/Bits";
import { formatBytes, formatDate, formatRange } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import { ShareAndEarnButton } from "@/components/referral/ShareAndEarnButton";
import NintendoCover from "@/components/NintendoCover";
import { isAwaitingRelease } from "@/lib/release";
import { readOffers } from "@/lib/hub";
import { playSound } from "@/hub/utils/audio";
import { cdnImage } from "@/lib/img";

/**
 * The game page's first screen, made of the shop's own clay.
 *
 * It used to be a cinematic black stage built around a 3D case: a dark wash
 * that ignored the member's theme, the price seamed into the art, and the ways
 * to buy the game three screens further down under a region filter. Now the
 * page opens on the picture the member just tapped — the square card art, in a
 * frame of clay — with the game's own key art as a soft wash behind it that
 * fades into the page, in whichever theme they chose. Beside it: the name,
 * what it runs on, and a purchase card that lists every way to buy it with its
 * price before a single tap.
 *
 * The buy sheet stays the one place a purchase is configured; this card shows
 * the choices and opens it.
 */
export function Hero() {
  const { t } = useI18n();
  const { formatConverted } = useCurrency();
  const { addNotification } = useNotifications();
  const router = useRouter();
  const {
    game,
    ranked,
    bestOffer,
    isWishlisted,
    toggleWishlist,
    openBuy,
    openAlert,
    openVideo,
    openLightbox,
    priceVerdict,
  } = useHub();

  const raw = useMemo(() => (game.rawProduct ?? {}) as Record<string, unknown>, [game.rawProduct]);
  const awaitingRelease = isAwaitingRelease(raw);

  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  // The wash drifts a little slower than the page; the art and the type do not.
  const washY = useTransform(scrollY, [0, 600], [0, 80]);

  const legacyGallery = (game as any).gallery as string[] | undefined;
  const images = useMemo(() => {
    if (game.images?.length) return game.images;
    return (legacyGallery || []).map((url: string, id: number) => ({
      id: `gal-${id}`,
      url,
      thumbUrl: url,
    }));
  }, [game.images, legacyGallery]);

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
    The wash behind the hero is the Cover Image role: wide, composition-friendly
    key art meant to be blurred. The Front Box Cover is deliberately absent from
    this chain — it is a tall, tightly-cropped photograph of a box, and stretched
    across a landscape header it looked like a mistake rather than a design.
  */
  const backdropUrl =
    (thumbIndex !== null ? images[thumbIndex]?.url : undefined) ??
    game.detailCoverUrl ??
    bannerUrl ??
    game.keyArtUrl;

  /*
    The ways to buy this game, cheapest first, named the way the shop names
    them. The hub's ranked offers carry the price in the member's currency; the
    shop's own reading of the product carries the label and the delivery note,
    and the two share an order (`<kind>-<index>`), so each row is matched to its
    own label rather than guessed from its format.
  */
  const purchaseOptions = useMemo(() => {
    const local = readOffers(raw);
    return ranked
      .filter((entry) => entry.offer.firstParty)
      .map((entry) => {
        const index = Number(entry.offer.id.split("-").pop());
        const source = Number.isInteger(index) ? local[index] : undefined;
        return {
          id: entry.offer.id,
          label: source?.label ?? entry.offer.storeName,
          meta: source?.meta,
          price: entry.offer.price,
          listPrice: entry.offer.listPrice,
          available:
            entry.offer.availability !== "out-of-stock" && entry.offer.availability !== "delisted",
        };
      });
  }, [raw, ranked]);

  const stats = buildQuickStats(game, t);
  const platforms = game.platforms
    .filter((p) => PLATFORM_META[p])
    .sort((a, b) => nintendoRank(a) - nintendoRank(b));

  const goBack = () => {
    playSound("select");
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/" });
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: game.title, url });
        return;
      } catch {
        // Sheet dismissed — fall through to the clipboard path.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      addNotification({ title: t("common.linkCopied"), type: "success" });
    } catch {
      addNotification({ title: t("common.error"), type: "warning" });
    }
  };

  return (
    <header className="relative isolate overflow-hidden">
      {/*
        ---- The wash: the game's own art, blurred, fading into the page ----
        Faded by a mask on the art itself, not by a band of page colour laid
        over it: the page behind is the lit canvas, and a flat band of its base
        colour drew a visible line where the wash ended.
      */}
      <motion.div
        aria-hidden
        {...(reduceMotion ? {} : { style: { y: washY } })}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] overflow-hidden sm:h-[34rem]"
      >
        {backdropUrl ? (
          <img
            src={cdnImage(backdropUrl)}
            alt=""
            style={WASH_MASK}
            className="h-full w-full scale-125 object-cover opacity-50 blur-3xl saturate-150 transition-opacity duration-700 dark:opacity-35"
          />
        ) : null}
      </motion.div>

      {/* ---- The page's own controls: back, share, keep ---- */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] lg:px-6">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("common.back")}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/80 text-foreground shadow-sm backdrop-blur-xl"
        >
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void share()}
            aria-label={t("common.share")}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/80 text-foreground shadow-sm backdrop-blur-xl"
          >
            <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleWishlist}
            aria-pressed={isWishlisted}
            aria-label={isWishlisted ? t("hero.inWishlist") : t("hero.addToWishlist")}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border border-[var(--clay-rim)] bg-card/80 shadow-sm backdrop-blur-xl",
              isWishlisted ? "text-nin" : "text-foreground",
            )}
          >
            <Heart className={cn("h-[18px] w-[18px]", isWishlisted && "fill-current")} />
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-4 pt-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10 lg:px-6 lg:pb-8 lg:pt-6">
        {/* ================= The game ================= */}
        <div className="min-w-0 lg:flex lg:items-start lg:gap-8">
          <div className="mx-auto w-[min(66vw,272px)] shrink-0 lg:mx-0 lg:w-[296px]">
            {/* The card art, in a frame of clay: the same picture the member tapped. */}
            <button
              type="button"
              onClick={() => images[0] && openLightbox(images[0].id)}
              aria-label={game.title}
              className="block w-full rounded-[30px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-xl"
            >
              <span className="relative block aspect-square w-full overflow-hidden rounded-[24px] bg-muted/40">
                <NintendoCover
                  product={raw}
                  usage="square-card"
                  ratio={null}
                  fit="cover"
                  alt={game.title}
                  loading="eager"
                  fetchPriority="high"
                  className="h-full w-full"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
                />
              </span>
            </button>

            {/* Trailer and stills, secondary to the art. */}
            {trailer || images.length > 0 ? (
              <div className="mt-3 flex items-center justify-center gap-2 lg:justify-start">
                {trailer ? (
                  <button
                    type="button"
                    onClick={() => {
                      playSound("confirm");
                      openVideo(trailer);
                    }}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--clay-rim)] bg-card pe-3.5 ps-1.5 text-[12px] font-bold text-foreground shadow-sm"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-nin text-white">
                      <Play className="ms-px h-3 w-3 fill-current" aria-hidden="true" />
                    </span>
                    {t("hero.watchTrailer")}
                  </button>
                ) : null}
                {images.slice(0, trailer ? 3 : 4).map((image: any, index: number) => (
                  <button
                    type="button"
                    key={`${image.id || image.url}-${index}`}
                    onMouseEnter={() => setThumbIndex(index)}
                    onFocus={() => setThumbIndex(index)}
                    onClick={() => openLightbox(image.id)}
                    aria-label={image.alt || t("hero.gallery")}
                    className={cn(
                      "h-10 w-12 shrink-0 overflow-hidden rounded-[12px] border border-[var(--clay-rim)] shadow-sm transition-opacity duration-300",
                      index === thumbIndex ? "opacity-100" : "opacity-75 hover:opacity-100",
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
            ) : null}
          </div>

          <div className="mt-5 min-w-0 text-center lg:mt-1 lg:text-start">
            <h1
              dir="auto"
              className="text-[26px] font-black leading-[1.08] tracking-[-0.025em] text-balance text-foreground sm:text-[34px]"
            >
              {game.title}
            </h1>
            {game.subtitle ? (
              <p className="mt-1 text-[16px] font-bold text-nin sm:text-[18px]">{game.subtitle}</p>
            ) : null}

            {game.developer || game.publisher ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                {[
                  game.developer?.name,
                  game.publisher && game.publisher.id !== game.developer?.id
                    ? game.publisher.name
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}

            {/* What it runs on, how it ships, and what it scored. */}
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
              {platforms.map((platform, platIdx) => {
                const meta = PLATFORM_META[platform];
                const { Icon } = meta;
                return (
                  <span
                    key={`${platform}-${platIdx}`}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-bold",
                      meta.nintendo ? "bg-nin text-white" : "bg-muted/70 text-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {meta.short}
                  </span>
                );
              })}
              {game.criticScore?.metacritic != null ? (
                <span className="inline-flex h-7 items-center gap-1 rounded-full bg-muted/70 px-2.5 text-[11.5px] font-bold text-foreground">
                  <Trophy className="h-3 w-3 text-warn" aria-hidden="true" />
                  <span className="tabular-nums">{game.criticScore.metacritic}</span>
                  <span className="text-muted-foreground">{t("hero.metacritic")}</span>
                </span>
              ) : null}
              {game.userScore != null ? (
                <span className="inline-flex h-7 items-center gap-1 rounded-full bg-muted/70 px-2.5 text-[11.5px] font-bold text-foreground">
                  <Star className="h-3 w-3 fill-warn text-warn" aria-hidden="true" />
                  <span className="tabular-nums">{game.userScore.toFixed(1)}</span>
                </span>
              ) : null}
              {game.ageRating ? (
                <span
                  dir="ltr"
                  title={`${game.ageRating.system} ${game.ageRating.label}`}
                  className="inline-flex h-7 max-w-full items-center truncate rounded-full border border-border px-2.5 text-[11px] font-extrabold text-foreground"
                >
                  {game.ageRating.system} {game.ageRating.label}
                </span>
              ) : null}
            </div>

            {game.tagline ? (
              <p className="mx-auto mt-3.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground lg:mx-0">
                {game.tagline}
              </p>
            ) : null}
          </div>
        </div>

        {/* ================= The purchase card ================= */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[28px] border border-[var(--clay-rim)] bg-card p-4 shadow-lg sm:p-5">
            {bestOffer ? (
              <div>
                <p className="text-[12px] font-bold text-muted-foreground">
                  {purchaseOptions.length > 1 ? t("hero.from") : t("hero.bestPrice")}
                </p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="num text-[32px] font-black leading-none tracking-[-0.03em] text-foreground">
                    {formatConverted(bestOffer.offer.price)}
                  </span>
                  {bestOffer.offer.listPrice &&
                  bestOffer.offer.listPrice.amount > bestOffer.offer.price.amount ? (
                    <span className="num text-[14px] font-semibold text-muted-foreground line-through">
                      {formatConverted(bestOffer.offer.listPrice)}
                    </span>
                  ) : null}
                  {bestOffer.offer.discountPercent != null ? (
                    <span className="num rounded-full bg-good/15 px-2 py-0.5 text-[12px] font-extrabold text-good">
                      −{bestOffer.offer.discountPercent}%
                    </span>
                  ) : null}
                </div>
                {priceVerdict ? (
                  <p
                    className={cn(
                      "mt-1.5 text-[12px] font-bold",
                      priceVerdict.id === "wait" ? "text-warn" : "text-good",
                    )}
                  >
                    {t(`history.verdict${capitalise(priceVerdict.id)}` as never)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[14px] text-muted-foreground">{t("prices.noOffers")}</p>
            )}

            {purchaseOptions.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-bold text-muted-foreground">
                  {t("hero.waysToBuy")}
                </p>
                <ul className="divide-y divide-border/70 overflow-hidden rounded-[20px] bg-muted/50">
                  {purchaseOptions.map((option) => (
                    <li
                      key={option.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-bold text-foreground">
                          {option.label}
                        </p>
                        {option.meta ? (
                          <p className="truncate text-[12px] text-muted-foreground">
                            {option.meta}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="num text-[14px] font-black text-foreground">
                          {formatConverted(option.price)}
                        </p>
                        {option.listPrice && option.listPrice.amount > option.price.amount ? (
                          <p className="num text-[11px] text-muted-foreground line-through">
                            {formatConverted(option.listPrice)}
                          </p>
                        ) : null}
                        {!option.available ? (
                          <p className="text-[11px] font-bold text-muted-foreground">
                            {t("hero.outOfStock")}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              type="button"
              id="hero-buy-button"
              onClick={() => {
                playSound("confirm");
                openBuy();
              }}
              className="btn btn-primary mt-4 h-[52px] w-full rounded-[18px] text-[15px]"
            >
              {/*
                Before launch this opens the release panel rather than the
                purchase sheet, so it must not promise a sale. `openBuy` itself
                is what enforces that; this only tells the truth about what the
                tap will do.
              */}
              {awaitingRelease ? (
                <>
                  <BellRing className="h-4 w-4" aria-hidden="true" />
                  {t("hero.preorder")}
                </>
              ) : (
                <>
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  {t("hero.buyNow")}
                </>
              )}
            </button>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={toggleWishlist}
                aria-pressed={isWishlisted}
                className={cn(
                  "flex h-11 items-center justify-center gap-1.5 rounded-[16px] border border-[var(--clay-rim)] bg-card text-[12.5px] font-bold shadow-sm",
                  isWishlisted ? "text-nin" : "text-foreground",
                )}
              >
                <Heart
                  className={cn("h-4 w-4", isWishlisted && "fill-current")}
                  aria-hidden="true"
                />
                {isWishlisted ? t("hero.inWishlist") : t("hero.addToWishlist")}
              </button>
              <button
                type="button"
                onClick={openAlert}
                className="flex h-11 items-center justify-center gap-1.5 rounded-[16px] border border-[var(--clay-rim)] bg-card text-[12.5px] font-bold text-foreground shadow-sm"
              >
                <Bell className="h-4 w-4 text-warn" aria-hidden="true" />
                {t("hero.trackPrice")}
              </button>
            </div>

            {/*
              Share and earn — دعوة صديق. The card's quiet control: it carries a
              number worth reading, so it is a chip, not a third button.
            */}
            <div className="mt-3 flex justify-center">
              <ShareAndEarnButton product={raw} />
            </div>
          </div>
        </aside>
      </div>

      {/* ---- The facts, one glance: a strip of pressed tiles ---- */}
      {stats.length > 0 ? (
        <div className="mx-auto max-w-6xl px-4 pb-2 lg:px-6">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0">
            {stats.map((stat, statIdx) => (
              <div
                key={`${stat.label}-${statIdx}`}
                className="flex min-w-[8.5rem] shrink-0 flex-col gap-1 rounded-[18px] bg-muted/50 px-3.5 py-3 lg:min-w-0"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                  <stat.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{stat.label}</span>
                </span>
                <span
                  dir="auto"
                  title={stat.value}
                  className="truncate text-[14px] font-black text-foreground"
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </header>
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

/** Fades the wash out downwards, so the canvas behind it shows through. */
const WASH_MASK = {
  maskImage: "linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 0.55) 45%, transparent 92%)",
  WebkitMaskImage: "linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 0.55) 45%, transparent 92%)",
} as const;

const nintendoRank = (platform: string) =>
  platform === "switch2" ? 0 : platform === "switch" ? 1 : 2;
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
