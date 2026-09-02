#!/usr/bin/env node
/**
 * Applies one reviewed catalogue batch to production — under every guard.
 *
 * DRY RUN unless the reviewed file itself carries `"apply": true`.
 *
 * Guards, in order, per game:
 *  1. Commercial fields are untouchable: any attempt to set or clear them is
 *     stripped and reported, never written.
 *  2. Drift: the live record is re-read and content-hashed; if it no longer
 *     matches the `baseHash` captured at export time, the game is refused —
 *     someone changed production since the review and the review is stale.
 *  3. The merge goes through the application's own `mergeProductUpdate`, so an
 *     omitted field can never erase a stored one and media rules hold.
 *  4. Device performance is re-normalized to the single platform record and
 *     validated; a game that fails validation is refused, not written.
 *  5. After the write the row is read back and re-hashed; a mismatch marks the
 *     game failed and it stays un-reviewed.
 *
 * On full success the reviewed file's `apply` is reset to false and
 * `review-state.json` records each game with its post-apply hash.
 *
 * Usage:  node scripts/catalogue-review-apply.mjs [--batch=NNN] [--dry-run]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORK_DIR = "review-workdir";
const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const FORCE_DRY = process.argv.includes("--dry-run");

for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

/**
 * The commercial surface the review must never touch. Both spellings where
 * production rows carry both.
 */
const COMMERCIAL_FIELDS = new Set([
  "price", "cost", "stock", "isInfiniteStock", "is_infinite_stock",
  "isHidden", "is_hidden", "isActive", "status",
  "options", "types", "variants",
  "trade_enabled", "trade_value", "trade_value_iqd", "trade_value_locked",
  "store_offer_bonus", "store_offer_bonus_iqd",
  "displayOrder", "display_order", "sales", "sold", "views",
  "id", "createdAt", "created_at",
]);

const batchArg = flag("batch", "");
const reviewedFiles = readdirSync(WORK_DIR)
  .filter((f) => /^reviewed-catalogue-batch-\d+\.json$/.test(f))
  .sort();
const reviewedPath = batchArg
  ? path.join(WORK_DIR, `reviewed-catalogue-batch-${batchArg}.json`)
  : path.join(WORK_DIR, reviewedFiles[reviewedFiles.length - 1] ?? "");
if (!reviewedPath || !existsSync(reviewedPath)) throw new Error(`no reviewed batch file found (${reviewedPath})`);
const reviewed = JSON.parse(readFileSync(reviewedPath, "utf8"));
const APPLY = reviewed.apply === true && !FORCE_DRY;
const lines = [];
const say = (t = "") => { lines.push(t); console.log(t); };

say(`# Catalogue review apply — batch ${reviewed.batch} ${APPLY ? "(APPLY)" : "(dry run)"}`);
say();

/* ------------------------------------------------ the application's own code */
const outfile = path.resolve(".catalogue-review-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile, bundle: true, format: "esm", platform: "node", target: "node20",
  logLevel: "silent", alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

const canonicalHash = (doc) => {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(stable(doc))).digest("hex");
};

const readBack = async (id) => {
  const rows = await app.d1All("SELECT value FROM store_kv WHERE key = ?", `store:product:${id}`);
  try { return rows?.[0]?.value ? JSON.parse(String(rows[0].value)) : null; } catch { return null; }
};

/* Aggregate fallback for products that only live in the aggregate document. */
const aggRows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%'",
);
let aggregate = "";
for (const row of aggRows) aggregate += String(row.value ?? "");
const aggProducts = new Map();
try { for (const p of JSON.parse(aggregate || "[]")) if (p?.id) aggProducts.set(String(p.id), p); } catch { /* reported below per game */ }

const hardwareRows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'",
);
const hardware = [];
for (const row of hardwareRows) {
  try {
    const doc = JSON.parse(String(row.value));
    if (doc && app.getProductCategory(doc) === "hardware") hardware.push(doc);
  } catch { /* not this row's job */ }
}
for (const p of aggProducts.values()) {
  if (app.getProductCategory(p) === "hardware" && !hardware.some((h) => String(h.id) === String(p.id))) hardware.push(p);
}
say(`hardware products visible to the resolver: ${hardware.length}`);
say();

const statePath = path.join(WORK_DIR, "review-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { batches: 0, reviewed: {} };

const results = [];
let refused = 0, written = 0, unchanged = 0;

for (const entry of reviewed.games || []) {
  const id = String(entry.id);
  say(`## ${id} (${entry.slug || ""})`);

  /* guard 1 — commercial surface */
  const set = { ...(entry.set || {}) };
  const clear = [...(entry.clear || [])];
  const strippedSet = Object.keys(set).filter((k) => COMMERCIAL_FIELDS.has(k));
  const strippedClear = clear.filter((k) => COMMERCIAL_FIELDS.has(k));
  for (const k of strippedSet) delete set[k];
  const safeClear = clear.filter((k) => !COMMERCIAL_FIELDS.has(k));
  if (strippedSet.length || strippedClear.length) {
    say(`- **commercial fields stripped, never written**: ${[...strippedSet, ...strippedClear].join(", ")}`);
  }

  const stored = (await readBack(id)) ?? aggProducts.get(id) ?? null;
  if (!stored) { say(`- REFUSED: product no longer exists in production`); refused++; results.push({ id, action: "REFUSED_MISSING" }); continue; }
  const liveHash = canonicalHash(stored);

  if (!Object.keys(set).length && !safeClear.length) {
    say(`- no changes requested — review recorded as clean`);
    unchanged++;
    results.push({ id, action: "CLEAN" });
    if (APPLY) state.reviewed[id] = { batch: reviewed.batch, at: new Date().toISOString(), hash: liveHash, clean: true };
    continue;
  }

  /* guard 3 — the application's own merge */
  const guard = app.mergeProductUpdate(stored, set, { clear: safeClear });
  if (guard.blocked.length) say(`- merge guard blocked: ${guard.blocked.map((b) => b.field ?? b).join(", ")}`);

  /*
    Idempotency before the drift guard: when production already carries every
    requested value (a rerun after a partial cycle), there is nothing to
    write, so the review is recorded clean instead of drift-refused.
  */
  if (canonicalHash(guard.merged) === liveHash) {
    say(`- production already matches the review — recorded as clean (hash ${liveHash.slice(0, 12)})`);
    unchanged++;
    results.push({ id, action: "CLEAN_ALREADY_APPLIED" });
    if (APPLY) state.reviewed[id] = { batch: reviewed.batch, at: new Date().toISOString(), hash: liveHash, clean: true };
    continue;
  }

  /* guard 2 — drift: never write over a record someone changed since export */
  if (entry.baseHash && liveHash !== entry.baseHash) {
    say(`- REFUSED: production changed since export (live ${liveHash.slice(0, 12)} ≠ base ${String(entry.baseHash).slice(0, 12)}) — re-export this game`);
    refused++; results.push({ id, action: "REFUSED_DRIFT" }); continue;
  }
  const merged = { ...guard.merged, updatedAt: new Date().toISOString(), updated_at: new Date().toISOString() };

  /* guard 4 — one device record, validated */
  merged.devicePerformance = app.normalizeGameDevicePerformance(merged, hardware);
  delete merged.device_performance;
  const issues = app.validateGameDevicePerformance(merged).filter((i) => i.severity === "error");
  if (issues.length) {
    say(`- REFUSED: device performance invalid — ${issues.map((i) => i.message).join(" | ")}`);
    refused++; results.push({ id, action: "REFUSED_VALIDATION" }); continue;
  }

  say(`- fields changing (${guard.changed.length}): ${guard.changed.join(", ") || "(clear-only)"}`);
  if (safeClear.length) say(`- fields cleared: ${safeClear.join(", ")}`);

  if (!APPLY) { results.push({ id, action: "DRY_RUN", changed: guard.changed }); continue; }

  /* write + guard 5 — read back and re-hash */
  writeFileSync(path.join(WORK_DIR, `${id}.before.json`), JSON.stringify(stored, null, 1));
  await app.d1Run(
    "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    `store:product:${id}`,
    JSON.stringify(merged),
    new Date().toISOString(),
  );
  const back = await readBack(id);
  const backHash = back ? canonicalHash(back) : "";
  if (backHash !== canonicalHash(merged)) {
    say(`- **read-after-write verification FAILED** — game stays un-reviewed`);
    refused++; results.push({ id, action: "WRITE_VERIFY_FAILED" }); continue;
  }
  try { await app.syncGameDevicePerformance?.(merged, hardware); } catch (e) { say(`- perf projection sync warning: ${String(e).slice(0, 100)}`); }
  say(`- written and verified (hash ${backHash.slice(0, 12)})`);
  written++;
  state.reviewed[id] = { batch: reviewed.batch, at: new Date().toISOString(), hash: backHash };
  results.push({ id, action: "APPLIED", changed: guard.changed });
}

say();
say(`## Summary — applied: ${written} · clean: ${unchanged} · refused: ${refused} · mode: ${APPLY ? "APPLY" : "dry run"}`);

if (APPLY) {
  reviewed.apply = false;
  reviewed.appliedAt = new Date().toISOString();
  reviewed.results = results;
  writeFileSync(reviewedPath, JSON.stringify(reviewed, null, 1));
  writeFileSync(statePath, JSON.stringify(state, null, 1));
}
writeFileSync(path.join(WORK_DIR, `apply-report-${reviewed.batch}.md`), lines.join("\n") + "\n");
/*
  Refusals are per-game outcomes, recorded above; the cycle itself succeeded,
  so the workflow's commit and next-batch export must still run. Refused games
  stay out of review-state.json and come back in a later export automatically.
*/
