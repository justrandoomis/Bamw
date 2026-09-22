/**
 * The pictures behind a category header.
 *
 * This is the banner pool the slideshow flips through, lifted out of
 * `/category/$categoryId` unchanged in what it selects and bounded in what it
 * keeps. It used to gather EVERY screenshot, gallery image, hero and wallpaper
 * URL across every product in the category and hand back all of them — on the
 * games category that is thousands of URLs for a slideshow that shows one
 * every two and a half seconds. The caller then preloaded the lot at once.
 *
 * The selection rules below are copied verbatim, because which pictures are
 * eligible is a thing the shop decided and not a thing a performance fix gets
 * to change. Only the size of the answer is new.
 */

/** A slideshow nobody watches for half an hour needs no more than this. */
export const BANNER_POOL_LIMIT = 24;

/**
 * Artwork that is a cartridge or a thumbnail, not a scene.
 *
 * A missing URL counts as cartridge-like so it is dropped: the header wants
 * gameplay, and an empty string is not it.
 */
function isCartridgeLike(url?: string | null): boolean {
  if (!url || typeof url !== "string") return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("cartridge") ||
    lower.includes("/cartridges/") ||
    lower.includes("cart_") ||
    lower.includes("cover_thumb")
  );
}

/** Does this product belong to the category whose header we are dressing? */
export function bannerCategoryMatch(p: any, categoryId: string): boolean {
  const targetCat = String(categoryId || "").toLowerCase();
  const pCat = String(p?.category || p?.categoryId || "").toLowerCase();
  const pKind = String(p?.kind || "").toLowerCase();

  return (
    pCat === targetCat ||
    pKind === targetCat ||
    categoryId === "all" ||
    (targetCat === "nintendo_games" &&
      (pCat === "cat_nintendo" ||
        pCat === "nintendo-switch-games" ||
        pKind === "nintendo-switch-games"))
  );
}

/** Every picture one product offers the header, in the order it offers them. */
export function bannerCandidates(p: any): string[] {
  const candidates: (string | undefined | null)[] = [
    p?.banner,
    p?.bannerImage,
    p?.heroImage,
    p?.keyArt,
    p?.wallpaper,
    p?.background,
  ];

  if (Array.isArray(p?.gallery)) {
    p.gallery.forEach((g: any) => candidates.push(typeof g === "string" ? g : g?.url));
  } else if (typeof p?.gallery === "string") {
    p.gallery.split(",").forEach((s: string) => candidates.push(s.trim()));
  }

  if (Array.isArray(p?.galleryImages)) {
    p.galleryImages.forEach((img: any) =>
      candidates.push(typeof img === "string" ? img : img?.url),
    );
  }

  if (Array.isArray(p?.screenshots)) {
    p.screenshots.forEach((s: any) =>
      candidates.push(typeof s === "string" ? s : s?.imageUrl || s?.url),
    );
  }

  if (Array.isArray(p?.metadata?.images?.screenshots)) {
    p.metadata.images.screenshots.forEach((s: any) => candidates.push(s?.imageUrl || s?.url));
  }

  if (Array.isArray(p?.metadata?.screenshots)) {
    p.metadata.screenshots.forEach((s: any) =>
      candidates.push(typeof s === "string" ? s : s?.imageUrl || s?.url),
    );
  }

  const out: string[] = [];
  candidates.forEach((img) => {
    if (typeof img === "string" && img.length > 5 && !isCartridgeLike(img)) out.push(img);
  });
  return out;
}

/**
 * A bounded, shuffled pool of header pictures for one category.
 *
 * Bounded by reservoir sampling rather than by taking the first N: the
 * catalogue is sorted, and the first N products are always the same products,
 * so a head-of-list cap would show the same few games' screenshots to
 * everyone forever. A reservoir gives every eligible picture in the category
 * the same chance of being on the shelf today while still only ever holding
 * `limit` of them.
 */
export function categoryBannerPool(
  products: any[] | undefined,
  categoryId: string,
  limit: number = BANNER_POOL_LIMIT,
  random: () => number = Math.random,
): string[] {
  if (!Array.isArray(products) || products.length === 0 || limit <= 0) return [];

  const seen = new Set<string>();
  const reservoir: string[] = [];
  let considered = 0;

  for (const p of products) {
    if (!bannerCategoryMatch(p, categoryId)) continue;
    for (const url of bannerCandidates(p)) {
      if (seen.has(url)) continue;
      seen.add(url);

      if (reservoir.length < limit) {
        reservoir.push(url);
      } else {
        const j = Math.floor(random() * (considered + 1));
        if (j < limit) reservoir[j] = url;
      }
      considered++;
    }
  }

  // Shuffle what survived, so the order is not the order they were met in.
  for (let i = reservoir.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = reservoir[i] as string;
    reservoir[i] = reservoir[j] as string;
    reservoir[j] = tmp;
  }

  return reservoir;
}
