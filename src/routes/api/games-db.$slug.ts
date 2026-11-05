import { createFileRoute } from "@tanstack/react-router";

import { cachedJson, getGamesDbTitle } from "@/lib/games-db.server";
import { guard, json } from "@/lib/http.server";

/**
 * One title of the games database, with every fact Nintendo gives:
 *
 *   GET /api/games-db/<slug>
 *
 * `shopPath` is set when the shop sells the title and the product is live —
 * the page then links to it instead of offering the request button. A miss is
 * a 404 and is not cached, so a title the next load adds appears at once.
 */
export const Route = createFileRoute("/api/games-db/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        guard(async () => {
          const slug = String(params.slug ?? "")
            .trim()
            .toLowerCase();
          // An address is ASCII letters, digits and dashes (`slugFor`); anything
          // else cannot be one, and is not worth a query or a cache key.
          if (!/^[a-z0-9-]{1,160}$/.test(slug)) {
            return json({ ready: true, title: null, shopPath: null, error: "not_found" }, { status: 404 });
          }
          return cachedJson(request, `title/${slug}`, async () => {
            const body = await getGamesDbTitle(slug);
            if (!body.title) return { body: { ...body, error: "not_found" }, status: 404, cacheable: false };
            return { body, cacheable: true };
          });
        }, "api:games-db"),
    },
  },
});
