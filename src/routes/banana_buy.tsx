import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * «شراء الموز» — the member-to-member market, which no longer exists.
 *
 * The owner removed the marketplace from the product outright: «احذف مفهوم
 * Marketplace بين المستخدمين بالكامل من تجربة المستخدم». This screen was its
 * buying half — other members' offers, filters, a bot's listing to take — and
 * there is nothing here to show any more.
 *
 * It is a REDIRECT rather than a deletion because the address is out in the
 * world: in chat history, in a member's own tabs, in whatever they bookmarked.
 * «يمكن إبقاء routes القديمة فقط إذا كانت لازمة للتوافق مع روابط قديمة، لكن
 * يجب redirect أو دمجها بطريقة آمنة إلى القسم المناسب في /banana_market.» A
 * dead link is a worse answer than the page that replaced it.
 *
 * `beforeLoad` rather than a component that navigates on mount: the redirect
 * happens before anything renders, so nobody sees the old title flash past.
 */
export const Route = createFileRoute("/banana_buy")({
  beforeLoad: () => {
    throw redirect({ to: "/banana_market", replace: true });
  },
});
