import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Where the games database's own page was.
 *
 * «the games shoud be on /category/nintendo_games not sepearted page» — every
 * Nintendo game is now on the games shelf, the shop's own first and the rest
 * of Nintendo's index after them, and a search answers from both. An old link
 * still arrives: with a query it goes to the search page, without one to the
 * shelf. A game's own page (/games-db/<slug>) stays where it was.
 */
export const Route = createFileRoute("/games-db/")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const raw = search["q"];
    const q = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    return q ? { q } : {};
  },
  beforeLoad: ({ search }) => {
    if (search.q) throw redirect({ to: "/search", search: { q: search.q }, replace: true });
    throw redirect({
      to: "/category/$categoryId",
      params: { categoryId: "nintendo_games" },
      replace: true,
    });
  },
});
