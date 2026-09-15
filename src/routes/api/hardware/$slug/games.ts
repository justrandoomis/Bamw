import { createFileRoute } from "@tanstack/react-router";
import { getStore } from "@/lib/db.server";
import { json, guard } from "@/lib/http.server";
import {
  getDevicePerformanceList,
  parseFps,
  performanceMatches,
  resolutionRank,
  slugifyDevice,
} from "@/lib/devicePerformance";
import { isVisibleToPublic } from "@/lib/purchasable";
import { searchCatalogue } from "@/lib/search/products";

type LinkedGame = {
  id: string;
  slug: string;
  title: string;
  image: string;
  releaseDate: string;
  performance: ReturnType<typeof getDevicePerformanceList>[number];
  performanceSummary: string;
};

export const Route = createFileRoute("/api/hardware/$slug/games")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        guard(async () => {
          const url = new URL(request.url);
          const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
          const limit = Math.min(
            100,
            Math.max(1, Number.parseInt(url.searchParams.get("limit") || "24", 10) || 24),
          );
          const search = (url.searchParams.get("search") || "").trim().toLowerCase();
          const filters = (url.searchParams.get("filters") || "")
            .split(",")
            .map((filter) => filter.trim())
            .filter(Boolean);
          const sort = url.searchParams.get("sort") || "alphabetical";
          const wanted = slugifyDevice(params.slug);
          const store = await getStore();

          /*
            The compatibility list gets the shop's real search, not a substring
            test on one field.

            This line was the last place still doing what the header used to do
            before `be7682c` — `title.toLowerCase().includes(search)` — with no
            Arabic name, no folding, no tokenisation and no typo tolerance. So
            a customer filtering the games that run on their console could type
            «زيلدا», or «zelda» with one letter wrong, and be told the console
            runs neither.

            Matched by id: the search ranks the whole catalogue, and the loop
            below then keeps the ones that are also compatible, so the two
            filters compose instead of one overriding the other.
          */
          const searchHits = search
            ? new Set(
                searchCatalogue(
                  (store.products || []) as unknown as Record<string, unknown>[],
                  search,
                  { limit: 400 },
                ).map((hit) => String(hit.product["id"])),
              )
            : null;

          const games = (store.products || []).flatMap((product): LinkedGame[] => {
            if (!isVisibleToPublic(product)) return [];
            const performance = getDevicePerformanceList(product).find(
              (record) => record.deviceSlug === wanted,
            );
            if (!performance || !performanceMatches(performance, filters)) return [];
            const title = String(product.title || product.titleEn || "");
            if (searchHits && !searchHits.has(String(product.id))) return [];
            return [
              {
                id: String(product.id),
                slug: String(product.slug || ""),
                title,
                image: String(
                  product.cartridgeImage ||
                    product.coverHiResImage ||
                    product.image ||
                    product.mainImage ||
                    "",
                ),
                releaseDate: String(product.releaseDate || ""),
                performance,
                performanceSummary: [
                  performance.handheld?.supported === false
                    ? "Handheld: Not Supported"
                    : `Handheld: ${performance.handheld?.outputResolution || performance.handheld?.resolution || ""} / ${performance.handheld?.fps || ""}`,
                  performance.tv?.supported === false
                    ? "TV: Not Supported"
                    : `TV: ${performance.tv?.outputResolution || performance.tv?.resolution || ""} / ${performance.tv?.fps || ""}`,
                ]
                  .filter((entry) => !entry.endsWith(":  / "))
                  .join(" · "),
              },
            ];
          });

          const fps = (game: LinkedGame) =>
            Math.max(parseFps(game.performance.handheld?.fps), parseFps(game.performance.tv?.fps));
          const resolution = (game: LinkedGame) =>
            Math.max(
              resolutionRank(
                game.performance.handheld?.outputResolution ||
                  game.performance.handheld?.resolution,
              ),
              resolutionRank(
                game.performance.tv?.outputResolution || game.performance.tv?.resolution,
              ),
            );
          games.sort((a, b) => {
            if (sort === "highest_fps") return fps(b) - fps(a);
            if (sort === "highest_resolution") return resolution(b) - resolution(a);
            if (sort === "recently_verified")
              return String(b.performance.verifiedAt || "").localeCompare(
                String(a.performance.verifiedAt || ""),
              );
            if (sort === "newest") return b.releaseDate.localeCompare(a.releaseDate);
            return a.title.localeCompare(b.title);
          });

          const total = games.length;
          const items = games.slice((page - 1) * limit, page * limit);
          return json({ items, page, limit, total, totalPages: Math.ceil(total / limit) });
        }, "api:hardware-games"),
    },
  },
});
