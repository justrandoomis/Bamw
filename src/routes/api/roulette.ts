import { createFileRoute } from "@tanstack/react-router";

import { getUserBananaBalance } from "@/lib/banana-balance.server";
import { getMarketConfig, spotPriceAt } from "@/lib/banana-market-config.server";
import { getStore } from "@/lib/db.server";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { requireUser } from "@/lib/session.server";
import {
  DEFAULT_PRICE_BOUNDARY,
  MAX_TICKETS_PER_SPIN,
  oddsRows,
  resolveOdds,
  validTicketCount,
} from "@/lib/roulette-odds";
import { buildPool, populationOf, readGameFlags } from "@/lib/roulette-pool.server";
import { importPrize } from "@/lib/roulette-import.server";
import { listPrizes, spinRoulette } from "@/lib/roulette.server";
import { getTicketBalance, getWheelOdds } from "@/lib/wheel.server";

/**
 * The roulette.
 *
 * Everything that decides anything happens on this side of the wire. The
 * browser sends how many tickets to spend and an id for the press of the
 * button; it does not send the pool, the odds, the price, the winner or the
 * product it claims to have won. «اعتبر كل بيانات Client غير موثوقة.»
 *
 * The animation is told the answer after the fact and exists to show it —
 * «الفائز معروف مسبقاً من استجابة السيرفر والAnimation فقط تعرضه».
 */

/** The pool, and the odds it implies, built from the catalogue on the server. */
async function buildState(tickets: number) {
  const [store, flags, wheelOdds, market] = await Promise.all([
    getStore(),
    readGameFlags(),
    getWheelOdds().catch(() => ({ ticketPriceBananas: 0 })),
    getMarketConfig().catch(() => null),
  ]);
  const boundary = Number(
    (market as { roulettePriceBoundary?: number } | null)?.roulettePriceBoundary ??
      DEFAULT_PRICE_BOUNDARY,
  );
  const { games } = buildPool(
    (store.products ?? []) as Record<string, unknown>[],
    flags,
    boundary > 0 ? boundary : DEFAULT_PRICE_BOUNDARY,
  );
  const population = populationOf(games);
  return {
    games,
    population,
    boundary: boundary > 0 ? boundary : DEFAULT_PRICE_BOUNDARY,
    ticketPriceBananas: Number(
      (wheelOdds as { ticketPriceBananas?: number }).ticketPriceBananas ?? 0,
    ),
    odds: resolveOdds(tickets, population, boundary > 0 ? boundary : DEFAULT_PRICE_BOUNDARY),
  };
}

/**
 * The strip the roulette scrolls, as cards.
 *
 * A SAMPLE, not the pool: sending seventeen hundred games so a browser can
 * scroll a ribbon past a pointer is a megabyte spent on decoration. The winner
 * is already decided by the time any of them is under the marker, and the
 * winning card is inserted into the strip by the client from the server's own
 * answer.
 *
 * `image` may be null and that is deliberate — «لا تستخدم صورة خاطئة… اعرض
 * fallback نظيف يحتوي اسم اللعبة فقط».
 */
const stripOf = (games: { id: string; title: string; squareImage: string | null }[]) =>
  games.slice(0, 80).map((game) => ({
    id: game.id,
    title: game.title,
    image: game.squareImage,
  }));

export const Route = createFileRoute("/api/roulette")({
  server: {
    handlers: {
      /** Everything the roulette screen needs to draw itself. */
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!getD1()) {
            /*
              The SAME SHAPE as a healthy answer, with empty values.

              The wheel's degraded payload omitted three fields the screen
              reads, so a client that survived the outage then crashed on the
              missing ones — an outage turned into a broken page.
            */
            return json({
              tickets: 0,
              bananas: 0,
              prizes: [],
              strip: [],
              poolSize: 0,
              population: {},
              odds: [],
              ticketPriceBananas: 0,
              maxTicketsPerSpin: MAX_TICKETS_PER_SPIN,
              priceBoundary: DEFAULT_PRICE_BOUNDARY,
              marketPrice: 0,
            });
          }

          const requested = validTicketCount(new URL(request.url).searchParams.get("tickets")) ?? 1;
          const [state, tickets, wallet, prizes, market] = await Promise.all([
            buildState(requested),
            getTicketBalance(user.id),
            getUserBananaBalance(user.id),
            listPrizes(user.id, 50),
            getMarketConfig().catch(() => null),
          ]);

          return json({
            tickets,
            bananas: wallet.balance,
            prizes,
            strip: stripOf(state.games),
            poolSize: state.games.length,
            population: state.population,
            odds: oddsRows(state.odds.probabilities, state.population),
            emptied: state.odds.emptied,
            ticketPriceBananas: state.ticketPriceBananas,
            maxTicketsPerSpin: MAX_TICKETS_PER_SPIN,
            priceBoundary: state.boundary,
            marketPrice: market ? spotPriceAt(market) : 0,
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });

          const sent = await body<Record<string, unknown>>(request).catch(
            () => ({}) as Record<string, unknown>,
          );
          const action = String(sent["action"] ?? "spin");

          /*
            A budget per ACTION, not one for the page.

            The wheel counted buying, spinning and everything else against a
            single thirty-a-minute allowance, so a member who bought ten
            tickets found they could no longer spin them. Importing a prize is
            rarer still and should not be starved by either.
          */
          const scope =
            action === "import_prize" ? "roulette-import" : action === "spin" ? "roulette-spin" : "roulette";
          const limit = action === "import_prize" ? 20 : 40;
          const throttle = await consumeRateLimit(request, scope, limit, 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          if (action === "import_prize") {
            /*
              The prize id, and NOTHING else. The product, its title, its price
              and its picture all come off the stored row — «لا يقبل productId
              من Client كحقيقة».
            */
            const result = await importPrize({
              userId: user.id,
              prizeId: String(sent["prizeId"] ?? ""),
            });
            if (result.ok) {
              return json({
                ok: true,
                orderId: result.orderId,
                threadId: result.threadId,
                prize: result.prize,
                alreadyImported: result.alreadyImported,
                message: result.alreadyImported
                  ? "هذه اللعبة مستوردة بالفعل، وهذا طلبها"
                  : "تم إنشاء طلب الهدية ✅",
              });
            }
            const why: Record<string, string> = {
              not_found: "لم نجد هذه الجائزة.",
              not_yours: "هذه الجائزة ليست لك.",
              already_claiming: "الاستيراد جارٍ الآن، حدّث الصفحة بعد لحظات.",
              expired: "انتهت صلاحية هذه الجائزة.",
              failed: "تعذّر إنشاء الطلب، والجائزة ما زالت لك. حاول مرة أخرى.",
            };
            return json(
              { error: why[result.reason] ?? why["failed"], code: result.reason },
              { status: result.reason === "not_found" || result.reason === "not_yours" ? 404 : 409 },
            );
          }

          if (action !== "spin") return json({ error: "إجراء غير معروف" }, { status: 400 });

          /*
            The ticket count is validated here AND inside `spinRoulette`. Twice
            on purpose: this one gives the member a sentence, and that one is
            the guarantee — a second caller of the module must not be able to
            skip the check by not being this route.
          */
          const tickets = validTicketCount(sent["tickets"]);
          if (tickets === null) {
            return json(
              { error: `اختر عددًا من التذاكر بين 1 و ${MAX_TICKETS_PER_SPIN}.`, code: "bad_tickets" },
              { status: 400 },
            );
          }

          const state = await buildState(tickets);
          const outcome = await spinRoulette({
            userId: user.id,
            tickets,
            requestId: String(sent["requestId"] ?? ""),
            games: state.games,
            priceBoundary: state.boundary,
          });

          if (outcome.ok) {
            return json({
              ok: true,
              won: outcome.won,
              spinId: outcome.spinId,
              tickets: outcome.tickets,
              ticketsLeft: outcome.ticketsLeft,
              replay: outcome.replay,
              prize: outcome.won ? outcome.prize : null,
              odds: oddsRows(outcome.odds.probabilities, state.population),
              message: outcome.won ? "مبروك! ربحت لعبة 🎉" : "حظ أوفر في المرة القادمة 🍀",
            });
          }

          const why: Record<string, string> = {
            bad_tickets: `اختر عددًا من التذاكر بين 1 و ${MAX_TICKETS_PER_SPIN}.`,
            bad_request: "طلب غير صالح.",
            no_tickets: "لا تملك هذا العدد من التذاكر.",
            empty_pool: "لا توجد ألعاب متاحة في الروليت الآن.",
            failed: "تعذّر تنفيذ الدورة. لم يُخصم شيء، حاول مرة أخرى.",
          };
          return json(
            {
              error: why[outcome.reason] ?? why["failed"],
              code: outcome.reason,
              ticketsLeft: outcome.ticketsLeft,
            },
            { status: outcome.reason === "no_tickets" ? 409 : 400 },
          );
        }),
    },
  },
});
