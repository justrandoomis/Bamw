import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * «استبدال الموز» — now a section of the market rather than a page.
 *
 * «لا تقسم تجربة سوق الموز إلى صفحات مستقلة… لا تجعل المستخدم ينتقل إلى
 * banana_buy أو banana_redeem أو صفحات فرعية لتنفيذ هذه العمليات.»
 *
 * The rewards themselves did not go anywhere: the same offers, the same
 * stock, the same redemption action, rendered by `RewardsShelf` at the bottom
 * of `/banana_market`. Only the separate address is gone, and it redirects for
 * the reason its sibling does — the link exists in places this repository does
 * not control.
 */
export const Route = createFileRoute("/banana_redeem")({
  beforeLoad: () => {
    throw redirect({ to: "/banana_market", replace: true });
  },
});
