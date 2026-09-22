import { createFileRoute } from "@tanstack/react-router";

import {
  BananaError,
  buyListing,
  cancelListing,
  getSnapshot,
  redeemReward,
} from "@/lib/banana.server";
import { getSessionUser, requireUser } from "@/lib/session.server";
import type { User } from "@/lib/types";
import { body } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

/** A member may trade once name/username/email/birth date/gender are filled in. */
function isProfileComplete(user: User) {
  return Boolean(
    user.name?.trim() &&
    user.username?.trim() &&
    user.email?.trim() &&
    user.birthDate &&
    user.gender &&
    user.gender !== "unspecified",
  );
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/banana")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const range = url.searchParams.get("range") ?? "1D";
        const user = await getSessionUser(request);
        const snapshot = await getSnapshot(user?.id, range);
        return json({ ...snapshot, profileComplete: user ? isProfileComplete(user) : false });
      },

      POST: async ({ request }) => {
        let user;
        try {
          user = await requireUser(request);
        } catch (error) {
          if (error instanceof Response) return error;
          throw error;
        }

        const throttle = await consumeRateLimit(request, "banana-mutation", 30, 60, user.id);
        if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
        const input = await body<Record<string, unknown>>(request);
        const action = String(input["action"] ?? "");
        const range = String(input["range"] ?? "1D");

        try {
          if (action === "sell_bananas") {
            /*
              THE ONE WAY BANANAS BECOME MONEY NOW.

              The body carries a quantity and an id for the press of the
              button. It does NOT carry the price, the proceeds or the balance:
              «لا تثق بالسعر أو الناتج أو الرصيد القادم من Client». The reply
              states the price it really executed at, which is not necessarily
              the one the sheet was showing.
            */
            const { sellBananas } = await import("@/lib/banana-sell.server");
            const sold = await sellBananas({
              userId: user.id,
              quantity: input["quantity"],
              requestId: String(input["requestId"] ?? ""),
            });
            if (!sold.ok) {
              const why: Record<string, string> = {
                disabled: "بيع الموز متوقف مؤقتًا.",
                bad_quantity: "الكمية غير صالحة.",
                bad_request: "طلب غير صالح.",
                too_small: "الكمية أصغر من أن تساوي دينارًا واحدًا.",
                no_price: "لا يوجد سعر سوق الآن.",
                in_progress: "البيع قيد التنفيذ، حدّث الصفحة بعد لحظات.",
                insufficient_bananas: "رصيد الموز لا يكفي.",
                failed: "تعذّر إتمام البيع. لم يُخصم شيء.",
                failed_not_refunded:
                  "تعذّر إتمام البيع ولم يُعد الموز تلقائيًا. تواصل مع المتجر ومعك رقم حسابك.",
              };
              return json({ error: why[sold.reason] ?? why["failed"], code: sold.reason }, 400);
            }
            return json({
              ...(await getSnapshot(user.id, range)),
              profileComplete: isProfileComplete(user),
              sale: {
                quantity: sold.quantity,
                pricePerBanana: sold.pricePerBanana,
                proceeds: sold.proceeds,
                walletBalance: sold.walletBalance,
                replay: sold.replay,
              },
            });
          } else if (action === "create_listing" || action === "update_listing") {
            /*
              THE MARKETPLACE IS CLOSED TO NEW OFFERS.

              «احذف مفهوم Marketplace بين المستخدمين بالكامل من تجربة
              المستخدم… أوقف endpoints/actions التي تسمح بإنشاء Listings
              جديدة.»

              Refused here rather than deleted, and the distinction matters.
              `banana_market_offers` still holds every offer a member ever
              made, `buyListing` still exists so an offer already standing can
              be bought or cancelled by its owner, and none of that history is
              touched — «لا تحذف بيانات الإنتاج بشكل أعمى». What stops is the
              creation of anything new.
            */
            return json({ error: "سوق العروض بين الأعضاء أُغلق. يمكنك البيع مباشرة للمتجر." }, 400);
          } else if (action === "cancel_listing") {
            await cancelListing(user.id, String(input["id"] ?? ""));
          } else if (action === "buy_listing") {
            await buyListing(user.id, String(input["id"] ?? ""));
          } else if (action === "redeem_reward") {
            await redeemReward(user.id, String(input["rewardId"] ?? ""));
          } else {
            return json({ error: "unknown_action" }, 400);
          }
        } catch (error: any) {
          if (error instanceof BananaError) return json({ error: error.message }, 400);
          throw error;
        }

        return json({
          ...(await getSnapshot(user.id, range)),
          profileComplete: isProfileComplete(user),
        });
      },
    },
  },
});
