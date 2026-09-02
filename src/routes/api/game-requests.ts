import { createFileRoute } from "@tanstack/react-router";
import { randomId } from "@/lib/crypto.server";
import { d1All, d1First, d1Run, ensureSchema, getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { getSessionUser, requireAdmin, requireUser } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import type { ProductRequest } from "@/lib/types";
import { toProductRequest, type ProductRequestRow } from "@/lib/product-requests";
import { redactProductRequestForMember } from "@/lib/redaction";

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const Route = createFileRoute("/api/game-requests")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ requests: [] });
          await ensureSchema();
          const user = await getSessionUser(request);
          if (!user) return json({ requests: [] });

          /*
            Rows are translated, never spread. The columns are snake_case and
            every reader — this screen, the customer's own history, the
            notifications — expects camelCase, so returning `...r` handed them a
            request whose name, date, contact method and status trail were all
            `undefined`. That is the blank game name in the admin list.
          */
          if (user.isAdmin) {
            const rows = await d1All<ProductRequestRow>(
              "SELECT * FROM product_requests ORDER BY created_at DESC",
            );
            return json({ requests: rows.map(toProductRequest) });
          }

          // A customer sees their own requests, without the staff-only note.
          const rows = await d1All<ProductRequestRow>(
            "SELECT * FROM product_requests WHERE user_id = ? ORDER BY created_at DESC",
            user.id,
          );
          return json({
            requests: rows.map((row) => redactProductRequestForMember(toProductRequest(row))),
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ error: "DB not ready" }, { status: 500 });
          await ensureSchema();
          const user = await requireUser(request);
          const throttle = await consumeRateLimit(
            request,
            "product-request",
            8,
            24 * 60 * 60,
            user.id,
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          const input = await body<Record<string, unknown>>(request);
          const productName = clean(input["productName"], 120);
          const requestType = clean(input["requestType"], 40) || "game";

          if (productName.length < 2) {
            return json({ error: "اسم المنتج مطلوب" }, { status: 400 });
          }

          // Duplicate detection
          const existing = await d1First<{ id: string }>(
            `SELECT id FROM product_requests WHERE user_id = ? AND product_name = ? AND status IN ('submitted', 'under_review', 'accepted', 'sourcing')`,
            user.id,
            productName,
          );
          if (existing) {
            return json({ error: "لديك طلب مسبق قيد المراجعة لنفس المنتج" }, { status: 400 });
          }

          const now = new Date().toISOString();
          const row: ProductRequest = {
            id: randomId("prq"),
            userId: user.id,
            requestType,
            productName,
            gameId: clean(input["gameId"], 60) || undefined,
            platform: clean(input["platform"], 40) || undefined,
            productCategory: clean(input["productCategory"], 40) || undefined,
            referenceUrl: clean(input["referenceUrl"], 400) || undefined,
            notes: clean(input["notes"], 1000) || undefined,
            preferredVersion: clean(input["preferredVersion"], 40) || undefined,
            preferredRegion: clean(input["preferredRegion"], 40) || undefined,
            contactMethod: clean(input["contactMethod"], 80) || user.phone || user.email,
            status: "submitted",
            statusHistory: [{ status: "submitted", timestamp: now }],
            createdAt: now,
            updatedAt: now,
          };

          await d1Run(
            `INSERT INTO product_requests (
               id, user_id, request_type, product_name, game_id, platform, product_category,
               reference_url, notes, preferred_version, preferred_region, contact_method,
               status, status_history, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.id,
            row.userId,
            row.requestType,
            row.productName,
            row.gameId ?? null,
            row.platform ?? null,
            row.productCategory ?? null,
            row.referenceUrl ?? null,
            row.notes ?? null,
            row.preferredVersion ?? null,
            row.preferredRegion ?? null,
            row.contactMethod ?? null,
            row.status,
            JSON.stringify(row.statusHistory),
            row.createdAt,
            row.updatedAt,
          );

          // Notify the admin Telegram chat
          try {
            const { notifyAdminGameRequest } = await import("@/lib/telegram-notifications.server");
            await notifyAdminGameRequest({
              request: row,
              user: { id: user.id, name: user.name, phone: user.phone },
            });
          } catch (e) {
            console.warn("Failed to dispatch admin notification", e);
          }

          return json({ success: true, request: row });
        }),

      PATCH: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ error: "DB not ready" }, { status: 500 });
          await ensureSchema();
          await requireAdmin(request);
          const input = await body<{
            id: string;
            status?: string;
            adminNote?: string;
            userVisibleNote?: string;
            linkedProductId?: string;
          }>(request);

          const id = clean(input.id, 60);
          if (!id) return json({ error: "invalid_input" }, { status: 400 });

          const existingRow = await d1First<ProductRequestRow>(
            `SELECT * FROM product_requests WHERE id = ?`,
            id,
          );
          if (!existingRow) return json({ error: "not_found" }, { status: 404 });
          /*
            Translated before it is read. Reading camelCase off the raw row made
            every `|| existing.x || null` fall through to null, so accepting a
            request erased the admin note, the customer-visible note and the
            linked product id; the status trail was re-read as `[]` and rewritten
            over the real one; and `existing.userId` being undefined meant the
            customer was never told their request had moved.
          */
          const existing = toProductRequest(existingRow);

          const now = new Date().toISOString();
          const newStatus = clean(input.status, 40) || existing.status;

          /*
            A field that is absent from the request keeps its stored value; a
            field that is present keeps what was sent, empty included. The
            quick-action buttons send only `status` and a customer note, so the
            internal note and the linked product must survive them — but an
            admin who clears the textarea and saves means it, and
            `clean(x) || existing.x` could only ever rewrite the old value,
            leaving a wrong customer-visible message with no way to remove it.
          */
          const patched = (incoming: string | undefined, max: number, current?: string) =>
            incoming === undefined ? (current ?? null) : clean(incoming, max) || null;

          const history = [...existing.statusHistory];
          if (newStatus !== existing.status) {
            history.push({
              status: newStatus,
              timestamp: now,
              note: input.userVisibleNote || undefined,
            });
          }

          await d1Run(
            `UPDATE product_requests SET 
             status = ?, admin_note = ?, user_visible_note = ?, linked_product_id = ?, status_history = ?, updated_at = ?
             WHERE id = ?`,
            newStatus,
            patched(input.adminNote, 500, existing.adminNote),
            patched(input.userVisibleNote, 500, existing.userVisibleNote),
            patched(input.linkedProductId, 100, existing.linkedProductId),
            JSON.stringify(history),
            now,
            id,
          );

          // Notify user if Telegram linked
          if (existing.userId && newStatus !== existing.status) {
            try {
              const { getUserTelegramChatId } = await import("@/lib/telegram-notifications.server");
              const userChatId = await getUserTelegramChatId(existing.userId);
              if (userChatId) {
                const { sendTelegramMessage, telegramMiniAppDeepLink } =
                  await import("@/lib/telegram.server");
                await sendTelegramMessage(
                  userChatId,
                  `🎯 <b>تحديث على طلب اللعبة: ${existing.productName}</b>\n\nالحالة الجديدة: <b>${newStatus}</b>\n${input.userVisibleNote ? `ملاحظة: ${input.userVisibleNote}\n` : ""}\nاضغط أدناه لمتابعة طلباتك 👇`,
                  {
                    parse_mode: "HTML",
                    reply_markup: {
                      inline_keyboard: [
                        [
                          {
                            text: "🎮 تفاصيل طلب اللعبة",
                            url: telegramMiniAppDeepLink(`gamereq_${existing.id}`),
                          },
                        ],
                      ],
                    },
                  },
                );
              }
            } catch (err) {
              console.warn("Failed to notify user on game request update", err);
            }
          }

          return json({ success: true });
        }),
    },
  },
});
