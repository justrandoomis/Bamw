import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { CurrencyProvider } from "../context/CurrencyContext";
import ThemeApplier from "../components/ThemeApplier";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { readPrefs } from "../lib/prefs";
import { ensureLanguageAssets, useI18n, tr } from "../i18n";
import GlobalMusicPlayer from "../components/GlobalMusicPlayer";
import { Toaster } from "../components/ui/sonner";
import { ReferralCapture } from "../components/referral/ReferralCapture";
import { ensureNintendoCategory } from "../lib/nintendo-setup";
import { isScriptImportError, handleModuleReload } from "../lib/polyfills";
import { useStoreData } from "../hooks/useStoreData";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error: rootError, reset }: { error: any; reset: () => void }) {
  const error = rootError?.error || rootError;
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? (error as any).message || JSON.stringify(error)
          : String(error);

  const is404 = (error as any)?.status === 404 || message.includes("404");
  const isChunkError = isScriptImportError(error) || isScriptImportError(message);

  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  const handleRetry = () => {
    if (isChunkError) {
      handleModuleReload(true);
      return;
    }
    router.invalidate();
    reset();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center select-none overflow-hidden">
      {/* Dynamic Empty State Illustration inspired by user-uploads://file-6 pattern */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 mb-8 opacity-20">
        <svg
          viewBox="0 0 240 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-sm"
        >
          <ellipse
            cx="120"
            cy="190"
            rx="95"
            ry="12"
            fill="#fde8e9"
            transform="rotate(-4 120 190)"
          />
          <path
            d="M95 90 L95 70 L150 70 L150 90"
            stroke="#d68a29"
            strokeWidth="12"
            strokeLinejoin="round"
            fill="none"
          />
          <polygon points="80,105 165,105 165,90 90,90" fill="#d07e1c" />
          <path d="M95 105 C95 80, 142 80, 142 105 Z" fill="#fb8e49" />
          <polygon points="170,105 190,110 170,185 150,180" fill="#d57b28" />
          <polygon points="65,105 170,105 150,180 50,170" fill="#f8c347" />
          <path
            d="M85 105 L85 82 L135 82 L135 105"
            stroke="#f8c347"
            strokeWidth="12"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-black text-slate-900 mb-3">
        {is404 ? tr("Page not found") : tr("This page didn't load")}
      </h1>
      <p className="text-slate-500 text-sm max-w-xs mb-8 leading-relaxed">
        {is404
          ? tr("The page you are looking for doesn't exist or has been moved.")
          : tr("Something went wrong on our end. You can try refreshing or head back home.")}
        {message && (
          <span className="block mt-4 text-[10px] font-mono text-slate-400 opacity-50 overflow-hidden text-ellipsis whitespace-nowrap">
            Error: {message}
          </span>
        )}
      </p>

      <div className="flex flex-col gap-3 w-full max-w-[200px]">
        <button
          onClick={handleRetry}
          className="w-full bg-[var(--brand-red)] text-white font-black py-4 px-6 rounded-2xl shadow-lg shadow-rose-500/20 active:scale-[0.98] transition-all text-sm"
        >
          {tr("Try again")}
        </button>
        <a
          href="/"
          className="w-full bg-slate-100 text-slate-900 font-bold py-3.5 px-6 rounded-2xl active:scale-[0.98] transition-all text-sm"
        >
          {tr("Go home")}
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * Fetch the visitor's language pack before anything renders.
   *
   * English, Kurdish and Turkish copy is split out of the critical path, and
   * this loader is awaited on the server and on the client, so a non-Arabic
   * visitor has it in hand for the very first paint. Arabic resolves
   * immediately — its keys are its copy, so there is nothing to fetch.
   */
  loader: async () => {
    await ensureLanguageAssets(readPrefs().lang);
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        // interactive-widget shrinks the layout when the on-screen keyboard
        // opens, so a full-height chat keeps its composer and bottom bar in
        // view instead of pushing them behind it. Left at the default
        // viewport-fit so every other page keeps rendering inside the safe area.
        content: "width=device-width, initial-scale=1, interactive-widget=resizes-content",
      },
      { name: "format-detection", content: "telephone=no" },
      { title: "بنانا ستور — ألعاب وحسابات ننتندو سويتش" },
      {
        name: "description",
        content:
          "متجر بنانا لألعاب وحسابات ننتندو سويتش والأجهزة والملحقات، مع تسليم فوري للحسابات ودعم مباشر عبر المحادثة.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "بنانا ستور — ألعاب وحسابات ننتندو سويتش" },
      {
        property: "og:description",
        content:
          "متجر بنانا لألعاب وحسابات ننتندو سويتش والأجهزة والملحقات، مع تسليم فوري للحسابات ودعم مباشر عبر المحادثة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "بنانا ستور — ألعاب وحسابات ننتندو سويتش" },
      {
        name: "twitter:description",
        content:
          "متجر بنانا لألعاب وحسابات ننتندو سويتش والأجهزة والملحقات، مع تسليم فوري للحسابات ودعم مباشر عبر المحادثة.",
      },
      {
        property: "og:image",
        content: "https://banan.to/og-image.png",
      },
      {
        name: "twitter:image",
        content: "https://banan.to/og-image.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Warm the TLS handshake for the image hosts before the first <img> renders.
      { rel: "preconnect", href: "https://assets.banan.to", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://assets.nintendo.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://img-eshop.cdn.nintendo.net", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://assets.banan.to" },
      { rel: "dns-prefetch", href: "https://assets.nintendo.com" },
      { rel: "dns-prefetch", href: "https://img-eshop.cdn.nintendo.net" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      // The store-services sign is above the fold on the home page.
      {
        rel: "preload",
        as: "image",
        href: "https://assets.banan.to/Images/Services/Hang_Banner.webp",
        type: "image/webp",
      },
      // Nintendo and Brand branding assets
      {
        rel: "preload",
        as: "image",
        href: "https://assets.banan.to/Images/Brand/bananto_logo.webp",
        type: "image/webp",
      },
      // Start the catalogue request while the HTML is still parsing.
      { rel: "preload", as: "fetch", href: "/api/data?slim=1", crossOrigin: "use-credentials" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Read from cookies on the server too, so the first painted HTML already
  // carries the member's background pack and language (no theme flash).
  const prefs = readPrefs();

  return (
    <html
      lang={prefs.lang}
      dir={prefs.dir}
      data-theme={prefs.theme}
      data-motion={prefs.motion}
      className={prefs.dark ? "dark" : undefined}
      style={{ colorScheme: prefs.dark ? "dark" : "light" }}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootInner() {
  // Seed the dictionary from the cookie before any child renders, so the server
  // HTML is already in the member's language and hydration matches.
  const cookieLang = readPrefs().lang;
  if (useI18n.getState().lang !== cookieLang) useI18n.setState({ lang: cookieLang });
  const lang = useI18n((state) => state.lang);
  // Re-key the tree when a language pack lands so a runtime switch re-reads it.
  const assetsVersion = useI18n((state) => state.assetsVersion);

  // Catalogue response: fetched with SWR and shared across the application.
  const { data: store } = useStoreData();

  // Any image that fails through the edge proxy (rate limit, upstream 4xx/5xx)
  // is retried once against its original URL, so a proxy hiccup never leaves a
  // product card with a broken thumbnail.
  useEffect(() => {
    const onImgError = (event: Event) => {
      const img = event.target as HTMLImageElement | null;
      if (!img || img.tagName !== "IMG" || img.dataset["imgFallback"] === "1") return;
      const src = img.getAttribute("src") || "";
      const match = /\/api\/img\?u=([^&]+)/.exec(src);
      if (!match) return;
      img.dataset["imgFallback"] = "1";
      try {
        img.src = decodeURIComponent(match[1]!);
      } catch {
        /* leave as-is */
      }
    };
    document.addEventListener("error", onImgError, true);
    return () => document.removeEventListener("error", onImgError, true);
  }, []);

  // Seed any missing storefront sections from the catalogue already in hand.
  useEffect(() => {
    if (!store) return;
    void ensureNintendoCategory(store.categories);
  }, [store]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).Telegram?.WebApp) return;
    const isTg =
      window.location.pathname.startsWith("/telegram") ||
      window.location.search.includes("tgWebAppData") ||
      window.location.hash.includes("tgWebAppData") ||
      (window as any).TelegramWebviewProxy !== undefined;

    if (isTg) {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-web-app.js?63";
      script.async = true;
      script.onerror = () => {
        console.warn("[Telegram] Failed to load Telegram WebApp SDK");
      };
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const isDevOrPreview =
      import.meta.env.DEV ||
      (typeof window !== "undefined" &&
        (window.self !== window.top ||
          window.location.hostname.includes("run.app") ||
          window.location.hostname.includes("localhost") ||
          window.location.hostname === "127.0.0.1" ||
          window.location.hostname.includes("ais-") ||
          window.location.hostname.includes("googleusercontent.com") ||
          window.location.hostname.includes("webcontainer") ||
          window.location.port !== ""));

    if (isDevOrPreview) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          for (const reg of regs) void reg.unregister();
        })
        .catch(() => {});
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return (
    <CurrencyProvider>
      <GlobalMusicPlayer musicList={store?.musicList} />
      <ThemeApplier />
      <Toaster />
      {/*
        A referral link can land on any page, so the code in `?ref=` is picked
        up here rather than on the product route — and it is picked up by the
        *server*, which answers with the signed cookie that actually carries
        the attribution.
      */}
      <ReferralCapture />
      {/* key={lang} remounts the tree so every tr() call re-reads the dictionary. */}
      <div key={`${lang}:${assetsVersion}`} className="contents">
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </div>
    </CurrencyProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RootInner />
    </QueryClientProvider>
  );
}
