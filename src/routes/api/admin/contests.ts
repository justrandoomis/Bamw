import { createFileRoute } from "@tanstack/react-router";

import {
  adminContestDetail,
  adminListContests,
  confirmWinner,
  createTickets,
  disqualifyWinner,
  drawContest,
  drawFromInstagram,
  importPastedComments,
  previewInstagram,
  pullInstagramComments,
  readContestRow,
  readSettings,
  removeEntry,
  revokeTicket,
  saveContest,
  setContestStatus,
  type StatusAction,
} from "@/lib/contests.server";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";

const STATUS_ACTIONS: readonly StatusAction[] = [
  "publish",
  "unpublish",
  "close",
  "reopen",
  "cancel",
];

/**
 * Contests, as the admin runs them: one route, an `action` per thing done —
 * the house style of `/api/admin/banana` and `/api/admin/referrals`.
 */
export const Route = createFileRoute("/api/admin/contests")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          if (!getD1()) return json({ contests: [] });
          const id = new URL(request.url).searchParams.get("id");
          if (id) {
            const detail = await adminContestDetail(id);
            if (!detail) return json({ error: "المسابقة غير موجودة" }, { status: 404 });
            return json(detail);
          }
          return json({ contests: await adminListContests() });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });
          const sent = await body<Record<string, unknown>>(request);
          const action = String(sent["action"] ?? "");
          const contestId = String(sent["contestId"] ?? "");
          const fail = (result: { status: number; error: string }) =>
            json({ error: result.error }, { status: result.status });

          if (action === "save") {
            const result = await saveContest({
              adminId: admin.id,
              id: contestId || null,
              settings: sent["settings"],
            });
            return result.ok ? json({ ok: true, id: result.id }) : fail(result);
          }

          if (STATUS_ACTIONS.includes(action as StatusAction)) {
            const result = await setContestStatus({
              adminId: admin.id,
              id: contestId,
              action: action as StatusAction,
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "draw") {
            const row = await readContestRow(contestId);
            if (!row) return json({ error: "المسابقة غير موجودة" }, { status: 404 });
            const result =
              readSettings(row).drawSource === "instagram"
                ? await drawFromInstagram({
                    contestId,
                    actor: admin.id,
                    filters: sent["filters"],
                  })
                : await drawContest({ contestId, actor: admin.id });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "confirm_winner") {
            const result = await confirmWinner({
              adminId: admin.id,
              winnerId: String(sent["winnerId"] ?? ""),
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "disqualify_winner") {
            const result = await disqualifyWinner({
              adminId: admin.id,
              winnerId: String(sent["winnerId"] ?? ""),
              reason: String(sent["reason"] ?? ""),
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "create_tickets") {
            const result = await createTickets({
              adminId: admin.id,
              contestId,
              count: Number(sent["count"] ?? 1),
              note: String(sent["note"] ?? ""),
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "revoke_ticket") {
            const result = await revokeTicket({
              adminId: admin.id,
              code: String(sent["code"] ?? ""),
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "remove_entry") {
            const result = await removeEntry({
              adminId: admin.id,
              entryId: String(sent["entryId"] ?? ""),
              reason: String(sent["reason"] ?? ""),
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "instagram_fetch") {
            const result = await pullInstagramComments({
              contestId,
              restart: sent["restart"] === true,
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "instagram_import") {
            const result = await importPastedComments({
              contestId,
              raw: String(sent["raw"] ?? ""),
              replace: sent["replace"] === true,
            });
            return result.ok ? json(result) : fail(result);
          }

          if (action === "instagram_preview") {
            const preview = await previewInstagram({ contestId, filters: sent["filters"] });
            if (!preview) return json({ error: "المسابقة غير موجودة" }, { status: 404 });
            return json(preview);
          }

          return json({ error: "إجراء غير معروف" }, { status: 400 });
        }),
    },
  },
});
