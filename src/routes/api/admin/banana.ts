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
import { PRICE_STEP, roundsToZero } from "@/lib/banana-market-config.server";
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
              A floor above the ceiling, or a base outside its own bounds, is a
              market nobody can list into. `getMarketConfig` silently repairs
              the first of those on read; refusing here means the admin is told
              rather than left wondering why the engine ignored them.
            */
            const current = (await getAdminBananaData()).marketConfig;
            const merged = { ...current, ...patch } as typeof current;
            if (merged.minPrice > merged.maxPrice) {
              return json({ error: "أدنى سعر أكبر من أعلى سعر" }, { status: 400 });
            }
            if (!(merged.basePrice > 0)) {
              return json({ error: "السعر الأساسي يجب أن يكون أكبر من صفر" }, { status: 400 });
            }
            /*
              The comment above promised this check and the code never made it.
              Production is in exactly the state it describes: a base of 0.0004
              against a ceiling of 0.0003, so `spotPriceAt` clamps every price
              to the ceiling and the base the admin set means nothing.
            */
            if (merged.basePrice < merged.minPrice || merged.basePrice > merged.maxPrice) {
              return json(
                {
                  error:
                    `السعر الأساسي (${merged.basePrice}) خارج حدوده: ` +
                    `أدنى ${merged.minPrice} وأعلى ${merged.maxPrice}. ` +
                    "المحرك يحصر السعر داخل الحدين، فالقيمة خارجهما لا أثر لها.",
                },
                { status: 400 },
              );
            }
            /*
              A band that rounds to nothing.

              `spotPriceAt` rounds to three decimals, so a ceiling below 0.0005
              prices at 0.000 for every customer no matter what the base says —
              which is the «موزة واحدة $0.00» that was reported. Refused with
              the smallest usable number rather than saved and left to puzzle
              the admin, who sees a price they set and a market showing zero.
            */
            for (const [label, value] of [
              ["السعر الأساسي", merged.basePrice],
              ["أدنى سعر", merged.minPrice],
              ["أعلى سعر", merged.maxPrice],
            ] as const) {
              if (roundsToZero(value)) {
                return json(
                  {
                    error:
                      `${label} (${value}) يُقرَّب إلى صفر عند دقة السوق. ` +
                      `أصغر قيمة قابلة للعرض هي ${PRICE_STEP}.`,
                  },
                  { status: 400 },
                );
              }
            }
            if (merged.botMinQuantity > merged.botMaxQuantity) {
              return json({ error: "أقل كمية للبوت أكبر من أكبر كمية" }, { status: 400 });
            }
            if (merged.minListingQuantity > merged.maxListingQuantity) {
              return json({ error: "أقل كمية للعرض أكبر من أكبر كمية" }, { status: 400 });
            }

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
