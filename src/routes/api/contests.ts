import { createFileRoute } from "@tanstack/react-router";

import {
  claimContestPrize,
  contestView,
  enterContest,
  listContestViews,
  readContestRow,
} from "@/lib/contests.server";
import { CONTEST_ENTRY_METHODS, type ContestEntryMethod } from "@/lib/contests";
import { getD1 } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { listPrizes } from "@/lib/roulette.server";
import { getSessionUser, requireUser } from "@/lib/session.server";

/**
 * Contests, as members see them.
 *
 * GET lists every published contest (or one, with `?id=`), with the viewer's
 * own tickets and «ألعابك» when they are signed in. POST takes tickets
 * (`enter`) or claims a game won on Instagram with its code (`claim`).
 *
 * Nothing that decides anything comes from the body: the method is checked
 * against the contest's own list, the price in bananas is the contest's, and
 * the ticket numbers, caps and winners are all the server's.
 */
export const Route = createFileRoute("/api/contests")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const viewer = await getSessionUser(request).catch(() => undefined);
          if (!getD1()) return json({ contests: [], prizes: [] });
          const id = new URL(request.url).searchParams.get("id");
          if (id) {
            const row = await readContestRow(id);
            if (!row || row.status === "draft") {
              return json({ error: "المسابقة غير موجودة" }, { status: 404 });
            }
            return json({ contest: await contestView(row, viewer) });
          }
          const [contests, prizes] = await Promise.all([
            listContestViews(viewer),
            viewer ? listPrizes(viewer.id, 50) : Promise.resolve([]),
          ]);
          return json({ contests, prizes });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const user = await requireUser(request);
          if (!getD1()) return json({ error: "الخدمة غير متاحة حالياً" }, { status: 503 });
          const sent = await body<Record<string, unknown>>(request);
          const action = String(sent["action"] ?? "");

          if (action === "claim") {
            const throttle = await consumeRateLimit(request, "contest-claim", 10, 600, user.id);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
            const result = await claimContestPrize({ user, code: String(sent["code"] ?? "") });
            if (!result.ok) return json({ error: result.error }, { status: result.status });
            return json({ ok: true, message: result.message, prizeId: result.prizeId });
          }

          if (action !== "enter") return json({ error: "إجراء غير معروف" }, { status: 400 });

          const method = String(sent["method"] ?? "") as ContestEntryMethod;
          if (!CONTEST_ENTRY_METHODS.includes(method)) {
            return json({ error: "طريقة دخول غير معروفة" }, { status: 400 });
          }
          const throttle = await consumeRateLimit(request, "contest-enter", 30, 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
          /* A code is a secret worth guessing at: a tighter limit of its own. */
          if (method === "ticket") {
            const codes = await consumeRateLimit(request, "contest-code", 10, 600, user.id);
            if (!codes.allowed) return rateLimitResponse(codes.retryAfter);
          }

          const contestId = String(sent["contestId"] ?? "");
          const result = await enterContest({
            user,
            contestId,
            method,
            count: Number(sent["count"] ?? 1),
            requestId: String(sent["requestId"] ?? ""),
            code: String(sent["code"] ?? ""),
          });
          if (!result.ok) {
            return json(
              { error: result.error, ...(result.code ? { code: result.code } : {}) },
              { status: result.status },
            );
          }
          const row = await readContestRow(contestId);
          return json({
            ok: true,
            added: result.added,
            message: result.message,
            contest: row ? await contestView(row, user) : null,
          });
        }),
    },
  },
});
