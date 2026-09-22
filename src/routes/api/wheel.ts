import { createFileRoute } from "@tanstack/react-router";

import { getStore } from "@/lib/db.server";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { isGameProduct } from "@/lib/productSection";
import { filterPurchasable } from "@/lib/purchasable";
import { isAwaitingRelease } from "@/lib/release";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { requireUser } from "@/lib/session.server";
import { resolveProductImage } from "@/lib/productImages";
import {
  PRIZE_VALID_DAYS,
  buyTickets,
  getTicketBalance,
  getWheelOdds,
  recentSpins,
  spinWheel,
  type WheelCandidate,
} from "@/lib/wheel.server";
import { oddsBreakdown } from "@/lib/wheel-odds";

/**
 * عجلة الحظ.
 *
 * The candidate list is built here, from the shop's own catalogue, and the
 * winner is chosen in `spinWheel` on this side of the wire. The browser is
 * sent the result and spins an animation to it. Anything else — a client that
 * picks, or a client that sends the candidates — is a free-games button for
 * whoever opens the developer tools.
 */

/**
 * Kinds that are not a game, whatever the product's category says.
 *
 * `isGameProduct` is the shop's classifier and it answers "game" by default:
 * once a product carries any category id, `getProductCategory` decides from
 * that id alone, and an id it does not recognise falls through to "game".
 * Category ids created in the admin's الأقسام tab are `Date.now()` strings, so
 * they recognise nothing — and a Nintendo Switch 2 console at 749,000 IQD
 * filed under one is, to that function, a game.
 *
 * That default is load-bearing everywhere else: the imported catalogue stores
 * Arabic category titles that match no alias either, and the storefront relies
 * on them still being games. So the fix belongs here rather than in the
 * classifier, where changing it would move every shelf in the shop.
 *
 * `kind` is the field the record itself carries, independent of whatever
 * category it was later filed under.
 */
const NOT_A_GAME = new Set([
  "hardware",
  "device",
  "accessory",
  "amiibo",
  "collectible",
  "bundle",
  "gift_card",
  "digital_code",
  "used",
]);

/** The games a spin can land on, in the shape the wheel needs. */
async function candidates(): Promise<WheelCandidate[]> {
  const store = await getStore();
  const products = filterPurchasable<Record<string, unknown>>(
    Array.isArray(store?.products) ? (store.products as Record<string, unknown>[]) : [],
  );

  const list: WheelCandidate[] = [];
  for (const product of products) {
    if (!isGameProduct(product)) continue;
    /*
      Both gates, because they answer different questions. The classifier says
      what shelf this belongs on; this says what the record calls itself. A
      prize has to pass both — the wheel gives things away, so a wrong answer
      here costs the shop a console.
    */
    if (
      NOT_A_GAME.has(
        String(product["kind"] ?? "")
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    const price = Number(product["price"]);
    /*
      A price is required, and not only because the odds are priced. A product
      with no price is not a thing the shop has decided to sell yet, and
      winning one would hand out something nobody has valued.
    */
    if (!Number.isFinite(price) || price <= 0) continue;

    /*
      A game that has not come out yet cannot be a prize.

      `filterPurchasable` does not exclude a pre-order — `isProductPriced`
      whitelists the kind on purpose, because a pre-order is a real listing a
      member may register interest in. Checkout is where the gate lives, and it
      is the right place for it: `orders.server.ts` throws `AwaitingReleaseError`
      for every line from every surface.

      Which is exactly the problem. The wheel would happily land on one, spend
      the ticket, mint the coupon and record the spin — and the member would
      then be refused at the till, with a prize that expires in fourteen days
      and a release date that may be further out than that. They lose the
      ticket and get nothing, and no path anywhere gives it back.
    */
    if (isAwaitingRelease(product)) continue;

    /*
      Nor one the shop has run out of.

      The same shape of fault as the pre-order: the storefront refuses to add
      a sold-out line to the cart, so the prize is a code the member cannot
      spend and a ticket nobody gives back. Unknown stock is not "sold out" —
      most of the imported catalogue carries none, and reading absence as zero
      would empty the wheel.
    */
    const stock = Number(product["stock"]);
    const infiniteStock = product["isInfiniteStock"] === true || stock < 0;
    if (!infiniteStock && Number.isFinite(stock) && stock <= 0) continue;

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
          /*
            Counted by POSITION, not by label.

            This matched each game to its band by comparing label strings,
            which was fine while the bands were a module constant and stops
            being fine the moment an admin can edit one: two bands named the
            same would merge into one row and every game in the second would
            be counted twice or not at all. `oddsBreakdown` works from the
            index, and «حظ أوفر» is one of the rows it returns — so the
            percentages a member reads include the chance of winning nothing.
          */
          const wheelOdds = await getWheelOdds();
          const counts = wheelOdds.tiers.map(
            (_, index) =>
              pool.filter(
                (candidate) =>
                  wheelOdds.tiers.findIndex(
                    (tier) => tier.upTo === null || Number(candidate.price) <= tier.upTo,
                  ) === index,
              ).length,
          );

          return json({
            tickets,
            poolSize: pool.length,
            candidates: faces,
            spins,
            prizeValidDays: PRIZE_VALID_DAYS,
            ticketPriceBananas: wheelOdds.ticketPriceBananas,
            odds: oddsBreakdown(wheelOdds, counts),
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

          // Nothing in the body reaches the prize decision. The one thing it
          // may ask for is a ticket purchase, whose price is read from the
          // server's own settings and never from the request.
          const sent = await body<Record<string, unknown>>(request).catch(
            () => ({}) as Record<string, unknown>,
          );

          if (String(sent["action"] ?? "") === "buy_ticket") {
            const bought = await buyTickets({
              userId: user.id,
              quantity: Number(sent["quantity"] ?? 1),
              // One id per button press. The server still falls back to a
              // time bucket when a client sends none.
              requestId: String(sent["requestId"] ?? ""),
            });
            if (bought.ok) {
              return json({
                ok: true,
                tickets: bought.tickets,
                spent: bought.spent,
                bananas: bought.balance,
                message: `تم شراء التذاكر ✅`,
              });
            }
            /*
              «لم يُخصم شيء» is a promise, and it was made on a path where the
              bananas HAD been taken and only the tickets failed. The refund is
              reported, not assumed: a member told their bananas came back who
              then finds they did not has been lied to about something they
              paid for, and the second sentence asks them to contact the shop
              rather than to try again.
            */
            const why: Record<string, string> = {
              not_for_sale: "لم يحدد المتجر سعر التذكرة بعد.",
              bad_quantity: "عدد التذاكر غير صالح.",
              insufficient_bananas: "رصيد الموز لا يكفي.",
              failed: "تعذّر إصدار التذاكر، وأُعيد الموز إلى رصيدك.",
              failed_not_refunded:
                "تعذّر إصدار التذاكر ولم تُعد الموز تلقائيًا. تواصل مع المتجر ومعك رقم حسابك.",
            };
            return json({ error: why[bought.reason] ?? why["failed"] }, { status: 400 });
          }

          const outcome = await spinWheel({ userId: user.id, candidates: await candidates() });

          /*
            «حظ أوفر» — a spin that happened and won nothing.

            Reported as `ok` with `won: false`, because the spin succeeded: the
            ticket was spent, the draw was made, the answer was no prize. It is
            not an error and must not be shown as one, and no coupon exists to
            send. The ticket does NOT come back — that is what makes it a
            losing chance rather than a free re-roll.
          */
          if (outcome.ok && !outcome.won) {
            return json({
              ok: true,
              won: false,
              spinId: outcome.spinId,
              prize: null,
              tickets: outcome.ticketsLeft,
              message: "حظ أوفر في المرة القادمة 🍀",
            });
          }

          if (outcome.ok) {
            return json({
              ok: true,
              won: true,
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
