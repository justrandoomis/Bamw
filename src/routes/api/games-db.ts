import { createFileRoute } from "@tanstack/react-router";

import { gamesDbSearchString, parseGamesDbQuery } from "@/lib/games-db";
import { cachedJson, listGamesDb } from "@/lib/games-db.server";
import { guard } from "@/lib/http.server";

/**
 * The games database, a page at a time:
 *
 *   GET /api/games-db?q=&platform=switch1|switch2&genre=&page=&sort=new|az
 *
 * Public and identical for every visitor, so it is answered from the edge
 * cache (an hour) and keyed on the validated filters. An answer from before
 * the loader has run (`ready: false`) is never cached.
 */
export const Route = createFileRoute("/api/games-db")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const query = parseGamesDbQuery(new URL(request.url).searchParams);
          return cachedJson(request, `list?${gamesDbSearchString(query)}`, async () => {
            const body = await listGamesDb(query);
            return { body, cacheable: body.ready };
          });
        }, "api:games-db"),
    },
  },
});
