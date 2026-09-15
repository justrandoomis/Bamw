import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";

import AppShell from "@/components/AppShell";
import GameDetailsRequest from "@/components/GameDetailsRequest";
import ProductReviews from "@/components/ProductReviews";

import { CurrencyProvider } from "@/hub/context/CurrencyContext";
import { NotificationProvider } from "@/hub/context/NotificationContext";
import { UserProvider } from "@/hub/context/UserContext";
import { ProductDetails } from "@/components/product-details/ProductDetails";
import { gameFromProduct } from "@/hub/data/fromProduct";
import { GameHub } from "@/hub/gamehub/GameHub";
import { I18nProvider } from "@/hub/i18n";
import { tr, useI18n } from "@/i18n";
import { useStoreData } from "@/hooks/useStoreData";
import { detectSchema } from "@/lib/productImport/registry";
import { getProductCategory, schemaForSection } from "@/lib/productSection";
import { findProductByIdOrSlug, getProductSlug } from "@/lib/productRouting";
import { isProductPurchasable } from "@/lib/purchasable";
import { isBareListing } from "@/lib/bareListing";
import { useAuth } from "@/hooks/useAuth";
import { recordView } from "@/lib/view-history";

export const Route = createFileRoute("/product/$productId")({
  head: () => ({
    meta: [
      { title: "تفاصيل المنتج — بنانا ستور" },
      {
        name: "description",
        content: "كل تفاصيل المنتج: الأسعار والتوفر، المواصفات، الأداء والمراجعات.",
      },
      { property: "og:title", content: "تفاصيل المنتج — بنانا ستور" },
      {
        property: "og:description",
        content: "كل تفاصيل المنتج والأسعار في صفحة واحدة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  /*
    `isLoading` matters here, not just `user`.

    The session query resolves after first paint, so a signed-in customer who
    presses a request button in that window looks signed out and gets bounced
    to /auth. The panel is handed `undefined` while the answer is unknown and
    waits instead of guessing.
  */
  const { user, isLoading: sessionLoading } = useAuth();

  // 1. Instant cache access via shared store data
  const { data: storeData } = useStoreData();
  const cachedProduct = useMemo(
    () => findProductByIdOrSlug(storeData?.products, productId) as Record<string, unknown> | undefined,
    [storeData?.products, productId],
  );

  // 2. Fetch full product payload if needed
  const { data: singleProductData, isLoading: isSingleLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: async () => {
      const res = await fetch(`/api/product?id=${encodeURIComponent(productId)}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("failed_to_fetch_product");
      }
      const body = await res.json();
      return body.product as Record<string, unknown>;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  // Merge: single full product takes precedence, fallback to cached product immediately
  const product = singleProductData || cachedProduct;
  const isLoading = !product && isSingleLoading && !storeData;

  const lang = useI18n((s) => s.lang);
  const locale = lang === "ar" ? "ar" : "en";

  /*
    The Game Hub belongs to Nintendo Switch Games and nothing else. Every other
    section — hardware, amiibo, accessories, gift cards, used, bundles — renders
    its own schema-driven details page.
  */
  const section = useMemo(() => (product ? getProductCategory(product) : undefined), [product]);
  const isGame = section === "game";

  /*
    A listing that carries a name and a price and nothing else.

    Derived rather than flagged — the same predicate the admin table counts
    with — so the panel disappears by itself the moment the game is written up,
    with nothing to remember to turn off. Judged on the *merged* record, which
    means the instant answer from the cached listing can differ from the one a
    second later when the full record arrives; that is correct, and the panel
    appearing late is better than it appearing on a game that has a cover.
  */
  const isBare = useMemo(
    () => (product ? isBareListing(product as Record<string, unknown>) : false),
    [product],
  );

  const schema = useMemo(
    () =>
      product && !isGame
        ? ((section ? schemaForSection(section) : undefined) ?? detectSchema(product))
        : undefined,
    [product, section, isGame],
  );

  const game = useMemo(
    () => (product && isGame ? gameFromProduct(product, locale, storeData?.products as any) : null),
    [product, isGame, locale, storeData?.products],
  );

  // Kept on the user's device; sent with a support message as a hint only.
  useEffect(() => {
    if (product) {
      const productTitle = String(product["titleEn"] || product["title"] || product["name"] || "");
      document.title = `${productTitle} — بنانا ستور`;
      recordView(String(product["id"] ?? productId), productTitle);
    }
  }, [product, productId]);

  if (isLoading) {
    return (
      <AppShell currentView="details" hideNav>
        <div className="mx-auto max-w-6xl space-y-4 p-4">
          <div className="aspect-[16/9] w-full animate-pulse rounded-3xl bg-[var(--page-2)]" />
          <div className="h-6 w-1/2 animate-pulse rounded-full bg-[var(--page-2)]" />
          <div className="h-40 w-full animate-pulse rounded-3xl bg-[var(--page-2)]" />
        </div>
      </AppShell>
    );
  }

  if (!product) {
    return (
      <AppShell currentView="details" hideNav>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <p className="text-muted-foreground">{tr("لم يتم العثور على هذا المنتج.")}</p>
          <button
            onClick={() => void navigate({ to: "/" })}
            className="rounded-xl bg-[var(--brand-red)] px-4 py-2 text-sm font-bold text-white"
          >
            {tr("رجوع للمتجر")}
          </button>
        </div>
      </AppShell>
    );
  }

  if (game && isGame) {
    return (
      <I18nProvider>
        <CurrencyProvider>
          <UserProvider>
            <NotificationProvider>
              <div className="relative min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))]">
                <GameHub
                  game={game}
                  onNavigateGuide={(slug) => {
                    const el = document.getElementById("guides");
                    el?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
                {/*
                  Below the hub rather than inside it. The hub drops every
                  section it has no data for, so on one of these listings it is
                  already short — and the panel lands where the page ends
                  instead of interrupting a layout built for a game with
                  everything filled in.
                */}
                {/*
                  Judged on its own, not folded into the panel below.

                  The seventeen Japanese-only titles in the supplier catalogue
                  are all bare listings today, so it would work either way — and
                  would stop working the day somebody writes one of them up,
                  taking the warning away with the panel. A customer buying a
                  game they cannot read is a refund whatever else the page has.
                */}
                {product["englishSupport"] === false && (
                  <div className="px-4 pb-4">
                    <p className="mx-auto flex max-w-5xl items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm font-bold text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      هذه اللعبة لا تدعم اللغة الإنجليزية — واجهتها ونصوصها يابانية أو صينية.
                    </p>
                  </div>
                )}

                {isBare && (
                  <div className="px-4 pb-16">
                    <GameDetailsRequest
                      productId={String(product["id"] ?? productId)}
                      productTitle={String(product["titleEn"] || product["title"] || "")}
                      platform={String(product["platform"] ?? "")}
                      isSignedIn={sessionLoading ? undefined : Boolean(user)}
                      onSignIn={() => void navigate({ to: "/auth" })}
                    />
                  </div>
                )}
              </div>
            </NotificationProvider>
          </UserProvider>
        </CurrencyProvider>
      </I18nProvider>
    );
  }

  return (
    <AppShell currentView="details" hideNav>
      <div className="min-h-screen bg-[var(--page)]">
        <ProductDetails
          product={product}
          schema={schema}
        />
        <div className="mx-auto max-w-6xl px-4 py-8">
          <ProductReviews productId={String(product["id"])} />
        </div>
      </div>
    </AppShell>
  );
}
