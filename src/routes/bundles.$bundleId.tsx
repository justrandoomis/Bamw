import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Layers,
  Sparkles,
  ShieldCheck,
  Zap,
  ShoppingCart,
  Check,
  ChevronLeft,
  ArrowRight,
  ExternalLink,
  Wallet,
  Info,
  Flame,
  CheckCircle2,
  Gamepad2,
  Lock,
  Headphones,
} from "lucide-react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { AccountBundle, Product } from "@/lib/types";
import {
  getBundleGames,
  getBundleSavings,
  getAccountTypeInfo,
  getBundleOriginalTotal,
} from "@/lib/bundles";
import { useCurrency } from "@/context/CurrencyContext";
import { playSound } from "@/utils/audio";
import { useAuth } from "@/hooks/useAuth";
import { useCartStore } from "@/store/useCartStore";
import { useServerFn } from "@tanstack/react-start";
import { addToCart as addToCartFn } from "@/lib/cart.functions";
import { showAddToCartToast } from "@/utils/cart-toast";
import NintendoCover from "@/components/NintendoCover";

export const Route = createFileRoute("/bundles/$bundleId")({
  head: () => ({
    meta: [
      { title: "تفاصيل البندل — بنانا ستور" },
      {
        name: "description",
        content:
          "تفاصيل حزمة ألعاب ننتندو سويتش: الألعاب المتضمنة، التوفير، وطريقة التفعيل الفوري.",
      },
      { property: "og:title", content: "تفاصيل البندل — بنانا ستور" },
      {
        property: "og:description",
        content: "أكثر من لعبة في حساب واحد جاهز للتحميل والتسليم الفوري.",
      },
    ],
  }),
  component: BundleDetailPage,
});

function BundleDetailPage() {
  const { bundleId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formatGenericPrice } = useCurrency();
  const addLocalCart = useCartStore((state) => state.add);
  const addToCartServer = useServerFn(addToCartFn);

  const [isAdding, setIsAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const { data: store, isLoading } = useQuery({
    queryKey: ["store", "full"],
    queryFn: () => api.store(),
  });

  const products = (store?.products ?? []) as Product[];
  const bundles = (store?.bundles ?? []) as AccountBundle[];

  const bundle = useMemo(() => {
    return bundles.find((b) => String(b.id) === String(bundleId) || b.slug === bundleId);
  }, [bundles, bundleId]);

  const games = useMemo(() => {
    if (!bundle) return [];
    return getBundleGames(bundle, products);
  }, [bundle, products]);

  /*
    Games in this bundle that are not on the shelf yet.

    A title the description named and the shop did not carry was created as a
    hidden catalogue row with nothing but its name, for the admin to finish.
    Hidden means the public catalogue does not carry it, so it cannot resolve
    into a card — but the customer was still promised it, so it is listed by
    name. The moment the admin publishes the record it resolves like any other
    game and drops out of this list on its own.
  */
  const notYetListed = useMemo(() => {
    if (!bundle?.pendingGames?.length) return [];
    const resolved = new Set(games.map((g) => String(g.id)));
    return bundle.pendingGames.filter((p) => !resolved.has(String(p.id)));
  }, [bundle, games]);

  const savings = useMemo(() => {
    if (!bundle) return { amount: 0, percentage: 0 };
    return getBundleSavings(bundle, products);
  }, [bundle, products]);

  const originalTotal = useMemo(() => {
    if (!bundle) return 0;
    return getBundleOriginalTotal(bundle, products);
  }, [bundle, products]);

  const accountInfo = useMemo(() => {
    return getAccountTypeInfo(bundle?.accountType);
  }, [bundle?.accountType]);

  const handleAddToCart = async (directCheckout = false) => {
    if (!bundle || isAdding) return;

    setIsAdding(true);
    playSound("switch_click", 0.7);

    try {
      addLocalCart({
        productId: bundle.id,
        title: bundle.titleEn || bundle.title,
        image: bundle.image || games[0]?.image || "",
        price: bundle.price,
        kind: "bundle",
        requiresAddress: false,
      });

      if (user) {
        await addToCartServer({
          data: {
            productId: String(bundle.id),
            quantity: 1,
            options: { bundleGameIds: bundle.gameIds },
          },
        });
        queryClient.invalidateQueries({ queryKey: ["cart"] });
      }

      setAdded(true);
      if (directCheckout) {
        void navigate({ to: "/cart" });
      } else {
        showAddToCartToast({
          title: "أُضيف إلى السلة",
          message: bundle.titleEn || bundle.title,
          product: (bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>,
          navigate,
          playSoundEffect: false,
        });
        setTimeout(() => setAdded(false), 2500);
      }
    } catch (err) {
      toast.error("حدث خطأ أثناء الإضافة للسلة");
    } finally {
      setIsAdding(false);
    }
  };

  if (isLoading) {
    return (
      <AppShell currentView="store" onBack={() => navigate({ to: "/bundles" })}>
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
          <div className="h-8 w-48 bg-muted/30 rounded-xl animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 aspect-[16/9] bg-muted/20 rounded-3xl animate-pulse" />
            <div className="lg:col-span-5 space-y-4">
              <div className="h-10 bg-muted/20 rounded-xl animate-pulse" />
              <div className="h-24 bg-muted/20 rounded-2xl animate-pulse" />
              <div className="h-14 bg-muted/20 rounded-xl animate-pulse" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!bundle) {
    return (
      <AppShell currentView="store" onBack={() => navigate({ to: "/bundles" })}>
        <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-600 flex items-center justify-center mx-auto">
            <Layers className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-foreground">البندل غير متوفر</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            عذراً، لم يتم العثور على هذا البندل أو قد تم إيقافه من قبل الإدارة.
          </p>
          <Link
            to="/bundles"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            تصفح جميع البندلات
          </Link>
        </div>
      </AppShell>
    );
  }

  const walletBalance = user?.walletBalance ?? 0;
  const isBalanceSufficient = walletBalance >= bundle.price;

  return (
    <AppShell currentView="store" onBack={() => navigate({ to: "/bundles" })}>
      <div className="pb-20 bg-[var(--page)] min-h-screen">
        {/* Breadcrumb Header */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 pb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">
              الرئيسية
            </Link>
            <ChevronLeft className="w-3.5 h-3.5" />
            <Link to="/bundles" className="hover:text-foreground transition-colors">
              حزم الحسابات (Bundles)
            </Link>
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="text-foreground line-clamp-1">{bundle.titleEn || bundle.title}</span>
          </div>
        </div>

        {/* Main Product / Bundle Overview */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Visual Montage & Badge Highlights (7 cols on lg) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative rounded-3xl overflow-hidden bg-slate-950 border border-border shadow-xl aspect-[16/9]">
                {games.length >= 2 ? (
                  <div className="absolute inset-0 flex" dir="ltr">
                    {games.slice(0, 4).map((g, idx) => (
                      <div
                        key={g.id || idx}
                        className="h-full flex-1 relative overflow-hidden border-r border-black/60 last:border-r-0"
                      >
                        <NintendoCover
                          product={g as Record<string, unknown>}
                          usage="bundle-card"
                          ratio={null}
                          fit="cover"
                          alt={String(g.titleEn || (g as any).english_name || g.title || "")}
                          className="w-full h-full"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                        <div className="absolute bottom-3 inset-x-2 text-center">
                          <span className="text-xs font-black text-white line-clamp-1 drop-shadow-md px-1">
                            {String(g.titleEn || (g as any).english_name || g.title || "")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <NintendoCover
                    product={
                      (bundle.image ? bundle : games[0]) as unknown as Record<string, unknown>
                    }
                    usage="bundle-card"
                    ratio={null}
                    fit="cover"
                    alt={String(bundle.titleEn || bundle.title || "")}
                    className="w-full h-full"
                  />
                )}

                {/* Overlaid Badges */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  <span className="text-xs font-black px-3 py-1 rounded-full bg-red-600 text-white shadow-lg flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 fill-current" />
                    {games.length || bundle.gameIds.length} ألعاب بحساب واحد
                  </span>
                  {savings.percentage > 0 && (
                    <span className="text-xs font-black px-3 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg">
                      توفير {savings.percentage}%
                    </span>
                  )}
                </div>

                {bundle.badge && (
                  <div className="absolute top-3 left-3">
                    <span className="text-xs font-black bg-amber-500 text-black px-3 py-1 rounded-xl shadow-lg flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      {bundle.badge}
                    </span>
                  </div>
                )}
              </div>

              {/* Digital Product & Instant Delivery Notice */}
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 text-amber-950 dark:text-amber-200">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 shrink-0 mt-0.5">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm flex items-center gap-2">
                    <span>منتج رقمي وتسليم فوري (Digital Account)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/20 font-mono font-bold">
                      بدون عنوان شحن
                    </span>
                  </h4>
                  <p className="text-xs leading-relaxed opacity-90">
                    هذا المنتج عبارة عن حساب ننتندو سويتش رسمي يضم جميع الألعاب المذكورة. يتم الدفع
                    مباشرة عبر المحفظة واستلام بيانات الحساب وخطوات التفعيل في محادثة الطلب فوراً.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Title, Account Type, Pricing & Actions (5 cols on lg) */}
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs font-extrabold px-2.5 py-1 rounded-xl border ${accountInfo.color}`}
                  >
                    {accountInfo.label}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-muted text-muted-foreground">
                    Nintendo Switch eShop
                  </span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                  {bundle.titleEn || bundle.title}
                </h1>
                {/* If bundle.title and bundle.titleEn are identical, don't show it twice. Already handled by prefer-english above */}

                {bundle.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed pt-1">
                    {bundle.description}
                  </p>
                )}
              </div>

              {/* Price & Savings Box */}
              <div className="p-5 rounded-3xl bg-card border border-border shadow-sm space-y-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-muted-foreground block mb-1">
                      سعر البندل الكامل
                    </span>
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-2xl sm:text-3xl font-black text-foreground">
                        {formatGenericPrice(bundle.price)}
                      </span>
                      {originalTotal > bundle.price && (
                        <span className="text-sm line-through text-muted-foreground">
                          {formatGenericPrice(originalTotal)}
                        </span>
                      )}
                    </div>
                  </div>

                  {savings.amount > 0 && (
                    <div className="text-left bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-2xl">
                      <span className="text-[10px] font-bold text-emerald-600 block">
                        إجمالي التوفير
                      </span>
                      <span className="text-xs sm:text-sm font-black text-emerald-600">
                        {formatGenericPrice(savings.amount)} ({savings.percentage}%)
                      </span>
                    </div>
                  )}
                </div>

                {/* Account Type Explanation */}
                <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-xs text-muted-foreground flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <span>{accountInfo.description}</span>
                </div>

                {/* Wallet Balance Status */}
                {user && (
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Wallet className="w-4 h-4" />
                      <span>رصيد محفظتك:</span>
                      <span className="font-bold text-foreground">
                        {formatGenericPrice(walletBalance)}
                      </span>
                    </div>
                    {!isBalanceSufficient ? (
                      <Link
                        to="/wallet"
                        className="text-[11px] font-bold text-red-500 hover:underline"
                      >
                        شحن المحفظة
                      </Link>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        رصيد كافٍ للدفع
                      </span>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-2 pt-2">
                  <button
                    onClick={() => handleAddToCart(true)}
                    disabled={isAdding}
                    className="w-full py-3.5 px-4 rounded-2xl bg-red-500 hover:bg-red-600 active:scale-[0.99] text-white font-black text-sm shadow-md hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Zap className="w-4 h-4 fill-current" />
                    <span>شراء الآن عبر المحفظة</span>
                  </button>

                  <button
                    onClick={() => handleAddToCart(false)}
                    disabled={isAdding}
                    className={`w-full py-3 px-4 rounded-2xl border font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      added
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-600"
                        : "bg-muted/40 hover:bg-muted border-border text-foreground"
                    }`}
                  >
                    {added ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>تمت الإضافة للسلة!</span>
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="w-4 h-4" />
                        <span>إضافة إلى السلة</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Guarantees & Features Checklist */}
              <div className="p-4 rounded-3xl bg-card border border-border shadow-xs space-y-2.5">
                <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  ضمانات ومميزات بنانا ستور
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>حساب أصلي ورسمي 100%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>تحميل مباشر من eShop</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>دعم فني خطوة بخطوة</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>ضمان دائم مع استبدال</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Included Games Section (Crucial Requirement: Click navigates to product details) */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-12 space-y-4">
          <div className="flex items-center justify-between gap-4 border-b border-border/80 pb-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-foreground flex items-center gap-2">
                <Gamepad2 className="w-6 h-6 text-red-500" />
                الألعاب المتضمنة في هذا البندل (
                {games.length + notYetListed.length || bundle.gameIds.length} ألعاب)
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                انقر على أي لعبة للانتقال إلى صفحة تفاصيلها ومعرفة قصتها ومميزاتها
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" dir="ltr">
            {/*
              Named, not linked. The page for one of these does not exist yet —
              offering a click that leads nowhere is worse than showing the
              title the bundle promises and saying it is on its way.
            */}
            {notYetListed.map((pendingGame) => (
              <div
                key={pendingGame.id}
                className="p-3.5 rounded-2xl bg-card border border-dashed border-border/80 flex items-center gap-3.5"
              >
                <div className="w-16 h-20 rounded-xl bg-muted/40 shrink-0 flex items-center justify-center border border-border/50">
                  <Gamepad2 className="w-5 h-5 text-muted-foreground/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600">
                    متضمنة بالبندل
                  </span>
                  <p className="font-bold text-sm text-foreground truncate mt-1" dir="auto">
                    {pendingGame.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    صفحة التفاصيل قيد الإعداد
                  </p>
                </div>
              </div>
            ))}

            {games.map((game, idx) => (
              <div
                key={game.id || idx}
                onClick={() => {
                  playSound("hover_s", 0.8);
                  void navigate({
                    to: "/product/$productId",
                    params: { productId: String(game.id) },
                  });
                }}
                className="p-3.5 rounded-2xl bg-card border border-border/80 hover:border-red-500/50 shadow-xs hover:shadow-lg transition-all cursor-pointer group flex items-center gap-3.5 relative overflow-hidden"
              >
                {/* Game Thumbnail / Cartridge */}
                <div className="w-16 h-20 rounded-xl overflow-hidden bg-slate-900 shrink-0 relative border border-border/50 group-hover:scale-105 transition-transform duration-300">
                  <NintendoCover
                    product={game as Record<string, unknown>}
                    usage="bundle-card"
                    ratio={null}
                    alt={String(game.titleEn || (game as any).english_name || game.title || "")}
                    className="w-full h-full"
                  />
                  <div className="absolute top-1 right-1 bg-black/70 rounded-md p-0.5">
                    <Gamepad2 className="w-3 h-3 text-red-400" />
                  </div>
                </div>

                {/* Game Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600">
                      متضمنة بالبندل
                    </span>
                    {game.publisher && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {game.publisher}
                      </span>
                    )}
                  </div>

                  <h4 className="font-extrabold text-sm text-foreground line-clamp-1 group-hover:text-red-500 transition-colors">
                    {String(game.titleEn || (game as any).english_name || game.title || "")}
                  </h4>

                  {game.description && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {game.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-border/40">
                    <span className="text-xs font-bold text-foreground">
                      {game.price ? formatGenericPrice(game.price) : "نسخة كاملة"}
                    </span>
                    <span className="text-[11px] font-bold text-red-500 flex items-center gap-1 group-hover:translate-x-[-2px] transition-transform">
                      تفاصيل اللعبة
                      <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How It Works Steps */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-14">
          <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-xs space-y-6">
            <div className="text-center max-w-xl mx-auto space-y-1">
              <h3 className="text-lg sm:text-xl font-black text-foreground">
                كيف تعمل حزم وبندلات الحسابات؟
              </h3>
              <p className="text-xs text-muted-foreground">
                3 خطوات سهلة وسريعة للاستمتاع بجميع ألعاب البندل على جهازك
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 space-y-2">
                <div className="w-8 h-8 rounded-xl bg-red-500 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  1
                </div>
                <h4 className="font-bold text-sm text-foreground">الدفع الفوري بالمحفظة</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  قم بإضافة البندل للسلة وأكمل الطلب عبر رصيد المحفظة دون الحاجة لأي بيانات شحن أو
                  عنوان.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 space-y-2">
                <div className="w-8 h-8 rounded-xl bg-red-500 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  2
                </div>
                <h4 className="font-bold text-sm text-foreground">استلام بيانات الحساب</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  يصلك الإيميل وكلمة المرور في محادثة الطلب فوراً وبشكل مشفر ومحمي.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-muted/40 border border-border/60 space-y-2">
                <div className="w-8 h-8 rounded-xl bg-red-500 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  3
                </div>
                <h4 className="font-bold text-sm text-foreground">تسجيل الدخول والتحميل</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  أضف المستخدم لجهاز السويتش، ادخل على Nintendo eShop وحمّل الألعاب كاملة مع كافة
                  التحديثات.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
