import { getNintendoMedia, NINTENDO_IMAGE_PLACEHOLDER } from "@/lib/nintendoImages";
import { normalizeProductPlatform } from "@/lib/product-identity";

type NintendoListingProduct = Record<string, unknown>;
export type NintendoPlatformFilter = "all" | "switch1" | "switch2";

function nintendoPlatformKind(product: NintendoListingProduct): string {
  const rawPlatform = String(product["platform"] ?? "")
    .trim()
    .toLowerCase();
  const compactPlatform = rawPlatform.replace(/[\s_-]+/g, "");
  if (
    compactPlatform === "switch2" ||
    compactPlatform === "nintendoswitch2" ||
    compactPlatform === "ns2"
  ) {
    return "switch2";
  }
  if (
    compactPlatform === "switch" ||
    compactPlatform === "switch1" ||
    compactPlatform === "nintendoswitch" ||
    compactPlatform === "nintendoswitch1" ||
    compactPlatform === "ns1"
  ) {
    return "switch1";
  }

  const platform = normalizeProductPlatform(rawPlatform);
  if (platform === "switch1" || platform === "switch2" || platform === "both") return platform;
  return platform;
}

/** Whether this product has artwork intended for the square game-card surface. */
export function hasNintendoSquareCard(product: NintendoListingProduct): boolean {
  const media = getNintendoMedia(product, "square-card");
  if (media.isPlaceholder) return false;
  return [media.url, ...(media.fallbackUrls ?? [])].some((url) => {
    const path = url.split(/[?#]/, 1)[0] ?? url;
    return !path.endsWith(NINTENDO_IMAGE_PLACEHOLDER);
  });
}

/**
 * The platform flag used by the compact Nintendo listing card.
 *
 * `platform` is canonical for current rows, while the two boolean fields and
 * the tag check keep older imported Switch 2 rows labelled correctly.
 */
export function isNintendoSwitch2Product(product: NintendoListingProduct): boolean {
  const platform = nintendoPlatformKind(product);
  if (platform === "switch2" || platform === "both") return true;

  const switch2 = product["switch2"];
  if (
    switch2 &&
    typeof switch2 === "object" &&
    (switch2 as Record<string, unknown>)["isSwitch2Edition"] === true
  ) {
    return true;
  }
  if (product["switch2Enhanced"] === true) return true;

  const rawTags = product["tags"];
  const tags = Array.isArray(rawTags) ? rawTags.map(String) : String(rawTags ?? "").split(/[,;|]/);
  return tags.some((tag) =>
    /^(?:nintendo[\s_-]*)?switch[\s_-]*2(?:[\s_-]*(?:edition|exclusive|enhanced))?$/i.test(
      tag.trim(),
    ),
  );
}

/** Keep the catalogue device filter consistent with the badge on the card. */
export function matchesNintendoPlatformFilter(
  product: NintendoListingProduct,
  filter: NintendoPlatformFilter,
): boolean {
  if (filter === "all") return true;

  const platform = nintendoPlatformKind(product);
  const switch2 = isNintendoSwitch2Product(product);
  const enhancedForSwitch2 = product["switch2Enhanced"] === true;

  if (filter === "switch2") return switch2;
  if (platform === "both" || enhancedForSwitch2) return true;
  // A Switch 2 edition marker overrides a stale/default Switch 1 value. Only
  // an explicit cross-generation record or enhancement belongs in both tabs.
  if (switch2) return false;
  if (!String(product["platform"] ?? "").trim()) return true;
  if (platform === "switch1") return true;
  return false;
}

/** The real sales count carried by the public product record. */
export function nintendoProductSales(product: NintendoListingProduct): number {
  const sales = Number(product["sales"]);
  return Number.isFinite(sales) && sales > 0 ? sales : 0;
}

/**
 * Home Nintendo ordering: products with real square artwork first, then the
 * best sellers in each group. The original order is the final stable tie-break
 * so no synthetic popularity or duplicated filler is introduced.
 */
export function sortNintendoGamesForHome<T extends NintendoListingProduct>(products: T[]): T[] {
  const seenIds = new Set<string>();
  const uniqueProducts = products.filter((product) => {
    const id = product["id"];
    if (id === undefined || id === null || id === "") return true;
    const key = String(id);
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });

  return uniqueProducts
    .map((product, index) => ({
      product,
      index,
      hasSquareCard: hasNintendoSquareCard(product),
      sales: nintendoProductSales(product),
    }))
    .sort(
      (a, b) =>
        Number(b.hasSquareCard) - Number(a.hasSquareCard) || b.sales - a.sales || a.index - b.index,
    )
    .map(({ product }) => product);
}
