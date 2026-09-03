import { createFileRoute } from "@tanstack/react-router";

import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { createAuditLog, getStore } from "@/lib/db.server";
import { getProductCategory } from "@/lib/productSection";
import {
  listProductAdminMetadata,
  readProductAdminMetadata,
  writeSupplierNameZh,
  type ZhVerificationStatus,
} from "@/lib/productAdminMetadata.server";

/**
 * The admin's view of the Chinese supplier names.
 *
 * Admin-only, and the only route in the application that reads
 * `product_admin_metadata` at all — `-supplier-name-privacy.test.ts` asserts
 * that no public route mentions it. Everything here is behind
 * `requireAdmin`, and nothing here is ever rendered to a customer.
 */

interface ReportRow {
  productId: string;
  title: string;
  supplierNameZhCn: string;
  sourceUrl: string;
  status: ZhVerificationStatus;
  verifiedAt: string;
}

export const Route = createFileRoute("/api/admin/product-metadata")({
  server: {
    handlers: {
      /**
       * The completion report: every Nintendo game and where its name stands.
       *
       * Built by joining the catalogue against the metadata table rather than
       * listing the table, so a game with no row at all shows as `missing`
       * instead of being absent — the whole point of the report is to find the
       * ones nobody has done yet.
       */
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const url = new URL(request.url);
          const productId = (url.searchParams.get("productId") ?? "").trim();

          if (productId) {
            const meta = await readProductAdminMetadata(productId);
            return json({ metadata: meta ?? null });
          }

          const store = await getStore();
          const games = ((store?.products ?? []) as Record<string, unknown>[]).filter(
            (product) => getProductCategory(product) === "game",
          );
          const byId = new Map(
            (await listProductAdminMetadata()).map((row) => [row.productId, row]),
          );

          const rows: ReportRow[] = games.map((product) => {
            const id = String(product["id"] ?? "");
            const meta = byId.get(id);
            return {
              productId: id,
              title: String(product["title"] ?? ""),
              supplierNameZhCn: meta?.supplierNameZhCn ?? "",
              sourceUrl: meta?.supplierNameZhSourceUrl ?? "",
              status: meta?.supplierNameZhVerificationStatus ?? "missing",
              verifiedAt: meta?.supplierNameZhVerifiedAt ?? "",
            };
          });

          const totals = {
            games: rows.length,
            verified: rows.filter((row) => row.status === "verified").length,
            needsReview: rows.filter((row) => row.status === "needs_review").length,
            missing: rows.filter((row) => row.status === "missing").length,
          };

          return json({ rows, totals });
        }),

      /** Record or correct one name. Every write is attributable. */
      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const data = await body<{
            productId?: string;
            supplierNameZhCn?: string;
            sourceUrl?: string;
            status?: string;
            englishTitle?: string;
          }>(request);

          const productId = String(data.productId ?? "").trim();
          if (!productId) return json({ error: "product_required" }, { status: 400 });

          const result = await writeSupplierNameZh({
            productId,
            supplierNameZhCn: String(data.supplierNameZhCn ?? ""),
            sourceUrl: String(data.sourceUrl ?? ""),
            ...(data.status === "verified" ? { status: "verified" as const } : {}),
            englishTitle: String(data.englishTitle ?? ""),
            updatedBy: admin.id,
          });

          /*
            The name itself is not written to the audit log — the log is read
            in places the metadata table deliberately is not, and copying a
            secret into a second store is how the first store's guarantee stops
            meaning anything. The product, the status and who did it are enough
            to answer "who changed this and when".
          */
          await createAuditLog(
            admin.id,
            "product_supplier_name_zh",
            "product",
            productId,
            null,
            null,
            { status: result.status, ok: result.ok },
          ).catch(() => undefined);

          return json({
            ok: result.ok,
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
          });
        }),
    },
  },
});
