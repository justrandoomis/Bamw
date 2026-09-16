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
 * **Idempotent.** A row is matched to an existing product by slug, id or name,
 * and an existing product is left alone, never duplicated. Running the same
 * file twice changes nothing the second time, which is what makes resuming an
 * interrupted run the same action as starting one.
 *
 * **Non-destructive.** A game already in the shop is where somebody decided it
 * should be hidden, out of stock or priced differently, and the sheet does not
 * get to overrule that. `refresh-prices` is the opt-in exception and touches
 * two fields on listings this importer created — see `buildListing`.
 *
 * **Reversible in the safe direction.** `apply: false` is the default, so the
 * first thing the owner sees is a count of what *would* happen. Nothing is
 * written until they ask for it.
 *
 * ## One transaction per batch, not four hundred round trips
 *
 * The first version wrote each product as its own `store:product:<id>` overlay
 * row, refreshed its projection row, and wrote its supplier name — three or
 * four D1 round trips per product, awaited in order, a hundred products to a
 * batch. Four hundred sequential round trips is a request the Worker holds open
 * for as long as D1 takes to answer four hundred times, and it is not the only
 * request the shop has to serve while it does. That run stopped at batch three
 * and took `/api/admin/store` down with it.
 *
 * It also got heavier as it went. Overlay rows are only folded into the
 * catalogue document by a full write, so every batch re-read and re-parsed
 * every overlay the batches before it had written — and an interrupted run
 * left them there, on the read path of the whole shop, until somebody ran a
 * compaction that never came.
 *
 * So a batch is now one `updateStore` call: the store's own write path, which
 * commits the catalogue and its projection in a single transaction and leaves
 * nothing behind to compact. Four round trips instead of four hundred, and an
 * interrupted run leaves a catalogue that is complete as far as it got.
 */

import { createFileRoute } from "@tanstack/react-router";

import { getStore, invalidateStoreCache, updateStore } from "@/lib/db.server";
import { d1All, d1Batch, d1Run } from "@/lib/d1.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { supplierNameStatements } from "@/lib/productAdminMetadata.server";
import {
  buildListing,
  decide,
  type CatalogueRow,
  type Decision,
  type ImportMode,
  type RowResult,
} from "@/lib/catalogueImport";
import { categoryFilterAliases, resolveCategoryType } from "@/lib/productSection";
import { assertBoundParameters, chunkForParams } from "@/lib/sql-params";
import type { StoreDoc } from "@/lib/types";

/** One request's worth. A hundred products is one transaction, not a hundred. */
const MAX_BATCH = 100;

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
            Tidy-up for a run that predates the transactional write, and for
            any other path that left granular overlays behind.

            An overlay row is read and re-parsed by `loadStore` on every cold
            start until a full write folds it into the catalogue document. This
            endpoint no longer creates them, but production still holds the
            ones an interrupted run left — so the sweep stays, and the client
            calls it whether the run finished or stopped.

            The delete is narrowed by `updated_at`, not by key alone. An admin
            editing a product between the aggregate write and this statement
            has written a newer row, and that edit is not in the document just
            persisted — deleting it would silently discard their save.
          */
          if (payload?.finalize === true) {
            const before = new Date().toISOString();

            /*
              Look before rewriting.

              This called `updateStore((current) => current)` first — a full
              read, normalise, stringify, re-chunk and projection re-derivation
              of a document that did not change — and only then asked whether
              there was anything to fold in. Measured in-container at 121 ms for
              876 products and 184 ms for 1,706, which is the same order as a
              whole batch of a hundred products, spent to write back exactly
              what was already there. It is also why finalize was answering 503
              at the end of a run that had otherwise survived.

              The sweep below is the cheap part and it is what the step is for,
              so the question it already asks is simply asked first.
            */
            const stale = await d1All<{ key: string }>(
              `SELECT key FROM store_kv
                WHERE key LIKE 'store:product:%' AND updated_at <= ?`,
              before,
            );
            if (stale.length === 0) {
              return json({ success: true, finalized: true, compacted: 0 });
            }

            await updateStore((current) => current);
            invalidateStoreCache();
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
            return json(
              { error: "لا توجد صفوف في هذه الدفعة", code: "EMPTY_BATCH" },
              { status: 400 },
            );
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

          /*
            Held outside the mutation so the response can report what the
            *accepted* attempt decided. `updateStore` re-runs the callback
            against a fresh snapshot when another writer wins the revision, and
            the counts from a losing attempt describe a catalogue that was
            never saved.
          */
          let decision: Decision | undefined;

          if (apply) {
            await updateStore((current) => {
              decision = decide(current, rows, mode);
              return { ...current, products: decision.products } as StoreDoc;
            });
            invalidateStoreCache();
          } else {
            decision = decide(await getStore(), rows, mode);
          }

          const result = decision!;

          /*
            The supplier names, in one transaction after the products are
            safely written.

            A failure here does not fail the import: the listing is sellable
            without the supplier's name for it, and losing a hundred games over
            a metadata row would be the wrong trade. Re-running the import
            writes them again.
          */
          let namesWritten = 0;
          if (apply && result.names.length > 0) {
            try {
              const statements = supplierNameStatements(
                result.names.map((entry) => ({ ...entry, updatedBy: admin.id })),
              );
              if (statements.length > 0) {
                await d1Batch(statements.map((s) => ({ sql: s.sql, binds: s.params })));
                namesWritten = result.names.length;
              }
            } catch (err) {
              console.warn("[catalogue-import] supplier names failed", err);
            }
          }

          return json({
            success: true,
            apply,
            categoryId: result.categoryId,
            mode,
            created: result.created,
            updated: result.updated,
            skipped: result.results.filter((r) => r.outcome === "skipped").length,
            namesWritten,
            results: result.results,
          });
        }),
    },
  },
});
