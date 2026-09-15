import { createFileRoute } from "@tanstack/react-router";

import { guard } from "@/lib/http.server";
import { readBinaryStream, readBinary } from "@/lib/storage.server";
import { getSessionUser } from "@/lib/session.server";

/*
  Paths whose on-demand recovery has already been tried and failed.

  Bounded so a flood of bad paths cannot grow it without limit: past the cap the
  oldest entry goes, which at worst costs one repeated catalogue read rather
  than unbounded memory.
*/
const recoveryFailed = new Set<string>();
const MAX_REMEMBERED_FAILURES = 500;

function rememberRecoveryFailure(path: string): void {
  if (recoveryFailed.size >= MAX_REMEMBERED_FAILURES) {
    const oldest = recoveryFailed.values().next().value;
    if (oldest !== undefined) recoveryFailed.delete(oldest);
  }
  recoveryFailed.add(path);
}

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        guard(async () => {
          const path = (params as { _splat?: string })._splat ?? "";
          if (
            !/^(?:[a-z0-9_-]{1,64}\/)*[a-z0-9_-]{1,96}\.(?:png|jpe?g|webp|gif|avif|pdf|mp4|webm|mov)$/i.test(
              path,
            )
          ) {
            return new Response("Not found", { status: 404 });
          }

          // Sensitive user folders that require authentication (wallets, orders, receipts, documents, support, chat, uploads)
          const isPrivateFolder =
            /^(chat|uploads|wallets|orders|support|receipts|documents)\//i.test(path);

          if (isPrivateFolder) {
            const viewer = await getSessionUser(request);
            if (!viewer) {
              return new Response("Not found", { status: 404 });
            }
            const userMatch = /(?:^|\/)(usr_[a-z0-9]+)(?:\/|$)/i.exec(path);
            if (userMatch) {
              const targetUserId = userMatch[1];
              if (!viewer.isAdmin && viewer.id !== targetUserId) {
                return new Response("Not found", { status: 404 });
              }
            } else if (!viewer.isAdmin) {
              return new Response("Not found", { status: 404 });
            }
          }

          const url = new URL(request.url);
          const targetWidth = Math.min(2400, Math.max(0, parseInt(url.searchParams.get("w") || "0", 10)));
          const targetQuality = Math.min(100, Math.max(40, parseInt(url.searchParams.get("q") || "85", 10)));
          
          const file: any = targetWidth > 0 ? await readBinary(`files/${path}`) : await readBinaryStream(`files/${path}`);
          if (!file) {
            // If this is a product cover / cartridge / game image, attempt on-demand recovery
            const isProductMedia =
              path.startsWith("products/") ||
              path.startsWith("cartridges/") ||
              path.startsWith("covers/") ||
              path.startsWith("images/");

            /*
              Recovery is attempted once per path, per isolate.

              A missing object is usually missing for good — a filename that
              moved, a product deleted, an upload that never landed — and this
              branch loads the **entire catalogue** (3.8 MB of chunks, parsed,
              with every product normalised) to look for a URL to re-fetch it
              from. Without a memory of having failed, every retry of that image
              by every browser on the page pays for it again: `/api/files/…` was
              the busiest route in the shop at 479 requests in a six-hour
              sample, with 66 of them cancelled.

              Remembering the failure costs one string per dead path and turns
              an unbounded cost into a one-off. It is per-isolate on purpose:
              an isolate is short-lived, so an image genuinely restored later
              is picked up by the next one rather than being denied for ever.
            */
            if (isProductMedia && !recoveryFailed.has(path)) {
              try {
                const { getStore } = await import("@/lib/db.server");
                const { fetchRemoteImage, readLimitedBody } = await import("@/lib/security.server");
                const { writeBinary } = await import("@/lib/storage.server");

                const store = await getStore();
                const prdMatch = /prd_[a-zA-Z0-9_-]+/i.exec(path);
                const targetPrdId = prdMatch ? prdMatch[0] : null;

                // Find matching product
                let matchingProduct = targetPrdId
                  ? store.products.find((p) => p.id === targetPrdId)
                  : null;

                if (!matchingProduct) {
                  matchingProduct =
                    store.products.find(
                      (p) =>
                        String(p.cartridgeImage || "").includes(path) ||
                        String(p.coverImage || "").includes(path) ||
                        String(p.nintendoCardImage || "").includes(path) ||
                        String(p.image || "").includes(path) ||
                        String(p.mainImage || "").includes(path),
                    ) ?? null;
                }

                // Collect candidate external URLs
                const candidateUrls: string[] = [];
                if (matchingProduct) {
                  const potentialFields = [
                    matchingProduct.box_front_url,
                    matchingProduct.coverUrl,
                    matchingProduct.cartridgeImage,
                    matchingProduct.coverImage,
                    matchingProduct.image,
                    matchingProduct.mainImage,
                    matchingProduct.bannerImage,
                    matchingProduct.banner,
                  ];
                  for (const f of potentialFields) {
                    if (typeof f === "string" && /^https?:\/\//i.test(f.trim())) {
                      candidateUrls.push(f.trim());
                    }
                  }
                }

                // If we have remote candidate URLs, try to fetch the first working one
                for (const remoteUrl of candidateUrls) {
                  try {
                    const res = await fetchRemoteImage(remoteUrl, {
                      headers: {
                        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
                        "User-Agent":
                          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                      },
                    });
                    if (res && res.ok) {
                      const bytes = await readLimitedBody(res, 15 * 1024 * 1024);
                      if (bytes && bytes.length > 0) {
                        const mime = res.headers.get("content-type") || "image/jpeg";
                        // Cache in local storage for fast subsequent loads
                        await writeBinary(`files/${path}`, bytes, mime, {
                          cacheControl: "public, max-age=31536000, immutable",
                        });

                        return new Response(bytes as unknown as BodyInit, {
                          headers: {
                            "content-type": mime,
                            "cache-control": "public, max-age=31536000, immutable",
                            "x-recovered-from": "upstream",
                            "x-content-type-options": "nosniff",
                          },
                        });
                      }
                    }
                  } catch {
                    // Continue to next candidate
                  }
                }

                // If we found a candidate URL but failed to buffer it, redirect to it directly
                if (candidateUrls.length > 0 && candidateUrls[0]) {
                  return Response.redirect(candidateUrls[0], 302);
                }
                /*
                  The catalogue was read and it had nothing to offer for this
                  path. That answer will not change while this isolate lives.
                */
                rememberRecoveryFailure(path);
              } catch {
                rememberRecoveryFailure(path);
              }
            }

            return new Response("Not found", { status: 404 });
          }

          const etag = file.etag || `"${path}-${file.size || 0}"`;
          const cacheControl = isPrivateFolder
            ? "private, no-store"
            : "public, max-age=31536000, immutable";

          const headers: Record<string, string> = {
            "content-type": file.mime,
            etag,
            "cache-control": cacheControl,
            "x-content-type-options": "nosniff",
          };

          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, { status: 304, headers });
          }

          if (file.stream) {
            return new Response(file.stream as unknown as BodyInit, { headers });
          }
          if (file.bytes) {
            return new Response(file.bytes as unknown as BodyInit, { headers });
          }

          return new Response("Not found", { status: 404 });
        }),
    },
  },
});
