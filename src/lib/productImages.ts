/**
 * Which picture each storefront surface shows for a **non-game** product.
 *
 * Nintendo Switch Games are not served from here. Their roles
 * (`square-card`, `front-box`, `detail-cover`, `3d-texture`, banner, gallery)
 * live in `src/lib/nintendoImages.ts` and deliberately have **no** cross-role
 * fallback: a missing square card shows a placeholder rather than a vertical
 * box cover, because a wrong picture reads as a data error while a placeholder
 * reads as "artwork pending".
 *
 * Hardware, accessories, amiibo, gift cards, used items and bundles are a
 * different problem. They have no box art, and their import templates carry a
 * dozen genuinely different photographs of one object — front, back, packaging,
 * close-up, lifestyle. Here a fallback is not a category error: a listing card
 * that cannot find `listing_image` and shows `front_image` is showing *the same
 * product from a defensible angle*, which is strictly better than a grey box.
 *
 * What is still forbidden is an *undefined* fallback. Each context below has
 * one written chain, the same on every screen, and nothing outside its chain:
 *
 * | context | chain |
 * | --- | --- |
 * | listing card | `listing_image → main_image → front_image → packaging_front_image → first gallery frame` |
 * | product hero | `main_image → front_image → packaging_front_image → listing_image` |
 * | details background | `cover_image → banner_image → main_image` |
 * | thumbnail | `thumbnail_image → listing_image → main_image` |
 *
 * A banner never enters a hero or a listing card, and a hero never falls back
 * to a gallery screenshot — those are the substitutions that made one product
 * look like four different products across the store.
 */

import { isUsableImageUrl, NINTENDO_IMAGE_PLACEHOLDER } from "./nintendoImages";

export type ProductImageContext = "listing" | "hero" | "background" | "thumbnail";

export interface ResolvedProductImage {
  url: string;
  /** Which field answered — useful in tests and in the media audit. */
  source: string;
  isPlaceholder: boolean;
  /** Remaining candidates from the *same* chain, for an `onError` retry. */
  fallbackUrls: string[];
}

/**
 * Field aliases per template key, newest name first.
 *
 * Both spellings exist in D1: the import parser writes camelCase targets, while
 * rows created before the schema system (and the raw template keys themselves)
 * are snake_case. Reading both is what lets old products keep working without a
 * migration that rewrites product identity.
 */
const FIELDS = {
  listing: ["listingImage", "listing_image"],
  main: ["mainImage", "main_image"],
  front: ["frontImage", "front_image"],
  packagingFront: ["packagingFrontImage", "packaging_front_image"],
  cover: ["coverImage", "cover_image"],
  banner: ["bannerImage", "banner_image"],
  thumbnail: ["thumbnailImage", "thumbnail_image"],
} as const;

/** The one chain per context. Order is the contract; nothing reorders it. */
const CHAINS: Record<ProductImageContext, readonly (keyof typeof FIELDS)[]> = {
  listing: ["listing", "main", "front", "packagingFront"],
  hero: ["main", "front", "packagingFront", "listing"],
  background: ["cover", "banner", "main"],
  thumbnail: ["thumbnail", "listing", "main"],
};

/**
 * Contexts allowed to reach the gallery as a last resort.
 *
 * Only the listing card: a card with no picture at all is a hole in a grid,
 * and a product photograph from the gallery is still a photograph of this
 * product. A hero does not do this — a screenshot presented as the main image
 * of a physical object is the misrepresentation this module exists to prevent.
 */
const GALLERY_LAST_RESORT: ReadonlySet<ProductImageContext> = new Set(["listing"]);

function readField(product: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = product[name];
    if (isUsableImageUrl(value)) return value.trim();
  }
  return null;
}

function galleryFrames(product: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["gallery", "galleryImages", "lifestyleImages", "images"]) {
    const value = product[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (isUsableImageUrl(entry)) out.push(entry.trim());
      else if (entry && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        for (const field of ["url", "image", "src", "imageUrl"]) {
          if (isUsableImageUrl(row[field])) {
            out.push(String(row[field]).trim());
            break;
          }
        }
      }
    }
  }
  return out;
}

export function resolveProductImage(
  product: Record<string, unknown> | null | undefined,
  context: ProductImageContext,
): ResolvedProductImage {
  const placeholder: ResolvedProductImage = {
    url: NINTENDO_IMAGE_PLACEHOLDER,
    source: "placeholder",
    isPlaceholder: true,
    fallbackUrls: [],
  };
  if (!product || typeof product !== "object") return placeholder;

  const candidates: { url: string; source: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, source: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, source });
  };

  for (const step of CHAINS[context]) push(readField(product, FIELDS[step]), step);
  if (GALLERY_LAST_RESORT.has(context)) {
    for (const frame of galleryFrames(product)) push(frame, "gallery");
  }

  const primary = candidates[0];
  if (!primary) return placeholder;
  return {
    url: primary.url,
    source: primary.source,
    isPlaceholder: false,
    fallbackUrls: candidates.slice(1).map((c) => c.url),
  };
}

/** URL-only wrapper for the common case. */
export function productImageUrl(
  product: Record<string, unknown> | null | undefined,
  context: ProductImageContext,
): string {
  return resolveProductImage(product, context).url;
}

/**
 * Every distinct product photograph, in the order a gallery should show them.
 *
 * The hero picture leads, the remaining named roles follow in a fixed
 * anatomical order, then the free-form gallery. Fixed rather than
 * `Object.keys` order so two products with the same fields always present them
 * the same way.
 */
export const GALLERY_FIELD_ORDER: readonly (keyof typeof FIELDS | "closeUp" | "back" | "left" | "right" | "packagingBack")[] =
  ["main", "front", "back", "left", "right", "closeUp", "packagingFront", "packagingBack", "listing"];

const EXTRA_FIELDS: Record<string, readonly string[]> = {
  back: ["backImage", "back_image"],
  left: ["leftImage", "left_image"],
  right: ["rightImage", "right_image"],
  closeUp: ["closeUpImage", "close_up_image"],
  packagingBack: ["packagingBackImage", "packaging_back_image"],
};

export function productGalleryImages(
  product: Record<string, unknown> | null | undefined,
): string[] {
  if (!product || typeof product !== "object") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  };

  for (const role of GALLERY_FIELD_ORDER) {
    const names = (FIELDS as Record<string, readonly string[]>)[role] ?? EXTRA_FIELDS[role];
    if (names) push(readField(product, names));
  }
  for (const frame of galleryFrames(product)) push(frame);
  return out;
}
