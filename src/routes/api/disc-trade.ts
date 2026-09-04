import { createFileRoute } from "@tanstack/react-router";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin, requireUser } from "@/lib/session.server";
import { d1All, d1First, d1Run, ensureSchema } from "@/lib/d1.server";
import { d1Batch } from "@/lib/db.server";
import { randomId } from "@/lib/crypto.server";
import {
  computeTradeValue,
  canTransition,
  initialTradeStatus,
  normalizeTradeStatus,
  type TradeRule,
  type TradeStatus,
} from "@/lib/trade-calc";
import {
  backfillCanonicalIds,
  getGame,
  listTradeRules,
  matchGame,
} from "@/lib/game-catalog.server";
import { redactDiscTradeForMember } from "@/lib/redaction";
import { describeSelections, payoutMethodOf } from "@/lib/tradeConditionView";
import { chunkForParams } from "@/lib/sql-params";

interface TradeBody extends Record<string, unknown> {
  action?: string;
}

const now = () => new Date().toISOString();

async function notify(text: string, userId?: string) {
  try {
    const { sendTelegramMessage } = await import("@/lib/telegram.server");
    const { d1First } = await import("@/lib/d1.server");

    let chatId: string | undefined;
    if (userId) {
      const link = await d1First<{ telegram_chat_id: number }>(
        "SELECT telegram_chat_id FROM telegram_links WHERE user_id = ?",
        userId,
      );
      if (link) chatId = String(link.telegram_chat_id);
    }

    if (chatId) {
      await sendTelegramMessage(chatId, text);
    }
  } catch {
    // Notifications must never break the trade lifecycle.
  }
}

async function appendStatus(tradeId: string, status: string, actor: string, note?: string) {
  const normStatus = normalizeTradeStatus(status);
  const row = await d1First<{ status_history: string | null }>(
    `SELECT status_history FROM disc_trades WHERE id = ?`,
    tradeId,
  );
  let history: unknown[] = [];
  try {
    history = JSON.parse(row?.status_history || "[]");
  } catch {
    history = [];
  }
  history.push({ status: normStatus, at: now(), actor, note: note ?? null });
  await d1Run(
    `UPDATE disc_trades SET status = ?, status_history = ?, updated_at = ? WHERE id = ?`,
    normStatus,
    JSON.stringify(history),
    now(),
    tradeId,
  );
  await d1Run(
    `INSERT INTO delivery_events (id, context_kind, context_id, event, actor, note, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    randomId("dev"),
    "trade",
    tradeId,
    `status:${normStatus}`,
    actor,
    note ?? null,
    now(),
  );
}

export const Route = createFileRoute("/api/disc-trade")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await ensureSchema();
          const url = new URL(request.url);
          const scope = url.searchParams.get("scope") || "mine";

          if (scope === "rules") return json({ rules: await listTradeRules() });

          if (scope === "admin") {
            await requireAdmin(request);
            const rawStatus = url.searchParams.get("status") || "";
            const filterStatus = rawStatus ? normalizeTradeStatus(rawStatus) : "";
            const rows = filterStatus
              ? await d1All<Record<string, any>>(
                  `SELECT * FROM disc_trades WHERE status = ? OR (status = 'pending' AND ? = 'waiting_review') ORDER BY created_at DESC LIMIT 200`,
                  filterStatus,
                  filterStatus,
                )
              : await d1All<Record<string, any>>(
                  `SELECT * FROM disc_trades ORDER BY created_at DESC LIMIT 200`,
                );

            /*
              Everything the shop owner needs to put a price on the disc.

              The row alone carries none of it. `selections` is a JSON string
              the client cannot read through its own `typeof === "object"`
              guard; the values inside it are rule keys, whose Arabic labels
              live in `trade_rules`; every photo after the first sits in
              `disc_trade_images`, which nothing had ever SELECTed; and the
              catalogue's own valuation — the number a manual price is judged
              against — was joined for the member's view and not for the
              admin's. Resolved here, once, rather than asked of the client.
            */
            const rules = (await listTradeRules()) as unknown as TradeRule[];

            /*
              Both lookups are `IN (...)` over up to 200 rows, and D1 accepts
              fewer bound variables than that. `chunkForParams` splits each
              into statements that fit — the same guard the product index uses,
              and the one `sql-bounds-audit.test.ts` exists to make sure a new
              dynamic statement cannot skip.
            */
            const ids = rows.map((r) => String(r["id"] ?? "")).filter(Boolean);
            const photos = new Map<string, { url: string; kind: string }[]>();
            for (const group of chunkForParams(ids, 1)) {
              const placeholders = group.map(() => "?").join(",");
              const imageRows = await d1All<Record<string, any>>(
                `SELECT trade_id, url, kind FROM disc_trade_images
                  WHERE trade_id IN (${placeholders}) ORDER BY created_at`,
                ...group,
              );
              for (const row of imageRows) {
                const key = String(row["trade_id"] ?? "");
                const url = String(row["url"] ?? "");
                if (!key || !url) continue;
                photos.set(key, [
                  ...(photos.get(key) ?? []),
                  { url, kind: String(row["kind"] ?? "other") },
                ]);
              }
            }

            const catalogue = new Map<string, Record<string, any>>();
            const gameIds = [
              ...new Set(rows.map((r) => String(r["game_id"] ?? "")).filter(Boolean)),
            ];
            for (const group of chunkForParams(gameIds, 1)) {
              const placeholders = group.map(() => "?").join(",");
              const catalogueRows = await d1All<Record<string, any>>(
                `SELECT game_id, title, trade_value_iqd, store_offer_bonus_iqd, cover_url
                   FROM game_catalog WHERE game_id IN (${placeholders})`,
                ...group,
              );
              for (const row of catalogueRows) {
                catalogue.set(String(row["game_id"] ?? ""), row);
              }
            }

            const normalizedRows = rows.map((r) => {
              const id = String(r["id"] ?? "");
              const game = catalogue.get(String(r["game_id"] ?? ""));
              const gallery = photos.get(id) ?? [];
              const first = r["photo_url"] ? String(r["photo_url"]) : "";
              return {
                ...r,
                status: normalizeTradeStatus(r.status),
                /* Finished labels, in the order the customer answered them. */
                conditionAnswers: describeSelections(r["selections"], rules),
                /*
                  Every photo, the thumbnail included and never duplicated. The
                  close-up of the scratch is usually the one that decides the
                  price, and it was the one nobody could see.
                */
                photos: [
                  ...(first ? [{ url: first, kind: "primary" }] : []),
                  ...gallery.filter((p) => p.url !== first),
                ],
                /* What the customer actually asked for, not the hardcoded column. */
                payoutMethod: payoutMethodOf(r["selections"]),
                catalogTitle: game?.["title"] ?? null,
                catalogValuationIqd: game?.["trade_value_iqd"] ?? null,
                catalogBonusIqd: game?.["store_offer_bonus_iqd"] ?? null,
                coverUrl: game?.["cover_url"] ?? null,
              };
            });
            return json({ items: normalizedRows });
          }

          const user = await requireUser(request);
          const trades = await d1All<Record<string, any>>(
            `SELECT dt.*, gc.title AS catalog_title, gc.trade_value_iqd AS official_valuation, gc.store_offer_bonus_iqd AS catalog_bonus_iqd, gc.cover_url
             FROM disc_trades dt
             LEFT JOIN game_catalog gc ON gc.game_id = dt.game_id
             WHERE dt.user_id = ? ORDER BY dt.created_at DESC`,
            user.id,
          );
          const normalizedTrades = trades.map((t) => ({
            ...redactDiscTradeForMember(t),
            status: normalizeTradeStatus(t.status),
          }));
          return json({ items: normalizedTrades });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          await ensureSchema();
          await backfillCanonicalIds();
          const data = await body<TradeBody>(request);
          const action = String(data.action || "submit");

          /* ---------------- quote: deterministic, no AI, no network -------- */
          if (action === "quote") {
            const isCustom = data["is_custom"] === true || data["game_id"] === "custom";
            if (isCustom) {
              return json({
                matched: false,
                is_custom: true,
                priced: false,
                message: "السعر بعد المراجعة من قبل الإدارة",
              });
            }

            const rules = (await listTradeRules()) as unknown as TradeRule[];
            let gameId = String(data["game_id"] || "");
            if (!gameId && data["game_name"]) {
              const match = await matchGame(String(data["game_name"]));
              if (!match) {
                return json({
                  matched: false,
                  priced: false,
                  message: "لم يتم العثور على اللعبة في القائمة الرسمية (السعر بعد المراجعة).",
                });
              }
              gameId = match.game_id;
            }
            const game = gameId ? await getGame(gameId) : undefined;
            if (!game) {
              return json({
                matched: false,
                priced: false,
                message: "اللعبة غير موجودة في القائمة التلقائية (السعر بعد المراجعة)",
              });
            }

            // Check if game is disabled for trades
            if (game.trade_enabled === 0) {
              return json({
                matched: true,
                game,
                priced: false,
                trade_enabled: false,
                message: "المقايضة غير متاحة لهذه اللعبة حالياً بقرار من الإدارة.",
              });
            }

            const base = Number(game.trade_value_iqd || 0);
            if (!base) {
              return json({
                matched: true,
                game,
                priced: false,
                message: "لم يتم اعتماد سعر مقايضة لهذه اللعبة بعد (السعر بعد المراجعة).",
              });
            }
            const selections = (data["selections"] as Record<string, string>) || {};
            const result = computeTradeValue(base, selections, rules);
            const bonusIqd = Number(game.store_offer_bonus_iqd || 0);
            const storeOfferTotal = result.final_iqd + bonusIqd;

            return json({
              matched: true,
              priced: true,
              trade_enabled: true,
              game,
              quote: {
                ...result,
                store_offer_bonus_iqd: bonusIqd,
                store_offer_total_iqd: storeOfferTotal,
              },
            });
          }

          /* ---------------- user actions ----------------------------------- */
          if (action === "cancel" || action === "user_cancel") {
            const user = await requireUser(request);
            const tradeId = String(data["trade_id"] || "");
            const trade = await d1First<{ status: string; user_id: string }>(
              `SELECT status, user_id FROM disc_trades WHERE id = ?`,
              tradeId,
            );
            if (!trade || trade.user_id !== user.id)
              return json({ error: "غير مسموح" }, { status: 403 });

            const currentNormStatus = normalizeTradeStatus(trade.status);
            if (!canTransition(currentNormStatus, "cancelled"))
              return json({ error: "لا يمكن الإلغاء في هذه المرحلة" }, { status: 400 });

            await appendStatus(tradeId, "cancelled", user.id, "ملغاة من قبل العميل");
            return json({ success: true });
          }

          if (action === "accept" || action === "accept_offer") {
            const user = await requireUser(request);
            const tradeId = String(data["trade_id"] || "");
            const payout = String(data["payout_type"] || "store_credit");
            const trade = await d1First<{ status: string; user_id: string }>(
              `SELECT status, user_id FROM disc_trades WHERE id = ?`,
              tradeId,
            );
            if (!trade || trade.user_id !== user.id)
              return json({ error: "غير مسموح" }, { status: 403 });

            /*
              The customer accepting the offer is the one transition they own.
              It is only meaningful while an offer is actually with them.
            */
            const currentNormStatus = normalizeTradeStatus(trade.status);
            if (!canTransition(currentNormStatus, "customer_approved"))
              return json({ error: "لا يمكن قبول العرض الآن" }, { status: 400 });

            const acceptedAt = new Date().toISOString();
            await d1Run(
              `UPDATE disc_trades SET payout_type = ?, customer_approved_at = ? WHERE id = ?`,
              payout,
              acceptedAt,
              tradeId,
            );
            await appendStatus(tradeId, "customer_approved", user.id, `payout:${payout}`);
            await notify(`🔄 المستخدم قبل عرض المقايضة ${tradeId} (${payout})`);
            return json({ success: true });
          }

          /* ---------------- admin transitions ------------------------------ */
          if (action === "admin_update") {
            const admin = await requireAdmin(request);
            const tradeId = String(data["trade_id"] || "");
            const trade = await d1First<{
              id: string;
              status: string;
              user_id: string;
              valuation_iqd: number | null;
              final_iqd: number | null;
              admin_valuation_iqd: number | null;
              approved_iqd: number | null;
              payout_credited: number | null;
              preferred_trade: string | null;
              payout_type: string | null;
              selections: string | null;
            }>(
              `SELECT id, status, user_id, valuation_iqd, final_iqd, admin_valuation_iqd, approved_iqd, payout_credited, preferred_trade, payout_type, selections FROM disc_trades WHERE id = ?`,
              tradeId,
            );
            if (!trade) return json({ error: "طلب المقايضة غير موجود" }, { status: 404 });

            const actor = String((admin as { email?: string }).email ?? "admin");
            const currentNormStatus = normalizeTradeStatus(trade.status);

            /*
              Setting a price and approving it are different acts.

              `approved_iqd` is written only here, only by an admin, and is what
              the customer is shown as "السعر النهائي المعتمد" and what the
              payout uses. `final_iqd` remains the estimate and is never
              promoted into it silently — a manual-priced request has no
              estimate at all, and pretending otherwise is what made the two
              indistinguishable on the card.
            */
            const priceInput = data["approved_iqd"] ?? data["admin_valuation_iqd"];
            if (priceInput !== undefined) {
              const amount = Math.max(0, Math.round(Number(priceInput) || 0));
              await d1Run(
                `UPDATE disc_trades SET approved_iqd = ?, admin_valuation_iqd = ?, priced_at = COALESCE(priced_at, ?), updated_at = ? WHERE id = ?`,
                amount,
                amount,
                now(),
                now(),
                tradeId,
              );
            }
            if (data["admin_notes"] !== undefined) {
              await d1Run(
                `UPDATE disc_trades SET admin_notes = ?, updated_at = ? WHERE id = ?`,
                String(data["admin_notes"] ?? ""),
                now(),
                tradeId,
              );
            }

            const rawNext = data["status"] ? String(data["status"]).trim() : "";
            if (rawNext && rawNext !== trade.status && rawNext !== currentNormStatus) {
              const next = normalizeTradeStatus(rawNext);
              /*
                A price has to exist before it can be offered. Without this an
                admin could send "بانتظار موافقة العميل" on a manual request
                that still had no number, and the customer would be asked to
                approve nothing.
              */
              if (next === "awaiting_customer_approval") {
                const priced = await d1First<{
                  approved_iqd: number | null;
                  final_iqd: number | null;
                  pricing_mode: string | null;
                }>(
                  `SELECT approved_iqd, final_iqd, pricing_mode FROM disc_trades WHERE id = ?`,
                  tradeId,
                );
                const hasPrice =
                  Number(priced?.approved_iqd ?? 0) > 0 ||
                  (String(priced?.pricing_mode ?? "auto") !== "manual" &&
                    Number(priced?.final_iqd ?? 0) > 0);
                if (!hasPrice) {
                  return json(
                    { error: "لا يمكن إرسال العرض قبل إدخال السعر واعتماده" },
                    { status: 400 },
                  );
                }
                await d1Run(
                  `UPDATE disc_trades SET approved_at = COALESCE(approved_at, ?) WHERE id = ?`,
                  now(),
                  tradeId,
                );
              }
              if (!canTransition(currentNormStatus, next, true)) {
                return json(
                  { error: `انتقال غير مسموح: ${currentNormStatus} → ${next}` },
                  { status: 400 },
                );
              }
              await appendStatus(
                tradeId,
                next,
                actor,
                data["note"] ? String(data["note"]) : undefined,
              );
              await notify(`🔄 تحديث حالة المقايضة ${tradeId}: ${next}`, trade.user_id);

              /*
                Settlement happens when the trade completes. The three former
                payout statuses (`payout_pending`, `payout_processing`,
                `approved`) all described the same moment, so the money is now
                tied to the one status that means the work is finished.
              */
              if (next === "completed" && !trade.payout_credited) {
                /*
                  Pay the price that was actually approved. The estimate
                  (`final_iqd`) is explicitly last: paying an estimate that no
                  admin ever signed off is how a manual-priced trade ends up
                  settling at a number nobody agreed to.
                */
                const creditAmount = Math.max(
                  0,
                  Math.round(
                    Number(
                      data["approved_iqd"] ??
                        trade.approved_iqd ??
                        data["admin_valuation_iqd"] ??
                        trade.admin_valuation_iqd ??
                        trade.final_iqd ??
                        trade.valuation_iqd ??
                        0,
                    ),
                  ),
                );

                /*
                  How the customer asked to be paid.

                  `selections` first: the form hardcodes `payout_type` to store
                  credit and sends it for every request, so the column says
                  store credit even for the members who picked cash — and the
                  quote they accepted was calculated from that choice. Settling
                  from the column pays a cash request in store credit, which is
                  the customer's money in a form they cannot take out of the
                  shop.
                */
                const payoutMethod =
                  payoutMethodOf(trade.selections) ??
                  (trade.payout_type === "cash" ? "cash" : "store_credit");

                if (creditAmount > 0 && payoutMethod === "cash") {
                  /*
                    Cash is handed over by a person, so the money does not move
                    here — but the trade still has to stop being payable, or
                    the next status change credits a wallet for a debt already
                    settled at the counter. The row is marked settled with the
                    method recorded, and both sides are told: the customer what
                    to expect, the shop that somebody owes a payment.
                  */
                  await d1Run(
                    `UPDATE disc_trades SET payout_credited = 1, payout_credited_at = ?, payout_amount_credited = ?, payout_type = 'cash' WHERE id = ? AND (payout_credited IS NULL OR payout_credited = 0)`,
                    now(),
                    creditAmount,
                    trade.id,
                  );
                  await appendStatus(tradeId, "completed", "system", "تسوية نقدية");
                  await notify(
                    `✅ اكتملت مقايضتك. المبلغ ${creditAmount.toLocaleString()} د.ع يُسلَّم نقداً حسب اختيارك، وليس رصيداً في المحفظة.`,
                    trade.user_id,
                  );
                  try {
                    const { sendAdminNotification } = await import(
                      "@/lib/telegram-notifications.server"
                    );
                    /*
                      The wallet topic, because this is a payment the shop
                      owes — the same place a top-up verdict goes. There is no
                      "trade" kind, and inventing one would route it to the
                      general topic where money notices get lost.
                    */
                    await sendAdminNotification(
                      "wallet",
                      `💵 مقايضة مكتملة بالدفع النقدي\nالمبلغ: ${creditAmount.toLocaleString()} د.ع\nرقم الطلب: ${trade.id.slice(-6)}\nسلّم المبلغ نقداً — لم يُضف أي رصيد للمحفظة.`,
                    );
                  } catch (err) {
                    console.error("[trade:cash_payout_notify_failed]", err);
                  }
                } else if (creditAmount > 0) {
                  try {
                    // Execute atomic batch: Mark trade as credited, insert transaction, update wallet
                    await d1Batch([
                      {
                        sql: `INSERT INTO wallet_transactions (id, user_id, amount, kind, description, order_id, created_at, reference_type, reference_id)
                              VALUES (?, ?, ?, 'disc_trade_payout', ?, ?, ?, 'disc_trade', ?)`,
                        params: [
                          randomId("wtx"),
                          trade.user_id,
                          creditAmount,
                          `استحقاق مقايضة شريط ألعاب #${trade.id.slice(-6)}`,
                          trade.id,
                          now(),
                          trade.id,
                        ],
                      },
                      {
                        sql: `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?`,
                        params: [creditAmount, trade.user_id],
                      },
                      {
                        sql: `UPDATE disc_trades SET payout_credited = 1, payout_credited_at = ?, payout_amount_credited = ? WHERE id = ? AND (payout_credited IS NULL OR payout_credited = 0)`,
                        params: [now(), creditAmount, trade.id],
                      },
                    ]);

                    await appendStatus(tradeId, "completed", "system", "تم الدفع تلقائياً");
                    await notify(
                      `🎉 تم إيداع رصيد المقايضة (${creditAmount.toLocaleString()} د.ع) في محفظتك بنجاح!`,
                      trade.user_id,
                    );
                  } catch (walletErr: any) {
                    if (
                      walletErr.message?.includes("UNIQUE constraint failed") ||
                      walletErr.message?.includes("wallet_transactions_ref_idx")
                    ) {
                      // Already processed by a concurrent request. Safe to ignore.
                      console.log("Payout already processed for trade concurrently", trade.id);
                    } else {
                      console.error("Wallet payout credit error:", walletErr);
                      throw walletErr; // Bubble up unexpected errors
                    }
                  }
                } else {
                  // No payout needed, just mark completed
                  await appendStatus(tradeId, "completed", "system", "لا يوجد مبلغ للدفع");
                }
              }
            }
            return json({ success: true });
          }

          /* ---------------- submit ----------------------------------------- */
          const user = await requireUser(request);
          const gameName = String(data["game_name"] || "").trim();
          // A missing field is a bad request, not a server fault; throwing here
          // reached the caller as an opaque 500 with a `server_error` body.
          if (!gameName) return json({ error: "اسم اللعبة مطلوب" }, { status: 400 });

          const isCustom = data["is_custom"] === true || data["game_id"] === "custom";
          let gameId = isCustom ? "" : String(data["game_id"] || "");
          if (!gameId && !isCustom) {
            const match = await matchGame(gameName);
            gameId = match?.game_id ?? "";
          }
          const game = gameId ? await getGame(gameId) : undefined;

          if (game && game.trade_enabled === 0) {
            return json(
              {
                error: "المقايضة غير متاحة لهذه اللعبة حالياً",
                trade_enabled: false,
              },
              { status: 400 },
            );
          }

          const selections = (data["selections"] as Record<string, string>) || {};
          const rules = (await listTradeRules()) as unknown as TradeRule[];
          const base = !isCustom && game ? Number(game?.trade_value_iqd || 0) : 0;
          const bonusIqd = !isCustom && game ? Number(game?.store_offer_bonus_iqd || 0) : 0;
          const quote = base ? computeTradeValue(base, selections, rules) : null;
          const storeOfferTotal = quote ? quote.final_iqd + bonusIqd : null;
          const platform = String(data["platform"] || game?.platform || "Nintendo Switch");

          /*
            Which of the two pricing flows this request follows, decided here and
            recorded on the row rather than inferred later from whether a number
            happens to be null.

            An automatic quote is only possible when the catalogue knows the
            game's trade value — a custom entry, or a game with no trade value
            set, genuinely has to be priced by a person. Saying so on the record
            is what lets the card show "تسعير يدوي" and
            "بانتظار التسعير اليدوي" instead of a bare "غير مسعر".
          */
          const pricingMode = quote ? "auto" : "manual";
          const initialStatus = initialTradeStatus(pricingMode);

          const tradeId = randomId("trade");
          const stamp = now();
          await d1Run(
            `INSERT INTO disc_trades
              (id, user_id, game_id, game_name, platform, condition, notes, photo_url, preferred_trade,
               selections, base_iqd, final_iqd, valuation_iqd, store_offer_bonus_iqd, store_offer_total_iqd,
               pricing_mode, priced_at, status, status_history, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            tradeId,
            user.id,
            gameId || null,
            game?.title ?? gameName,
            platform,
            String(data["condition"] || "like_new"),
            data["notes"] ? String(data["notes"]) : null,
            data["photo_url"] ? String(data["photo_url"]) : null,
            /*
              The customer's own answer, not the form's constant.

              `disc_trade.tsx` holds `const payout = "store_credit"` and sends
              it for everyone, so this column has said store credit on every
              row ever written — including the rows where the member chose cash
              in the condition step, and where the quote was calculated from
              that choice. Settling from the column pays a cash request in
              store credit, which is the customer's money in the wrong form.
            */
            payoutMethodOf(selections) ??
              (data["payout_type"] ? String(data["payout_type"]) : null),
            JSON.stringify(selections),
            quote?.base_iqd ?? null,
            quote?.final_iqd ?? null,
            quote?.final_iqd ?? null,
            bonusIqd,
            storeOfferTotal,
            pricingMode,
            // An automatic estimate exists from this instant; a manual one does not.
            quote ? stamp : null,
            initialStatus,
            JSON.stringify([{ status: initialStatus, at: stamp, actor: user.id }]),
            stamp,
            stamp,
          );

          const images = Array.isArray(data["images"])
            ? (data["images"] as { kind?: string; url: string }[])
            : [];
          /*
            The first photo is the one the card leads with.

            `disc_trade.tsx` sends `photos.map((url) => ({ url }))` with no
            kind, so every row was stored as "other" and the admin gallery had
            no way to tell the cover shot from the close-up of the scratch. The
            same URL is also written to `photo_url`, which is the field the
            list view reads, so naming the first one "primary" makes the two
            agree instead of guessing.
          */
          for (const [index, img] of images.entries()) {
            if (!img?.url) continue;
            await d1Run(
              `INSERT INTO disc_trade_images (id, trade_id, kind, url, created_at) VALUES (?,?,?,?,?)`,
              randomId("dti"),
              tradeId,
              img.kind || (index === 0 ? "primary" : "detail"),
              img.url,
              stamp,
            );
          }

          // Notify Admin in Telegram with MiniApp Deep Link
          try {
            const { notifyAdminDiscTrade } = await import("@/lib/telegram-notifications.server");
            await notifyAdminDiscTrade({
              tradeId,
              gameName: game?.title ?? gameName,
              platform,
              finalIqd: quote?.final_iqd,
              isCustom,
              user: { id: user.id, name: user.name, phone: user.phone },
            });
          } catch (err) {
            console.warn("Failed to notify admin on disc trade", err);
          }

          return json({ success: true, id: tradeId, quote, is_custom: isCustom });
        }),
    },
  },
});
