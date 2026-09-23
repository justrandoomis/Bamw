#!/usr/bin/env node
/**
 * Phase 1-3 recovery audit. READ-ONLY — mutates nothing.
 *
 * For every live product it reads all ten sources, compares the granular
 * overlay against the aggregate copy field by field, counts the relational
 * rows, and classifies the product into recovery group A-E.
 *
 * The classification is the whole point: a product whose overlay is thinner
 * than its aggregate copy (group B) is recovered from D1 itself, and must not
 * be sent to Time Travel.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { LEGACY_BUCKET, SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
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

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
function redact(text) {
  let out = String(text ?? "");
  for (const secret of SECRETS) out = out.split(secret).join("«redacted»");
  return out;
}

const lines = [];
const say = (text = "") => {
  const safe = redact(text);
  lines.push(safe);
  console.log(safe);
};

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const WRANGLER_ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

function wrangler(args, { allowFail = false, timeoutMs = 120_000 } = {}) {
  try {
    return execFileSync(WRANGLER, args, {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: WRANGLER_ENV,
    });
  } catch (err) {
    if (allowFail) return null;
    throw new Error(redact(err?.stderr || err?.message || String(err)).slice(0, 800));
  }
}

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

let queries = 0;
function d1(sql, { allowFail = false } = {}) {
  const statement = assertReadOnly(sql);
  queries++;
  process.stderr.write(`[q${queries}] ${statement.slice(0, 60).replace(/\s+/g, " ")}\n`);
  const parsed = parseJson(
    wrangler(
      ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", statement],
      { allowFail },
    ),
  );
  if (!parsed) {
    if (allowFail) return null;
    throw new Error(`unparseable D1 response: ${statement.slice(0, 70)}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/* ------------------------------------------------------------ field probes */

/** The image roles, kept separate on purpose — never collapsed into one. */
const IMAGE_ROLES = {
  front_box_cover: ["cartridgeImage", "packagingFrontImage", "boxImage", "box_front_url"],
  square_card: ["nintendoCardImage", "squareGameImage"],
  cover_image: ["coverImage", "cardArtwork", "mainImage"],
  texture_3d: ["coverHiResImage", "modelTextureUrl"],
};
const BANNER_FIELDS = ["bannerImages"];
const GALLERY_FIELDS = ["gallery", "galleryImages", "galleryDetails", "screenshots"];

const GAME_DATA = [
  "platform", "developer", "publisher", "releaseDate", "genres", "supportedLanguages",
  "ageRating", "players", "gameSizeGb", "downloadSizeGb", "trailer", "trailerUrl",
  "metacriticScore", "metacriticRating", "verdict",
];
const DETAIL_SECTIONS = [
  "nintendo", "switch2", "performance", "devicePerformance", "overview", "editions",
  "editionOptions", "editionsList", "gameplayPillars", "story", "galleryDetails", "videos",
  "languagesInfo", "multiplayer", "dlc", "dlcs", "timeline", "updates", "music",
  "similarGamesInfo", "studioInfo", "seriesInfo", "faq", "reviews", "guides", "sources",
  "completion", "storage", "requirements", "highlights", "boxContents", "prosCons",
];
const COMMERCIAL = ["options", "variants", "productTypes", "subtypes", "stock", "cost", "price"];

const filled = (value) => {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined && v !== "").length;
  if (typeof value === "object") return Object.values(value).some((v) => v !== null && v !== undefined && v !== "") ? 1 : 0;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (typeof value === "number") return 1;
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
};
const countFilled = (doc, keys) => keys.reduce((sum, k) => sum + (filled(doc?.[k]) > 0 ? 1 : 0), 0);

function roleMap(doc) {
  const out = {};
  for (const [role, fields] of Object.entries(IMAGE_ROLES)) {
    const hit = fields.find((f) => filled(doc?.[f]) > 0);
    out[role] = hit ? String(doc[hit]) : "";
  }
  out.banners = BANNER_FIELDS.reduce((n, f) => n + filled(doc?.[f]), 0);
  out.gallery = GALLERY_FIELDS.reduce((n, f) => n + filled(doc?.[f]), 0);
  return out;
}

/** One comparable number for "how much rich data does this copy carry". */
function richness(doc) {
  if (!doc) return -1;
  const roles = roleMap(doc);
  return (
    countFilled(doc, GAME_DATA) +
    countFilled(doc, DETAIL_SECTIONS) +
    countFilled(doc, COMMERCIAL) +
    Object.values(IMAGE_ROLES).reduce((n, fs) => n + (fs.some((f) => filled(doc?.[f])) ? 1 : 0), 0) +
    (roles.banners > 0 ? 1 : 0) +
    (roles.gallery > 0 ? 1 : 0)
  );
}

/* --------------------------------------------------------------------- main */

say("# Recovery audit — read-only");
say();
say(`Run at ${new Date().toISOString()}. Nothing is mutated by this script.`);
say();

/* --- product_index (the live allowlist) --- */
const indexRows = d1(
  "SELECT id, slug, title, performance_required, updated_at, price, stock FROM product_index ORDER BY id",
);
const indexById = new Map(indexRows.map((r) => [String(r.id), r]));
say(`- \`product_index\` rows: **${indexRows.length}**`);
say(`- flagged \`performance_required\`: **${indexRows.filter((r) => Number(r.performance_required) === 1).length}**`);

/* --- aggregate --- */
const chunkKeys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((r) => String(r.key));
const numbered = chunkKeys
  .filter((k) => /^store:products#\d+$/.test(k))
  .sort((a, b) => Number(a.split("#")[1]) - Number(b.split("#")[1]));
let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  process.stderr.write(`[chunk] ${key}\n`);
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}
let aggregate = [];
try {
  const parsed = JSON.parse(raw || "[]");
  aggregate = Array.isArray(parsed) ? parsed : [];
} catch (err) {
  say(`- **aggregate parse FAILED: ${err.message}**`);
}
const aggById = new Map();
for (const p of aggregate) if (p?.id) aggById.set(String(p.id), p);
say(`- aggregate products: **${aggById.size}**`);

/* --- overlays --- */
const overlayRows = d1("SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'");
const overlayById = new Map();
let tombstones = 0;
for (const row of overlayRows) {
  let doc = null;
  try {
    doc = JSON.parse(row.value);
  } catch {
    continue;
  }
  if (!doc?.id) continue;
  if (doc._deleted === true) {
    tombstones++;
    overlayById.set(String(doc.id), { _deleted: true, _bytes: String(row.value).length });
    continue;
  }
  doc._bytes = String(row.value).length;
  overlayById.set(String(doc.id), doc);
}
say(`- overlays: **${overlayRows.length}** (tombstones **${tombstones}**, live **${overlayById.size - tombstones}**)`);

/* --- live set, exactly as loadStore computes it --- */
const live = new Map();
for (const [id, doc] of aggById) live.set(id, doc);
for (const [id, doc] of overlayById) {
  if (doc._deleted) live.delete(id);
  else live.set(id, doc);
}
say(`- **live products: ${live.size}**`);
say();

/* --- relational rows --- */
const groupCount = (table, column, where = "") => {
  const map = new Map();
  const rows = d1(`SELECT ${column} AS k, COUNT(*) AS n FROM ${table} ${where} GROUP BY ${column}`, {
    allowFail: true,
  });
  for (const r of rows ?? []) map.set(String(r.k), Number(r.n));
  return map;
};
const imagesBy = groupCount("game_images", "game_id");
const variantsBy = groupCount("game_variants", "game_id");
const perfBy = groupCount("game_device_performance", "game_id", "WHERE active = 1");
const perfAllBy = groupCount("game_device_performance", "game_id");
const identityBy = groupCount("product_identity", "product_id");
const recordsBy = groupCount("game_records", "game_id");
const aliasesBy = groupCount("game_aliases", "game_id");

const modeRows = d1(
  `SELECT p.game_id AS k, COUNT(*) AS n FROM game_device_performance_modes m
   JOIN game_device_performance p ON p.id = m.performance_id GROUP BY p.game_id`,
  { allowFail: true },
);
const modesBy = new Map((modeRows ?? []).map((r) => [String(r.k), Number(r.n)]));

const catalogTitles = new Set(
  (d1("SELECT title FROM game_catalog", { allowFail: true }) ?? []).map((r) =>
    String(r.title).trim().toLowerCase(),
  ),
);

/* --- per-product matrix --- */
const rows = [];
for (const [id, doc] of live) {
  const overlay = overlayById.get(id);
  const overlayDoc = overlay && !overlay._deleted ? overlay : null;
  const agg = aggById.get(id) ?? null;
  const rOverlay = richness(overlayDoc);
  const rAgg = richness(agg);
  const rLive = richness(doc);
  const title = String(doc?.title ?? indexById.get(id)?.title ?? "");

  let group = "";
  const rel =
    (imagesBy.get(id) ?? 0) + (variantsBy.get(id) ?? 0) + (perfBy.get(id) ?? 0);
  if (rAgg > rOverlay && overlayDoc) group = "B";
  else if (rLive >= 12) group = "A";
  else if (rel > 0) group = "C";
  else group = "E";

  rows.push({
    id,
    slug: String(doc?.slug ?? indexById.get(id)?.slug ?? ""),
    title: title.slice(0, 34),
    index_exists: indexById.has(id) ? 1 : 0,
    overlay_exists: overlayDoc ? 1 : 0,
    overlay_bytes: overlayDoc?._bytes ?? 0,
    aggregate_exists: agg ? 1 : 0,
    aggregate_bytes: agg ? JSON.stringify(agg).length : 0,
    r_overlay: rOverlay,
    r_aggregate: rAgg,
    r_live: rLive,
    images: imagesBy.get(id) ?? 0,
    variants: variantsBy.get(id) ?? 0,
    perf: perfBy.get(id) ?? 0,
    perf_all: perfAllBy.get(id) ?? 0,
    modes: modesBy.get(id) ?? 0,
    catalog: catalogTitles.has(title.trim().toLowerCase()) ? 1 : 0,
    records: recordsBy.get(id) ?? 0,
    identity: identityBy.get(id) ?? 0,
    aliases: aliasesBy.get(id) ?? 0,
    detail_sections: countFilled(doc, DETAIL_SECTIONS),
    game_data: countFilled(doc, GAME_DATA),
    commercial: countFilled(doc, COMMERCIAL),
    roles: roleMap(doc),
    group,
  });
}

rows.sort((a, b) => a.r_live - b.r_live || a.id.localeCompare(b.id));

say("## Per-product matrix");
say();
say(
  "```\nid                    slug                        idx ovl  ovlB  agg   aggB  rO rA rL img var prf mds cat rec idt det gme com FBC SQC COV 3DT ban gal grp",
);
for (const r of rows) {
  const rl = r.roles;
  say(
    [
      r.id.padEnd(21),
      r.slug.slice(0, 27).padEnd(27),
      String(r.index_exists).padStart(3),
      String(r.overlay_exists).padStart(3),
      String(r.overlay_bytes).padStart(6),
      String(r.aggregate_exists).padStart(3),
      String(r.aggregate_bytes).padStart(6),
      String(r.r_overlay).padStart(3),
      String(r.r_aggregate).padStart(2),
      String(r.r_live).padStart(2),
      String(r.images).padStart(3),
      String(r.variants).padStart(3),
      String(r.perf).padStart(3),
      String(r.modes).padStart(3),
      String(r.catalog).padStart(3),
      String(r.records).padStart(3),
      String(r.identity).padStart(3),
      String(r.detail_sections).padStart(3),
      String(r.game_data).padStart(3),
      String(r.commercial).padStart(3),
      (rl.front_box_cover ? "Y" : "-").padStart(3),
      (rl.square_card ? "Y" : "-").padStart(3),
      (rl.cover_image ? "Y" : "-").padStart(3),
      (rl.texture_3d ? "Y" : "-").padStart(3),
      String(rl.banners).padStart(3),
      String(rl.gallery).padStart(3),
      r.group.padStart(3),
    ].join(" "),
  );
}
say("```");
say();

/* --- classification summary --- */
say("## Classification");
say();
for (const g of ["A", "B", "C", "E"]) {
  const set = rows.filter((r) => r.group === g);
  const label = {
    A: "rich data intact in the live document",
    B: "aggregate richer than the current overlay — recover from D1 itself",
    C: "document thin, relational tables still hold data",
    E: "no copy in current D1 — needs historical snapshot",
  }[g];
  say(`- **Group ${g}** (${label}): **${set.length}**`);
  if (g !== "A" && set.length) {
    for (const r of set.slice(0, 40)) {
      say(`  - \`${r.id}\` ${r.slug.slice(0, 30)} — rO=${r.r_overlay} rA=${r.r_aggregate} rL=${r.r_live} img=${r.images} var=${r.variants} perf=${r.perf}`);
    }
  }
}
say();

/*
  Which sections are filled, across the whole catalogue.

  This is the test that separates "erased" from "never populated". A
  destructive regression hits the products it touched and leaves the rest
  alone, so a lost section shows an uneven fill rate. A section that is empty
  on all 90 products was never written by the import pipeline, and restoring it
  from a snapshot would be restoring something that never existed.
*/
say("## Detail-section fill rate across all live products");
say();
const sectionRate = [];
for (const key of [...DETAIL_SECTIONS, ...GAME_DATA, ...COMMERCIAL]) {
  const n = [...live.values()].filter((doc) => filled(doc?.[key]) > 0).length;
  sectionRate.push({ field: key, filled: n, pct: Math.round((n / live.size) * 100) });
}
sectionRate.sort((a, b) => b.filled - a.filled);
say("```");
say("field                     filled/90   %");
for (const r of sectionRate) {
  say(`${r.field.padEnd(24)} ${String(r.filled).padStart(6)}/${live.size}  ${String(r.pct).padStart(3)}%`);
}
say("```");
say();
const never = sectionRate.filter((r) => r.filled === 0).map((r) => r.field);
const partial = sectionRate.filter((r) => r.filled > 0 && r.filled < live.size);
say(`- Empty on **every** product (never populated, not erased): **${never.length}** — ${never.join(", ") || "none"}`);
say(`- Partially filled (uneven — the only shape a loss can take): **${partial.length}** — ${partial.map((r) => `${r.field} ${r.filled}/${live.size}`).join(", ") || "none"}`);
say();

/* --- performance, the flag the admin shows --- */
/*
  Ground truth, not a probe.

  Twice now a field list of mine has reported data missing that was simply
  stored under another name — `dlcs` vs `dlc`, `metacriticScore` vs
  `metacriticRating`, `performance` vs `devicePerformance`. So before anything
  is called lost, dump every key that actually holds a value on a few products
  and read what is there.
*/
say("## Every non-empty key, on three products");
say();
for (const id of [...live.keys()].slice(0, 3)) {
  const doc = live.get(id);
  say(`### \`${id}\` — ${String(doc?.slug ?? "")}`);
  say();
  const entries = Object.entries(doc)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => ({ k, n: filled(v), size: JSON.stringify(v ?? null).length }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.size - a.size);
  say("```");
  say(entries.map((e) => `${e.k}(${e.n})`).join("  "));
  say("```");
  const emptyKeys = Object.keys(doc).filter((k) => !k.startsWith("_") && filled(doc[k]) === 0);
  say(`- non-empty keys: **${entries.length}** of ${Object.keys(doc).length}`);
  say(`- empty keys: ${emptyKeys.slice(0, 70).join(", ")}`);
  say();
}

say("## Performance");
say();
const perfRows = [];
for (const [id, doc] of live) {
  const dp = Array.isArray(doc?.devicePerformance) ? doc.devicePerformance : [];
  const complete = dp.filter((entry) => {
    const hh = entry?.handheld ?? {};
    const tv = entry?.tv ?? {};
    return Boolean((hh.resolution || hh.outputResolution || hh.fps) || (tv.resolution || tv.outputResolution || tv.fps));
  }).length;
  perfRows.push({
    id,
    slug: String(doc?.slug ?? ""),
    doc_entries: dp.length,
    doc_complete: complete,
    table_active: perfBy.get(id) ?? 0,
    modes: modesBy.get(id) ?? 0,
    switch2: /switch\s*2|switch2/i.test(String(doc?.platform ?? "") + String(doc?.title ?? "")) ? 1 : 0,
  });
}
say(`- Products with a \`devicePerformance\` array in the document: **${perfRows.filter((r) => r.doc_entries > 0).length}**`);
say(`- ...of which at least one entry carries a resolution or FPS: **${perfRows.filter((r) => r.doc_complete > 0).length}**`);
say(`- Products with an active \`game_device_performance\` row: **${perfRows.filter((r) => r.table_active > 0).length}**`);
say(`- Document has entries but the table has none: **${perfRows.filter((r) => r.doc_entries > 0 && r.table_active === 0).length}**`);
say(`- Table has rows but the document has none: **${perfRows.filter((r) => r.table_active > 0 && r.doc_entries === 0).length}**`);
say(`- Neither has anything: **${perfRows.filter((r) => r.table_active === 0 && r.doc_entries === 0).length}**`);
say();
say("Products where neither source has performance data (nothing to recover from):");
say();
for (const r of perfRows.filter((x) => x.table_active === 0 && x.doc_entries === 0).slice(0, 60)) {
  say(`  - \`${r.id}\` ${r.slug.slice(0, 34)}`);
}
say();

/* --- products live in the catalogue but absent from the admin index --- */
say("## Live but absent from `product_index`");
say();
const unindexed = [...live.keys()].filter((id) => !indexById.has(id));
for (const id of unindexed) {
  const doc = live.get(id);
  const overlay = overlayById.get(id);
  say(
    `- \`${id}\` ${String(doc?.slug ?? "").slice(0, 40)} — overlay: ${overlay ? (overlay._deleted ? "TOMBSTONE" : "live") : "none"}, aggregate: yes`,
  );
}
say();
say(`- Total: **${unindexed.length}** — live on the storefront, invisible in the admin list.`);
say();

/* --- oversized documents --- */
const huge = [...live.entries()]
  .map(([id, doc]) => ({ id, slug: String(doc?.slug ?? ""), bytes: JSON.stringify(doc).length }))
  .filter((r) => r.bytes > 200_000);
if (huge.length) {
  say("## Oversized product documents");
  say();
  for (const r of huge) say(`- \`${r.id}\` ${r.slug} — **${(r.bytes / 1024 / 1024).toFixed(2)} MB**`);
  say();
}

say("## Aggregate coverage of missing roles");
say();
const missingRole = (role) => rows.filter((r) => !r.roles[role]).length;
say(`- Live products without a Front Box Cover: **${missingRole("front_box_cover")}**`);
say(`- without a Square Card Image: **${missingRole("square_card")}**`);
say(`- without a Cover Image: **${missingRole("cover_image")}**`);
say(`- without a 3D Texture Source: **${missingRole("texture_3d")}**`);
say(`- with zero banners: **${rows.filter((r) => r.roles.banners === 0).length}**`);
say(`- with zero gallery images: **${rows.filter((r) => r.roles.gallery === 0).length}**`);
say(`- with zero detail sections: **${rows.filter((r) => r.detail_sections === 0).length}**`);
say(`- with no active performance row: **${rows.filter((r) => r.perf === 0).length}** (any revision: ${rows.filter((r) => r.perf_all === 0).length})`);
say();

/* --- time travel --- */
say("## D1 Time Travel");
say();
const tt = wrangler(["d1", "time-travel", "info", DB_NAME, "--config", CONFIG, "--json"], {
  allowFail: true,
});
say("```");
say(redact(tt ?? "time-travel info unavailable").trim().slice(0, 1200));
say("```");
say();
say(`_Queries executed: ${queries}, all read-only._`);

const report = lines.join("\n") + "\n";
writeFileSync("recovery-audit.md", report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
