import { createFileRoute } from "@tanstack/react-router";

import { randomId } from "@/lib/crypto.server";
import { coverTextureFetchHeaders } from "@/lib/coverTexture";
import { body, guard, json } from "@/lib/http.server";
import { fetchRemoteImage, readLimitedBody } from "@/lib/security.server";
import { requireAdmin, requireUser } from "@/lib/session.server";
import { hasObject, writeBinary } from "@/lib/storage.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { processImageToWebP, isWebP } from "@/lib/imageProcessor";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function isVideo(mime: string): boolean {
  return mime.startsWith("video/");
}

const MIN_REMOTE_IMAGE_BYTES = 16;

function matchesMagic(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 4) return false;

  if (mime === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/gif") {
    return new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
  }
  if (mime === "image/webp") {
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (mime === "image/bmp") {
    return bytes[0] === 0x42 && bytes[1] === 0x4d;
  }
  if (mime === "image/tiff") {
    return (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    );
  }
  if (mime === "image/avif" || mime === "image/heic" || mime === "image/heif") {
    return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  }
  // MP4 and QuickTime carry an ISO base-media `ftyp` box at offset 4.
  if (mime === "video/mp4" || mime === "video/quicktime") {
    return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  }
  // WebM/Matroska EBML header.
  if (mime === "video/webm") {
    return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  return true;
}

function sniffImageMime(bytes: Uint8Array): string | undefined {
  for (const candidate of [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/avif",
    "image/heic",
    "image/heif",
  ]) {
    if (matchesMagic(bytes, candidate)) return candidate;
  }
  return undefined;
}

import { fetchRemoteImageWithRetry, sniffImageMimeType, ingestRemoteImage } from "@/lib/mediaIngest.server";

type RemoteImage = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string };

async function downloadRemoteImage(sourceUrl: string): Promise<RemoteImage> {
  const result = await fetchRemoteImageWithRetry(sourceUrl, { maxAttempts: 4 });
  if (!result.ok || !result.bytes) {
    return { ok: false, error: result.error || "remote_fetch_failed" };
  }
  return { ok: true, bytes: result.bytes, mime: result.mime || "image/jpeg" };
}

/**
 * Handles fast, unbounded uploads directly to Cloudflare R2:
 * - Direct streaming & multipart upload without payload caps
 * - Automated WebP transformation with fine detail preservation
 * - 3D Texture mode with zero crop & ultra-high fidelity
 * - Content-hash deduplication
 * - Read-after-write verification
 */
export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!user.isAdmin) {
            const throttle = await consumeRateLimit(request, "upload", 120, 60 * 60, user.id);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          }

          const contentType = request.headers.get("content-type") || "";

          let bytes: Uint8Array;
          let mime: string;
          let targetFolder = "uploads";
          let productId = "";
          let imageType = "image";

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file");
            const formFolder = formData.get("folder");
            const formProductId = formData.get("productId");
            const formImageType = formData.get("imageType");

            if (typeof formFolder === "string") targetFolder = formFolder;
            if (typeof formProductId === "string") productId = formProductId.replace(/[^a-zA-Z0-9_-]/g, "");
            if (typeof formImageType === "string") imageType = formImageType.replace(/[^a-zA-Z0-9_-]/g, "");

            if (!file || !(file instanceof File)) {
              return json({ error: "missing_file" }, { status: 400 });
            }

            mime = file.type || sniffImageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer())) || "image/jpeg";
            const buffer = await file.arrayBuffer();
            bytes = new Uint8Array(buffer);
          } else {
            const { dataUrl, sourceUrl, folder, productId: jsonProdId, imageType: jsonImgType } = await body<{
              dataUrl?: string;
              sourceUrl?: string;
              folder?: string;
              productId?: string;
              imageType?: string;
            }>(request);

            if (folder) targetFolder = folder;
            if (jsonProdId) productId = jsonProdId.replace(/[^a-zA-Z0-9_-]/g, "");
            if (jsonImgType) imageType = jsonImgType.replace(/[^a-zA-Z0-9_-]/g, "");

            if (typeof sourceUrl === "string" && sourceUrl.trim()) {
              await requireAdmin(request);
              const isHigh =
                imageType === "3d-texture" ||
                imageType === "coverHiResImage" ||
                imageType.includes("3d") ||
                imageType === "texture" ||
                imageType === "wrap";

              const result = await ingestRemoteImage({
                sourceUrl: sourceUrl.trim(),
                productId: productId || "general",
                field: imageType || "image",
                expectedType: imageType === "wrap" ? "wrap" : imageType === "gallery" ? "gallery" : "general",
                highQuality: isHigh,
              });

              if (!result.ok || !result.storedUrl) {
                return json(
                  {
                    error: result.error || "تعذر تنزيل الصورة من المصدر الخارجي",
                    httpStatus: result.httpStatus,
                    attempts: result.attempts,
                    sourceHost: result.sourceHost,
                  },
                  { status: 422 }
                );
              }

              return json({
                success: true,
                url: result.storedUrl,
                storedUrl: result.storedUrl,
                objectKey: result.storedUrl.replace("/api/files/", "files/"),
                mime: result.mime || "image/webp",
                size: result.sizeBytes || 0,
                hash: result.sha256 || "",
                status: result.status,
              });
            } else {
              const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl ?? "");
              if (!match) return json({ error: "invalid_data_url" }, { status: 400 });

              mime = match[1]!;
              const base64 = match[2]!;

              try {
                bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
              } catch {
                return json({ error: "invalid_base64" }, { status: 400 });
              }
            }
          }

          const isHighQuality =
            imageType === "3d-texture" ||
            imageType === "coverHiResImage" ||
            imageType.includes("3d") ||
            imageType === "texture";

          const shouldSmartCrop = imageType === "front";

          // Automatic transformation of all images to WebP
          if (mime.startsWith("image/")) {
            const converted = await processImageToWebP(bytes, mime, {
              highQuality: isHighQuality,
              preserveDimensions: true,
              smartCrop: shouldSmartCrop,
            });

            if (converted) {
              bytes = converted.bytes;
              mime = "image/webp";
            }
          }

          const rawFolder = targetFolder.replace(/[^a-z0-9/_-]/gi, "");
          const rootMatch =
            /^(uploads|products|cartridges|covers|banners|cards|hardware|amiibo|accessories|bundles|used|giftcards|guides|wallets|chat|avatars|orders|support|receipts|documents|reviews|categories|music|audio|assets|pages)/i.exec(
              rawFolder,
            );
          if (!rootMatch) {
            return json({ error: "invalid_upload_folder" }, { status: 400 });
          }

          const root = rootMatch[1]!.toLowerCase();

          // Compute SHA-256 hash for deduplication and structured naming
          const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);

          /*
            Never store a file the rest of the app will refuse.

            The WebP conversion is best-effort, and it fails outright for HEIC
            and HEIF — sharp has no decoder in the Worker and the jsquash
            fallback handles only JPEG, PNG and WebP. When it failed the
            original mime survived and the file was stored as `.heic`. The
            upload answered 200 with a URL, and the very next call, `POST
            /api/chat`, ran `isOwnUploadUrl` on it, which allows only formats a
            browser can actually display — and returned `400 invalid_image`.

            So the member's photo uploaded successfully and then failed to
            send, with no reason given. That is "فشل في ارسال الصورة", and it
            is every iPhone photo picked through Files rather than the camera
            roll, because iOS only transcodes HEIC on the way out of the latter.

            Refusing here says so plainly and at the step that can explain it.
            Storing it would leave an object in R2 that nothing can reference.
          */
          const SERVABLE_IMAGE = /^(png|jpg|jpeg|webp|gif)$/i;
          let key: string;
          const ext = MIME_EXT[mime] || (mime === "image/webp" ? "webp" : "bin");
          if (mime.startsWith("image/") && !SERVABLE_IMAGE.test(ext)) {
            return json(
              {
                error: "unsupported_image_format",
                message:
                  "تعذر تحويل هذه الصورة. جرّب اختيارها من الاستوديو مباشرة، أو أرسلها بصيغة JPG أو PNG.",
                format: ext,
              },
              { status: 415 },
            );
          }

          const isProductCatalogFolder =
            /^(products|covers|cartridges|banners|cards|hardware|amiibo|accessories|bundles|used|giftcards|categories)$/i.test(
              root,
            );

          if (isProductCatalogFolder) {
            const targetProdId = productId || "general";
            if (imageType === "gallery" || imageType === "screenshots") {
              key = `files/products/${targetProdId}/gallery/${hashHex}.${ext}`;
            } else {
              const prefix = imageType ? `${imageType}-` : "";
              key = `files/products/${targetProdId}/${prefix}${hashHex}.${ext}`;
            }
          } else {
            const safeFolder = `${root}/${user.id}`;
            key = `files/${safeFolder}/${hashHex}.${ext}`;
          }

          const isPrivateFolder =
            /^(chat|uploads|wallets|orders|support|receipts|documents)\//i.test(`${root}/`);
          const cacheControl = isPrivateFolder ? "private, no-store" : "public, max-age=31536000, immutable";

          // Deduplication: if exact content hash object already exists in R2, reuse it immediately
          const alreadyExists = await hasObject(key);
          if (!alreadyExists) {
            await writeBinary(key, bytes, mime, { cacheControl });
            
            // Read-after-write verification
            const verified = await hasObject(key);
            if (!verified) {
              return json({ error: "upload_storage_verification_failed" }, { status: 500 });
            }
          }

          const publicUrl = `/api/files/${key.slice("files/".length)}`;

          return json({
            success: true,
            url: publicUrl,
            objectKey: key,
            mime,
            size: bytes.length,
            hash: hashHex,
            deduplicated: alreadyExists,
          });
        }),
    },
  },
});
