import { createFileRoute } from "@tanstack/react-router";
import { getPublicBinanceConfig } from "@/lib/binance-pay/config.server";
import { getUsdIqdRate } from "@/lib/exchange-rate.server";
import {
  cancelTopUpIntent,
  createTopUpIntent,
  getActiveTopUpIntent,
  verifyTopUp,
} from "@/lib/binance-pay/service.server";
import {
  adjustUserWalletBalance,
  consumeBananCode,
  createRechargeRequest,
  getWalletTransactions,
  listRechargeRequestsByUser,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { requireUser } from "@/lib/session.server";
import type { RechargeMethod } from "@/lib/types";

const RECHARGE_METHODS: readonly RechargeMethod[] = [
  "zain_cash",
  "rafidain",
  "crypto",
  "eshop_card",
  "banan_code",
];

function isRechargeMethod(value: unknown): value is RechargeMethod {
  return typeof value === "string" && RECHARGE_METHODS.includes(value as RechargeMethod);
}

export const Route = createFileRoute("/api/wallet")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const transactions = await getWalletTransactions(user.id);
          const rechargeRequests = await listRechargeRequestsByUser(user.id);
          const activeBinanceIntent = await getActiveTopUpIntent(user.id);
          const binanceConfig = getPublicBinanceConfig(await getUsdIqdRate());

          return json({
            transactions,
            rechargeRequests,
            activeBinanceIntent,
            binanceConfig,
          });
        }),
      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          const throttle = await consumeRateLimit(request, "wallet-mutation", 20, 15 * 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          const data = await body<any>(request);

          if (data.action === "binance_intent") {
            if (!data.amountUsdt) {
              return json({ error: "يرجى إدخال مبلغ التعبئة بالدولار" }, { status: 400 });
            }
            try {
              const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
              const result = await createTopUpIntent({
                userId: user.id,
                amountUsdt: data.amountUsdt,
                clientIp,
              });
              return json({ success: true, ...result });
            } catch (err: any) {
              return json({ error: err?.message || "فشل إنشاء طلب التعبئة" }, { status: 400 });
            }
          }

          if (data.action === "binance_verify") {
            const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
            const result = await verifyTopUp({
              userId: user.id,
              intentId: data.intentId,
              transactionId: data.transactionId,
              clientIp,
            });
            return json(result, { status: result.success ? 200 : 400 });
          }

          if (data.action === "binance_cancel") {
            const success = await cancelTopUpIntent(user.id, data.intentId);
            return json({ success });
          }

          if (data.action === "recharge") {
            const amount = Number(data.amount);
            if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
              return json({ error: "invalid_amount" }, { status: 400 });
            }
            const proofUrl = typeof data.proofUrl === "string" ? data.proofUrl : "";
            const ownWalletPrefix = `/api/files/wallets/${user.id}/`;
            if (
              proofUrl &&
              (!proofUrl.startsWith(ownWalletPrefix) ||
                !/^\/api\/files\/wallets\/usr_[a-z0-9]+\/[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(
                  proofUrl,
                ))
            ) {
              return json({ error: "invalid_proof" }, { status: 400 });
            }
            if (!isRechargeMethod(data.method)) {
              return json({ error: "invalid_recharge_method" }, { status: 400 });
            }
            const req = await createRechargeRequest({
              userId: user.id,
              amount,
              method: data.method,
              proofUrl,
              eshopCode: data.eshopCode,
              bananCode: data.bananCode,
            });

            /*
              Through the outbox, keyed on the request id: a re-submitted form
              or a retried queue delivery is the same top-up, and the admin
              group should hear about it once.
            */
            try {
              const topUpPayload = {
                requestId: req.id,
                amount: req.amount,
                method: req.method,
                proofUrl: req.proofUrl,
                user: { id: user.id, name: user.name, phone: user.phone },
              };
              const { enqueueNotification } = await import("@/lib/notification-outbox.server");
              await enqueueNotification(
                {
                  type: "telegram_admin_wallet_topup",
                  payload: topUpPayload,
                  dedupeKey: `wallet_topup:${req.id}`,
                },
                async () => {
                  const { notifyAdminWalletTopUp } = await import(
                    "@/lib/telegram-notifications.server"
                  );
                  return notifyAdminWalletTopUp(topUpPayload);
                },
              );
            } catch (err) {
              console.warn("Failed to notify admin on wallet top up", err);
            }

            return json({ success: true, request: req });
          }

          if (data.action === "consume_banan") {
            const code = String(data.code ?? "").trim();
            if (!/^[A-Za-z0-9_-]{6,64}$/.test(code)) {
              return json({ error: "invalid_code" }, { status: 400 });
            }
            const result = await consumeBananCode(user.id, code);
            return json(result);
          }

          return json({ error: "Invalid action" }, { status: 400 });
        }),
    },
  },
});
