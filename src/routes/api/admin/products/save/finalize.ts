import { createFileRoute } from "@tanstack/react-router";
import { guard, body, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { d1All, d1Run } from "@/lib/d1.server";
import { getCatalogVersion, getStore, invalidateStoreCache } from "@/lib/db.server";
import { sanitizeAndVerifyProductImages } from "@/lib/productImageVerification.server";
import { syncGameDevicePerformance } from "@/lib/devicePerformance.server";
import { normalizeGameDevicePerformance } from "@/lib/devicePerformance";
import { resolveCategoryType } from "@/lib/productSection";

export const Route = createFileRoute("/api/admin/products/save/finalize")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const payload = await body<{ save_session_id: string }>(request);
          
          if (!payload.save_session_id) {
            return json({ error: "Missing save_session_id" }, { status: 400 });
          }

          const sessionId = payload.save_session_id;

          // Retrieve all chunks
          const rows = await d1All<{ key: string; value: string }>(
            `SELECT key, value FROM store_kv WHERE key LIKE ?`,
            `staged_save:${sessionId}:%`
          );

          if (rows.length === 0) {
            return json({ error: "No data found for session" }, { status: 404 });
          }

          const productParts: Record<string, any> = {};
          for (const row of rows) {
            const partMatch = row.key.match(/^staged_save:[^:]+:(.+)$/);
            if (!partMatch || partMatch[1] === "meta") continue;
            try {
              const partData = JSON.parse(row.value);
              Object.assign(productParts, partData);
            } catch (err) {
              console.error("Failed to parse chunk data:", err);
            }
          }

          if (!productParts.id) {
            return json({ error: "Product ID is missing from chunks" }, { status: 400 });
          }

          const productId = productParts.id;
          const nowIso = new Date().toISOString();

          // Sanitize and verify all product images (ensure WebP in R2, isolate media errors)
          let productToSave: any = {
            ...productParts,
            isActive: productParts.isActive !== false,
            status: productParts.status || "نشط",
            categoryId: productParts.categoryId || productParts.category || "cat_nintendo",
            category: productParts.category || productParts.categoryId || "cat_nintendo",
            createdAt: productParts.createdAt || productParts.created_at || nowIso,
            created_at: productParts.created_at || productParts.createdAt || nowIso,
            updatedAt: nowIso,
            updated_at: nowIso,
          };
          try {
            const imgVerification = await sanitizeAndVerifyProductImages(productToSave);
            productToSave = { ...productToSave, ...imgVerification.product };
          } catch (imgErr) {
            console.warn(
              "[sanitizeAndVerifyProductImages] Non-blocking media ingestion fallback:",
              imgErr,
            );
          }

          /*
            One performance record, owned by the platform's device, before the
            document is written — the chunked save is the editor's main path.
          */
          try {
            const storeForNorm = await getStore();
            const categoriesForNorm = storeForNorm.categories || [];
            const catIdForNorm = String(productToSave.categoryId || productToSave.category || "");
            const catForNorm = categoriesForNorm.find(
              (c) => String(c.id || "") === catIdForNorm,
            );
            const sectionForNorm = resolveCategoryType(
              catIdForNorm,
              String(catForNorm?.title || catForNorm?.name || ""),
              String(productToSave.kind || ""),
              String(productToSave.schemaId || ""),
            );
            if (sectionForNorm === "game") {
              const hardwareForNorm = (storeForNorm.products || []).filter((p) => {
                const cId = String(p.categoryId || p.category || "");
                const c = categoriesForNorm.find((entry) => String(entry.id || "") === cId);
                return (
                  resolveCategoryType(
                    cId,
                    String(c?.title || c?.name || ""),
                    String(p.kind || ""),
                    String(p.schemaId || ""),
                  ) === "hardware"
                );
              });
              productToSave.devicePerformance = normalizeGameDevicePerformance(
                productToSave,
                hardwareForNorm,
              );
            }
          } catch (normErr) {
            console.error("[finalize:normalizeGameDevicePerformance:error]", normErr);
          }

          // Save directly as granular product
          await d1Run(
            `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            `store:product:${productId}`,
            JSON.stringify(productToSave),
            new Date().toISOString(),
          );

          // Clean up staged chunks
          await d1Run(`DELETE FROM store_kv WHERE key LIKE ?`, `staged_save:${sessionId}:%`);
          
          invalidateStoreCache();

          // Sync game device performance in background/await safely
          try {
            const currentStore = await getStore();
            const categories = currentStore.categories || [];
            const catId = String(productToSave.categoryId || productToSave.category || "");
            const cat = categories.find((c) => String(c.id || "") === catId);
            const section = resolveCategoryType(
              catId,
              String(cat?.title || cat?.name || ""),
              String(productToSave.kind || ""),
              String(productToSave.schemaId || ""),
            );
            if (section === "game") {
              const allProducts = currentStore.products || [];
              const hardwareProds = allProducts.filter((p) => {
                const cId = String(p.categoryId || p.category || "");
                const c = categories.find((entry) => String(entry.id || "") === cId);
                return (
                  resolveCategoryType(
                    cId,
                    String(c?.title || c?.name || ""),
                    String(p.kind || ""),
                    String(p.schemaId || ""),
                  ) === "hardware"
                );
              });
              await syncGameDevicePerformance(productToSave, hardwareProds);
            }
          } catch (perfErr) {
            console.error("[finalize:syncGameDevicePerformance:error]", perfErr);
          }
          
          // Read-after-write verification
          const verifyRows = await d1All<{ key: string; value: string }>(
            `SELECT key, value FROM store_kv WHERE key = ?`,
            `store:product:${productId}`
          );
          
          if (verifyRows.length === 0) {
            return json({ error: "Failed to verify product save (Read-after-write failed)" }, { status: 500 });
          }

          return json({
            success: true,
            product: JSON.parse(verifyRows[0]?.value || "{}"),
            catalogVersion: await getCatalogVersion(),
          });
        }),
    },
  },
});


