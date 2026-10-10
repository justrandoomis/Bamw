import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef, type KeyboardEvent } from "react";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Gamepad2,
  Info,
  KeyRound,
  Layers,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import type { AccountBundle, Product } from "@/lib/types";
import {
  bundleAccountLabel,
  bundleAccountOptions,
  getBundleGames,
  getBundleSavings,
  getAccountTypeInfo,
  getBundleOriginalTotal,
  resolveBundleUnitPrice,
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

/* A hairline inside an art window, so bright artwork keeps its edge. */
const ART_HAIRLINE =
  "pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]";

const GUARANTEES = [
  "حساب أصلي ورسمي 100%",
  "تحميل مباشر من eShop",
  "دعم فني خطوة بخطوة",
  "ضمان دائم مع استبدال",
];

const STEPS = [
  {
    title: "الدفع الفوري بالمحفظة",
    body: "قم بإضافة البندل للسلة وأكمل الطلب عبر رصيد المحفظة دون الحاجة لأي بيانات شحن أو عنوان.",
  },
  {
    title: "استلام بيانات الحساب",
    body: "يصلك الإيميل وكلمة المرور في محادثة الطلب فوراً وبشكل مشفر ومحمي.",
  },
  {
    title: "تسجيل الدخول والتحميل",
    body: "أضف المستخدم لجهاز السويتش، ادخل على Nintendo eShop وحمّل الألعاب كاملة مع كافة التحديثات.",
  },
];

const gameName = (game: Product) =>
  String(game.titleEn || (game as any).english_name || game.title || "");

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

  const products = useMemo(() => (store?.products ?? []) as Product[], [store?.products]);
  const bundles = useMemo(() => (store?.bundles ?? []) as AccountBundle[], [store?.bundles]);

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

  /*
    The ways this bundle can be bought.

    A bundle saved before options existed reads as the one option it always
    had, so this list is never empty and the picker below simply does not draw
    itself when there is nothing to pick.
  */
  const accountOptions = useMemo(() => (bundle ? bundleAccountOptions(bundle) : []), [bundle]);

  const [optionId, setOptionId] = useState<string>("");
  /*
    Default to the cheapest, and re-pin whenever the list changes.

    Pre-selecting is what makes the headline price honest: the number beside
    the button is the number the buyer is about to be charged, from the first
    frame. The cheapest rather than the first, so the price shown before anyone
    touches anything is the lowest this bundle can be had for.
  */
  const selectedOptionId = useMemo(() => {
    if (accountOptions.some((option) => String(option.id) === optionId)) return optionId;
    const cheapest = [...accountOptions].sort(
      (a, b) => (Number(a.extraPrice) || 0) - (Number(b.extraPrice) || 0),
    )[0];
    return cheapest ? String(cheapest.id) : "";
  }, [accountOptions, optionId]);

  /* The same function the till prices with — see resolveBundleUnitPrice. */
  const livePrice = useMemo(() => {
    if (!bundle) return 0;
    return resolveBundleUnitPrice(bundle, { optionId: selectedOptionId }).unitPrice;
  }, [bundle, selectedOptionId]);

  const savings = useMemo(() => {
    if (!bundle) return { amount: 0, percentage: 0 };
    /* Against what is being charged, not against the base — see getBundleSavings. */
    return getBundleSavings(bundle, products, livePrice);
  }, [bundle, products, livePrice]);

  const originalTotal = useMemo(() => {
    if (!bundle) return 0;
    return getBundleOriginalTotal(bundle, products);
  }, [bundle, products]);

  const accountInfo = useMemo(() => {
    const chosen = accountOptions.find((option) => String(option.id) === selectedOptionId);
    return getAccountTypeInfo(chosen ? chosen.kind : bundle?.accountType);
  }, [accountOptions, selectedOptionId, bundle?.accountType]);

  /*
    The account picker is a real radio group: one tab stop (the chosen row),
    and the arrow keys move the choice, as they do in any native one.
  */
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = accountOptions.length - 1;
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = index >= last ? 0 : index + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = index <= 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    const option = accountOptions[next];
    if (!option) return;
    setOptionId(String(option.id));
    optionRefs.current[next]?.focus();
  };

  const handleAddToCart = async (directCheckout = false) => {
    if (!bundle || isAdding) return;

    setIsAdding(true);
    playSound("switch_click", 0.7);

    try {
      addLocalCart({
        productId: bundle.id,
        title: bundle.titleEn || bundle.title,
        image: bundle.image || games[0]?.image || "",
        price: livePrice,
        kind: "bundle",
        requiresAddress: false,
        /*
          Which account was picked. The cart re-prices from the record through
          the same resolver, so this is what it looks the surcharge up by — the
          number above is for showing, never for charging.
        */
        ...(selectedOptionId ? { optionId: selectedOptionId } : {}),
      });

      if (user) {
        await addToCartServer({
          data: {
            productId: String(bundle.id),
            quantity: 1,
            /*
              Inside `options`, which is where the endpoint keeps it: its
              validator accepts productId, quantity and options only, so a
              top-level field would be stripped before the handler saw it. The
              cart reads the choice back out of this blob, and so does the row
              matcher that decides whether this is a new line or one more of an
              existing one.
            */
            options: { bundleGameIds: bundle.gameIds, optionId: selectedOptionId },
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
        <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 sm:pt-5" aria-busy="true">
          <div className="mb-3 h-4 w-48 animate-pulse rounded-full bg-muted/60" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
            <div className="space-y-4">
              <div className="aspect-[16/9] w-full animate-pulse rounded-[28px] bg-muted/50" />
              <div className="h-8 w-2/3 animate-pulse rounded-full bg-muted/60" />
              <div className="h-4 w-full animate-pulse rounded-full bg-muted/50" />
            </div>
            <div className="h-[380px] animate-pulse rounded-[28px] bg-muted/50" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!bundle) {
    return (
      <AppShell currentView="store" onBack={() => navigate({ to: "/bundles" })}>
        <div className="mx-auto max-w-md px-4 py-12">
          <div className="flex flex-col items-center rounded-[28px] border border-[var(--clay-rim)] bg-card px-6 py-10 text-center shadow-md">
            <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-muted/70">
              <Layers className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-[18px] font-black tracking-[-0.02em] text-foreground">
              البندل غير متوفر
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              عذراً، لم يتم العثور على هذا البندل أو قد تم إيقافه من قبل الإدارة.
            </p>
            <Link
              to="/bundles"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40"
            >
              تصفح جميع البندلات
              <ChevronLeft className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const walletBalance = user?.walletBalance ?? 0;
  /*
    Enough for what is actually about to be charged.

    Measured against `bundle.price`, so an account option that adds to it would
    have promised «رصيد كافٍ للدفع» for a total the server then refuses.
  */
  const isBalanceSufficient = walletBalance >= livePrice;

  const title = bundle.titleEn || bundle.title;
  const includedCount = games.length + notYetListed.length || bundle.gameIds.length;

  return (
    <AppShell currentView="store" onBack={() => navigate({ to: "/bundles" })}>
      <div className="min-h-screen pb-10">
        <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 sm:pt-5">
          <nav
            aria-label="مسار التنقل"
            className="mb-3 flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-muted-foreground"
          >
            <Link to="/" className="shrink-0 transition-colors hover:text-foreground">
              الرئيسية
            </Link>
            <ChevronLeft className="h-3.5 w-3.5 shrink-0 ltr:rotate-180" aria-hidden="true" />
            <Link to="/bundles" className="shrink-0 transition-colors hover:text-foreground">
              حزم الحسابات
            </Link>
            <ChevronLeft className="h-3.5 w-3.5 shrink-0 ltr:rotate-180" aria-hidden="true" />
            <span aria-current="page" dir="auto" className="min-w-0 truncate text-foreground">
              {title}
            </span>
          </nav>

          {/*
            The page follows the decision: what is in it and what it costs,
            then what you get, then how it works. On a wide screen the purchase
            card stays beside the reading as it scrolls.
          */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
            {/* ================= What is in it ================= */}
            <section
              aria-labelledby="bundle-title"
              className="min-w-0 lg:col-start-1 lg:row-start-1"
            >
              {/* The games' art, in a frame of clay */}
              <div className="rounded-[28px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-lg">
                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[22px] bg-muted/40">
                  {games.length >= 2 ? (
                    <div className="absolute inset-0 flex gap-[3px] bg-card">
                      {games.slice(0, 4).map((g, idx) => (
                        <div
                          key={g.id || idx}
                          className="relative h-full min-w-0 flex-1 overflow-hidden"
                        >
                          <NintendoCover
                            product={g as Record<string, unknown>}
                            usage="bundle-card"
                            ratio={null}
                            fit="cover"
                            alt={gameName(g)}
                            loading="eager"
                            className="h-full w-full"
                          />
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
                      alt={String(title || "")}
                      loading="eager"
                      className="h-full w-full"
                    />
                  )}
                  <span aria-hidden="true" className={ART_HAIRLINE} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--brand-red)]/12 px-2.5 text-[12px] font-black text-[var(--brand-red)]">
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  {games.length || bundle.gameIds.length} ألعاب بحساب واحد
                </span>
                <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted/70 px-2.5 text-[12px] font-bold text-foreground">
                  <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{accountInfo.label}</span>
                </span>
                {bundle.badge ? (
                  <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-[var(--clay-rim)] bg-card px-2.5 text-[12px] font-bold text-foreground shadow-sm">
                    <Sparkles
                      className="h-3.5 w-3.5 shrink-0 text-[var(--brand-red)]"
                      aria-hidden="true"
                    />
                    <span className="truncate">{bundle.badge}</span>
                  </span>
                ) : null}
              </div>

              <h1
                id="bundle-title"
                className="mt-3 text-balance text-[26px] font-black leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[34px]"
              >
                <bdi>{title}</bdi>
              </h1>
              {bundle.description ? (
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">
                  {bundle.description}
                </p>
              ) : null}
            </section>

            {/* ================= What it costs ================= */}
            <aside
              aria-label="شراء البندل"
              className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
            >
              <div className="rounded-[28px] border border-[var(--clay-rim)] bg-card p-4 shadow-lg sm:p-5">
                <p className="text-[12px] font-bold text-muted-foreground">سعر البندل الكامل</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  {/* The price of the account chosen below, not the base. */}
                  <span
                    dir="ltr"
                    className="text-[32px] font-black leading-none tracking-[-0.03em] tabular-nums text-foreground"
                  >
                    {formatGenericPrice(livePrice)}
                  </span>
                  {originalTotal > livePrice ? (
                    <span
                      dir="ltr"
                      className="text-[15px] font-semibold tabular-nums text-muted-foreground line-through"
                    >
                      {formatGenericPrice(originalTotal)}
                    </span>
                  ) : null}
                </div>
                {savings.amount > 0 ? (
                  <p className="mt-2.5 inline-flex flex-wrap items-center gap-x-1.5 rounded-full bg-emerald-500/12 px-3 py-1 text-[12.5px] font-extrabold text-emerald-700 dark:text-emerald-300">
                    <span>إجمالي التوفير</span>
                    {/* Two isolated runs: one LTR run would pull «د.ع (» into Arabic order. */}
                    <span dir="ltr" className="tabular-nums">
                      {formatGenericPrice(savings.amount)}
                    </span>
                    <span dir="ltr" className="tabular-nums">
                      ({savings.percentage}%)
                    </span>
                  </p>
                ) : null}

                {/*
                  Pick the account.

                  Drawn only when there is a choice: a bundle sold one way
                  should not ask a question with one answer.
                */}
                {accountOptions.length > 1 ? (
                  <div className="mt-4">
                    <p
                      id="bundle-account-label"
                      className="mb-2 text-[12px] font-bold text-muted-foreground"
                    >
                      اختر نوع الحساب
                    </p>
                    <div
                      role="radiogroup"
                      aria-labelledby="bundle-account-label"
                      className="grid gap-2"
                    >
                      {accountOptions.map((option, index) => {
                        const id = String(option.id);
                        const isPicked = id === selectedOptionId;
                        const extra = Number(option.extraPrice) || 0;
                        return (
                          <button
                            key={id}
                            ref={(element) => {
                              optionRefs.current[index] = element;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={isPicked}
                            tabIndex={isPicked ? 0 : -1}
                            onClick={() => setOptionId(id)}
                            onKeyDown={(event) => handleOptionKeyDown(event, index)}
                            className={`flex min-h-[52px] w-full min-w-0 items-center justify-between gap-3 rounded-[18px] border px-4 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 ${
                              isPicked
                                ? "border-[var(--brand-red)]/50 bg-card shadow-sm"
                                : "border-transparent bg-muted/50 shadow-none hover:bg-muted/70"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                  isPicked
                                    ? "border-[var(--brand-red)]"
                                    : "border-muted-foreground/40"
                                }`}
                              >
                                {isPicked ? (
                                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-red)]" />
                                ) : null}
                              </span>
                              <span className="min-w-0 text-[14px] font-bold text-foreground">
                                {bundleAccountLabel(option)}
                              </span>
                            </span>
                            {extra > 0 ? (
                              <span
                                dir="ltr"
                                className="shrink-0 text-[13px] font-black tabular-nums text-foreground"
                              >
                                + {formatGenericPrice(extra)}
                              </span>
                            ) : (
                              <span className="shrink-0 text-[12px] font-bold text-muted-foreground">
                                مشمول
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* What the chosen account means */}
                <div
                  aria-live="polite"
                  className="mt-3 flex items-start gap-2 rounded-[16px] bg-muted/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground"
                >
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-red)]"
                    aria-hidden="true"
                  />
                  <span>{accountInfo.description}</span>
                </div>

                {/* Wallet Balance Status */}
                {user ? (
                  <div className="mt-4 flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
                      <Wallet className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>رصيد محفظتك:</span>
                      <span dir="ltr" className="font-bold tabular-nums text-foreground">
                        {formatGenericPrice(walletBalance)}
                      </span>
                    </span>
                    {!isBalanceSufficient ? (
                      <Link
                        to="/wallet"
                        className="shrink-0 font-bold text-[var(--brand-red)] hover:underline"
                      >
                        شحن المحفظة
                      </Link>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        رصيد كافٍ للدفع
                      </span>
                    )}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => handleAddToCart(true)}
                  disabled={isAdding}
                  className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-[18px] bg-[var(--brand-red)] px-5 text-[15px] font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 disabled:cursor-wait disabled:opacity-70"
                >
                  <Zap className="h-4 w-4 fill-current" aria-hidden="true" />
                  شراء الآن عبر المحفظة
                </button>

                <button
                  type="button"
                  onClick={() => handleAddToCart(false)}
                  disabled={isAdding}
                  className={`mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border text-[13px] font-bold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/40 disabled:cursor-wait disabled:opacity-70 ${
                    added
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-[var(--clay-rim)] bg-card text-foreground"
                  }`}
                >
                  {added ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      تمت الإضافة للسلة!
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                      إضافة إلى السلة
                    </>
                  )}
                </button>

                <p className="mt-3.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    منتج رقمي بدون عنوان شحن: تصلك بيانات الحساب وخطوات التفعيل في محادثة الطلب
                    فوراً.
                  </span>
                </p>
              </div>
            </aside>

            {/* ================= What you get ================= */}
            <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
              {games.length + notYetListed.length > 0 ? (
                <section aria-labelledby="bundle-games-title">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h2
                        id="bundle-games-title"
                        className="text-[20px] font-black tracking-[-0.02em] text-foreground"
                      >
                        الألعاب المتضمنة
                      </h2>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        انقر على أي لعبة للانتقال إلى صفحة تفاصيلها
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted/70 px-2.5 py-1 text-[12px] font-bold text-muted-foreground">
                      {includedCount} ألعاب
                    </span>
                  </div>

                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {games.map((game, idx) => (
                      <li key={game.id || idx} className="min-w-0">
                        <Link
                          to="/product/$productId"
                          params={{ productId: String(game.id) }}
                          onClick={() => playSound("hover_s", 0.8)}
                          className="group flex min-h-[80px] items-center gap-3 rounded-[22px] border border-[var(--clay-rim)] bg-card p-2 pe-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-red)]/50"
                        >
                          <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[16px] bg-muted/40">
                            <NintendoCover
                              product={game as Record<string, unknown>}
                              usage="square-card"
                              ratio={null}
                              fit="cover"
                              alt=""
                              className="h-full w-full"
                            />
                            <span aria-hidden="true" className={ART_HAIRLINE} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              dir="auto"
                              className="block truncate text-[14px] font-bold text-foreground rtl:text-right"
                            >
                              {gameName(game)}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                              {game.publisher ? (
                                <>
                                  <span className="truncate">{game.publisher}</span>
                                  <span aria-hidden="true">·</span>
                                </>
                              ) : null}
                              {game.price ? (
                                <span dir="ltr" className="shrink-0 font-bold tabular-nums">
                                  {formatGenericPrice(game.price)}
                                </span>
                              ) : (
                                <span className="shrink-0 font-bold">نسخة كاملة</span>
                              )}
                            </span>
                          </span>
                          <ChevronLeft
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5 ltr:rotate-180 ltr:group-hover:translate-x-0.5 motion-reduce:transition-none"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}

                    {/*
                      Named, not linked. The page for one of these does not
                      exist yet — offering a click that leads nowhere is worse
                      than showing the title the bundle promises and saying it
                      is on its way.
                    */}
                    {notYetListed.map((pendingGame) => (
                      <li
                        key={pendingGame.id}
                        className="flex min-h-[80px] min-w-0 items-center gap-3 rounded-[22px] bg-muted/50 p-2 pe-3"
                      >
                        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[16px] border border-dashed border-muted-foreground/30">
                          <Gamepad2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            dir="auto"
                            className="block truncate text-[14px] font-bold text-foreground rtl:text-right"
                          >
                            {pendingGame.name}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">
                            صفحة التفاصيل قيد الإعداد
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section
                aria-labelledby="bundle-guarantees-title"
                className="rounded-[22px] border border-[var(--clay-rim)] bg-card p-4 shadow-md sm:p-5"
              >
                <h2
                  id="bundle-guarantees-title"
                  className="flex items-center gap-2 text-[16px] font-black tracking-[-0.02em] text-foreground"
                >
                  <ShieldCheck
                    className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  ضمانات ومميزات بنانا ستور
                </h2>
                <ul className="mt-3 grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
                  {GUARANTEES.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-2 text-[13.5px] leading-snug text-foreground"
                    >
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          {/* ================= How it works ================= */}
          <section aria-labelledby="bundle-steps-title" className="mt-10">
            <h2
              id="bundle-steps-title"
              className="text-[20px] font-black tracking-[-0.02em] text-foreground"
            >
              كيف تعمل حزم وبندلات الحسابات؟
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              3 خطوات سهلة وسريعة للاستمتاع بجميع ألعاب البندل على جهازك
            </p>
            <ol className="mt-4 grid gap-3 md:grid-cols-3 md:gap-4">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-[22px] border border-[var(--clay-rim)] bg-card p-4 shadow-md"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="clay-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-red)] text-[15px] font-black tabular-nums text-primary-foreground"
                    >
                      {index + 1}
                    </span>
                    <h3 className="text-[15px] font-black tracking-[-0.01em] text-foreground">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
