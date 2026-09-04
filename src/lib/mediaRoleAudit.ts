/**
 * Warns when a product's images do not respect their roles.
 *
 * The five Nintendo image fields have five different jobs, and the storefront
 * enforces that: each surface asks for one role and shows a placeholder rather
 * than borrowing another. That is the right behaviour, but it makes a data
 * problem *silent* — a product whose square card and box cover are the same
 * file looks fine until you notice the homepage strip is full of tall boxes
 * squeezed into square windows.
 *
 * So the check belongs at save and import time, where a human can still fix it.
 * Everything here is a **warning**. Nothing blocks a save: 3D Texture Source is
 * optional by design, and a genuine exception (a game whose key art really is
 * its banner) should be possible without arguing with the tool.
 */

/** A role, its field, and how it is described to an admin. */
const ROLES = [
  {
    role: "front-box",
    label: "Front Box Cover",
    labelAr: "غلاف العلبة الأمامي",
    fields: ["cartridgeImage", "cartridge_image", "front_image", "box_front_url"],
  },
  {
    role: "square-card",
    label: "Square Card Image",
    labelAr: "صورة البطاقة المربعة",
    fields: ["nintendoCardImage", "nintendo_card_image", "squareGameImage", "squareImage"],
  },
  {
    role: "detail-cover",
    label: "Cover Image",
    labelAr: "صورة الغلاف",
    fields: ["coverImage", "cover_image", "coverUrl"],
  },
  {
    role: "3d-texture",
    label: "3D Texture Source",
    labelAr: "مصدر نسيج المجسم",
    fields: ["coverHiResImage", "coverHiRes", "textureSourceImage"],
  },
] as const;

export type MediaRole = (typeof ROLES)[number]["role"];

export interface MediaRoleIssue {
  code:
    | "duplicate-across-roles"
    | "missing-front-box"
    | "missing-square-card"
    | "duplicate-banner"
    | "duplicate-gallery"
    | "gallery-reuses-cover"
    | "duplicate-listing-image"
    | "foreign-image-host"
    | "empty-image-slot";
  /** Arabic, because that is what the admin panel shows. */
  message: string;
  severity: "warning";
  roles?: MediaRole[];
}

function firstValue(product: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = product[field];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 2) return trimmed;
    }
  }
  return null;
}

/**
 * Two URLs pointing at the same picture.
 *
 * Compared without the query string, because the same R2 object requested at
 * two widths (`?w=320` and `?w=800`) is still one image — and that is the most
 * common way the duplicate hides.
 */
function sameImage(a: string, b: string): boolean {
  const strip = (url: string) => url.split("?")[0]!.replace(/\/+$/, "").toLowerCase();
  return strip(a) === strip(b);
}

function listOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        for (const key of ["url", "src", "image", "imageUrl"]) {
          if (typeof row[key] === "string") return row[key] as string;
        }
      }
      return "";
    })
    .filter((url) => url.trim().length > 2);
}

/**
 * Reports role problems in a product's media. Never throws, never blocks.
 *
 * Ordered so the two that actually break a storefront surface come first.
 */
export function auditMediaRoles(product: Record<string, unknown> | null | undefined): MediaRoleIssue[] {
  if (!product || typeof product !== "object") return [];
  const issues: MediaRoleIssue[] = [];

  const resolved = ROLES.map((entry) => ({ ...entry, url: firstValue(product, entry.fields) }));
  const byRole = new Map(resolved.map((entry) => [entry.role, entry]));

  const frontBox = byRole.get("front-box");
  const squareCard = byRole.get("square-card");

  if (!frontBox?.url) {
    issues.push({
      code: "missing-front-box",
      severity: "warning",
      roles: ["front-box"],
      message:
        "لا يوجد غلاف علبة أمامي — ستظهر صورة بديلة في «أحدث إصدارات نينتندو» و /nintendo_games، وأيضاً مكان المجسم ثلاثي الأبعاد.",
    });
  }

  if (!squareCard?.url) {
    issues.push({
      code: "missing-square-card",
      severity: "warning",
      roles: ["square-card"],
      message:
        "لا توجد صورة بطاقة مربعة — سيظهر شريط «ألعاب نينتندو سويتش» في الصفحة الرئيسية بصورة بديلة.",
    });
  }

  /*
    The same file in two roles. Reported per pair so the message names both,
    which is the only form an admin can act on.
  */
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i]!;
      const b = resolved[j]!;
      if (!a.url || !b.url || !sameImage(a.url, b.url)) continue;
      issues.push({
        code: "duplicate-across-roles",
        severity: "warning",
        roles: [a.role, b.role],
        message: `نفس الصورة مستخدمة في «${a.labelAr}» و«${b.labelAr}» — لكل دور غرض مختلف (${a.label} / ${b.label}).`,
      });
    }
  }

  const banners = listOf(product["bannerImages"]);
  const uniqueBanners = new Set(banners.map((url) => url.split("?")[0]!.toLowerCase()));
  if (banners.length > 1 && uniqueBanners.size < banners.length) {
    issues.push({
      code: "duplicate-banner",
      severity: "warning",
      message: `${banners.length} بانر لكن ${uniqueBanners.size} صورة مختلفة فقط — اترك الخانات الزائدة فارغة بدل تكرار نفس الصورة.`,
    });
  }

  const gallery = listOf(product["galleryImages"]).concat(listOf(product["gallery"]));
  const uniqueGallery = new Set(gallery.map((url) => url.split("?")[0]!.toLowerCase()));
  if (gallery.length > 1 && uniqueGallery.size < gallery.length) {
    issues.push({
      code: "duplicate-gallery",
      severity: "warning",
      message: `${gallery.length} صورة في المعرض لكن ${uniqueGallery.size} مختلفة فقط — لا تكرر نفس اللقطة لملء الخانات.`,
    });
  }

  /*
    The listing trio.

    `listingImage`, `thumbnailImage` and `frontImage` are not among the four
    Nintendo roles above, so nothing checked them — and the gift card holds one
    file in all three. They are different sizes in different places: a grid
    tile, a small thumbnail, and the front of the card. One picture doing all
    three is a picture that is wrong in at least two of them.
  */
  const LISTING_TRIO = ["listingImage", "thumbnailImage", "frontImage"] as const;
  const trio = LISTING_TRIO.map((field) => ({ field, url: firstValue(product, [field]) })).filter(
    (entry) => entry.url,
  );
  const distinctTrio = new Set(trio.map((entry) => entry.url!.split("?")[0]!.toLowerCase()));
  if (trio.length > 1 && distinctTrio.size < trio.length) {
    issues.push({
      code: "duplicate-listing-image",
      severity: "warning",
      message: `نفس الصورة في ${trio.length} خانات (${trio.map((e) => e.field).join("، ")}) — لكل خانة مقاس ومكان مختلف.`,
    });
  }

  /*
    An image the shop does not own.

    An importer that pastes a retailer's URL leaves the storefront serving a
    picture from someone else's CDN: it cannot be resized, it is not covered
    by our caching, and it disappears the day that host changes a path. Every
    image is meant to be ingested into our own storage.
  */
  const ALL_IMAGE_FIELDS = [
    ...ROLES.flatMap((role) => role.fields),
    ...LISTING_TRIO,
    "image",
    "mainImage",
    "cardArtwork",
  ];
  const OURS = /^(?:\/|https?:\/\/(?:[a-z0-9-]+\.)*(?:banan\.to|r2\.dev|cloudflarestorage\.com|nintendo\.(?:com|net|co\.jp)|nintendo-europe\.com))/i;
  const foreign = new Set<string>();
  for (const field of ALL_IMAGE_FIELDS) {
    const value = product[field];
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (url.length > 2 && !OURS.test(url)) foreign.add(new URL(url, "https://banan.to").hostname);
  }
  for (const list of ["galleryImages", "gallery", "bannerImages", "lifestyleImages", "screenshots"]) {
    for (const url of listOf(product[list])) {
      if (!OURS.test(url)) {
        try {
          foreign.add(new URL(url, "https://banan.to").hostname);
        } catch {
          /* Not a URL at all: reported by the empty-slot check instead. */
        }
      }
    }
  }
  for (const host of foreign) {
    if (host === "banan.to") continue;
    issues.push({
      code: "foreign-image-host",
      severity: "warning",
      message: `صورة مستضافة خارج تخزين المتجر (${host}) — انسخها إلى تخزيننا، وإلا ستتعطل عند تغيير ذلك الموقع لمسارها.`,
    });
  }

  /*
    A slot holding an empty string is not an empty slot.

    It counts toward the length of the array everywhere that counts frames, so
    a carousel advertises a picture it has nothing to show for.
  */
  for (const list of ["galleryImages", "gallery", "bannerImages", "lifestyleImages", "screenshots"]) {
    const value = product[list];
    if (!Array.isArray(value)) continue;
    const blanks = value.filter(
      (entry) => entry === null || entry === undefined || (typeof entry === "string" && !entry.trim()),
    ).length;
    if (blanks > 0) {
      issues.push({
        code: "empty-image-slot",
        severity: "warning",
        message: `«${list}» فيه ${blanks} خانة فارغة — احذفها بدل تركها، لأنها تُحسب كصورة في العدّاد.`,
      });
    }
  }

  // A screenshot standing in for a cover is the failure the roles exist to stop.
  for (const entry of resolved) {
    if (!entry.url) continue;
    if (gallery.some((shot) => sameImage(shot, entry.url!))) {
      issues.push({
        code: "gallery-reuses-cover",
        severity: "warning",
        roles: [entry.role],
        message: `«${entry.labelAr}» يستخدم نفس صورة موجودة في المعرض — لقطة الشاشة ليست غلافاً.`,
      });
      break;
    }
  }

  return issues;
}
