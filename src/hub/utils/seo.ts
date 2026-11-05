import type { Game, StoreOffer } from "@/hub/types";
import { rankOffers } from "@/hub/utils/priceIntelligence";

/**
 * Head + structured-data management.
 *
 * This is a single-page app, so tags are applied imperatively. Every builder
 * below emits plain JSON-LD objects, which means the same functions can be
 * called from a server renderer without change if the hub later moves to SSR
 * (see README → "Rendering & SEO").
 */

export const SITE_NAME = "Bananto"; // Default, though technically dynamic for translations, but we'll use a neutral one here.
export const SITE_URL =
  typeof window !== "undefined" ? window.location.origin : "https://banam.example";

const MANAGED_ATTR = "data-banam-seo";

export interface SeoInput {
  title: string;
  description?: string;
  canonicalPath: string;
  imageUrl?: string;
  type?: "website" | "article" | "product" | "video.other";
  locale?: string;
  jsonLd?: object[];
}

export function applySeo(input: SeoInput): void {
  if (typeof document === "undefined") return;

  document.title = input.title;

  const canonical = `${SITE_URL}${input.canonicalPath}`;
  setMeta("name", "description", input.description);
  setLink("canonical", canonical);

  setMeta("property", "og:title", input.title);
  setMeta("property", "og:description", input.description);
  setMeta("property", "og:type", input.type ?? "website");
  setMeta("property", "og:url", canonical);
  setMeta("property", "og:image", input.imageUrl);
  setMeta("property", "og:site_name", SITE_NAME);
  setMeta("property", "og:locale", input.locale ?? "ar_SA");

  setMeta("name", "twitter:card", input.imageUrl ? "summary_large_image" : "summary");
  setMeta("name", "twitter:title", input.title);
  setMeta("name", "twitter:description", input.description);
  setMeta("name", "twitter:image", input.imageUrl);

  setJsonLd(input.jsonLd ?? []);
}

function setMeta(keyAttr: "name" | "property", key: string, value?: string): void {
  const selector = `meta[${keyAttr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!value) {
    if (el?.hasAttribute(MANAGED_ATTR)) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(keyAttr, key);
    el.setAttribute(MANAGED_ATTR, "");
    document.head.appendChild(el);
  }
  el.content = value;
}

function setLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    el.setAttribute(MANAGED_ATTR, "");
    document.head.appendChild(el);
  }
  el.href = href;
}

function setJsonLd(blocks: object[]): void {
  document.head
    .querySelectorAll(`script[type="application/ld+json"][${MANAGED_ATTR}]`)
    .forEach((n) => n.remove());

  for (const block of blocks) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(MANAGED_ATTR, "");
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  }
}

/* -------------------------------------------------------------------------- */
/* Structured data builders                                                    */
/* -------------------------------------------------------------------------- */

export function gamePath(slug: string, sub?: "guides" | "dlc" | "prices" | "reviews"): string {
  const cleanSlug = encodeURIComponent(String(slug || "").trim());
  return sub ? `/product/${cleanSlug}?tab=${sub}` : `/product/${cleanSlug}`;
}

export function buildProductJsonLd(game: Game): object | null {
  const buyable = (game.offers ?? []).filter((o) => o.availability !== "delisted");
  if (buyable.length === 0 && !game.coverUrl) return null;

  const ranked = rankOffers(buyable, "USD", (a) => a);
  const prices = ranked.map((r) => r.offer.price.amount).filter((n) => Number.isFinite(n));

  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.title,
    alternateName: game.subtitle || undefined,
    description: game.description,
    image: game.coverUrl,
    url: `${SITE_URL}${gamePath(game.slug)}`,
    gamePlatform: game.platforms.map(platformLabel),
    genre: game.genres,
    author: game.developer ? { "@type": "Organization", name: game.developer.name } : undefined,
    publisher: game.publisher ? { "@type": "Organization", name: game.publisher.name } : undefined,
    datePublished: game.releaseDate,
    contentRating: game.ageRating ? `${game.ageRating.system} ${game.ageRating.label}` : undefined,
    numberOfPlayers: game.multiplayer?.players
      ? {
          "@type": "QuantitativeValue",
          minValue: game.multiplayer.players.min,
          maxValue: game.multiplayer.players.max,
        }
      : undefined,
    inLanguage: game.languages?.map((l) => l.code),
  };

  if (game.reviewSummary && game.reviewSummary.total > 0) {
    product["aggregateRating"] = {
      "@type": "AggregateRating",
      ratingValue: Number(game.reviewSummary.average.toFixed(1)),
      reviewCount: game.reviewSummary.total,
      bestRating: 5,
      worstRating: 1,
    };
  }

  if (prices.length > 0) {
    product["offers"] = {
      "@type": "AggregateOffer",
      /*
        The currency the amounts are actually in — the shop's dinars. This said
        "USD" over raw IQD figures, so a search result could show a 25,000 IQD
        game as $25,000.
      */
      priceCurrency: ranked[0]?.offer.price.currency || "IQD",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
      availability: availabilitySchema(ranked[0]?.offer),
    };
  }

  return stripUndefined(product);
}

export function buildVideoJsonLd(game: Game): object[] {
  return (game.videos ?? []).slice(0, 5).map((video) =>
    stripUndefined({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: video.title,
      description: `${video.title} — ${game.title}`,
      thumbnailUrl: video.thumbnailUrl,
      uploadDate: video.publishedAt,
      embedUrl: video.embedUrl,
      duration: video.duration ? `PT${Math.round(video.duration)}S` : undefined,
    }),
  );
}

export function buildFaqJsonLd(game: Game): object | null {
  if (!game.faq?.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: game.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function buildBreadcrumbJsonLd(trail: Array<{ name: string; path: string }>): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${SITE_URL}${crumb.path}`,
    })),
  };
}

function availabilitySchema(offer?: StoreOffer): string {
  switch (offer?.availability) {
    case "in-stock":
    case "low-stock":
      return "https://schema.org/InStock";
    case "preorder":
      return "https://schema.org/PreOrder";
    case "out-of-stock":
      return "https://schema.org/OutOfStock";
    default:
      return "https://schema.org/Discontinued";
  }
}

export function platformLabel(id: string): string {
  const map: Record<string, string> = {
    switch: "Nintendo Switch",
    switch2: "Nintendo Switch 2",
    ps5: "PlayStation 5",
    ps4: "PlayStation 4",
    "xbox-series": "Xbox Series X|S",
    "xbox-one": "Xbox One",
    pc: "PC",
  };
  return map[id] ?? id;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}
