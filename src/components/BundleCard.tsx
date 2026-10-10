import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, KeyRound, Layers, ShoppingCart, Sparkles } from "lucide-react";
import type { AccountBundle, Product } from "@/lib/types";
import {
  bundleAccountOptions,
  getBundleGames,
  getBundleSavings,
  getAccountTypeInfo,
  resolveBundleUnitPrice,
} from "@/lib/bundles";
import { useCurrency } from "@/context/CurrencyContext";
import { playSound } from "@/utils/audio";
import { useCartStore } from "@/store/useCartStore";
import { useQueryClient } from "@tanstack/react-query";
import { addToCart as addToCartFn } from "@/lib/cart.functions";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { showAddToCartToast } from "@/utils/cart-toast";
import NintendoCover from "@/components/NintendoCover";
import { resolvePurchaseImage } from "@/lib/nintendoImages";

interface BundleCardProps {
  bundle: AccountBundle;
  products: Product[];
  layout?: "compact" | "grid" | "featured";
  onSelect?: () => void;
}

/*
  The card is one piece of clay: raised off the page, the games' art inset in
  its own rounded window, and the price pressed into a tray at its foot with the
  button standing up out of it. The whole piece opens the bundle; the title is
  the real button behind that, so a keyboard reaches it, and the card draws the
  focus ring when it does. Pressing squashes the piece, unless the press is on
  the cart button inside it.
*/
const CARD_MOTION =
  "clay-press transition-[box-shadow,translate,scale] duration-300 ease-[var(--clay-ease)] hover:-translate-y-0.5 active:duration-75 has-[[data-card-cart]:active]:scale-100 has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-[var(--brand-red)]/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/* Art grows a little on hover, never when motion is reduced. */
const ART_HOVER =
  "transition-transform duration-500 ease-[var(--clay-ease)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100";

/* A hairline inside the window, so bright artwork keeps its edge. */
const ART_HAIRLINE =
  "pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]";

/* A small raised chip laid over the artwork. */
const ART_CHIP =
  "inline-flex h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--clay-rim)] bg-card/90 px-2.5 text-[11.5px] font-bold text-foreground shadow-sm backdrop-blur-md";

/* The saving, in the shop's green, shaded like a filled button. */
const SAVING_CHIP =
  "clay-btn inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full bg-emerald-600 px-2.5 text-[11.5px] font-black text-white";

const gameName = (game: Product) =>
  String(game.titleEn || (game as any).english_name || game.title || "");

export function BundleCard({ bundle, products, layout = "grid", onSelect }: BundleCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formatGenericPrice } = useCurrency();
  const addLocalCart = useCartStore((state) => state.add);
  const addToCartServer = useServerFn(addToCartFn);

  const games = getBundleGames(bundle, products);

  /*
    The option this card stands for, and its price.

    A card has no room for a picker, so pressing «أضف للسلة» has to choose one
    — the cheapest, which is the one the listed price belongs to. The catch is
    that nothing makes the cheapest option free: the admin can give every
    option a surcharge in two keystrokes. When that happens the card was
    printing the bundle's base while adding, and charging, base + surcharge —
    the card and the detail page disagreeing about the same purchase.

    So the number shown and the number added come from the same call. Read
    once here, used by the price, the saving and the button alike.
  */
  const cheapestOption = [...bundleAccountOptions(bundle)].sort(
    (a, b) => (Number(a.extraPrice) || 0) - (Number(b.extraPrice) || 0),
  )[0];
  const cardOptionId = cheapestOption ? String(cheapestOption.id) : "";
  const cardPrice = resolveBundleUnitPrice(bundle, { optionId: cardOptionId }).unitPrice;

  const { amount: savingsAmount, percentage: savingsPercent } = getBundleSavings(
    bundle,
    products,
    cardPrice,
  );
  const accountInfo = getAccountTypeInfo(cheapestOption?.kind ?? bundle.accountType);

  const [isAdding, setIsAdding] = React.useState(false);
  const [added, setAdded] = React.useState(false);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isAdding) return;

    setIsAdding(true);
    playSound("switch_click", 0.7);

    try {
      // Local store for fast instant UI update
      const bundleArt = resolvePurchaseImage(bundle as unknown as Record<string, unknown>);
      const bundleImage = bundleArt.isPlaceholder
        ? resolvePurchaseImage(games[0] as Record<string, unknown> | undefined).url
        : bundleArt.url;

      /*
        The cheapest way to buy it, picked for them.

        A bundle sold as several kinds of account has no picker on a card —
        there is no room for one and the card is a summary, not a checkout. So
        the card adds the option the listed price belongs to, which is the
        cheapest; the detail page is where the more expensive one is chosen.
        Without an id the till would price the base and the cart would merge
        two different accounts into one line.
      */
      const optionId = cardOptionId;
      const unitPrice = cardPrice;

      addLocalCart({
        productId: bundle.id,
        title: bundle.titleEn || bundle.title,
        image: bundleImage,
        price: unitPrice,
        kind: "bundle",
        requiresAddress: false,
        ...(optionId ? { optionId } : {}),
      });

      if (user) {
        await addToCartServer({
          data: {
            productId: String(bundle.id),
            quantity: 1,
            options: { bundleGameIds: bundle.gameIds, optionId },
          },
        });
        queryClient.invalidateQueries({ queryKey: ["cart"] });
      }

      setAdded(true);
      showAddToCartToast({
        title: "أُضيف إلى السلة",
        message: bundle.titleEn || bundle.title,
        product: (bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>,
        navigate,
        playSoundEffect: false,
      });
      setTimeout(() => setAdded(false), 2000);
    } catch (err) {
      toast.error("حدث خطأ أثناء الإضافة للسلة");
    } finally {
      setIsAdding(false);
    }
  };

  const handleCardClick = () => {
    playSound("hover_s", 0.8);
    if (onSelect) {
      onSelect();
    } else {
      void navigate({ to: "/bundles/$bundleId", params: { bundleId: bundle.id } });
    }
  };

  const title = bundle.titleEn || bundle.title;
  const gameCount = games.length || bundle.gameIds.length;
  const originalPrice = Number(bundle.originalPrice) || 0;
  const showOriginal = originalPrice > cardPrice;
  const gameNames = games.map(gameName).filter(Boolean);

  /*
    The title is the card's real control. It has no handler of its own: its
    click bubbles to the card, which is what opens the bundle — so a tap on the
    art, a tap on the title and Enter on the focused title all take one path.
  */
  const openButton = (clampClass: string) => (
    <button
      type="button"
      data-card-open=""
      className="block w-full cursor-pointer text-start outline-none"
    >
      <span dir="auto" className={`${clampClass} rtl:text-right`}>
        {title}
      </span>
    </button>
  );

  if (layout === "compact") {
    /*
      The compact card is the bundle shown on the home page. Its artwork is
      chosen by the admin, so that image takes precedence over the generated
      game collage. The collage remains the fallback for older bundles that
      do not have their own usable image yet.
    */
    const hasBundleArtwork = !resolvePurchaseImage(bundle as unknown as Record<string, unknown>)
      .isPlaceholder;

    return (
      <div
        onClick={handleCardClick}
        className={`group relative flex h-full w-[224px] shrink-0 cursor-pointer flex-col rounded-[22px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-sm hover:shadow-md sm:w-[256px] ${CARD_MOTION}`}
      >
        {/* Admin-selected cover, with the existing game collage as fallback */}
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[16px] bg-muted/40">
          {hasBundleArtwork ? (
            <NintendoCover
              product={bundle as unknown as Record<string, unknown>}
              usage="bundle-card"
              ratio={null}
              fit="cover"
              alt={String(title || "")}
              className="h-full w-full"
              imgClassName={ART_HOVER}
            />
          ) : games.length >= 2 ? (
            <div className="absolute inset-0 flex gap-[3px] bg-card">
              {games.slice(0, 3).map((g, idx) => (
                <div key={g.id || idx} className="relative h-full min-w-0 flex-1 overflow-hidden">
                  <NintendoCover
                    product={g as Record<string, unknown>}
                    usage="bundle-card"
                    ratio={null}
                    fit="cover"
                    alt={gameName(g)}
                    className="h-full w-full"
                    imgClassName={ART_HOVER}
                  />
                </div>
              ))}
            </div>
          ) : (
            <NintendoCover
              product={games[0] as unknown as Record<string, unknown>}
              usage="bundle-card"
              ratio={null}
              fit="cover"
              alt={String(title || "")}
              className="h-full w-full"
              imgClassName={ART_HOVER}
            />
          )}
          <span aria-hidden="true" className={ART_HAIRLINE} />

          <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-1.5">
            <span className={ART_CHIP}>
              <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
              {gameCount} ألعاب
            </span>
            {savingsPercent > 0 ? (
              <span className={SAVING_CHIP}>توفير {savingsPercent}%</span>
            ) : null}
          </div>
        </div>

        {/* What it is */}
        <div className="flex min-w-0 flex-col px-1.5 pb-2.5 pt-2.5">
          {bundle.badge ? (
            <p className="mb-0.5 truncate text-[11px] font-bold text-[var(--brand-red)]">
              {bundle.badge}
            </p>
          ) : null}
          <h3 className="text-[14px] font-black leading-snug tracking-[-0.01em] text-foreground">
            {openButton("block truncate")}
          </h3>
          {gameNames.length > 0 || bundle.description ? (
            <p
              dir="auto"
              className="mt-0.5 truncate text-[11.5px] text-muted-foreground rtl:text-right"
            >
              {gameNames.length > 0 ? gameNames.join(" · ") : bundle.description}
            </p>
          ) : null}
        </div>

        {/* What it costs, pressed into the foot of the card */}
        <div className="mt-auto flex items-center justify-between gap-2 rounded-[16px] bg-muted/50 py-1.5 pe-1.5 ps-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span
                dir="ltr"
                className="text-[15px] font-black leading-tight tracking-[-0.01em] tabular-nums text-foreground"
              >
                {formatGenericPrice(cardPrice)}
              </span>
              {showOriginal ? (
                <span
                  dir="ltr"
                  className="text-[10.5px] font-semibold tabular-nums text-muted-foreground line-through"
                >
                  {formatGenericPrice(originalPrice)}
                </span>
              ) : null}
            </p>
            <p className="truncate text-[11px] font-bold text-muted-foreground">
              {accountInfo.label}
            </p>
          </div>

          <button
            type="button"
            data-card-cart=""
            onClick={handleAddToCart}
            disabled={isAdding}
            aria-label={added ? "تمت الإضافة إلى السلة" : "أضف إلى السلة"}
            title={added ? "تمت الإضافة إلى السلة" : "أضف إلى السلة"}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 disabled:opacity-70 ${
              added ? "bg-emerald-600 text-white" : "bg-[var(--brand-red)] text-primary-foreground"
            }`}
          >
            {added ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    );
  }

  // Grid layout (for /bundles page)
  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex h-full min-w-0 cursor-pointer flex-col rounded-[22px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-md hover:shadow-xl ${CARD_MOTION}`}
    >
      {/* The games, inset in their own window */}
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[16px] bg-muted/40">
        {games.length >= 2 ? (
          <div className="absolute inset-0 flex gap-[3px] bg-card">
            {games.slice(0, 3).map((g, idx) => (
              <div key={g.id || idx} className="relative h-full min-w-0 flex-1 overflow-hidden">
                <NintendoCover
                  product={g as Record<string, unknown>}
                  usage="bundle-card"
                  ratio={null}
                  fit="cover"
                  alt={gameName(g)}
                  className="h-full w-full"
                  imgClassName={ART_HOVER}
                />
              </div>
            ))}
          </div>
        ) : (
          <NintendoCover
            product={(bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>}
            usage="bundle-card"
            ratio={null}
            fit="cover"
            alt={String(title || "")}
            className="h-full w-full"
            imgClassName={ART_HOVER}
          />
        )}
        <span aria-hidden="true" className={ART_HAIRLINE} />

        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <span className={ART_CHIP}>
            <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {gameCount} ألعاب في حساب واحد
          </span>
          {savingsPercent > 0 ? <span className={SAVING_CHIP}>توفير {savingsPercent}%</span> : null}
        </div>
      </div>

      {/* What it is */}
      <div className="flex min-w-0 flex-col px-2.5 pb-3.5 pt-3 sm:px-3">
        {bundle.badge ? (
          <p className="mb-1 flex min-w-0 items-center gap-1 text-[12px] font-bold text-[var(--brand-red)]">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{bundle.badge}</span>
          </p>
        ) : null}
        <h3 className="text-[18px] font-black leading-snug tracking-[-0.02em] text-foreground">
          {openButton("line-clamp-2")}
        </h3>
        {bundle.description ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {bundle.description}
          </p>
        ) : null}
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{accountInfo.label}</span>
        </p>

        {gameNames.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="الألعاب في الحزمة">
            {games.map((g, idx) => (
              <li
                key={g.id || idx}
                dir="auto"
                className="max-w-full truncate rounded-full bg-muted/60 px-2.5 py-1 text-[11.5px] font-semibold text-foreground/80"
              >
                {gameName(g)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* What it costs, pressed into the foot of the card */}
      <div className="mt-auto flex items-center justify-between gap-3 rounded-[16px] bg-muted/50 py-1.5 pe-1.5 ps-3.5">
        <div className="min-w-0 py-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              dir="ltr"
              className="text-[20px] font-black leading-none tracking-[-0.02em] tabular-nums text-foreground"
            >
              {formatGenericPrice(cardPrice)}
            </span>
            {showOriginal ? (
              <span
                dir="ltr"
                className="text-[12px] font-semibold tabular-nums text-muted-foreground line-through"
              >
                {formatGenericPrice(originalPrice)}
              </span>
            ) : null}
          </p>
          {savingsAmount > 0 ? (
            <p className="mt-1 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
              توفير{" "}
              <span dir="ltr" className="tabular-nums">
                {formatGenericPrice(savingsAmount)}
              </span>
            </p>
          ) : null}
        </div>

        <button
          type="button"
          data-card-cart=""
          onClick={handleAddToCart}
          disabled={isAdding}
          className={`flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] px-4 text-[13px] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 disabled:opacity-70 ${
            added ? "bg-emerald-600 text-white" : "bg-[var(--brand-red)] text-primary-foreground"
          }`}
        >
          {added ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              تمت الإضافة
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              أضف للسلة
            </>
          )}
        </button>
      </div>
    </div>
  );
}
