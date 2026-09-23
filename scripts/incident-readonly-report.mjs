#!/usr/bin/env node
/**
 * Read-only production diagnosis for the product data-loss incident.
 *
 * This script NEVER writes. Every SQL statement passes an allowlist that
 * accepts only SELECT/PRAGMA and rejects anything containing a mutating
 * keyword or a second statement, so a typo cannot become a migration. R2 is
 * touched with `bucket info` and `object get` only — no put, no delete, no
 * list-and-prune.
 *
 * It shells out to wrangler using CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
 * from the environment. Secret values are never printed: everything on its way
 * to stdout goes through redact().
 *
 *   node scripts/incident-readonly-report.mjs [--products prd_a,prd_b]
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { LEGACY_BUCKET, SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
// The bucket the incident concerns. The secret wins when it is set, so the
// workflow stays correct if production ever points somewhere else.
const PUBLIC_BUCKET = LEGACY_BUCKET;
const PRIVATE_BUCKET = SERVING_BUCKET;

/* ------------------------------------------------------------------ safety */

const READ_SHAPE = /^\s*select\b/i;
const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|begin|commit|rollback|truncate)([^_\w]|$)/i;

function assertReadOnly(sql) {
  const s = String(sql).trim();
  if (!READ_SHAPE.test(s)) throw new Error(`REFUSED (not a SELECT): ${s.slice(0, 60)}`);
  if (MUTATING.test(s)) throw new Error(`REFUSED (mutating keyword): ${s.slice(0, 60)}`);
  if (s.replace(/;\s*$/, "").includes(";")) throw new Error("REFUSED (multiple statements)");
  return s;
}

/** Anything that could identify the account or the database never reaches stdout. */
const SECRETS = [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.CLOUDFLARE_D1_DATABASE_ID,
].filter((v) => v && v.length >= 8);

function redact(text) {
  let out = String(text ?? "");
  for (const secret of SECRETS) out = out.split(secret).join("«redacted»");
  // Belt and braces: any bare 32-hex account id, any uuid-shaped database id.
  out = out.replace(/\b[0-9a-f]{32}\b/gi, "«redacted-id»");
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "«redacted-id»");
  return out;
}

const lines = [];
function say(text = "") {
  const safe = redact(text);
  lines.push(safe);
  console.log(safe);
}

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");

const WRANGLER_ENV = {
  ...process.env,
  // Wrangler's first-run telemetry question blocks on stdin. With stdin closed
  // that is an indefinite hang, not an error, which is exactly how the first
  // attempt at this diagnostic burned a 30-minute job doing nothing.
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
  CI: "true",
};

/** Fail loudly after this rather than silently occupying the runner. */
const COMMAND_TIMEOUT_MS = 120_000;

/*
  A *present* object comes back in about two seconds. A missing one sends
  wrangler into its retry ladder, and at the 120s ceiling a few dozen misses
  are enough to consume the whole job — which is what happened when the
  document URLs (mostly older, mostly absent) were first probed. A miss is
  exactly the answer being looked for here, so it has to be cheap.
*/
const R2_PROBE_TIMEOUT_MS = 15_000;

function wrangler(args, { allowFail = false, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  try {
    return execFileSync(WRANGLER, [...args], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: WRANGLER_ENV,
    });
  } catch (err) {
    if (allowFail) return null;
    const detail = redact(err?.stderr || err?.stdout || err?.message || String(err));
    throw new Error(detail.slice(0, 1200));
  }
}

/** Wrangler prints warnings before the JSON body; take from the first bracket. */
function parseJson(raw) {
  if (raw == null) return null;
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

let queryCount = 0;

/**
 * Runs several SELECTs.
 *
 * This used to put them in one `--file` invocation to save round trips. On the
 * production database that call never returned — the run sat on it until the
 * job timed out, twice the wall time of simply issuing them one at a time,
 * which completes in about forty seconds. Correctness of the report matters
 * more than the round trips, so each statement goes over the `--command` path
 * that is known to work, and every one is still validated by the same
 * SELECT-only allowlist.
 */
function d1Batch(statements, { allowFail = false } = {}) {
  return statements.map((sql) => d1(sql, { allowFail }) ?? []);
}

function d1(sql, { allowFail = false } = {}) {
  const statement = assertReadOnly(sql);
  queryCount++;
  process.stderr.write(`[q${queryCount}] ${statement.slice(0, 70).replace(/\s+/g, " ")}\n`);
  const raw = wrangler(
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", statement],
    { allowFail },
  );
  const parsed = parseJson(raw);
  if (!parsed) {
    if (allowFail) return null;
    throw new Error(`unparseable D1 response for: ${statement.slice(0, 80)}`);
  }
  process.stderr.write(`[q${queryCount}] ok\n`);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/* ------------------------------------------------------------------ helpers */

const n = (value) => (value == null ? 0 : Number(value));
const kb = (bytes) => `${(n(bytes) / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(n(bytes) / 1024 / 1024).toFixed(2)} MB`;

function table(rows, columns) {
  if (!rows.length) return ["_(no rows)_"];
  const out = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
  for (const row of rows) out.push(`| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`);
  return out;
}

/* --------------------------------------------------------------------- main */

const argProducts = (() => {
  const i = process.argv.indexOf("--products");
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

say("# Read-only production diagnosis — product data-loss incident");
say();
say(`Run at ${new Date().toISOString()}. **No statement in this run mutates anything.**`);
say();

/* 1 — connectivity ---------------------------------------------------------- */

say("## 1. Connectivity");
say();
const ping = d1("SELECT 1 AS ok");
say(`- D1 reached: **${ping?.[0]?.ok === 1 ? "yes" : "no"}**`);
say(`- D1 database name (from \`wrangler.jsonc\`): **${DB_NAME}** (binding \`bananto\`, \`--remote\`)`);
const configuredId = (readFileSync(CONFIG, "utf8").match(/"database_id"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "";
if (process.env.CLOUDFLARE_D1_DATABASE_ID) {
  say(`- Database id in \`wrangler.jsonc\` matches the \`CLOUDFLARE_D1_DATABASE_ID\` secret: **${
    configuredId && configuredId === process.env.CLOUDFLARE_D1_DATABASE_ID ? "yes" : "NO — the run used the id in wrangler.jsonc"
  }** (values withheld)`);
}
const tables = d1(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).map((r) => r.name);
say(`- Tables visible: **${tables.length}**`);
const expected = [
  "store_kv", "store_rev", "product_index", "game_images", "game_variants",
  "game_device_performance", "game_device_performance_modes", "game_catalog",
  "game_records", "product_identity", "game_aliases", "game_price_history", "game_import_logs",
];
const missing = expected.filter((t) => !tables.includes(t));
say(`- Expected incident tables missing: ${missing.length ? "**" + missing.join(", ") + "**" : "_none_"}`);
const setAside = tables.filter((t) => /(_old|_backup|_bak|_legacy|_copy|_v\d+)$/i.test(t));
say(`- Tables renamed aside by migrations (possible pre-incident copies): **${setAside.length}**${setAside.length ? " — " + setAside.slice(0, 15).join(", ") : ""}`);
const storeLike = tables.filter((t) => /store/i.test(t));
say(`- Tables whose name mentions \`store\`: ${storeLike.slice(0, 15).join(", ") || "_none_"}`);
say();

/* 2 — store_kv census ------------------------------------------------------- */

say("## 2. `store_kv` census");
say();
const census = d1(`SELECT CASE
    WHEN key = 'store' THEN '1 base document'
    WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN '2 products aggregate'
    WHEN key LIKE 'store:product:%' THEN '3 granular overlay'
    WHEN key LIKE 'store:%' THEN '4 other heavy section'
    ELSE '5 other' END AS kind,
  COUNT(*) AS rows, SUM(LENGTH(value)) AS bytes
  FROM store_kv GROUP BY 1 ORDER BY 1`);
for (const row of census) row.bytes_h = mb(row.bytes);
for (const line of table(census, ["kind", "rows", "bytes", "bytes_h"])) say(line);
say();
const totalBytes = census.reduce((sum, r) => sum + n(r.bytes), 0);
say(`**Total \`store_kv\` bytes: ${totalBytes.toLocaleString()} (${mb(totalBytes)})**`);
say();

say("### Aggregate chunks");
say();
const chunks = d1(
  `SELECT key, LENGTH(value) AS bytes FROM store_kv
   WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key`,
);
for (const row of chunks) row.bytes_h = kb(row.bytes);
for (const line of table(chunks, ["key", "bytes", "bytes_h"])) say(line);
const aggregateBytes = chunks.reduce((sum, r) => sum + n(r.bytes), 0);
say();
say(`**Aggregate bytes: ${aggregateBytes.toLocaleString()} (${mb(aggregateBytes)})**`);
say();

/* 3 — granular overlays ----------------------------------------------------- */

say("## 3. Granular overlays");
say();
const overlay = d1(`SELECT COUNT(*) AS overlays,
    SUM(CASE WHEN value LIKE '%"_deleted":true%' THEN 1 ELSE 0 END) AS compaction_pattern_hits,
    SUM(CASE WHEN LENGTH(value) < 400 THEN 1 ELSE 0 END) AS under_400_bytes,
    SUM(LENGTH(value)) AS bytes
  FROM store_kv WHERE key LIKE 'store:product:%'`)[0] ?? {};
say(`- Surviving granular overlays: **${n(overlay.overlays)}**`);
say(`- Rows matching the compaction \`LIKE '%"_deleted":true%'\` pattern: **${n(overlay.compaction_pattern_hits)}**`);
say(`- Overlays under 400 bytes (tombstone-sized): **${n(overlay.under_400_bytes)}**`);
say(`- Overlay bytes: ${n(overlay.bytes).toLocaleString()} (${mb(overlay.bytes)})`);
say();
say("### Thinnest overlays");
say();
const thin = d1(
  `SELECT key, LENGTH(value) AS bytes FROM store_kv WHERE key LIKE 'store:product:%'
   ORDER BY LENGTH(value) ASC LIMIT 20`,
);
for (const line of table(thin, ["key", "bytes"])) say(line);
say();

/* 4 — product_index --------------------------------------------------------- */

say("## 4. `product_index`");
say();
const pi = d1(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN image = '' OR image IS NULL THEN 1 ELSE 0 END) AS without_image,
    SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden,
    SUM(CASE WHEN performance_required = 1 THEN 1 ELSE 0 END) AS performance_required
  FROM product_index`, { allowFail: true });
if (pi) {
  const row = pi[0] ?? {};
  say(`- Products indexed: **${n(row.total)}**`);
  say(`- Indexed rows with no image: **${n(row.without_image)}**`);
  say(`- Hidden: ${n(row.hidden)} — flagged performance-required: ${n(row.performance_required)}`);
} else {
  say("- `product_index` unreadable or absent.");
}
say();

/* 5 — relation tables ------------------------------------------------------- */

say("## 5. Product relation tables");
say();
const relations = [
  ["game_images", "game_id"],
  ["game_variants", "game_id"],
  ["game_device_performance", "game_id"],
  ["game_device_performance_modes", "performance_id"],
  ["game_records", "game_id"],
  ["game_aliases", "game_id"],
  ["game_price_history", "game_id"],
  ["game_import_logs", "game_id"],
  ["product_identity", "product_id"],
  ["game_catalog", "title"],
];
const relationRows = [];
for (const [name, key] of relations) {
  if (!tables.includes(name)) {
    relationRows.push({ table: name, rows: "—", distinct_parents: "table absent" });
    continue;
  }
  const r = d1(`SELECT COUNT(*) AS rows, COUNT(DISTINCT ${key}) AS parents FROM ${name}`, {
    allowFail: true,
  });
  relationRows.push({
    table: name,
    rows: r ? n(r[0]?.rows) : "error",
    distinct_parents: r ? n(r[0]?.parents) : "error",
  });
}
for (const line of table(relationRows, ["table", "rows", "distinct_parents"])) say(line);
say();

if (tables.includes("game_images")) {
  say("### `game_images` by role (`kind`)");
  say();
  const kinds = d1(
    "SELECT kind, COUNT(*) AS rows, COUNT(DISTINCT game_id) AS products FROM game_images GROUP BY kind ORDER BY rows DESC LIMIT 30",
  );
  for (const line of table(kinds, ["kind", "rows", "products"])) say(line);
  say();
}

/* 6 — reconstruct the catalogue exactly as loadStore does ------------------- */

say("## 6. Catalogue reconstruction (same merge rule as `loadStore`)");
say();

const chunkKeys = chunks.map((c) => c.key);
let aggregateRaw = "";
const singleKey = chunkKeys.find((k) => k === "store:products");
const numbered = chunkKeys
  .filter((k) => /^store:products#\d+$/.test(k))
  .sort((a, b) => Number(a.split("#")[1]) - Number(b.split("#")[1]));

if (numbered.length) {
  // Eight chunks per invocation: ~3 MB of JSON per round trip, and a couple of
  // calls instead of thirty for a 10 MB catalogue.
  const BATCH = 8;
  for (let i = 0; i < numbered.length; i += BATCH) {
    const slice = numbered.slice(i, i + BATCH);
    process.stderr.write(`[chunks] ${i + 1}-${i + slice.length} of ${numbered.length}\n`);
    const sets = d1Batch(
      slice.map((key) => `SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`),
    );
    for (const set of sets) aggregateRaw += set?.[0]?.value ?? "";
  }
} else if (singleKey) {
  const row = d1("SELECT value FROM store_kv WHERE key = 'store:products'");
  aggregateRaw = row?.[0]?.value ?? "";
}

let aggregateProducts = [];
let aggregateParseError = "";
try {
  const parsed = JSON.parse(aggregateRaw || "[]");
  aggregateProducts = Array.isArray(parsed) ? parsed : [];
} catch (err) {
  aggregateParseError = err.message;
}
say(`- Aggregate parsed: **${aggregateParseError ? "FAILED — " + aggregateParseError : "ok"}**`);
say(`- Products in the aggregate: **${aggregateProducts.length}**`);

const overlayRows = d1(
  "SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%' ORDER BY key",
);
const overlays = new Map();
let tombstones = 0;
for (const row of overlayRows) {
  let doc = null;
  try {
    doc = JSON.parse(row.value);
  } catch {
    continue;
  }
  if (!doc?.id) continue;
  if (doc._deleted === true) tombstones++;
  overlays.set(String(doc.id), doc);
}
say(`- Parsed overlays: **${overlays.size}** (top-level tombstones: **${tombstones}**)`);

const live = new Map();
for (const p of aggregateProducts) {
  if (p?.id) live.set(String(p.id), { doc: p, source: "aggregate" });
}
for (const [id, doc] of overlays) {
  if (doc._deleted === true) live.delete(id);
  else live.set(id, { doc, source: "overlay" });
}
say(`- **Live products after the merge: ${live.size}**`);
say();

say("### Live products missing from `product_index`");
say();
const indexedIds = new Set(
  d1("SELECT id FROM product_index", { allowFail: true })?.map((r) => String(r.id)) ?? [],
);
const notIndexed = [...live.keys()].filter((id) => !indexedIds.has(id));
const indexedButGone = [...indexedIds].filter((id) => !live.has(id));
say(`- Live in the catalogue but **absent from \`product_index\`** (invisible in the admin list): **${notIndexed.length}**`);
for (const id of notIndexed.slice(0, 20)) {
  say(`  - \`${id}\` — ${String(live.get(id)?.doc?.title ?? "").slice(0, 60)}`);
}
say(`- In \`product_index\` but **not** in the catalogue (stale index rows): **${indexedButGone.length}**`);
for (const id of indexedButGone.slice(0, 20)) say(`  - \`${id}\``);
say();

/* 7 — richness profile ------------------------------------------------------ */

/*
  The first run probed `GameMetadata.images.{cartridgeFront,boxArt,screenshots}`
  and reported zero for every product — but the catalogue stores its image roles
  as flat fields, the ones `AdminProductEditor` reads and writes. Probing the
  nested shape measured nothing and would have been read as total image loss.
*/
const IMAGE_FIELDS = [
  "image", "banner", "cartridgeImage", "nintendoCardImage", "coverImage",
  "coverHiResImage", "squareGameImage", "packagingFrontImage", "boxImage",
  "cardArtwork", "mainImage", "regionBanner", "bannerImage", "modelTextureUrl",
];
const IMAGE_ARRAY_FIELDS = ["bannerImages", "gallery", "screenshots", "galleryImages"];

const RICH_KEYS = [
  "images", "gallery", "bannerImages", "trailer", "trailerUrl", "nintendo", "switch2",
  "overview", "gameplayPillars", "story", "editionOptions", "editions", "dlcs",
  "genres", "supportedLanguages", "gameTypes", "features", "performance",
  "devicePerformance", "variants", "options", "productTypes", "sections",
];

/** Every asset-looking URL anywhere in the document, however deeply nested. */
const ASSET_RE = /(^|\/)(api\/files\/|files\/)|\.(avif|webp|jpe?g|png|gif|mp4|glb)($|\?)/i;
function collectAssetUrls(value, out = new Set(), depth = 0) {
  if (depth > 8 || value == null) return out;
  if (typeof value === "string") {
    const v = value.trim();
    if (v.length > 4 && ASSET_RE.test(v)) out.add(v);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetUrls(item, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectAssetUrls(item, out, depth + 1);
  }
  return out;
}

/** `/api/files/x.avif`, `files/x.avif` and a full URL all name the same object. */
function assetKey(url) {
  let path = String(url);
  try {
    if (path.startsWith("http")) path = new URL(path).pathname;
  } catch {
    /* not a URL; treat the raw string as a path */
  }
  path = path.replace(/^\/+/, "").replace(/^api\//, "");
  const marker = path.indexOf("files/");
  return marker > 0 ? path.slice(marker) : path;
}
const PROJECTION_KEYS = new Set([
  "id", "slug", "title", "titleEn", "category", "categoryId", "kind", "schemaId",
  "platform", "price", "cost", "stock", "isInfiniteStock", "isHidden", "status",
  "sales", "image", "displayOrder", "updatedAt", "createdAt", "releaseDate",
]);

function sizeOf(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  return 1;
}

function profile(id, entry) {
  const doc = entry.doc;
  const keys = Object.keys(doc);
  const rich = {};
  for (const key of RICH_KEYS) rich[key] = sizeOf(doc[key]);
  const richTotal = Object.values(rich).reduce((a, b) => a + b, 0);
  const imageRoles = {};
  for (const field of IMAGE_FIELDS) imageRoles[field] = doc[field] ? 1 : 0;
  for (const field of IMAGE_ARRAY_FIELDS) {
    imageRoles[field] = Array.isArray(doc[field])
      ? doc[field].filter((v) => typeof v === "string" && v.trim()).length
      : 0;
  }
  const assetUrls = collectAssetUrls(doc);
  return {
    assetUrls,
    assetKeys: new Set([...assetUrls].map(assetKey)),
    id,
    source: entry.source,
    bytes: JSON.stringify(doc).length,
    keys: keys.length,
    // The Vector-B fingerprint: nothing survives beyond the projection columns.
    projectionOnly: keys.every((k) => PROJECTION_KEYS.has(k)),
    beyondProjection: keys.filter((k) => !PROJECTION_KEYS.has(k)).length,
    richTotal,
    rich,
    imageRoles,
    imageCount: Object.values(imageRoles).reduce((a, b) => a + b, 0),
  };
}

const profiles = [];
for (const [id, entry] of live) profiles.push(profile(id, entry));

say("## 7. Richness profile across the live catalogue");
say();
const projectionOnly = profiles.filter((p) => p.projectionOnly);
const noRich = profiles.filter((p) => p.richTotal === 0);
const noImages = profiles.filter((p) => p.imageCount === 0);
say(`- Live products: **${profiles.length}**`);
say(`- Carrying **only** \`product_index\` projection keys (Vector B fingerprint): **${projectionOnly.length}**`);
say(`- Carrying no rich field at all (${RICH_KEYS.length} probed keys all empty): **${noRich.length}**`);
say(`- Carrying no image in any role: **${noImages.length}**`);
say(`- Median document size: ${(() => {
  const sizes = profiles.map((p) => p.bytes).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)].toLocaleString() + " bytes" : "n/a";
})()}`);
say();

/* 8 — relations that outlive the document --------------------------------- */

say("## 8. Products whose relations survived but whose document did not");
say();
const imagesByProduct = new Map();
if (tables.includes("game_images")) {
  for (const row of d1("SELECT game_id, COUNT(*) AS rows FROM game_images GROUP BY game_id")) {
    imagesByProduct.set(String(row.game_id), n(row.rows));
  }
}
const variantsByProduct = new Map();
if (tables.includes("game_variants")) {
  for (const row of d1("SELECT game_id, COUNT(*) AS rows FROM game_variants GROUP BY game_id")) {
    variantsByProduct.set(String(row.game_id), n(row.rows));
  }
}
const perfByProduct = new Map();
if (tables.includes("game_device_performance")) {
  for (const row of d1(
    "SELECT game_id, COUNT(*) AS rows FROM game_device_performance WHERE active = 1 GROUP BY game_id",
  )) {
    perfByProduct.set(String(row.game_id), n(row.rows));
  }
}

// The decisive comparison: an asset row whose URL appears nowhere in the
// product document is an image the storefront can no longer render.
const relationUrls = new Map();
if (tables.includes("game_images")) {
  for (const row of d1("SELECT game_id, kind, url FROM game_images")) {
    const id = String(row.game_id);
    if (!relationUrls.has(id)) relationUrls.set(id, []);
    relationUrls.get(id).push({ kind: String(row.kind), url: String(row.url) });
  }
}

const damaged = [];
for (const p of profiles) {
  const relImages = imagesByProduct.get(p.id) ?? 0;
  const relVariants = variantsByProduct.get(p.id) ?? 0;
  const relPerf = perfByProduct.get(p.id) ?? 0;
  const docImages = p.imageCount;
  const deficit =
    Math.max(0, relImages - docImages) +
    Math.max(0, relVariants - p.rich.editions - p.rich.editionOptions) +
    Math.max(0, relPerf - p.rich.performance - p.rich.devicePerformance);
  const rel = relationUrls.get(p.id) ?? [];
  const orphanRoles = rel
    .filter((r) => !p.assetKeys.has(assetKey(r.url)))
    .map((r) => r.kind);
  if (deficit > 0 || orphanRoles.length > 0 || (relImages > 0 && docImages === 0)) {
    damaged.push({
      ...p, relImages, relVariants, relPerf, docImages, deficit,
      unreferenced: orphanRoles.length,
      unreferencedRoles: orphanRoles,
    });
  }
}
damaged.sort((a, b) => b.unreferenced - a.unreferenced || b.deficit - a.deficit);
say(`- Products with relation rows the document no longer reflects: **${damaged.length}**`);
say(`- Of those, with relation images but **zero** images in the document: **${damaged.filter((d) => d.relImages > 0 && d.docImages === 0).length}**`);
const totalUnreferenced = damaged.reduce((sum, d) => sum + d.unreferenced, 0);
say(`- **Stored \`game_images\` rows whose URL appears nowhere in the product document: ${totalUnreferenced}** (across ${damaged.filter((d) => d.unreferenced > 0).length} products)`);
const roleTally = {};
for (const d of damaged) for (const role of d.unreferencedRoles) roleTally[role] = (roleTally[role] ?? 0) + 1;
const roleLines = Object.entries(roleTally).sort((a, b) => b[1] - a[1]);
say(`- Unreferenced by role: ${roleLines.length ? roleLines.map(([k, v]) => `\`${k}\`=${v}`).join(", ") : "_none_"}`);
say();
for (const line of table(
  damaged.slice(0, 25).map((d) => ({
    id: d.id, source: d.source, bytes: d.bytes, keys: d.keys,
    doc_images: d.docImages, rel_images: d.relImages, unreferenced: d.unreferenced,
    rel_perf: d.relPerf,
  })),
  ["id", "source", "bytes", "keys", "doc_images", "rel_images", "unreferenced", "rel_perf"],
)) say(line);
say();

/* 9 — deep dive on individual products ------------------------------------- */

say("## 9. Damaged products in detail");
say();
const sample = argProducts.length
  ? argProducts
  : damaged.slice(0, 3).map((d) => d.id);
if (!sample.length) {
  say("_No product met the damage heuristic; nothing to dissect._");
}
const sampleUrls = [];
for (const id of sample) {
  const entry = live.get(id);
  say(`### \`${id}\``);
  say();
  if (!entry) {
    say("- Not present in the live catalogue (deleted or never existed).");
    const tomb = overlays.get(id);
    say(`- Overlay row: ${tomb ? (tomb._deleted ? "tombstone" : "live overlay") : "none"}`);
    say();
    continue;
  }
  const p = profile(id, entry);
  say(`- Title: \`${String(entry.doc.title ?? "").slice(0, 60)}\` — slug \`${String(entry.doc.slug ?? "")}\``);
  say(`- Source of the live copy: **${p.source}** — ${p.bytes.toLocaleString()} bytes, ${p.keys} top-level keys`);
  say(`- Keys beyond the projection column set: **${p.beyondProjection}** ${p.projectionOnly ? "(**projection-only — Vector B fingerprint**)" : ""}`);
  const present = Object.entries(p.imageRoles).filter(([, v]) => v > 0);
  const absent = Object.entries(p.imageRoles).filter(([, v]) => v === 0).map(([k]) => k);
  say(`- Image fields **present**: ${present.length ? present.map(([k, v]) => `\`${k}\`(${v})`).join(", ") : "_none_"}`);
  say(`- Image fields **empty**: ${absent.join(", ")}`);
  say(`- Distinct asset URLs anywhere in the document: **${p.assetUrls.size}**`);
  /*
    Counting populated fields is not enough. A product can have every role
    filled and still be wrong, if the roles all point at the same asset — which
    is precisely the failure being investigated. So print what each field
    actually holds.
  */
  const relKeys = new Set((relationUrls.get(id) ?? []).map((r) => assetKey(r.url)));
  const short = (u) => {
    const k = assetKey(String(u));
    return k.length > 58 ? "…" + k.slice(-56) : k;
  };
  const fieldRows = [];
  for (const field of IMAGE_FIELDS) {
    if (!entry.doc[field]) continue;
    fieldRows.push({
      field,
      value: short(entry.doc[field]),
      in_game_images: relKeys.has(assetKey(String(entry.doc[field]))) ? "yes" : "NO",
    });
  }
  for (const field of IMAGE_ARRAY_FIELDS) {
    const arr = Array.isArray(entry.doc[field]) ? entry.doc[field] : [];
    arr.forEach((value, i) => {
      if (typeof value !== "string" || !value.trim()) return;
      fieldRows.push({
        field: `${field}[${i}]`,
        value: short(value),
        in_game_images: relKeys.has(assetKey(value)) ? "yes" : "NO",
      });
    });
  }
  say();
  say("What each image field actually points at:");
  say();
  for (const line of table(fieldRows, ["field", "value", "in_game_images"])) say(line);
  const distinctValues = new Set(fieldRows.map((r) => r.value));
  say();
  say(`- ${fieldRows.length} populated image slots resolve to **${distinctValues.size} distinct assets**${distinctValues.size < fieldRows.length ? " — roles are sharing assets" : ""}`);
  const rel = relationUrls.get(id) ?? [];
  const missingRoles = rel.filter((r) => !p.assetKeys.has(assetKey(r.url)));
  say(`- \`game_images\` rows the document does **not** reference: **${missingRoles.length}** of ${rel.length}${missingRoles.length ? " — roles: " + missingRoles.map((r) => r.kind).join(", ") : ""}`);
  say(`- All top-level keys: \`${Object.keys(entry.doc).sort().join(", ").slice(0, 900)}\``);
  say(`- Rich field sizes: ${JSON.stringify(p.rich)}`);
  say(`- Relation rows still in D1: images=${imagesByProduct.get(id) ?? 0}, variants=${variantsByProduct.get(id) ?? 0}, active performance=${perfByProduct.get(id) ?? 0}`);
  const overlayDoc = overlays.get(id);
  say(`- Overlay row present: ${overlayDoc ? (overlayDoc._deleted ? "**tombstone**" : "yes, live") : "**no** (aggregate is the only copy)"}`);
  if (tables.includes("game_images")) {
    const rows = d1(
      `SELECT kind, url, is_primary FROM game_images WHERE game_id = '${id.replace(/'/g, "''")}' ORDER BY kind LIMIT 12`,
    );
    for (const line of table(
      rows.map((r) => ({ kind: r.kind, is_primary: r.is_primary, url: String(r.url).slice(0, 90) })),
      ["kind", "is_primary", "url"],
    )) say(line);
    for (const r of rows) sampleUrls.push({ id, kind: r.kind, url: r.url });
  }
  say();
}

/* 10 — R2 ------------------------------------------------------------------- */

say("## 10. R2 (read/list only)");
say();
for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
  const raw = wrangler(["r2", "bucket", "info", bucket, "--json"], { allowFail: true });
  const info = parseJson(raw);
  if (!info) {
    say(`- \`${bucket}\`: **unreachable or no permission** (bucket info failed).`);
    continue;
  }
  const payload = info.result ?? info;
  say(`- \`${bucket}\`: reached. name=\`${payload.name ?? bucket}\`, objects=**${payload.objectCount ?? payload.object_count ?? "unknown"}**, size=${payload.payloadSize ?? payload.payload_size ?? "unknown"}`);
}
say();

/*
  Checking only the URLs recorded in `game_images` answers the wrong question.
  Those are the assets the media ingest wrote; the storefront renders whatever
  the *product document* points at, and on un-migrated products that is an
  older `r2_<uuid>.jpg` or 56-hex name the ingest never recorded. If those
  objects were removed when the new ones landed, D1 looks healthy and the site
  shows nothing — which is the reported symptom. So the document's own URLs are
  checked too.
*/
say("### Do the assets the product documents point at still exist?");
say();
const docChecked = [];
for (const id of sample) {
  const entry = live.get(id);
  if (!entry) continue;
  const urls = [...collectAssetUrls(entry.doc)].slice(0, 4);
  for (const url of urls) {
    const key = assetKey(url);
    let found = "";
    for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
      if (!key) break;
      const got = wrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"], {
        allowFail: true,
        timeoutMs: R2_PROBE_TIMEOUT_MS,
      });
      if (got && got.length > 0) {
        found = bucket;
        break;
      }
    }
    const shown = assetKey(url);
    docChecked.push({
      id: id.slice(0, 22),
      document_url: shown.length > 56 ? "…" + shown.slice(-54) : shown,
      present: found || "NOT FOUND in either bucket",
    });
  }
}
for (const line of table(docChecked, ["id", "document_url", "present"])) say(line);
const orphanedDocUrls = docChecked.filter((r) => r.present.startsWith("NOT FOUND")).length;
say();
say(`- Document-referenced assets missing from R2: **${orphanedDocUrls} of ${docChecked.length} sampled**${orphanedDocUrls ? " — these render as broken images on the storefront" : ""}`);
say();

say("### Do the assets `game_images` recorded still exist?");
say();
const checked = [];
for (const { id, kind, url } of sampleUrls.slice(0, 8)) {
  let key = "";
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    key = path.replace(/^\/+/, "");
    const marker = key.indexOf("files/");
    if (marker > 0) key = key.slice(marker);
  } catch {
    key = "";
  }
  if (!key) {
    checked.push({ id, kind, key: "(not an R2 key)", present: "n/a" });
    continue;
  }
  const found = [];
  for (const bucket of [PUBLIC_BUCKET, PRIVATE_BUCKET]) {
    const got = wrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"], {
      allowFail: true,
      timeoutMs: R2_PROBE_TIMEOUT_MS,
    });
    if (got && got.length > 0) found.push(bucket);
  }
  checked.push({
    id: id.slice(0, 22),
    kind,
    key: key.length > 62 ? "…" + key.slice(-60) : key,
    present: found.length ? found.join(" + ") : "NOT FOUND in either bucket",
  });
}
for (const line of table(checked, ["id", "kind", "key", "present"])) say(line);
say();

/* 11 — verdict -------------------------------------------------------------- */

say("## 11. Vector verdict (evidence only — no repair attempted)");
say();
say(`- **Vector A** (compaction \`DELETE … LIKE '%"_deleted":true%'\` removing live overlays): rows currently matching that pattern = **${n(overlay.compaction_pattern_hits)}**, of which top-level tombstones = **${tombstones}**. Live overlays matching the pattern = **${Math.max(0, n(overlay.compaction_pattern_hits) - tombstones)}**.`);
say(`- **Vector B** (projection row written back as a product): live products carrying only projection keys = **${projectionOnly.length}**.`);
say(`- **Vector C** (rich data intact, only the projection/storefront stale): products in the merge = ${live.size} vs \`product_index\` = ${pi ? n(pi[0]?.total) : "n/a"}; drift = **${pi ? live.size - n(pi[0]?.total) : "n/a"}**.`);
say(`- **Vector D** (empty-products document written back): aggregate holds **${aggregateProducts.length}** products — an empty aggregate would read 0.`);
say();
say(`_Queries executed: ${queryCount}, all read-only._`);

const report = lines.join("\n") + "\n";
writeFileSync("incident-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
