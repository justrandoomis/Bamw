import { createFileRoute } from "@tanstack/react-router";

import {
  adminAdjustUserBanana,
  adminCancelMarketListing,
  adminDeleteBot,
  adminDeleteReward,
  adminSaveBot,
  adminSaveReward,
  adminToggleReward,
  adminUpdateRedemption,
  getAdminBananaData,
  getBananaBalance,
  saveMarketConfig,
} from "@/lib/banana.server";
/* The same numbers the pricing uses, so the refusal cannot disagree with it. */
import { getMarketConfig, marketConfigProblem } from "@/lib/banana-market-config.server";
import { getWheelOdds, saveWheelOdds } from "@/lib/wheel.server";
import { wheelOddsProblem } from "@/lib/wheel-odds";
import {
  createBananCodesBatch,
  deleteBananCode,
  listBananCodesWithDetails,
  updateStore,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";

/**
 * The Banana Market admin panel's server side.
 *
 * The panel — six tabs, an economy engine, market-maker bots, redemption
 * rewards, wallets — was fully built in the browser and fully built in
 * `banana.server.ts`, and the two were never connected. This route handled
 * three actions about top-up codes and nothing else: no `GET` at all, so every
 * counter on the page read zero, and no branch for any of the ten actions the
 * panel POSTs, so every button answered `{"error":"Invalid action"}`.
 *
 * The store meanwhile had a live market — offers, balances, trades — that the
 * owner could see as a customer and not as an admin. Nothing here computes
 * anything new; it hands the panel the functions that were already waiting for
 * it.
 */
export const Route = createFileRoute("/api/admin/banana")({
  server: {
    handlers: {
      /** Everything the six tabs render, in one read. */
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          return json(await getAdminBananaData());
        }),

      POST: async ({ request }) =>
        guard(async () => {
          /*
            Named, not just checked. A popularity tier moves which prizes a
            member can win, so the row it writes carries the admin who set it.
          */
          const admin = await requireAdmin(request);
          const data = await body<any>(request);
          const action = String(data.action ?? "");

          /* ---------------------------- top-up codes --------------------------- */

          if (action === "create_code") {
            const value = Number(data.value);
            const count = Number(data.count) || 1;
            if (!value || value <= 0 || !Number.isFinite(value)) {
              return json({ error: "Invalid value" }, { status: 400 });
            }
            const codes = await createBananCodesBatch(value, count);
            return json({ success: true, codes, code: codes[0] });
          }

          if (action === "list_codes") {
            return json({ codes: await listBananCodesWithDetails() });
          }

          if (action === "delete_code") {
            const id = String(data.id ?? "").trim();
            if (!id) return json({ error: "Invalid code ID" }, { status: 400 });
            return json({ success: await deleteBananCode(id) });
          }

          /* ------------------------- economy + engine -------------------------- */

          if (action === "save_settings") {
            /*
              The earn rate, the dinar peg and the signup grant live in the
              store settings; the opening price and the promo rate are the
              market engine's and are written through `saveMarketConfig` so the
              engine and the legacy mirrors cannot drift apart.

              Each field is written only when the panel actually sent it —
              a partial save must not reset the fields it did not carry.
            */
            const patch: Record<string, unknown> = {};
            if (data.rewardRatePerIqd !== undefined) {
              patch["bananaPerDinar"] = Number(data.rewardRatePerIqd);
              /*
                Both names for one number, written together so they cannot
                drift. `orders.server.ts` minted from `banana_reward_rate`
                while this panel only ever wrote `bananaPerDinar`, so the earn
                rate the owner set had no effect on what anyone earned.
              */
              patch["banana_reward_rate"] = Number(data.rewardRatePerIqd);
            }
            if (data.dinarPerBanana !== undefined) {
              patch["dinarPerBanana"] = Number(data.dinarPerBanana);
            }
            if (data.signupGrant !== undefined) {
              patch["bananaSignupGrant"] = Number(data.signupGrant);
            }

            const enginePatch: Record<string, number> = {};
            if (data.openingPrice !== undefined) {
              enginePatch["basePrice"] = Number(data.openingPrice);
            }
            if (data.promoRatePerMinute !== undefined) {
              enginePatch["promoRatePerMinute"] = Number(data.promoRatePerMinute);
            }

            /*
              Everything checked before anything is written.

              This form saves two halves — the store's settings and the market
              engine's — and it used to write the first half and then refuse
              the second. A rejected save had already changed the shop's earn
              rate, and the admin saw only the error: a save that half
              happened, reported as a save that did not.

              The engine half is held to the same rules as the engine tab,
              because this is the screen the owner actually uses.
              `save_market_config` refuses a base outside its band and a band
              that rounds to nothing; this action wrote `basePrice` with
              nothing checked at all, which is how a base of 0.0004 went into a
              shop whose ceiling was 0.0003 and killed the market silently. One
              set of rules, both doors.
            */
            for (const [key, value] of Object.entries({ ...patch, ...enginePatch })) {
              if (!Number.isFinite(Number(value))) {
                return json({ error: `قيمة غير صالحة للحقل ${key}` }, { status: 400 });
              }
            }
            if (Object.keys(enginePatch).length > 0) {
              const problem = marketConfigProblem({ ...(await getMarketConfig()), ...enginePatch });
              if (problem) return json({ error: problem }, { status: 400 });
            }

            if (Object.keys(patch).length > 0) {
              await updateStore((store) => ({
                ...store,
                settings: { ...(store.settings ?? {}), ...patch },
              }));
            }
            if (Object.keys(enginePatch).length > 0) await saveMarketConfig(enginePatch);

            const fresh = await getAdminBananaData();
            return json({ success: true, settings: fresh.settings });
          }

          if (action === "save_market_config") {
            const c = (data.config ?? {}) as Record<string, unknown>;
            const numeric = [
              "basePrice",
              "minPrice",
              "maxPrice",
              "commissionPercent",
              "volatilityPercent",
              "botCount",
              "botMinQuantity",
              "botMaxQuantity",
              "minListingQuantity",
              "maxListingQuantity",
              "promoRatePerMinute",
            ] as const;

            const patch: Record<string, unknown> = {};
            for (const key of numeric) {
              if (c[key] === undefined) continue;
              const value = Number(c[key]);
              if (!Number.isFinite(value)) {
                return json({ error: `قيمة غير صالحة للحقل ${key}` }, { status: 400 });
              }
              patch[key] = value;
            }
            if (c["botsEnabled"] !== undefined) patch["botsEnabled"] = Boolean(c["botsEnabled"]);
            /*
              The switch on direct selling — «تعطيل/تفعيل البيع المباشر عند
              الحاجة». A boolean, so it is coerced rather than validated: there
              is no invalid value, only on and off.
            */
            if (c["directSellEnabled"] !== undefined) {
              patch["directSellEnabled"] = Boolean(c["directSellEnabled"]);
            }

            /*
              One set of rules, shared with `save_settings` above, so the two
              doors into the same configuration cannot disagree about what a
              usable market is. Refused rather than silently repaired: the
              admin is told which number is wrong and why, instead of being
              left to wonder why the engine ignored them.
            */
            const current = (await getAdminBananaData()).marketConfig;
            const problem = marketConfigProblem({ ...current, ...patch } as typeof current);
            if (problem) return json({ error: problem }, { status: 400 });

            return json({ success: true, marketConfig: await saveMarketConfig(patch) });
          }

          /* ------------------------------ the wheel ---------------------------- */

          if (action === "save_wheel_odds") {
            /*
              Validated as the admin typed it, not as the reader would repair
              it. `normalizeWheelOdds` sorts a jumbled set and substitutes the
              shipped bands for an unusable one — which is right on the way
              OUT of storage, and would silently swallow the mistake on the way
              in. So the raw values are coerced to numbers and checked, and
              only then saved.
            */
            const raw = (data.odds ?? {}) as Record<string, unknown>;
            const current = await getWheelOdds();

            const tiers = Array.isArray(raw["tiers"])
              ? (raw["tiers"] as Record<string, unknown>[]).map((tier, index) => {
                  const bound = tier?.["upTo"];
                  return {
                    upTo:
                      bound === null || bound === undefined || bound === "" ? null : Number(bound),
                    weight: Number(tier?.["weight"]),
                    label: String(tier?.["label"] ?? `فئة ${index + 1}`),
                  };
                })
              : current.tiers;

            const candidate = {
              tiers,
              losingPercent:
                raw["losingPercent"] === undefined
                  ? current.losingPercent
                  : Number(raw["losingPercent"]),
              ticketPriceBananas:
                raw["ticketPriceBananas"] === undefined
                  ? current.ticketPriceBananas
                  : Number(raw["ticketPriceBananas"]),
            };

            const problem = wheelOddsProblem(candidate);
            if (problem) return json({ error: problem }, { status: 400 });

            return json({ success: true, wheelOdds: await saveWheelOdds(candidate) });
          }

          /* ------------------------------- bots -------------------------------- */

          if (action === "save_bot") {
            const bot = data.bot ?? {};
            if (!String(bot.name ?? "").trim()) {
              return json({ error: "اسم البوت مطلوب" }, { status: 400 });
            }
            const saved = await adminSaveBot(bot);
            return json({ success: true, id: saved.id });
          }

          if (action === "delete_bot") {
            const botId = String(data.botId ?? "").trim();
            if (!botId) return json({ error: "معرّف البوت مطلوب" }, { status: 400 });
            await adminDeleteBot(botId);
            return json({ success: true });
          }

          /* ----------------------------- rewards ------------------------------- */

          if (action === "save_reward") {
            const reward = data.reward ?? {};
            if (!String(reward.title ?? "").trim()) {
              return json({ error: "عنوان الجائزة مطلوب" }, { status: 400 });
            }
            /*
              Under either name. The admin form's field is `cost`; this read
              only `bananaPrice`, so every save was `Number(undefined)` — NaN —
              and was refused here with a message no one ever saw, because not
              one mutation on that screen had an onError.
            */
            const price = Number(reward.bananaPrice ?? reward.cost);
            if (!Number.isFinite(price) || price <= 0) {
              return json({ error: "سعر الجائزة بالموز غير صالح" }, { status: 400 });
            }
            return json({ success: true, reward: await adminSaveReward(reward) });
          }

          if (action === "delete_reward") {
            const rewardId = String(data.rewardId ?? "").trim();
            if (!rewardId) return json({ error: "معرّف الجائزة مطلوب" }, { status: 400 });
            await adminDeleteReward(rewardId);
            return json({ success: true, rewardId });
          }

          if (action === "toggle_reward") {
            const rewardId = String(data.rewardId ?? "").trim();
            if (!rewardId) return json({ error: "معرّف الجائزة مطلوب" }, { status: 400 });
            const isActive = Boolean(data.isActive);
            await adminToggleReward(rewardId, isActive);
            return json({ success: true, rewardId, isActive });
          }

          /* --------------------------- redemptions ----------------------------- */

          if (action === "update_redemption") {
            const redemptionId = String(data.redemptionId ?? "").trim();
            if (!redemptionId) return json({ error: "معرّف الطلب مطلوب" }, { status: 400 });
            await adminUpdateRedemption(redemptionId, {
              status: data.status,
              adminNotes: data.adminNotes ?? "",
              deliveryCode: data.deliveryCode ?? "",
            });
            return json({ success: true, redemptionId });
          }

          /* ------------------------ listings + wallets ------------------------- */

          if (action === "cancel_listing") {
            /*
              Cancelling returns the seller's locked bananas to them —
              `adminCancelMarketListing` goes through the same `cancelListing`
              a seller uses, so the refund and the ledger entry are the ones the
              market already writes rather than a second, admin-only path.
            */
            const listingId = String(data.listingId ?? "").trim();
            if (!listingId) return json({ error: "معرّف العرض مطلوب" }, { status: 400 });
            await adminCancelMarketListing(listingId);
            return json({ success: true, refundedBananas: 0 });
          }

          /*
            Tickets, granted by hand.

            «أو تعطى عن طريق الأدمن للمستخدمين» — the second of the two ways a
            member can get a ticket. Bananas are the first and they go through
            the redemption screen; this is the shop simply handing one over.

            `referenceId` is what makes it safe to press twice: the ledger has
            a unique index on it, so a repeated grant with the same reference
            adds nothing and says so.
          */
          if (action === "grant_wheel_tickets") {
            const userId = String(data.userId ?? "").trim();
            const quantity = Math.floor(Number(data.quantity));
            if (!userId) return json({ error: "معرّف المستخدم مطلوب" }, { status: 400 });
            if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
              return json({ error: "عدد التذاكر يجب أن يكون بين 1 و 100" }, { status: 400 });
            }

            const { grantTickets } = await import("@/lib/wheel.server");
            const reference = String(data.referenceId ?? "").trim();
            const result = await grantTickets({
              userId,
              quantity,
              reason: `admin_grant:${String(data.reason ?? "").slice(0, 120)}`,
              ...(reference ? { referenceId: reference } : {}),
            });

            return json({
              success: true,
              granted: result.granted,
              tickets: result.balance,
              // Said plainly rather than silently: a second press changed nothing.
              ...(result.granted ? {} : { note: "تم منح هذه التذاكر سابقاً بنفس المرجع" }),
            });
          }

          /*
            Turn a redemption offer into a ticket offer, or back.

            The banana price stays where the admin already sets prices — on the
            offer itself. This only records how many tickets that offer hands
            over, which is the one thing the redemption table cannot hold.
          */
          if (action === "set_ticket_offer") {
            const offerId = String(data.offerId ?? "").trim();
            const quantity = Math.floor(Number(data.ticketQuantity ?? 0));
            if (!offerId) return json({ error: "معرّف المكافأة مطلوب" }, { status: 400 });
            if (!Number.isFinite(quantity) || quantity < 0 || quantity > 100) {
              return json({ error: "عدد التذاكر غير صالح" }, { status: 400 });
            }
            const { setTicketOffer } = await import("@/lib/wheel.server");
            await setTicketOffer(offerId, quantity);
            return json({ success: true, offerId, ticketQuantity: quantity });
          }

          /* ---------------------------- the roulette --------------------------- */

          /*
            A game's popularity tier, and whether it is in the prize pool.
            «إدارة Popularity tier للألعاب عند الحاجة» and «استبعاد لعبة من
            Prize Pool بدون حذفها من المتجر».

            Neither touches the catalogue. They are the roulette's own facts
            about a product and they live in the roulette's own table — the
            shop's commercial record is not written to in order to say how
            famous a game is. See `roulette-pool.server.ts`.
          */
          if (action === "set_game_flags") {
            const productId = String(data.productId ?? "").trim();
            if (!productId) return json({ error: "معرّف المنتج مطلوب" }, { status: 400 });

            const rawTier = data.popularity;
            let popularity: "low" | "medium" | "high" | undefined;
            if (rawTier !== undefined) {
              const tier = String(rawTier).toLowerCase();
              if (!["low", "medium", "high"].includes(tier)) {
                return json({ error: "تصنيف الشهرة غير صالح" }, { status: 400 });
              }
              popularity = tier as "low" | "medium" | "high";
            }
            const excluded = data.excluded === undefined ? undefined : Boolean(data.excluded);
            if (popularity === undefined && excluded === undefined) {
              return json({ error: "لا يوجد شيء لتغييره" }, { status: 400 });
            }

            const { setGameFlags } = await import("@/lib/roulette-pool.server");
            await setGameFlags({
              productId,
              ...(popularity === undefined ? {} : { popularity }),
              ...(excluded === undefined ? {} : { excluded }),
              updatedBy: admin.id,
            });
            return json({ success: true, productId, popularity, excluded });
          }

          /*
            What the roulette actually pays out, at every ticket count.

            «عرض النسبة الفعلية النهائية بعد normalization وليس weights مبهمة»
            — so this returns the real percentages, the count of eligible games
            behind each one, and which buckets are empty and therefore giving
            their share away. Read-only: the curve is the engine's and is not
            editable by typing over it, which is the point of having solved it
            rather than tabulated it.
          */
          if (action === "roulette_odds") {
            const [{ getStore }, poolModule, oddsModule] = await Promise.all([
              import("@/lib/db.server"),
              import("@/lib/roulette-pool.server"),
              import("@/lib/roulette-odds"),
            ]);
            const store = await getStore();
            const flags = await poolModule.readGameFlags();
            const boundary = Number(data.priceBoundary ?? oddsModule.DEFAULT_PRICE_BOUNDARY);
            const built = poolModule.buildPool(
              (store.products ?? []) as Record<string, unknown>[],
              flags,
              boundary > 0 ? boundary : oddsModule.DEFAULT_PRICE_BOUNDARY,
            );
            const population = poolModule.populationOf(built.games);

            const curve: {
              tickets: number;
              rows: ReturnType<typeof oddsModule.oddsRows>;
              emptied: string[];
            }[] = [];
            for (let tickets = 1; tickets <= oddsModule.MAX_TICKETS_PER_SPIN; tickets += 1) {
              const resolved = oddsModule.resolveOdds(tickets, population, boundary);
              curve.push({
                tickets,
                rows: oddsModule.oddsRows(resolved.probabilities, population),
                emptied: resolved.emptied,
              });
            }

            return json({
              success: true,
              priceBoundary: boundary > 0 ? boundary : oddsModule.DEFAULT_PRICE_BOUNDARY,
              poolSize: built.games.length,
              skipped: built.skipped,
              population,
              curve,
            });
          }

          /*
            The audit search: «البحث بالمستخدم، بـSpin ID، بـPrize ID، بـOrder ID».

            One action rather than four, because the admin has one box to type
            into and does not know in advance which kind of id they are holding.
            Every branch is bounded and read-only.
          */
          if (action === "roulette_audit") {
            const query = String(data.query ?? "").trim().slice(0, 100);
            if (!query) return json({ error: "اكتب معرّفًا للبحث عنه" }, { status: 400 });

            const { d1All } = await import("@/lib/d1.server");
            const [spins, prizes, sales, tickets] = await Promise.all([
              d1All(
                `SELECT id, user_id, tickets, bucket, product_id, product_title, product_price,
                        status, created_at, settled_at, prize_id, request_id
                   FROM wheel_spins
                  WHERE id = ? OR user_id = ? OR prize_id = ?
                  ORDER BY created_at DESC LIMIT 50`,
                query,
                query,
                query,
              ).catch(() => []),
              d1All(
                `SELECT * FROM roulette_prizes
                  WHERE id = ? OR user_id = ? OR spin_id = ? OR order_id = ?
                  ORDER BY won_at DESC LIMIT 50`,
                query,
                query,
                query,
                query,
              ).catch(() => []),
              d1All(
                `SELECT id, user_id, quantity, price_per_banana, proceeds_iqd, status, created_at
                   FROM banana_direct_sales
                  WHERE id = ? OR user_id = ?
                  ORDER BY created_at DESC LIMIT 50`,
                query,
                query,
              ).catch(() => []),
              d1All(
                `SELECT id, user_id, delta, reason, reference_id, created_at
                   FROM wheel_ticket_ledger
                  WHERE user_id = ? OR reference_id = ?
                  ORDER BY created_at DESC LIMIT 100`,
                query,
                query,
              ).catch(() => []),
            ]);

            return json({ success: true, query, spins, prizes, sales, tickets });
          }

          if (action === "adjust_balance") {
            const userId = String(data.userId ?? "").trim();
            const amount = Number(data.amount);
            if (!userId) return json({ error: "معرّف المستخدم مطلوب" }, { status: 400 });
            if (!Number.isFinite(amount) || amount === 0) {
              return json({ error: "قيمة التعديل غير صالحة" }, { status: 400 });
            }
            /*
              A member's balance is their money. The reason is recorded with the
              movement — `creditBananaBalance`/`debitBananaBalance` write the
              transaction row — so an adjustment is always answerable later.
            */
            const before = await getBananaBalance(userId);
            const result = await adminAdjustUserBanana(
              userId,
              amount,
              String(data.reason ?? "تعديل إداري").slice(0, 200),
            );
            if (!result.success) {
              return json({ error: result.error || "تعذّر تعديل الرصيد" }, { status: 400 });
            }
            return json({
              success: true,
              userId,
              oldBalance: before.balance,
              newBalance: result.newBalance,
            });
          }

          return json({ error: "Invalid action" }, { status: 400 });
        }),
    },
  },
});
