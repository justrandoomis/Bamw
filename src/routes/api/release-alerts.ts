import { createFileRoute } from "@tanstack/react-router";

import { randomId } from "@/lib/crypto.server";
import { d1All, d1Run, ensureSchema, getD1 } from "@/lib/d1.server";
import { getStore } from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { getSessionUser, requireUser } from "@/lib/session.server";
import { isAwaitingRelease, releaseDayISO } from "@/lib/release";

/**
 * "Tell me when it comes out."
 *
 * A pre-order here is a priced product with a future release date, and the
 * store used to sell it — taking money for a game it could not hand over. The
 * customer registers instead, and the release job (scheduled-jobs.server.ts)
 * writes to everyone on this list the day it lands. The product then becomes
 * buyable on its own, because the gate reads the date at request time.
 */

interface AlertRow {
  id: string;
  user_id: string;
  product_id: string;
  product_title: string | null;
  release_date: string | null;
  created_at: string;
  notified_at: string | null;
}

const toAlert = (row: AlertRow) => ({
  id: row.id,
  productId: row.product_id,
  productTitle: row.product_title ?? "",
  releaseDate: row.release_date,
  createdAt: row.created_at,
  notifiedAt: row.notified_at,
});

export const Route = createFileRoute("/api/release-alerts")({
  server: {
    handlers: {
      /** The products this customer is waiting on. */
      GET: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ alerts: [] });
          await ensureSchema();
          const user = await getSessionUser(request);
          // A signed-out visitor has no list; the page shows the sign-in
          // prompt rather than an error.
          if (!user) return json({ alerts: [] });

          const rows = await d1All<AlertRow>(
            `SELECT * FROM product_release_alerts WHERE user_id = ? ORDER BY created_at DESC`,
            user.id,
          );
          return json({ alerts: rows.map(toAlert) });
        }),

      /** Register for one product. Tapping twice is the same as tapping once. */
      POST: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ error: "db_unavailable" }, { status: 503 });
          await ensureSchema();
          const user = await requireUser(request);

          const throttle = await consumeRateLimit(request, "release-alert", 60, 60 * 60, user.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          const input = await body<{ productId?: unknown }>(request);
          const productId = String(input?.productId ?? "").trim();
          if (!productId) return json({ error: "missing_product_id" }, { status: 400 });

          const store = await getStore();
          const product = (store.products || []).find((p) => String(p.id) === productId);
          if (!product) return json({ error: "product_not_found" }, { status: 404 });

          /*
            Only a product that has not come out takes registrations. One that
            has is simply for sale, and an alert for it would never fire — the
            release job only looks at rows whose product is newly out.
          */
          if (!isAwaitingRelease(product)) {
            return json({ error: "already_released" }, { status: 400 });
          }

          const now = new Date().toISOString();
          await d1Run(
            `INSERT INTO product_release_alerts
               (id, user_id, product_id, product_title, release_date, created_at, notified_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(user_id, product_id) DO UPDATE SET
               product_title = excluded.product_title,
               release_date = excluded.release_date`,
            randomId("pra"),
            user.id,
            productId,
            String(product.title || product.titleEn || ""),
            releaseDayISO(product),
            now,
          );

          return json({ success: true, registered: true });
        }),

      /** Stop waiting on one product. */
      DELETE: async ({ request }) =>
        guard(async () => {
          if (!getD1()) return json({ error: "db_unavailable" }, { status: 503 });
          await ensureSchema();
          const user = await requireUser(request);

          const url = new URL(request.url);
          const fromQuery = url.searchParams.get("productId");
          const input = fromQuery ? null : await body<{ productId?: unknown }>(request);
          const productId = String(fromQuery ?? input?.productId ?? "").trim();
          if (!productId) return json({ error: "missing_product_id" }, { status: 400 });

          await d1Run(
            `DELETE FROM product_release_alerts WHERE user_id = ? AND product_id = ?`,
            user.id,
            productId,
          );
          return json({ success: true, registered: false });
        }),
    },
  },
});
