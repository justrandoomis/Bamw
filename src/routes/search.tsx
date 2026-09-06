import { createFileRoute } from "@tanstack/react-router";

import SearchResultsPage from "@/components/SearchResultsPage";

/**
 * The page a customer lands on when they press Enter.
 *
 * The header's dropdown answers the first few keystrokes; this answers the
 * question. It is a real URL — `/search?q=زيلدا` — so a result set can be
 * shared, bookmarked, reloaded and reached with the back button, none of which
 * a dropdown can do.
 *
 * The query lives in the URL rather than in component state. That is what
 * makes the back button work, and it is why typing replaces the history entry
 * instead of pushing one: nobody wants to press back eleven times to undo
 * «ماريو كارت».
 */
export const Route = createFileRoute("/search")({
  /*
    `q` is optional. Returning the key unconditionally would make it required
    and break every plain `navigate({ to: "/search" })` at the type level — the
    same trap /chat documents.
  */
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const raw = search["q"];
    // Bounded: `q` is echoed into the page and into the document title, and a
    // query string is whatever the address bar was pasted full of.
    const q = typeof raw === "string" ? raw.slice(0, 120) : "";
    return q ? { q } : {};
  },
  head: () => ({
    meta: [
      { title: "البحث — بنانا ستور" },
      {
        name: "description",
        content: "ابحث عن ألعاب ننتندو سويتش وبطاقات الشحن والأجهزة والملحقات في بنانا ستور.",
      },
      { property: "og:title", content: "البحث — بنانا ستور" },
      { property: "og:type", content: "website" },
      /*
        A result set is not a page search engines should index — it is one
        customer's query, and there are as many of them as there are strings.
      */
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  return <SearchResultsPage q={q} />;
}
