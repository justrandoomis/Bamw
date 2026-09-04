import { createFileRoute } from "@tanstack/react-router";
import { getCatalogVersion, getStore, invalidateStoreCache, updateStore } from "@/lib/db.server";
import { deleteProductEverywhere } from "@/lib/product-delete.server";
import { body, errorRef, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { autoTranslateProduct } from "@/lib/translate.server";
import type { Product } from "@/lib/types";
import { sanitizeSlug } from "./products";
import {
  deactivateGameDevicePerformance,
  syncGameDevicePerformance,
} from "@/lib/devicePerformance.server";
import {
  normalizeGameDevicePerformance,
  validateGameDevicePerformance,
} from "@/lib/devicePerformance";
import { releaseProductIdentity } from "@/lib/product-identity.server";
import { resolveCategoryType } from "@/lib/productSection";

import { sanitizeAndVerifyProductImages } from "@/lib/productImageVerification.server";

function productSection(product: Partial<Product>, categories: Record<string, unknown>[]) {
  const categoryId = String(product.categoryId || product.category || "");
  const category = categories.find((entry) => String(entry.id || "") === categoryId);
  return resolveCategoryType(
    categoryId,
    String(category?.title || category?.name || ""),
    String(product.kind || ""),
    String(product.schemaId || ""),
  );
}

export const Route = createFileRoute("/api/admin/products/$productId")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        guard(async () => {
          await requireAdmin(request);
          const productId = params.productId;
          const store = await getStore();
          const product = (store.products || []).find((p) => String(p.id) === String(productId));

          if (!product) {
            return json({ error: "Product not found", code: "NOT_FOUND" }, { status: 404 });
          }

          return json({ success: true, product });
        }),

      PUT: async ({ request, params }) =>
        guard(async () => {
          await requireAdmin(request);
          const productId = String(params.productId || "").trim();
          if (!productId) {
            return json(
              { error: "Missing product id in path", code: "MISSING_PRODUCT_ID" },
              { status: 400 },
            );
          }

          const payload = await body<Partial<Product>>(request);
          const titleEn = (payload.titleEn || payload.title || "").trim();
          if (!titleEn) {
            return json(
              { error: "Product title is required", code: "MISSING_TITLE" },
              { status: 400 },
            );
          }

          const price = Number(payload.price);
          if (isNaN(price) || price < 0) {
            return json(
              {
                error: "Invalid price: price must be a non-negative number",
                code: "INVALID_PRICE",
              },
              { status: 400 },
            );
          }

          let cost = 0;
          if (
            payload.cost !== undefined &&
            payload.cost !== null &&
            String(payload.cost).trim() !== ""
          ) {
            cost = Number(payload.cost);
            if (isNaN(cost) || cost < 0) {
              return json(
                { error: "Invalid cost: cost must be a non-negative number", code: "INVALID_COST" },
                { status: 400 },
              );
            }
          }

          const slug = sanitizeSlug(payload.slug || titleEn, productId);

          const currentStore = await getStore();
          const existingCatalog = currentStore.products || [];
          const slugConflict = existingCatalog.find(
            (p) =>
              String(p.id) !== productId &&
              Boolean(p.slug) &&
              String(p.slug).toLowerCase() === slug.toLowerCase(),
          );
          if (slugConflict) {
            return json(
              {
                error: `Duplicate slug: "${slug}" is already in use by product "${slugConflict.title || slugConflict.titleEn || slugConflict.id}".`,
                code: "DUPLICATE_SLUG",
              },
              { status: 400 },
            );
          }

          /*
            "Last modified" is only meaningful if every write path stamps it.
            This one — the single-product PUT the editor uses — did not, so a
            product edited here kept whatever timestamp it was imported with and
            sorting the admin table by Last Modified silently ignored the most
            recent edits in the store.

            Both spellings, because rows in production carry both and the sort
            reads whichever is present.
          */
          const savedAtIso = new Date().toISOString();

          let productToSave: Product = {
            ...payload,
            id: productId,
            updatedAt: savedAtIso,
            updated_at: savedAtIso,
            title: payload.title || titleEn,
            titleEn,
            slug,
            price,
            cost,
            stock: payload.isInfiniteStock ? 999999 : Number(payload.stock) || 0,
            status: payload.status || "نشط",
            isActive: payload.isActive !== false,
            categoryId: payload.categoryId || (payload as any).category || "cat_nintendo",
          };

          if (productSection(productToSave, currentStore.categories || []) === "game") {
            const performanceIssues = validateGameDevicePerformance(
              productToSave as Record<string, unknown>,
            ).filter((i) => i.severity === "error");
            if (performanceIssues.length) {
              return json(
                {
                  error: performanceIssues.map((issue) => issue.message).join("\n"),
                  code: "DEVICE_PERFORMANCE_REQUIRED",
                  issues: performanceIssues,
                },
                { status: 400 },
              );
            }
          }

          try {
            productToSave = await autoTranslateProduct(productToSave);
          } catch (transErr) {
            console.warn("[autoTranslateProduct] Translation fallback triggered:", transErr);
          }

          /*
            The role warnings travel back with the save.

            `sanitizeAndVerifyProductImages` has computed them on every save
            since it was written, and every caller took `.product` and dropped
            `.warnings` on the floor. The module's own docblock says the check
            belongs at save time "where a human can still fix it" — which only
            holds if the human is told. They are advisory: nothing here blocks
            a save.
          */
          let mediaWarnings: string[] = [];
          try {
            const verification = await sanitizeAndVerifyProductImages(productToSave);
            productToSave = verification.product as Product;
            mediaWarnings = verification.warnings ?? [];
          } catch (imgErr) {
            console.warn("[sanitizeAndVerifyProductImages] Image verification non-blocking fallback:", imgErr);
          }

          if (productSection(productToSave, currentStore.categories || []) === "game") {
            productToSave.devicePerformance = normalizeGameDevicePerformance(
              productToSave as unknown as Record<string, unknown>,
              (currentStore.products || []).filter(
                (item) => productSection(item, currentStore.categories || []) === "hardware",
              ),
            );
          }

          try {
            const updated = await updateStore((store) => {
              const products = store.products || [];
              const index = products.findIndex((p) => String(p.id) === productId);
              let nextProducts: Product[];
              if (index >= 0) {
                nextProducts = [...products];
                nextProducts[index] = { ...products[index], ...productToSave };
              } else {
                nextProducts = [productToSave, ...products];
              }
              return {
                ...store,
                products: nextProducts,
              };
            });

            const saved =
              (updated.products || []).find((p) => String(p.id) === productId) || productToSave;
            if (productSection(saved, updated.categories || []) === "game") {
              const hardware = (updated.products || []).filter(
                (item) => productSection(item, updated.categories || []) === "hardware",
              );
              await syncGameDevicePerformance(saved, hardware);
            }
            return json({
              success: true,
              product: saved,
              catalogVersion: await getCatalogVersion(),
              ...(mediaWarnings.length ? { mediaWarnings } : {}),
            });
          } catch (dbErr: any) {
            console.error("[UpdateProduct:DatabaseError]", dbErr);
            return json(
              {
                error: `Database save failed: ${dbErr?.message || "Internal database error"}`,
                code: "DATABASE_SAVE_FAILED",
              },
              { status: 500 },
            );
          }
        }),

      DELETE: async ({ request, params }) =>
        guard(async () => {
          await requireAdmin(request);
          const productId = String(params.productId || "").trim();
          if (!productId) {
            return json(
              { error: "Missing product id in path", code: "MISSING_PRODUCT_ID" },
              { status: 400 },
            );
          }

          /*
            Shared with the collection route — see src/lib/product-delete.server.ts.

            This used to verify *before* clearing the granular `store:product:<id>`
            row, which the loader overlays on top of the aggregate. A product
            that had one was therefore still present at verification time, so
            delete returned 500 and the early return meant its identity row was
            never released — leaving a ghost that refused the title forever.
          */
          const result = await deleteProductEverywhere(productId);

          if (!result.ok) {
            const ref = errorRef();
            console.error("[DeleteProduct:incomplete]", {
              productId,
              remaining: result.remaining,
              ref,
            });
            return json(
              {
                error: `Product still present after delete: ${result.remaining.join(", ") || "unknown"}`,
                code: "DELETE_INCOMPLETE",
                remaining: result.remaining,
                ref,
              },
              { status: 500 },
            );
          }

          return json({
            success: true,
            id: productId,
            ...(result.slug ? { slug: result.slug } : {}),
            catalogVersion: await getCatalogVersion(),
          });
        }),
    },
  },
});
