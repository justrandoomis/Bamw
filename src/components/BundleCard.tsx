import React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Layers, ShoppingCart, Sparkles, ShieldCheck, Check, ArrowRight } from "lucide-react";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export function BundleCard({ bundle, products, layout = "grid", onSelect }: BundleCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formatGenericPrice } = useCurrency();
  const addLocalCart = useCartStore((state) => state.add);
  const addToCartServer = useServerFn(addToCartFn);

  const games = getBundleGames(bundle, products);
  const { amount: savingsAmount, percentage: savingsPercent } = getBundleSavings(bundle, products);
  const accountInfo = getAccountTypeInfo(bundle.accountType);

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
      const cheapest = [...bundleAccountOptions(bundle)].sort(
        (a, b) => (Number(a.extraPrice) || 0) - (Number(b.extraPrice) || 0),
      )[0];
      const optionId = cheapest ? String(cheapest.id) : "";
      const unitPrice = resolveBundleUnitPrice(bundle, { optionId }).unitPrice;

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

  if (layout === "compact") {
    return (
      <motion.div
        whileHover={{ y: -3, transition: { duration: 0.18 } }}
        whileTap={{ scale: 0.98 }}
        onClick={handleCardClick}
        className="w-[200px] sm:w-[230px] md:w-[250px] shrink-0 bg-[var(--card)] rounded-2xl p-2.5 sm:p-3 border border-border/80 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
      >
        {/* Top badges */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
            <Layers className="w-2.5 h-2.5" />
            {games.length || bundle.gameIds.length} ألعاب
          </span>

          {savingsPercent > 0 && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-2xs">
              توفير {savingsPercent}%
            </span>
          )}
        </div>

        {/* Visual Game Collage / Cover */}
        <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-slate-900 mb-2 border border-border/40 group-hover:border-red-500/30 transition-colors">
          {games.length >= 2 ? (
            <div className="absolute inset-0 flex">
              {games.slice(0, 3).map((g, idx) => (
                <div
                  key={g.id || idx}
                  className="h-full flex-1 relative overflow-hidden border-r border-black/30 last:border-r-0 transform group-hover:scale-105 transition-transform duration-300"
                  style={{ transitionDelay: `${idx * 40}ms` }}
                >
                  <NintendoCover
                    product={g as Record<string, unknown>}
                    usage="bundle-card"
                    ratio={null}
                    fit="cover"
                    alt={String(g.titleEn || (g as any).english_name || g.title || "")}
                    className="w-full h-full"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                </div>
              ))}
            </div>
          ) : (
            <NintendoCover
              product={(bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>}
              usage="bundle-card"
              ratio={null}
              fit="cover"
              alt={String(bundle.titleEn || bundle.title || "")}
              className="w-full h-full"
              imgClassName="group-hover:scale-105 transition-transform duration-300"
            />
          )}

          <div className="absolute bottom-1.5 right-1.5 left-1.5 flex items-center justify-between text-white drop-shadow-xs">
            <span className="text-[9px] font-medium bg-black/60 backdrop-blur-xs px-1.5 py-0.5 rounded border border-white/10">
              {accountInfo.label}
            </span>
            {bundle.badge && (
              <span className="text-[9px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded">
                {bundle.badge}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-1.5 flex-1 flex flex-col justify-between">
          <div>
            <h4
              className="font-bold text-xs sm:text-sm text-foreground line-clamp-1 group-hover:text-red-500 transition-colors"
              dir="ltr"
            >
              {bundle.titleEn || bundle.title}
            </h4>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {games.map((g) => g.titleEn || g.english_name || g.title).join(" • ") ||
                bundle.description}
            </p>
          </div>

          <div className="pt-2 border-t border-border/50 flex items-center justify-between mt-auto">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-extrabold text-sm sm:text-base text-foreground">
                  {formatGenericPrice(bundle.price)}
                </span>
                {bundle.originalPrice && bundle.originalPrice > bundle.price && (
                  <span className="text-[10px] sm:text-xs line-through text-muted-foreground">
                    {formatGenericPrice(bundle.originalPrice)}
                  </span>
                )}
              </div>
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold block">
                تسليم فوري
              </span>
            </div>

            <button
              onClick={handleAddToCart}
              disabled={isAdding}
              className={`p-2 rounded-lg transition-all flex items-center justify-center ${
                added
                  ? "bg-emerald-500 text-white"
                  : "bg-red-500 hover:bg-red-600 text-white shadow-2xs hover:shadow-xs"
              }`}
              title="إضافة للسلة"
            >
              {added ? <Check className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Grid layout (for /bundles page)
  return (
    <motion.div
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      className="bg-[var(--card)] rounded-3xl p-4 sm:p-5 border border-border shadow-sm hover:shadow-2xl transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
      onClick={handleCardClick}
    >
      {/* Background Accent Glow */}
      <div className="absolute -right-20 -top-20 w-48 h-48 bg-red-500/5 rounded-full blur-3xl pointer-events-none group-hover:bg-red-500/10 transition-colors" />

      {/* Header Badges */}
      <div className="flex items-center justify-between gap-2 mb-3 z-10">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 border border-red-500/20">
            <Layers className="w-3.5 h-3.5" />
            {games.length || bundle.gameIds.length} ألعاب في حساب واحد
          </span>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${accountInfo.color}`}
          >
            {accountInfo.label}
          </span>
        </div>

        {savingsPercent > 0 && (
          <span className="text-xs font-black px-2.5 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-xs">
            توفير {savingsPercent}%
          </span>
        )}
      </div>

      {/* Main Image Collage */}
      <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden bg-slate-950 mb-4 border border-border/60 group-hover:border-red-500/30 transition-colors shadow-inner">
        {games.length >= 2 ? (
          <div className="absolute inset-0 flex">
            {games.slice(0, 3).map((g, idx) => (
              <div
                key={g.id || idx}
                className="h-full flex-1 relative overflow-hidden border-r border-black/50 last:border-r-0 group-hover:scale-105 transition-transform duration-700"
                style={{ transitionDelay: `${idx * 75}ms` }}
              >
                <NintendoCover
                  product={g as Record<string, unknown>}
                  usage="bundle-card"
                  ratio={null}
                  fit="cover"
                  alt={String(g.titleEn || (g as any).english_name || g.title || "")}
                  className="w-full h-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-2 inset-x-1 text-center">
                  <span className="text-[10px] font-bold text-white/90 line-clamp-1 drop-shadow-sm px-1">
                    {String(g.titleEn || (g as any).english_name || g.title || "")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <NintendoCover
            product={(bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>}
            usage="bundle-card"
            ratio={null}
            fit="cover"
            alt={String(bundle.titleEn || bundle.title || "")}
            className="w-full h-full"
            imgClassName="group-hover:scale-105 transition-transform duration-700"
          />
        )}

        {bundle.badge && (
          <div className="absolute top-2.5 right-2.5">
            <span className="text-[11px] font-bold bg-amber-500 text-slate-950 px-2.5 py-1 rounded-lg shadow-md flex items-center gap-1">
              <Sparkles className="w-3 h-3 fill-current" />
              {bundle.badge}
            </span>
          </div>
        )}
      </div>

      {/* Title and Included Games List */}
      <div className="space-y-3 flex-1 flex flex-col justify-between z-10">
        <div>
          <h3
            className="font-extrabold text-base sm:text-lg text-foreground group-hover:text-red-500 transition-colors"
            dir="ltr"
          >
            {bundle.titleEn || bundle.title}
          </h3>
          {bundle.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
              {bundle.description}
            </p>
          )}

          {/* Mini Included Games Preview */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {games.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1 text-[11px] font-medium bg-muted/50 hover:bg-muted text-foreground/80 px-2 py-0.5 rounded-md border border-border/40"
              >
                🎮 {String(g.titleEn || (g as any).english_name || g.title || "")}
              </span>
            ))}
          </div>
        </div>

        {/* Pricing and Action Buttons */}
        <div className="pt-3.5 border-t border-border/80 flex items-center justify-between gap-3 mt-auto">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-black text-lg sm:text-xl text-foreground">
                {formatGenericPrice(bundle.price)}
              </span>
              {bundle.originalPrice && bundle.originalPrice > bundle.price && (
                <span className="text-xs line-through text-muted-foreground">
                  {formatGenericPrice(bundle.originalPrice)}
                </span>
              )}
            </div>
            {savingsAmount > 0 && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold block">
                توفير {formatGenericPrice(savingsAmount)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAddToCart}
              disabled={isAdding}
              className={`px-3.5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                added
                  ? "bg-emerald-500 text-white"
                  : "bg-red-500 hover:bg-red-600 text-white shadow-md hover:shadow-lg"
              }`}
            >
              {added ? (
                <>
                  <Check className="w-4 h-4" />
                  تمت الإضافة
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  أضف للسلة
                </>
              )}
            </button>

            <div className="p-2.5 rounded-xl bg-muted/60 text-muted-foreground group-hover:text-foreground group-hover:bg-muted transition-colors">
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
