/**
 * The rest of Nintendo's games: every Switch and Switch 2 title in Nintendo
 * Europe's index that the shop does not sell live, a page at a time from
 * /api/games-db (`shop=exclude`).
 *
 * The games shelf (/category/nintendo_games) and the search page list the
 * shop's own games from the catalogue and then these, in the same grid, under
 * the same chips — one place for every Nintendo game rather than a separate
 * database page.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  gamesDbSearchString,
  parseGamesDbQuery,
  type GamesDbFacet,
  type GamesDbListItem,
  type GamesDbListResponse,
  type GamesDbSort,
} from "@/lib/games-db";

export interface NintendoCatalogueFilters {
  q?: string;
  platform?: "" | "switch1" | "switch2";
  /** One of the shop's genre ids (src/lib/genres.ts); the server widens it over Nintendo's. */
  shopGenre?: string;
  sort?: GamesDbSort;
}

async function fetchPage(qs: string, page: number, signal: AbortSignal): Promise<GamesDbListResponse> {
  const params = new URLSearchParams(qs);
  if (page > 1) params.set("page", String(page));
  // Asked of the server every time: its edge cache knows when a load
  // finished, the browser's copy does not (src/lib/games-db.server.ts).
  const response = await fetch(`/api/games-db?${params.toString()}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`games-db ${response.status}`);
  return (await response.json()) as GamesDbListResponse;
}

export interface NintendoCatalogue {
  items: GamesDbListItem[];
  /** How many such titles there are in all, under these filters; 0 until the first page answers. */
  total: number;
  /** Nintendo's genres with their counts, for the shelf's chips. */
  genres: GamesDbFacet[];
  /** False until the first page has answered with a loaded database. */
  ready: boolean;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function useNintendoCatalogue(
  filters: NintendoCatalogueFilters,
  { enabled = true }: { enabled?: boolean } = {},
): NintendoCatalogue {
  // The API's own parser and spelling, so the key matches the edge cache's.
  const qs = gamesDbSearchString(
    parseGamesDbQuery({
      q: filters.q ?? "",
      platform: filters.platform ?? "",
      shopGenre: filters.shopGenre ?? "",
      sort: filters.sort ?? "new",
      shop: "exclude",
    }),
  );
  const query = useInfiniteQuery({
    queryKey: ["games-db", "catalogue", qs],
    queryFn: ({ pageParam, signal }) => fetchPage(qs, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.ready && last.page < last.pages ? last.page + 1 : undefined),
    enabled,
    staleTime: 5 * 60_000,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const first = pages?.[0];
  const { fetchNextPage: fetchNext, hasNextPage, isFetchingNextPage } = query;
  const fetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNext();
  }, [fetchNext, hasNextPage, isFetchingNextPage]);
  return {
    items,
    total: first?.ready ? first.total : 0,
    genres: first?.genres ?? [],
    ready: Boolean(first?.ready),
    isPending: enabled && query.isPending,
    isError: query.isError,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    fetchNextPage,
  };
}

/**
 * A ref for the element at the foot of a growing list: `onVisible` runs when
 * it comes within a screenful or so of the viewport.
 */
export function useNearViewport(onVisible: () => void, { rootMargin = "1200px 0px" } = {}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => setNode(element), []);
  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, onVisible, rootMargin]);
  return ref;
}
