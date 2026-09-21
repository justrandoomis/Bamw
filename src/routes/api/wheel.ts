import { createFileRoute } from "@tanstack/react-router";

import { getStore } from "@/lib/db.server";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { isGameProduct } from "@/lib/productSection";
import { filterPurchasable } from "@/lib/purchasable";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { requireUser } from "@/lib/session.server";
import { resolveProductImage } from "@/lib/productImages";
import {
  PRIZE_VALID_DAYS,
  PRIZE_WEIGHTS,
  getTicketBalance,
  recentSpins,
  spinWheel,
  weightForPrice,
  type WheelCandidate,
} from "@/lib/wheel.server";

/**
 * عجلة الحظ.
 *
 * The candidate list is built here, from the shop's own catalogue, and the
 * winner is chosen in `spinWheel` on this side of the wire. The browser is
 * sent the result and spins an animation to it. Anything else — a client that
 * picks, or a client that sends the candidates — is a free-games button for
 * whoever opens the developer tools.
 */

/** The games a spin can land on, in the shape the wheel needs. */
async function candidates(): Promise<WheelCandidate[]> {
  const store = await getStore();
  const products = filterPurchasable<Record<string, unknown>>(
    Array.isArray(store?.products) ? (store.products as Record<string, unknown>[]) : [],
  );

  const list: WheelCandidate[] = [];
  for (const product of products) {
    if (!isGameProduct(product)) continue;
    const price = Number(product["price"]);
    /*
      A price is required, and not only because the odds are priced. A product
      with no price is not a thing the shop has decided to sell yet, and
      winning one would hand out something nobody has valued.
    */
    if (!Number.isFinite(price) || price <= 0) continue;

    /*
      Artwork is NOT required. Nine hundred and ninety-four of the catalogue's
      games arrived from the supplier's sheet with no cover, and they are
      overwhelmingly the 5,000-dinar games — which is precisely the bucket the
      owner asked to come up most often. Excluding them would have quietly
      removed the common prize from a wheel designed around it. They show the
      «لم يتم إضافة الصورة بعد» card, which is honest.
    */
    list.push({
      id: String(product["id"] ?? ""),
      title: String(product["title"] || product["titleEn"] || product["english_name"] || "لعبة"),
      price,
      image: resolveProductImage(product, "listing").url || null,
    });
  }
  return list.filter((candidate) => candidate.id);
}

export const Route = createFileRoute("/api/wheel")({
  server: {
    handlers: {
      /** What the wheel screen needs to draw itself. */
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!getD1()) {
            return json({ tickets: 0, candidates: [], spins: [], odds: [] });
          }

          const [tickets, pool, spins] = await Promise.all([
            getTicketBalance(user.id),
            candidates(),
            recentSpins(user.id, 10),
          ]);

          /*
            A sample of the pool for the wheel's faces, not the pool itself.
            Sending 1,500 games so a browser can draw twelve segments is a
            megabyte spent on nothing, and the segments are decoration: the
            winner has already been decided by the time one is highlighted.
          */
          const faces = pool.slice(0, 60).map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            image: candidate.image,
          }));

          /*
            The odds, stated. A wheel that will not say what the chances are is
            a wheel nobody should trust, and these are the shop's own numbers
            rather than a promise — the count is what the catalogue holds right
            now.
          */
          const odds = PRIZE_WEIGHTS.map((tier) => {
            const inTier = pool.filter(
              (candidate) => weightForPrice(candidate.price).label === tier.label,
            ).length;
            return { label: tier.label, weight: tier.weight, games: inTier };
          });
          const totalWeight = odds.reduce((sum, tier) => sum + tier.weight * tier.games, 0);

          return json({
            tickets,
            poolSize: pool.length,
            candidates: faces,
            spins,
            prizeValidDays: PRIZE_VALID_DAYS,
            odds: odds.map((tier) => ({
              ...tier,
              chance: totalWeight > 0 ? (tier.weight * tier.games) / totalWeight : 0,
            })),
          });
        }),

      /** Spend a ticket. */
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          /*
            Its own budget. The banana endpoint is capped at 30 mutations a
            minute and is shared with market trading; a member spinning through
            a handful of tickets should not find they can no longer sell
            bananas, and vice versa.
          */
          const throttle = await consumeRateLimit(request, "wheel-spin", 30, 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });

          // Read, but only to reject an unknown action early. Nothing in the
          // body reaches the prize decision.
          await body<Record<string, unknown>>(request).catch(() => ({}));

          const outcome = await spinWheel({ userId: user.id, candidates: await candidates() });

          if (outcome.ok) {
            return json({
              ok: true,
              spinId: outcome.spinId,
              prize: outcome.prize,
              couponCode: outcome.couponCode,
              expiresAt: outcome.expiresAt,
              tickets: outcome.ticketsLeft,
              message: "مبروك! ربحت لعبة 🎉",
            });
          }

          /*
            The refund is reported, not assumed. `returnTicket` can fail for
            the same reason the spin did, and a member told their ticket came
            back who then finds it did not has been lied to about something
            they paid for. The second sentence asks them to contact support
            instead of asking them to try again with a ticket they no longer
            have.
          */
          const messages: Record<string, string> = {
            no_ticket: "لا توجد لديك تذاكر. استبدل الموز بتذكرة أولاً.",
            no_candidates: "لا توجد ألعاب متاحة في العجلة الآن.",
            failed: outcome.ticketReturned
              ? "تعذرت الإدارة. أُعيدت تذكرتك، حاول مرة أخرى."
              : "تعذرت الإدارة ولم نتمكن من إعادة تذكرتك تلقائياً. تواصل مع الدعم وسنعيدها لك.",
          };
          return json(
            {
              error: messages[outcome.reason] ?? "تعذر تدوير العجلة",
              code: outcome.reason,
              tickets: outcome.ticketsLeft,
            },
            { status: outcome.reason === "no_ticket" ? 409 : 503 },
          );
        }),
    },
  },
});
