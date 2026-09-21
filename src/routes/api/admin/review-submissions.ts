import { createFileRoute } from "@tanstack/react-router";

import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import {
  approveReviewGroup,
  countReviewGroupsAwaitingAdmin,
  listReviewGroupsAwaitingAdmin,
  rejectReviewGroup,
} from "@/lib/reviews.server";

/**
 * The submissions waiting for an admin, and the two decisions they can take.
 *
 * A code is money, so approval is a deliberate act by a person: nothing here
 * is automatic, and the approval is what issues the reward — at most one per
 * customer per week, which the reward module enforces rather than this route.
 */
export const Route = createFileRoute("/api/admin/review-submissions")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          if (!getD1()) return json({ groups: [], count: 0 });
          const [groups, count] = await Promise.all([
            listReviewGroupsAwaitingAdmin(50),
            countReviewGroupsAwaitingAdmin(),
          ]);
          return json({ groups, count });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          if (!getD1()) return json({ error: "قاعدة البيانات غير متاحة" }, { status: 503 });
          const input = await body<Record<string, unknown>>(request);
          const groupId = String(input["groupId"] ?? "").trim();
          const action = String(input["action"] ?? "").trim();
          if (!groupId) return json({ error: "معرّف التقييم غير صالح" }, { status: 400 });

          const decision =
            action === "reject"
              ? await rejectReviewGroup({
                  groupId,
                  adminId: admin.id,
                  reason: String(input["reason"] ?? ""),
                })
              : action === "approve"
                ? await approveReviewGroup({ groupId, adminId: admin.id })
                : null;

          if (!decision) return json({ error: "إجراء غير معروف" }, { status: 400 });

          if (!decision.ok) {
            const message =
              decision.reason === "not_found"
                ? "التقييم غير موجود"
                : decision.reason === "already_decided"
                  ? "تمت معالجة هذا التقييم بالفعل"
                  : "اكتب سبب الرفض";
            return json(
              { error: message, code: decision.reason },
              { status: decision.reason === "not_found" ? 404 : 409 },
            );
          }

          /*
            The code itself goes back to the admin so they can read it to the
            customer if the Telegram message does not arrive. Nothing else
            about the customer is added here.
          */
          return json({
            ok: true,
            group: decision.group,
            reward: decision.reward,
            cooldown: decision.cooldown,
          });
        }),
    },
  },
});
