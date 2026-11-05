import { createFileRoute } from "@tanstack/react-router";

import GamesDbBrowser from "@/components/games-db/GamesDbBrowser";
import { gamesDbSearch, parseGamesDbQuery, type GamesDbSearch } from "@/lib/games-db";

/**
 * The games database: every Nintendo Switch and Switch 2 title in Nintendo
 * Europe's index, searched a page at a time from `/api/games-db`.
 *
 * Every filter lives in the URL — `/games-db?q=zelda&platform=switch2` — so a
 * result set can be shared, reloaded and reached with the back button. The
 * search is validated by the same parser the API uses, and only the keys it
 * keeps come back, all optional: a plain `navigate({ to: "/games-db" })` must
 * stay valid at the type level.
 */
export const Route = createFileRoute("/games-db/")({
  validateSearch: (search: Record<string, unknown>): GamesDbSearch =>
    gamesDbSearch(parseGamesDbQuery(search)),
  head: () => ({
    meta: [
      { title: "قاعدة بيانات ألعاب نينتندو — بنانا ستور" },
      {
        name: "description",
        content:
          "كل ألعاب نينتندو سويتش وسويتش 2 من فهرس نينتندو الرسمي: ابحث وتصفّح حسب الجهاز والتصنيف، واطلب أي لعبة غير متوفرة في المتجر.",
      },
      { property: "og:title", content: "قاعدة بيانات ألعاب نينتندو — بنانا ستور" },
      {
        property: "og:description",
        content: "أكثر من عشرين ألف لعبة لـ Switch و Switch 2 بصورها ومعلوماتها.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GamesDbPage,
});

function GamesDbPage() {
  const search = Route.useSearch();
  return <GamesDbBrowser search={search} />;
}
