import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The old address of the banana section: «تغيير العنوان من /banana_market
 * الى /banana».
 *
 * A redirect rather than a deletion, for the reason `banana_buy` gives: the
 * address is out in the world — in Telegram messages about contest wins, in
 * the ticket messages the admin pasted into Instagram DMs, in bookmarks — and a
 * dead link is a worse answer than the page that replaced it.
 *
 * Each old link keeps its meaning. `/banana_market` was the market, so it
 * opens the market half of `/banana`; `?tab=events` was the contests, which
 * are now where `/banana` opens anyway; and `?contest=<id>` still opens that
 * contest.
 */
type LegacySearch = { tab?: "events"; contest?: string };

export const Route = createFileRoute("/banana_market")({
  validateSearch: (search: Record<string, unknown>): LegacySearch => ({
    ...(search["tab"] === "events" ? { tab: "events" as const } : {}),
    ...(typeof search["contest"] === "string" && search["contest"]
      ? { contest: search["contest"] }
      : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/banana",
      search: search.contest
        ? { contest: search.contest }
        : search.tab === "events"
          ? {}
          : { tab: "market" as const },
      replace: true,
    });
  },
});
