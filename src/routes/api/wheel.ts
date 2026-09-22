import { createFileRoute } from "@tanstack/react-router";

import { getUserBananaBalance } from "@/lib/banana-balance.server";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { wheelCandidates } from "@/lib/wheel-pool.server";
import { requireUser } from "@/lib/session.server";
import {
  PRIZE_VALID_DAYS,
  buyTickets,
  getTicketBalance,
  getWheelOdds,
  recentSpins,
  spinWheel,
  type WheelCandidate,
} from "@/lib/wheel.server";
import { oddsBreakdown, tierCounts } from "@/lib/wheel-odds";

/**
 * عجلة الحظ.
 *
 * The candidate list is built here, from the shop's own catalogue, and the
 * winner is chosen in `spinWheel` on this side of the wire. The browser is
 * sent the result and spins an animation to it. Anything else — a client that
 * picks, or a client that sends the candidates — is a free-games button for
 * whoever opens the developer tools.
 */

export const Route = createFileRoute("/api/wheel")({
  server: {
    handlers: {
      /** What the wheel screen needs to draw itself. */
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!getD1()) {
            return json({ tickets: 0, bananas: 0, candidates: [], spins: [], odds: [] });
          }

          const [tickets, wallet, pool, spins] = await Promise.all([
            getTicketBalance(user.id),
            /*
              The member's banana balance, so the wheel can show it beside the
              ticket price instead of making them leave the screen to find out
              whether they can afford one. It is the same canonical figure the
              purchase itself debits — read here, not recomputed — so the chip
              and the charge can never disagree.
            */
            getUserBananaBalance(user.id),
            wheelCandidates(),
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
          const counts = tierCounts(
            wheelOdds.tiers,
            pool.map((candidate) => Number(candidate.price)),
          );

          return json({
            tickets,
            bananas: wallet.balance,
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

          const outcome = await spinWheel({ userId: user.id, candidates: await wheelCandidates() });

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
