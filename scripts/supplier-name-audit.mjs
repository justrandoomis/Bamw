#!/usr/bin/env node
/**
 * Reconciles three counts that have to agree, by product id and slug.
 *
 *   1. games in the live catalogue
 *   2. rows in `product_admin_metadata` that belong to one of them
 *   3. entries in `data/supplier-names-zh.json` that match one of them
 *
 * They drifted apart because the catalogue is live: two games were deleted
 * after the curated file was written, so the file kept two entries nothing
 * points at any more, and the metadata table kept whatever rows those products
 * had. A row for a product that no longer exists is not harmless — it is a
 * name an admin could be shown for a game the shop does not sell.
 *
 * READ ONLY without `--apply`. With it, the only statement it will run is a
 * DELETE against `product_admin_metadata`, for product ids that are not in the
 * live catalogue. It never writes a product, never restores a deleted one, and
 * never touches an order: an order that was placed for a game since deleted is
 * still a real order and its history is not this script's business.
 *
 * Usage:
 *   node scripts/supplier-name-audit.mjs [--apply]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

import { curatedIndex, curatedNameFor } from "./lib/supplier-name-curated.mjs";

const CURATED = "data/supplier-names-zh.json";
const APPLY = process.argv.includes("--apply");

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redact(t));

const outfile = path.resolve(".supplier-name-audit-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

/* ------------------------------------------------------------ the catalogue */
const rows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' OR key LIKE 'store:product:%'",
);
if (!rows.length) throw new Error("D1 unreachable or empty — refusing to audit against nothing");

let aggregate = "";
const overlays = [];
for (const row of rows) {
  if (String(row.key).startsWith("store:product:")) overlays.push(row);
  else aggregate += String(row.value ?? "");
}
const live = new Map();
for (const p of JSON.parse(aggregate || "[]")) if (p?.id) live.set(String(p.id), p);
for (const row of overlays) {
  try {
    const doc = JSON.parse(String(row.value));
    if (doc?.id) live.set(String(doc.id), doc);
  } catch {
    /* the recovery tooling's problem, not this one's */
  }
}

const games = [...live.values()]
  .filter((p) => !p["_deleted"] && !p["isDeleted"])
  .filter((p) => app.getProductCategory(p) === "game")
  .sort((a, b) => String(a.slug || a.id).localeCompare(String(b.slug || b.id)));

/*
  Every live product, not only the games: a metadata row is orphaned when its
  product is gone entirely, and a game that was re-categorised is a different
  problem that this script must not silently "fix" by deleting its row.
*/
const liveIds = new Set([...live.values()].filter((p) => !p["_deleted"] && !p["isDeleted"]).map((p) => String(p.id)));

say(`live products: ${liveIds.size}`);
say(`live games: ${games.length}`);

/* --------------------------------------------------------- the curated file */
const curatedFile = JSON.parse(readFileSync(CURATED, "utf8"));
const { byTitle, problems } = curatedIndex(curatedFile);
if (problems.length) {
  for (const problem of problems) say(`curated entry refused — ${problem}`);
  throw new Error("the curated file is malformed — fix it before auditing against it");
}
const curatedTitles = Object.keys(curatedFile.names ?? {});
say(`curated entries: ${curatedTitles.length}`);

/* Which curated entry each live game resolves to, so the unused ones show up. */
const usedTitles = new Set();
const gamesWithoutName = [];
for (const game of games) {
  const hit = curatedNameFor(game, byTitle);
  if (hit) usedTitles.add(hit.title);
  else gamesWithoutName.push(game);
}
const orphanedCurated = curatedTitles.filter((title) => !usedTitles.has(title));

/* ------------------------------------------------------------ the metadata */
const metaRows = await app.d1All(
  "SELECT product_id, supplier_name_zh_verification_status AS status FROM product_admin_metadata",
);
const orphanedRows = metaRows.filter((row) => !liveIds.has(String(row.product_id)));
const attachedRows = metaRows.filter((row) => liveIds.has(String(row.product_id)));

const byStatus = new Map();
for (const row of attachedRows) {
  const status = String(row.status || "missing");
  byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
}

/* ---------------------------------------------------------------- the report */
say("");
say("── curated entries no live game resolves to ──");
if (!orphanedCurated.length) say("  none");
for (const title of orphanedCurated) say(`  ${title}`);

say("");
say("── metadata rows whose product no longer exists ──");
if (!orphanedRows.length) say("  none");
for (const row of orphanedRows) say(`  product_id ${row.product_id} · status ${row.status || "missing"}`);

say("");
say("── live games with no curated name ──");
if (!gamesWithoutName.length) say("  none");
for (const game of gamesWithoutName) {
  say(`  ${game.id} · ${game.slug ?? "—"} · ${game.titleEn || game.title || ""}`);
}

if (APPLY && orphanedRows.length) {
  /*
    One statement, one table, and only for ids proven absent from the live
    catalogue above. Deleting by id rather than by "not in this list" because a
    NOT IN over the whole catalogue would delete everything the moment the
    catalogue read came back short.
  */
  for (const row of orphanedRows) {
    await app.d1Run("DELETE FROM product_admin_metadata WHERE product_id = ?", String(row.product_id));
    say(`deleted orphan row for product ${row.product_id}`);
  }
}

const after = APPLY ? attachedRows.length : metaRows.length;
say("");
say(`live games: ${games.length}`);
say(`metadata rows attached to a live product: ${attachedRows.length}`);
say(`orphaned metadata rows: ${APPLY ? 0 : orphanedRows.length}`);
say(`curated entries no game uses: ${orphanedCurated.length}`);
for (const [status, count] of [...byStatus].sort()) say(`  ${status}: ${count}`);
say(`total rows now: ${after}`);

if (games.length !== attachedRows.length) {
  throw new Error(
    `${games.length} live games but ${attachedRows.length} attached metadata rows — the counts do not reconcile`,
  );
}
