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
          await requireAdmin(request);
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
            }
            if (data.dinarPerBanana !== undefined) {
              patch["dinarPerBanana"] = Number(data.dinarPerBanana);
            }
            if (data.signupGrant !== undefined) {
              patch["bananaSignupGrant"] = Number(data.signupGrant);
            }
            if (Object.keys(patch).length > 0) {
              await updateStore((store) => ({
                ...store,
                settings: { ...(store.settings ?? {}), ...patch },
              }));
            }

            const enginePatch: Record<string, number> = {};
            if (data.openingPrice !== undefined) {
              enginePatch["basePrice"] = Number(data.openingPrice);
            }
            if (data.promoRatePerMinute !== undefined) {
              enginePatch["promoRatePerMinute"] = Number(data.promoRatePerMinute);
            }
            /*
              Held to the same rules as the engine tab, because this is the
              screen the owner actually uses. `save_market_config` below refuses
              a base outside its band and a band that rounds to nothing; this
              action wrote `basePrice` with nothing checked, which is how a base
              of 0.0004 went into a shop whose ceiling was 0.0003 and killed the
              market silently. One set of rules, both doors.
            */
            if (Object.keys(enginePatch).length > 0) {
              for (const [key, value] of Object.entries(enginePatch)) {
                if (!Number.isFinite(value)) {
                  return json({ error: `قيمة غير صالحة للحقل ${key}` }, { status: 400 });
                }
              }
              const problem = marketConfigProblem({ ...(await getMarketConfig()), ...enginePatch });
              if (problem) return json({ error: problem }, { status: 400 });
              await saveMarketConfig(enginePatch);
            }

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
