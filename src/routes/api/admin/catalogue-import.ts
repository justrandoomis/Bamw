/**
 * Importing the supplier catalogue.
 *
 * Fifteen hundred rows is too many for one request — the Worker would run out
 * of time long before the last one — so the browser parses the file, shows the
 * owner what it read, and then posts it back a batch at a time. This endpoint
 * handles one batch and says exactly what it did with every row in it.
 *
 * Three properties it is built around:
 *
 * **Idempotent.** A row is matched to an existing product by slug, and an
 * existing product is *updated*, never duplicated. Running the same file twice
 * changes nothing the second time; running an updated file changes only the
 * prices that moved. The owner can re-run it whenever the spreadsheet changes,
 * which is the only way a price list stays a price list.
 *
 * **Non-destructive.** An update overwrites the six columns the spreadsheet is
 * authoritative about and touches nothing else. A game somebody has since
 * written a description for, given a cover and set an online price on keeps all
 * of it — otherwise the first re-import would erase weeks of work, and that is
 * the kind of thing you discover afterwards.
 *
 * **Reversible in the safe direction.** `apply: false` is the default, so the
 * first thing the owner sees is a count of what *would* happen. Nothing is
 * written until they ask for it.
 *
 * It writes one `store:product:<id>` row per product plus one projection row —
 * the same granular path a single admin save takes — rather than rewriting the
 * whole catalogue document. Fifteen hundred products through the document path
 * would be fifteen hundred rewrites of a megabyte of JSON, each racing the
 * others for the store revision.
 */

import { createFileRoute } from "@tanstack/react-router";

import { getStore, invalidateStoreCache, updateStore } from "@/lib/db.server";
import { d1All, d1Run } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { refreshProductIndexRow } from "@/lib/product-index.server";
import { writeSupplierNameZh } from "@/lib/productAdminMetadata.server";
import { buildListing, type CatalogueRow, type ImportMode } from "@/lib/catalogueImport";
import { categoryFilterAliases } from "@/lib/productSection";
import { assertBoundParameters, chunkForParams } from "@/lib/sql-params";

/** One request's worth. Fifty products is roughly a second of Worker time. */
const MAX_BATCH = 100;

type Outcome = "created" | "updated" | "skipped";

interface RowResult {
  line: number;
  name: string;
  outcome: Outcome;
  /** Present on `skipped`, always in Arabic — the admin reads this list. */
  reason?: string;
  id?: string;
}

function slugOf(product: Record<string, unknown>): string {
  return String(product["slug"] ?? "")
    .trim()
    .toLowerCase();
}

/**
 * The Nintendo Switch Games category, as this store actually spells it.
 *
 * The section has six accepted spellings (`SECTION_CATEGORY_ALIASES`), and
 * guessing the wrong one puts fifteen hundred games in a category the sidebar
 * does not list. So the store's own categories are consulted first and only
 * the canonical id is used as a fallback.
 */
function resolveGamesCategory(categories: unknown): { id: string; title: string } {
  const list = Array.isArray(categories) ? (categories as Record<string, unknown>[]) : [];
  const aliases = categoryFilterAliases("nintendo-switch-games");
  for (const category of list) {
    const id = String(category?.["id"] ?? "")
      .trim()
      .toLowerCase();
    if (id && aliases.includes(id)) {
      return { id: String(category["id"]), title: String(category["title"] ?? "") };
    }
  }
  return { id: "nintendo-switch-games", title: "ألعاب نينتندو سويتش" };
}

export const Route = createFileRoute("/api/admin/catalogue-import")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const payload = await body<{
            rows?: CatalogueRow[];
            apply?: boolean;
            finalize?: boolean;
            mode?: ImportMode;
          }>(request);

          /*
            The last call of a run, and not an optional tidy-up.

            Each batch writes a `store:product:<id>` overlay row, which is the
            granular save path a single admin edit takes — fast, incremental,
            and safe to interrupt. But those rows are only *folded into* the
            catalogue document by a full write, and until that happens
            `loadStore` reads every one of them and re-parses it on every cold
            start. Fifteen hundred of them is fifteen hundred extra rows and
            fifteen hundred `JSON.parse` calls on the read path of the whole
            shop.

            So the run ends here: one full write of the aggregate (which by
            then already contains everything the overlays hold, because
            `loadStore` merged them to build it), then the overlays are
            removed.

            The delete is narrowed by `updated_at`, not by key alone. An admin
            editing a product between the aggregate write and this statement
            has written a newer row, and that edit is not in the document just
            persisted — deleting it would silently discard their save.
          */
          if (payload?.finalize === true) {
            const before = new Date().toISOString();
            await updateStore((current) => current);
            invalidateStoreCache();

            const stale = await d1All<{ key: string }>(
              `SELECT key FROM store_kv
                WHERE key LIKE 'store:product:%' AND updated_at <= ?`,
              before,
            );
            /*
              Chunked against D1's parameter ceiling rather than a number
              chosen by eye. One variable per key plus the timestamp, so the
              group size is a function of the limit — `sql-bounds-audit` fails
              the build for any `IN (...)` list that is not.
            */
            let removed = 0;
            for (const group of chunkForParams(stale, 1, 1)) {
              const keys = group.map((row) => row.key);
              const placeholders = keys.map(() => "?").join(",");
              const sql = `DELETE FROM store_kv WHERE key IN (${placeholders}) AND updated_at <= ?`;
              const binds = [...keys, before];
              assertBoundParameters(sql, binds);
              await d1Run(sql, ...binds);
              removed += keys.length;
            }
            return json({ success: true, finalized: true, compacted: removed });
          }

          const rows = Array.isArray(payload?.rows) ? payload.rows : [];
          if (rows.length === 0) {
            return json({ error: "لا توجد صفوف في هذه الدفعة", code: "EMPTY_BATCH" }, { status: 400 });
          }
          if (rows.length > MAX_BATCH) {
            return json(
              { error: `الحد الأقصى ${MAX_BATCH} صف في الطلب الواحد`, code: "BATCH_TOO_LARGE" },
              { status: 400 },
            );
          }

          const apply = payload?.apply === true;
          /*
            Create-only unless the run explicitly asks otherwise.

            The importer is additive: a game already in the shop is left as it
            is, whatever the sheet now says about it, because the shop is where
            somebody decided it should be hidden, out of stock, or priced
            differently. `refresh-prices` is opt-in and touches two fields on
            listings this importer created — see `buildListing`.
          */
          const mode: ImportMode =
            payload?.mode === "refresh-prices" ? "refresh-prices" : "create-only";
          const store = await getStore();
          const category = resolveGamesCategory(store.categories);

          /*
            One pass over the catalogue, not one lookup per row. A `find` per
            row over seventeen hundred products is eighty-five thousand string
            comparisons per batch, and there are sixteen batches.
          */
          const bySlug = new Map<string, Record<string, unknown>>();
          const byTitle = new Map<string, Record<string, unknown>>();
          for (const product of (store.products ?? []) as unknown as Record<string, unknown>[]) {
            const slug = slugOf(product);
            if (slug) bySlug.set(slug, product);
            const title = String(product["titleEn"] ?? product["title"] ?? "")
              .trim()
              .toLowerCase();
            if (title) byTitle.set(title, product);
          }

          const results: RowResult[] = [];
          let created = 0;
          let updated = 0;

          for (const row of rows) {
            const name = String(row?.englishName ?? "").trim();
            const line = Number(row?.line) || 0;
            if (!name || !(Number(row?.offlinePriceIqd) > 0)) {
              results.push({ line, name, outcome: "skipped", reason: "صف غير صالح" });
              continue;
            }

            /*
              Matched by slug first, then by name.

              The slug is what a re-run of the same sheet produces, so it is
              the reliable key. The title lookup is what stops the import from
              creating a second «Fire Emblem: Three Houses» beside one an admin
              added by hand under a different slug — and because an existing
              product is now refused rather than overwritten, a wrong match
              costs a skipped row the admin can see, not a product turned into
              something it is not.
            */
            const desiredSlug = String(row.slug ?? "").trim().toLowerCase();
            const existing =
              (desiredSlug ? bySlug.get(desiredSlug) : undefined) ??
              byTitle.get(name.toLowerCase()) ??
              undefined;

            const outcome = buildListing(row, {
              categoryId: category.id,
              categoryTitle: category.title,
              mode,
              ...(existing ? { existing } : {}),
            });

            if (outcome.action === "skip") {
              results.push({ line, name, outcome: "skipped", reason: outcome.reason });
              continue;
            }

            const id = String(outcome.product["id"]);

            if (apply) {
              try {
                await d1Run(
                  `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                  `store:product:${id}`,
                  JSON.stringify(outcome.product),
                  new Date().toISOString(),
                );
                await refreshProductIndexRow(outcome.product);

                /*
                  The Chinese name goes to its own admin-only table and never
                  onto the product. `getStore()` does not load that table, so
                  there is no path by which the storefront could serialise it —
                  which is the whole reason it lives there.

                  A failure here does not fail the import: the listing is
                  sellable without the supplier's name for it, and losing the
                  game over a metadata row would be the wrong trade.
                */
                if (outcome.chineseName) {
                  try {
                    await writeSupplierNameZh({
                      productId: id,
                      supplierNameZhCn: outcome.chineseName,
                      englishTitle: name,
                      updatedBy: admin.id,
                    });
                  } catch (metaErr) {
                    console.warn("[catalogue-import] supplier name failed", id, metaErr);
                  }
                }
              } catch (err) {
                console.error("[catalogue-import] write failed", id, err);
                results.push({
                  line,
                  name,
                  outcome: "skipped",
                  reason: "فشل الحفظ في قاعدة البيانات",
                });
                continue;
              }
            }

            if (outcome.action === "create") created += 1;
            else updated += 1;
            results.push({ line, name, outcome: outcome.action === "create" ? "created" : "updated", id });
          }

          if (apply) invalidateStoreCache();

          return json({
            success: true,
            apply,
            categoryId: category.id,
            mode,
            created,
            updated,
            skipped: results.filter((r) => r.outcome === "skipped").length,
            results,
          });
        }),
    },
  },
});
