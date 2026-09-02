import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/lib/env.server";
import { constantTimeEqual } from "@/lib/security.server";

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(request: Request): boolean {
  const expected = env("CRON_SECRET") ?? "";

  const header = request.headers.get("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return expected.length >= 24 && Boolean(bearer) && constantTimeEqual(expected, bearer);
}

export const Route = createFileRoute("/api/public/hooks/contests-draw")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) return unauthorized();

        const { d1All } = await import("@/lib/d1.server");
        const { drawContest } = await import("@/lib/telegram-contests.server");

        const contests = await d1All<{ id: string }>(
          `SELECT id FROM telegram_contests 
           WHERE status = 'active' 
           AND draw_at IS NOT NULL 
           AND draw_at <= ?`,
          new Date().toISOString(),
        );

        const results: Record<string, unknown>[] = [];
        for (const c of contests) {
          try {
            const res = await drawContest(c.id);
            results.push({ id: c.id, ...res });
          } catch (e) {
            console.error(`Failed to draw contest ${c.id}`, e);
          }
        }

        return Response.json({ processed: results.length, results });
      },
    },
  },
});
