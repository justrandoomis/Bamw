/**
 * The one place that decides which picture a product shows.
 *
 * ## Why this exists
 *
 * Every surface used to pick its own field. The home strip read
 * `cartridgeImage → image → coverImage`, the hub read
 * `coverImage → cartridgeImage → image`, the cart read one order for local
 * lines and a different one for server lines, and the add-to-cart toast reached
 * straight into the gallery. So one product legitimately showed four different
 * pictures on four screens, and a banner or a screenshot could end up standing
 * in for a box cover. There was no bug to fix in any single component — the bug
 * was that the decision had no owner.
 *
 * It has one now. Components ask {@link getNintendoMedia} for a *role* and get
 * back the field that role is defined to mean — or a placeholder. Never a
 * different kind of picture.
 *
 * ## Storage format is not purpose
 *
 * Every one of these fields holds a WebP in Cloudflare R2. That describes how
 * the bytes are stored; it says nothing about what the picture *is*. A square
 * card asset and a vertical retail packshot are both "a WebP in R2" and are
 * still not interchangeable. The roles below are about purpose.
 *
 * ## The fields, and what each one means
 *
 * | role | field | meaning |
 * | --- | --- | --- |
 * | `square-card` | `nintendoCardImage` | square / near-square art for compact platform cards |
 * | `front-box` | `cartridgeImage` | **canonical front box cover** — vertical retail packshot |
 * | `detail-cover` | `coverImage` | the product detail page's primary cover |
 * | `3d-texture` | `coverHiResImage` | full case wrap (back + spine + front) for the 3D sleeve |
 * | `banner` | `bannerImage`, `banner` | wide key art — never a cover |
 * | `gallery` | `galleryImages`, `gallery` | screenshots — never a cover |
 *
 * `cartridgeImage` keeps its database name (thousands of rows and the whole
 * import template use it) but its *meaning* is fixed: the vertical front box
 * cover. Renaming the column would rewrite product identity for no gain, so the
 * name stays and the role layer above it carries the meaning.
 *
 * ## The rule that stops the old bugs coming back
 *
 * **A role never falls back to a different role.** A product with no square
 * card asset shows the placeholder on a square card — it does not borrow the
 * front box cover, because a wrong picture reads as a data error to a customer
 * while a placeholder reads as "artwork pending". The same holds in every
 * direction: no banner into a cover slot, no front cover into the 3D wrap slot,
 * no gallery frame anywhere but the gallery.
 */

/**
 * What the picture is *for*. Each role maps to exactly one family of fields and
 * never borrows from another.
 */
export type NintendoMediaRole =
  /** Compact game card with square artwork (home Switch strip and /nintendo_games). */
  | "square-card"
  /** Vertical retail front box cover for box-art and case surfaces. */
  | "front-box"
  /** The product detail page's primary cover. */
  | "detail-cover"
  /** Full printed case wrap — back + spine + front — for the WebGL sleeve. */
  | "3d-texture"
  /** Wide key art. Never falls back to a cover. */
  | "banner"
  /** Screenshots. Never used as a cover. */
  | "gallery";

/**
 * Legacy usage names still used by non-game surfaces (hardware, accessories,
 * bundles, cart, toast). They resolve through {@link PURCHASE_THUMB_FIELDS},
 * which is a thumbnail chain for entities that have no Nintendo box art at all
 * — it stays inside cover-type fields and never reaches a banner or a gallery.
 */
export type NintendoImageUsage =
  | NintendoMediaRole
  /** @deprecated Use the `front-box` or `detail-cover` role. */
  | "front-cover"
  | "listing-card"
  | "bundle-card"
  | "cart"
  | "toast";

/**
 * Usages that frame a **box**, and therefore want the empty field around the
 * packshot removed before the image is encoded.
 *
 * Supplier feeds ship box art as a small box floating in a large white
 * rectangle. `object-fit: contain` reproduces that faithfully — which is the
 * "white outer background" on the product page and the scattered-stamps look in
 * a cover grid. The margin lives in the file, so it is removed in the image
 * pipeline (`/api/img?trim=1`), not with a CSS crop that only the components
 * remembering to apply it would benefit from.
 *
 * Deliberately not here: `3d-texture` (a full wrap, edge to edge by design),
 * `banner`, `gallery` and `detail-cover` — all of which legitimately reach
 * their own edges, and trimming one would cut into the picture.
 */
export const TRIMMED_USAGES: ReadonlySet<NintendoImageUsage> = new Set<NintendoImageUsage>([
  "front-box",
  "front-cover",
  "listing-card",
  "bundle-card",
  "square-card",
  "cart",
  "toast",
]);

/** Should this usage ask the image pipeline to trim the packshot's margin? */
export function usageWantsTrim(usage: NintendoImageUsage): boolean {
  return TRIMMED_USAGES.has(usage);
}

export interface ResolvedImage {
  /** The placeholder for this role when nothing usable exists. */
  url: string;
  /** Which product field the URL came from — useful in tests and diagnostics. */
  source: string;
  /** Stored crop rectangle for `url`, when the catalogue carries one. */
  trim?: unknown;
  /** True when `url` is a placeholder rather than product artwork. */
  isPlaceholder: boolean;
  /**
   * Further URLs from *the same role* to try if the primary one 404s. Never
   * another role's field — a broken square card falls back to the placeholder,
   * not to the box cover.
   */
  fallbackUrls?: string[];
}

/**
 * Local, neutral placeholder. Deliberately not a photo of a different game:
 * the previous fallback pulled random stock imagery (and, worse, a hardcoded
 * table of "known" covers matched by title substring), so a product with no
 * artwork advertised somebody else's box.
 */
export const NINTENDO_IMAGE_PLACEHOLDER = "/illustrations/cover-placeholder.svg";

/**
 * Per-role placeholder. Same asset today for every 2D role — the point is that
 * each role has its *own* answer to "nothing here", so a missing square card
 * can never be filled by a front cover. `3d-texture` has no placeholder at all:
 * a texture is either the real wrap or absent, and the viewer decides what to
 * do about it (see {@link resolveNintendoMedia}).
 */
export const ROLE_PLACEHOLDER: Record<NintendoMediaRole, string> = {
  "square-card": NINTENDO_IMAGE_PLACEHOLDER,
  "front-box": NINTENDO_IMAGE_PLACEHOLDER,
  "detail-cover": NINTENDO_IMAGE_PLACEHOLDER,
  "3d-texture": "",
  banner: NINTENDO_IMAGE_PLACEHOLDER,
  gallery: NINTENDO_IMAGE_PLACEHOLDER,
};

/** Product fields that carry square / near-square card artwork. */
export const SQUARE_CARD_FIELDS = [
  "nintendoCardImage",
  "nintendo_card_image",
  "squareGameImage",
  "squareImage",
  "square_card_image",
] as const;

/**
 * Product fields that carry the vertical front box cover.
 *
 * `coverImage` is deliberately **not** here: it is the detail cover's field.
 * Neither is `image` / `imageUrl` / `mainImage` — those are the generic
 * thumbnail carriers non-game products use, and letting them in is how a
 * screenshot once became a box cover.
 */
export const FRONT_BOX_FIELDS = [
  "cartridgeImage",
  "cartridge_image",
  "front_image",
  "frontImage",
  "box_front_url",
  "boxFrontUrl",
  "front_box_cover",
] as const;

/** Product fields that carry the product detail page's primary cover. */
export const DETAIL_COVER_FIELDS = ["coverImage", "cover_image", "coverUrl"] as const;

/**
 * Product fields that carry a full printed case wrap (back + spine + front) for
 * the 3D sleeve. See src/lib/coverTexture.ts for what the image must contain.
 *
 * A front cover is *not* in this list. The model's UVs wrap a single texture
 * across three faces, so handing it front-only art paints the front onto the
 * back and spine. When there is no wrap, the viewer composes one explicitly
 * instead of the resolver silently substituting one.
 */
export const TEXTURE_SOURCE_FIELDS = [
  "coverHiResImage",
  "coverHiRes",
  "textureSourceImage",
  "3d_texture_source",
  "full_cover",
  "fullCover",
  "box_cover",
  "boxCover",
  "sleeveUrl",
  "sleeve_url",
  "wrapImage",
  "wrap_image",
  "wrapUrl",
  "wrap_url",
] as const;

/** Product fields that carry a full printed wrap (sleeve: back + spine + front). */
export const WRAP_COVER_FIELDS = [
  "full_cover",
  "fullCover",
  "box_cover",
  "boxCover",
  "sleeveUrl",
  "sleeve_url",
  "wrapImage",
  "wrap_image",
  "wrapUrl",
  "wrap_url",
  "caseSleeve",
] as const;

/** Product fields that carry wide key art. Never used for a cover. */
export const BANNER_FIELDS = ["bannerImage", "banner", "keyArtUrl", "regionBanner"] as const;

/**
 * Thumbnail chain for entities that are not Nintendo games — hardware,
 * accessories, gift cards, account bundles — plus the cart, toast and any
 * legacy row saved before the semantic fields existed.
 *
 * This is the one place a generic `image` field is still read, and it exists
 * because a controller or a gift card genuinely has no "front box cover". It
 * still never reaches a banner or a gallery.
 */
export const PURCHASE_THUMB_FIELDS = [
  ...FRONT_BOX_FIELDS,
  ...DETAIL_COVER_FIELDS,
  "image",
  "mainImage",
  "imageUrl",
] as const;

/**
 * @deprecated Kept so existing imports keep compiling. Prefer
 * {@link FRONT_BOX_FIELDS} for the box cover role or
 * {@link PURCHASE_THUMB_FIELDS} for a non-game thumbnail.
 */
export const FRONT_COVER_FIELDS = PURCHASE_THUMB_FIELDS;

/** @deprecated Prefer {@link TEXTURE_SOURCE_FIELDS}. */
export const HI_RES_COVER_FIELDS = TEXTURE_SOURCE_FIELDS;

/** Fields each role is allowed to read, and nothing else. */
const ROLE_FIELDS: Record<NintendoMediaRole, readonly string[]> = {
  "square-card": SQUARE_CARD_FIELDS,
  "front-box": FRONT_BOX_FIELDS,
  "detail-cover": DETAIL_COVER_FIELDS,
  "3d-texture": TEXTURE_SOURCE_FIELDS,
  banner: BANNER_FIELDS,
  gallery: [],
};

/** Legacy usage → role. The purchase surfaces keep the generic thumb chain. */
const LEGACY_USAGE_ROLE: Record<string, NintendoMediaRole> = {
  "front-cover": "front-box",
  "listing-card": "front-box",
  "bundle-card": "front-box",
  cart: "front-box",
  toast: "front-box",
};

/** Legacy usages that may read {@link PURCHASE_THUMB_FIELDS} rather than one role. */
const PURCHASE_USAGES = new Set(["front-cover", "listing-card", "bundle-card", "cart", "toast"]);

/** Where a stored crop rectangle lives for each field. */
export const TRIM_FIELDS: Record<string, string> = {
  cartridgeImage: "cartridgeImageTrim",
  coverImage: "coverImageTrim",
  nintendoCardImage: "nintendoCardImageTrim",
};

/**
 * A URL we are willing to render.
 *
 * Import feeds produce `"[object Object]"` when a nested value is stringified,
 * `"undefined"`/`"null"` from template interpolation, and whitespace-only cells
 * from spreadsheets. All three render as a broken image, so they are rejected
 * here rather than at every call site.
 */
export function isUsableImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = value.trim();
  if (url.length < 3) return false;
  if (/^(?:\[object\s|undefined$|null$|nan$|#|javascript:)/i.test(url)) return false;
  if (url === "[object Object]") return false;
  // Anything else must at least look addressable.
  return /^(?:https?:\/\/|\/|data:image\/)/i.test(url);
}

/** First usable URL from a list-shaped field (strings or `{url}`/`{src}` rows). */
function firstFromList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (isUsableImageUrl(entry)) return entry.trim();
    if (entry && typeof entry === "object") {
      const row = entry as Record<string, unknown>;
      for (const key of ["url", "src", "imageUrl", "image"]) {
        if (isUsableImageUrl(row[key])) return String(row[key]).trim();
      }
    }
  }
  return null;
}

function collectCandidates(
  product: Record<string, unknown>,
  fields: readonly string[],
): { url: string; source: string }[] {
  const seen = new Set<string>();
  const candidates: { url: string; source: string }[] = [];
  for (const field of fields) {
    const value = product[field];
    if (isUsableImageUrl(value)) {
      const trimmed = value.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        candidates.push({ url: trimmed, source: field });
      }
    }
  }
  return candidates;
}

function pick(
  product: Record<string, unknown>,
  fields: readonly string[],
): { url: string; source: string; fallbacks: string[] } | null {
  const candidates = collectCandidates(product, fields);
  if (candidates.length === 0) return null;
  const primary = candidates[0]!;
  const fallbacks = candidates.slice(1).map((c) => c.url);
  return { ...primary, fallbacks };
}

function placeholderFor(role: NintendoMediaRole): ResolvedImage {
  return {
    url: ROLE_PLACEHOLDER[role],
    source: "placeholder",
    isPlaceholder: true,
    fallbackUrls: [],
  };
}

function withTrim(
  product: Record<string, unknown>,
  hit: { url: string; source: string; fallbacks?: string[] },
): ResolvedImage {
  const trimField = TRIM_FIELDS[hit.source];
  const trim = trimField ? product[trimField] : undefined;
  return {
    url: hit.url,
    source: hit.source,
    isPlaceholder: false,
    fallbackUrls: hit.fallbacks || [],
    ...(trim ? { trim } : {}),
  };
}

/**
 * Resolves the picture for a semantic role.
 *
 * There is deliberately **no cross-role fallback**. Each role reads its own
 * fields, in order, and returns that role's placeholder when none of them holds
 * a usable URL:
 *
 * - **square-card** → `nintendoCardImage → squareGameImage → …` → placeholder.
 *   Never the front box cover: the home strip would otherwise show a vertical
 *   packshot squeezed into a square window and look like a rendering bug.
 * - **front-box** → `cartridgeImage → front_image → box_front_url → …` →
 *   placeholder. Never the square card, never `image`.
 * - **detail-cover** → `coverImage → coverUrl` → placeholder.
 * - **3d-texture** → `coverHiResImage → …wrap fields` → *empty*. The wrap has
 *   no stand-in; the viewer composes a sleeve from the front box cover only
 *   when it explicitly asks for that (see `CaseStageWebGL`).
 * - **banner** → `bannerImage → banner → keyArtUrl` → placeholder. It never
 *   falls back to a cover, just as a cover never falls back to a banner.
 * - **gallery** → `galleryImages → gallery → images` → placeholder.
 */
export function getNintendoMedia(
  product: Record<string, unknown> | null | undefined,
  role: NintendoMediaRole,
): ResolvedImage {
  if (!product || typeof product !== "object") return placeholderFor(role);

  if (role === "gallery") {
    const shot =
      firstFromList(product["galleryImages"]) ??
      firstFromList(product["gallery"]) ??
      firstFromList(product["images"]);
    if (shot) return { url: shot, source: "gallery", isPlaceholder: false, fallbackUrls: [] };
    return placeholderFor(role);
  }

  if (role === "banner") {
    const hit = pick(product, BANNER_FIELDS);
    if (hit) return withTrim(product, hit);
    return placeholderFor(role);
  }

  const hit = pick(product, ROLE_FIELDS[role]);
  if (hit) return withTrim(product, hit);
  return placeholderFor(role);
}

/** URL-only convenience wrapper around {@link getNintendoMedia}. */
export function getNintendoMediaUrl(
  product: Record<string, unknown> | null | undefined,
  role: NintendoMediaRole,
): string {
  return getNintendoMedia(product, role).url;
}

/**
 * Role-or-legacy-usage entry point.
 *
 * New code should call {@link getNintendoMedia} with a role. This wrapper also
 * accepts the older usage names so the non-game surfaces (hardware cards, the
 * cart, the add-to-cart toast) keep their generic thumbnail chain.
 */
export function resolveNintendoImage(
  product: Record<string, unknown> | null | undefined,
  usage: NintendoImageUsage = "front-cover",
): ResolvedImage {
  const role = (LEGACY_USAGE_ROLE[usage] ?? usage) as NintendoMediaRole;

  if (PURCHASE_USAGES.has(usage)) {
    if (!product || typeof product !== "object") return placeholderFor(role);
    const hit = pick(product, PURCHASE_THUMB_FIELDS);
    if (hit) return withTrim(product, hit);
    return placeholderFor(role);
  }

  return getNintendoMedia(product, role);
}

/**
 * Resolves whether the product has an authentic full wrap sleeve
 * (back + spine + front printed insert). Returns undefined if only front artwork exists.
 */
export function resolveCaseSleeve(
  product: Record<string, unknown> | null | undefined,
): { url: string } | undefined {
  if (!product || typeof product !== "object") return undefined;

  // Direct caseSleeve object
  if (product["caseSleeve"] && typeof product["caseSleeve"] === "object") {
    const cs = product["caseSleeve"] as { url?: unknown };
    if (isUsableImageUrl(cs.url)) {
      return { url: cs.url.trim() };
    }
  }

  const hit = pick(product, WRAP_COVER_FIELDS);
  if (hit && isUsableImageUrl(hit.url)) {
    return { url: hit.url.trim() };
  }

  return undefined;
}

/** Convenience wrapper for the common case. */
export function resolveNintendoImageUrl(
  product: Record<string, unknown> | null | undefined,
  usage: NintendoImageUsage = "front-cover",
): string {
  return resolveNintendoImage(product, usage).url;
}

/**
 * The cart, the bundle card and the add-to-cart toast must agree, because the
 * same purchase is shown on all three within a couple of seconds and a mismatch
 * reads as "I added the wrong thing". They share this one entry point, which
 * covers every kind of product the store sells — not just Nintendo games.
 */
export function resolvePurchaseImage(
  product: Record<string, unknown> | null | undefined,
): ResolvedImage {
  return resolveNintendoImage(product, "cart");
}

/**
 * Display ratio for a front-cover frame.
 *
 * Fixed rather than derived from the file, so a row of covers is a row of equal
 * rectangles whatever mix of sources it came from. 0.72 is a retail Switch keep
 * case (10.4 × 17.2 cm is 0.60, but store packshots are consistently squarer);
 * with the margin trimmed, artwork fills it with no visible letterbox.
 */
export const COVER_ASPECT_RATIO = 0.72;

/** Display ratio for the compact platform card's artwork window. */
export const SQUARE_CARD_ASPECT_RATIO = 1;
