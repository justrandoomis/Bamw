import { ingestRemoteImage, type IngestResult } from "./mediaIngest.server";
import { auditMediaRoles } from "./mediaRoleAudit";
import type { Product } from "./types";

export const SINGLE_IMAGE_FIELDS = [
  "coverImage",
  "cartridgeImage",
  "nintendoCardImage",
  "coverHiResImage",
  "banner",
  "bannerImage",
  "image",
  "cardArtwork",
  "mainImage",
  "frontCover",
  "backCover",
  "spineCover",
  /*
    These four were never ingested, so whatever URL an importer wrote stayed
    live. The Nintendo gift card is still serving `listingImage`,
    `thumbnailImage` and `frontImage` straight from a retailer's CDN, and its
    `lifestyleImages` from another one — images the shop does not own, cannot
    resize, and which break the day either host changes a path. Ingestion
    copies them into our own storage like every other role.
  */
  "listingImage",
  "thumbnailImage",
  "frontImage",
] as const;

export const ARRAY_IMAGE_FIELDS = [
  "gallery",
  "galleryImages",
  "screenshots",
  "hardwareImages",
  "accessoriesImages",
  "bannerImages",
  "amiiboImages",
  "usedImages",
  "bundleImages",
  "lifestyleImages",
] as const;

/**
 * Ensures all image fields in a product are ingested into Cloudflare R2 as WebP,
 * and canonical internal URLs are stored.
 *
 * CRITICAL ISOLATION GUARANTEE:
 * Media download/network errors (HTTP 503, 403, 429, timeouts, etc.) will NEVER
 * cause this function to return ok: false or fail the product import/save.
 * If remote media fails, the product data saves normally with the original URL preserved
 * and a warning recorded.
 */
export async function sanitizeAndVerifyProductImages(
  product: Partial<Product>
): Promise<{
  ok: boolean;
  error?: string;
  product: Partial<Product>;
  warnings?: string[];
  results?: IngestResult[];
}> {
  const productId = String(product.id || "general").replace(/[^a-zA-Z0-9_-]/g, "");
  const cloned: Record<string, any> = { ...product };
  const warnings: string[] = [];
  const results: IngestResult[] = [];

  // Helper to ingest and verify a single URL
  const processAndVerifyUrl = async (
    url: string | null | undefined,
    fieldName: string,
    index?: number
  ): Promise<string | null> => {
    if (!url || typeof url !== "string") return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    // Clean uncommitted blob URLs without blocking the save
    if (trimmed.startsWith("blob:")) {
      warnings.push(`حقل الصورة (${fieldName}) يحتوي على رابط مؤقت (blob:) تم استبعاده.`);
      return null;
    }

    const isHighQuality =
      fieldName === "coverHiResImage" ||
      fieldName.includes("3d") ||
      fieldName === "cartridgeImage";

    const result = await ingestRemoteImage({
      sourceUrl: trimmed,
      productId,
      field: fieldName,
      index,
      expectedType: fieldName.includes("gallery")
        ? "gallery"
        : fieldName === "coverHiResImage"
          ? "wrap"
          : "general",
      highQuality: isHighQuality,
    });

    results.push(result);

    if (result.ok && result.storedUrl) {
      return result.storedUrl;
    }

    if (result.warning) {
      warnings.push(result.warning);
    }

    // Never drop or break the image field if download was temporarily unavailable;
    // preserve the original URL so data is not lost and can be repaired later.
    return trimmed;
  };

  // 1. Process single image fields
  for (const field of SINGLE_IMAGE_FIELDS) {
    if (cloned[field] && typeof cloned[field] === "string") {
      const processedUrl = await processAndVerifyUrl(cloned[field], field);
      cloned[field] = processedUrl || "";
    }
  }

  // 2. Process array image fields
  for (const field of ARRAY_IMAGE_FIELDS) {
    if (Array.isArray(cloned[field]) && cloned[field].length > 0) {
      const newArray = await Promise.all(
        cloned[field].map(async (item: any, idx: number) => {
          if (typeof item === "string") {
            const processedUrl = await processAndVerifyUrl(item, field, idx + 1);
            return processedUrl || item;
          } else if (item && typeof item === "object" && typeof item.imageUrl === "string") {
            const processedUrl = await processAndVerifyUrl(item.imageUrl, `${field}_screenshot`, idx + 1);
            return { ...item, imageUrl: processedUrl || item.imageUrl };
          }
          return item;
        })
      );
      cloned[field] = newArray.filter(Boolean);
    }
  }

  // 3. Process nested structures
  if (Array.isArray(cloned.gameplayPillars)) {
    await Promise.all(
      cloned.gameplayPillars.map(async (pillar: any, idx: number) => {
        if (pillar && typeof pillar.image === "string") {
          const processedUrl = await processAndVerifyUrl(pillar.image, "gameplayPillar", idx + 1);
          if (processedUrl) pillar.image = processedUrl;
        }
      })
    );
  }

  if (cloned.story && Array.isArray(cloned.story.chapters)) {
    await Promise.all(
      cloned.story.chapters.map(async (ch: any, idx: number) => {
        if (ch && typeof ch.image === "string") {
          const processedUrl = await processAndVerifyUrl(ch.image, "storyChapter", idx + 1);
          if (processedUrl) ch.image = processedUrl;
        }
      })
    );
  }

  if (Array.isArray(cloned.dlcs)) {
    await Promise.all(
      cloned.dlcs.map(async (dlc: any, idx: number) => {
        if (dlc && typeof dlc.image === "string") {
          const processedUrl = await processAndVerifyUrl(dlc.image, "dlc", idx + 1);
          if (processedUrl) dlc.image = processedUrl;
        }
      })
    );
  }

  if (Array.isArray(cloned.editions)) {
    await Promise.all(
      cloned.editions.map(async (ed: any, idx: number) => {
        if (ed && typeof ed.cover === "string") {
          const processedUrl = await processAndVerifyUrl(ed.cover, "editionCover", idx + 1);
          if (processedUrl) ed.cover = processedUrl;
        }
      })
    );
  }

  /*
    4. No square card is manufactured from the box cover any more.

    This step used to copy `cartridgeImage`, `coverImage` or `mainImage` into
    `nintendoCardImage` whenever that field was empty — and `auditMediaRoles`,
    twenty lines below, then reported the very duplicate this had just
    created. The pipeline produced the fault and filed the complaint about it.

    The copy did not help anything either. A box cover is tall and a square
    card is square, so the homepage strip filled with tall boxes letterboxed
    into square windows, and the record no longer said which images the
    product actually had: three fields holding one file, indistinguishable in
    an admin form where each is its own box.

    Leaving the field empty is the truth, and it is what `auditMediaRoles`
    reports as `missing-square-card` — a warning naming a product that needs a
    real square image, which is something somebody can act on. Nothing already
    saved changes: this only stops the next save from inventing one.
  */

  /*
    Role warnings, after the URLs are settled.

    The storefront refuses to borrow another role's image, so a product whose
    square card and box cover are the same file renders without complaint —
    and the homepage strip quietly fills with tall boxes in square windows.
    Save time, in front of someone who can fix it, is the only place that is
    visible. Warnings only: the 3D texture is optional and a genuine exception
    must not be blocked.
  */
  for (const issue of auditMediaRoles(cloned)) {
    warnings.push(issue.message);
  }

  return {
    ok: true,
    product: cloned as Partial<Product>,
    warnings: warnings.length > 0 ? warnings : undefined,
    results,
  };
}
