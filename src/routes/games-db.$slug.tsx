import { createFileRoute } from "@tanstack/react-router";

import GamesDbTitlePage from "@/components/games-db/GamesDbTitlePage";

/**
 * One title of the games database. The address is the title in ASCII and
 * Nintendo's id (`slugFor`); an old address still arrives by its id and is put
 * right on the page.
 */
export const Route = createFileRoute("/games-db/$slug")({
  head: () => ({
    meta: [
      { title: "قاعدة بيانات ألعاب نينتندو — بنانا ستور" },
      {
        name: "description",
        content: "معلومات اللعبة من فهرس نينتندو الرسمي: الجهاز، تاريخ الإصدار، الناشر، اللغات والحجم.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GamesDbTitleRoute,
});

function GamesDbTitleRoute() {
  const { slug } = Route.useParams();
  return <GamesDbTitlePage slug={slug} />;
}
