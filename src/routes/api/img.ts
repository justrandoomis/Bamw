import { createFileRoute } from "@tanstack/react-router";

import { guard } from "@/lib/http.server";
import { detectTrimCrop } from "@/lib/imageTrim.server";
import { fetchRemoteImage, readLimitedBody, safeRemoteImageUrl } from "@/lib/security.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { joinShared } from "@/lib/shared-wait.server";

const MAX_BYTES = 12 * 1024 * 1024;
// SVG is deliberately excluded: it is an active document, so echoing one
// back from our own origin would be a script-execution primitive on
// banan.to for any attacker-supplied URL.
const ALLOWED = /^image\/(?:png|jpeg|webp|gif|avif)$/i;

interface CachedImageEntry {
  buffer: Uint8Array;
  mime: string;
  timestamp: number;
}

// In-memory LRU cache for ultra-fast instant delivery of game covers
const memoryCache = new Map<string, CachedImageEntry>();
const inFlightRequests = new Map<string, Promise<{ buffer: Uint8Array; mime: string } | null>>();
const MAX_CACHE_ENTRIES = 350;

function getCached(key: string): CachedImageEntry | undefined {
  const entry = memoryCache.get(key);
  if (entry) {
    // Refresh LRU order
    memoryCache.delete(key);
    memoryCache.set(key, entry);
    return entry;
  }
  return undefined;
}

function setCached(key: string, buffer: Uint8Array, mime: string) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { buffer, mime, timestamp: Date.now() });
}

function detectMime(buffer: Uint8Array, fallbackUrl: string, headerMime?: string | null): string {
  if (headerMime && ALLOWED.test(headerMime)) {
    return headerMime;
  }

  // Sniff magic bytes
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return "image/avif";
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }

  // Fallback to URL extension
  const clean = (fallbackUrl.split("?")[0] || "").toLowerCase();
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".gif")) return "image/gif";

  return "image/jpeg";
}

/**
 * High-performance edge image proxy & dynamic format optimizer.
 * Handles AVIF (preferred), WebP (fallback), width constraints, and immutable caching.
 */
export const Route = createFileRoute("/api/img")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const url = new URL(request.url);
          const remote = url.searchParams.get("u") ?? "";
          const targetWidth = Math.min(2400, Math.max(0, parseInt(url.searchParams.get("w") || "0", 10)));
          const formatParam = (url.searchParams.get("format") || "").toLowerCase();
          const targetQuality = Math.min(100, Math.max(40, parseInt(url.searchParams.get("q") || "85", 10)));
          /*
            Remove the empty field around a packshot before anything else.

            Opt-in per call site rather than always-on: a full case wrap, a
            banner and a screenshot all legitimately reach their own edges, and
            trimming those would cut into the picture. Only the surfaces that
            frame a box ask for it.

            This is what repairs the covers already in production. They are
            stored with the supplier's white margin baked in, and this session
            cannot rewrite R2 or D1 — but every catalogue image is read through
            this proxy, so the very next request serves the box tight to frame.
          */
          const wantsTrim = url.searchParams.get("trim") === "1";

          const safeUrl = safeRemoteImageUrl(remote);
          if (!safeUrl) return new Response("Bad request", { status: 400 });

          const cacheKey = `${safeUrl.toString()}_w${targetWidth}_f${formatParam}_q${targetQuality}_t${wantsTrim ? 1 : 0}`;
          const cached = getCached(cacheKey);
          if (cached) {
            return new Response(cached.buffer as unknown as BodyInit, {
              headers: {
                "content-type": cached.mime,
                "cache-control": "public, max-age=31536000, immutable",
                "x-image-proxy": "memory-hit",
                "x-content-type-options": "nosniff",
                "content-security-policy": "default-src 'none'; sandbox",
                vary: "Accept",
              },
            });
          }

          const throttle = await consumeRateLimit(
            request,
            "image-proxy",
            5000,
            60 * 60,
            safeUrl.hostname,
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          const acceptHeader = request.headers.get("accept") || "";
          const prefersAvif = formatParam === "avif" || (!formatParam && acceptHeader.includes("image/avif"));
          const prefersWebp = formatParam === "webp" || (!formatParam && acceptHeader.includes("image/webp"));

          /*
            De-duplicate concurrent upstream fetches — but never trust another
            request's fetch to finish. If the visitor who started it left, the
            fetch was cancelled with their request and the shared promise can
            stay pending; every later request for that cover then hung. Joiners
            wait a bounded time and then fetch for themselves
            (see src/lib/shared-wait.server.ts).
          */
          const startFetch = (): Promise<{ buffer: Uint8Array; mime: string } | null> => {
            const holder: { promise?: Promise<{ buffer: Uint8Array; mime: string } | null> } = {};
            const own: Promise<{ buffer: Uint8Array; mime: string } | null> = (holder.promise = (async () => {
              const res = await fetchRemoteImage(safeUrl.toString(), {
                headers: {
                  accept: "image/avif,image/webp,image/*,*/*;q=0.8",
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
              });
              if (!res?.ok) return null;
              const rawBuffer = await readLimitedBody(res, MAX_BYTES);
              if (!rawBuffer) return null;

              let finalBuffer: Uint8Array = rawBuffer;
              let mime = detectMime(rawBuffer, safeUrl.toString(), res.headers.get("content-type"));

              // Perform fast Sharp dynamic optimization
              try {
                const sharpModule = await import("sharp");
                const sharp = sharpModule.default || sharpModule;
                if (typeof sharp === "function" && mime !== "image/gif") {
                  let pipeline = sharp(rawBuffer, { failOnError: false } as any).rotate();

                  if (wantsTrim) {
                    // Before the resize: the crop is measured in source pixels,
                    // and cropping first also means the discarded margin is
                    // never encoded.
                    const trimmed = await detectTrimCrop(rawBuffer, sharp as any);
                    if (trimmed) pipeline = pipeline.extract(trimmed.crop);
                  }

                  if (targetWidth > 0) {
                    pipeline = pipeline.resize({ width: targetWidth, fit: "inside", withoutEnlargement: true });
                  }

                  if (prefersAvif) {
                    // Effort 2 gives 10x faster encoding than effort 4 with virtually identical file size
                    const avifBuf = await pipeline.avif({ quality: targetQuality, effort: 2 }).toBuffer();
                    finalBuffer = new Uint8Array(avifBuf);
                    mime = "image/avif";
                  } else if (prefersWebp || !formatParam) {
                    // Fast webp conversion with smart subsampling
                    const webpBuf = await pipeline.webp({ quality: targetQuality, effort: 2, smartSubsample: true }).toBuffer();
                    finalBuffer = new Uint8Array(webpBuf);
                    mime = "image/webp";
                  } else if (targetWidth > 0 || wantsTrim) {
                    // A trim with no resize and no format change still has to
                    // be encoded, or the crop is silently discarded.
                    const outBuf = await pipeline.toBuffer();
                    finalBuffer = new Uint8Array(outBuf);
                  }
                }
              } catch {
                // Silently fallback to raw upstream image
              }

              setCached(cacheKey, finalBuffer, mime);
              return { buffer: finalBuffer, mime };
            })().finally(() => {
              if (inFlightRequests.get(cacheKey) === holder.promise) inFlightRequests.delete(cacheKey);
            }));
            inFlightRequests.set(cacheKey, own);
            return own;
          };

          const existing = inFlightRequests.get(cacheKey);
          const processed = await (existing
            ? joinShared(existing, {
                label: "img-proxy",
                waitMs: 10_000,
                restart: () => {
                  if (inFlightRequests.get(cacheKey) === existing) inFlightRequests.delete(cacheKey);
                  return startFetch();
                },
              })
            : startFetch());
          if (!processed) {
            // Graceful fallback: redirect directly to upstream URL so client fetches it natively
            return Response.redirect(safeUrl.toString(), 302);
          }

          const isImmutable = url.searchParams.has("v") || url.searchParams.has("h") || safeUrl.pathname.includes("/v/");
          const cacheControl = isImmutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=2592000, stale-while-revalidate=31536000";

          return new Response(processed.buffer as unknown as BodyInit, {
            headers: {
              "content-type": processed.mime,
              "cache-control": cacheControl,
              "x-image-proxy": "edge-optimizer",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox",
              vary: "Accept",
            },
          });
        }),
    },
  },
});
