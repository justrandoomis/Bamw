#!/usr/bin/env node
/**
 * Report A (existing production games) and Report B (attached import templates).
 *
 * READ-ONLY. Writes nothing to D1 or R2.
 *
 * Field names come from `src/lib/gameImportSchema.ts` — the mapping the import
 * pipeline itself uses, template key to persisted target. Every earlier pass of
 * this investigation reported data missing that was simply stored under a name
 * from `types.ts` rather than the one the pipeline writes: `performance` for
 * `devicePerformance`, `story` for `storyChapters`, `music` for `soundtrack`,
 * `updates` for `patchNotes`. Nothing is classified against a guessed name.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
const PRIVATE_BUCKET = SERVING_BUCKET;
const TEMPLATE_DIR = "import-sources/nintendo-2026-08";
const SCHEMA_FILE = "src/lib/gameImportSchema.ts";

const num = (name, fallback) =>
  Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1]);
const PROBE_BUDGET = num("probes", 300);

/* ------------------------------------------------------------------ safety */

const READ_SHAPE = /^\s*select\b/i;
const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
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
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

function wrangler(args, { allowFail = false, timeoutMs = 120_000 } = {}) {
  try {
    return execFileSync(WRANGLER, args, {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: ENV,
    });
  } catch (err) {
    if (allowFail) return null;
    throw new Error(redact(err?.stderr || err?.message || String(err)).slice(0, 800));
  }
}
const parseJson = (raw) => {
  if (raw == null) return null;
  const i = raw.search(/[[{]/);
  if (i < 0) return null;
  try {
    return JSON.parse(raw.slice(i));
  } catch {
    return null;
  }
};
let queries = 0;
function d1(sql, { allowFail = false } = {}) {
  const s = assertReadOnly(sql);
  queries++;
  process.stderr.write(`[q${queries}] ${s.slice(0, 55).replace(/\s+/g, " ")}\n`);
  const parsed = parseJson(
    wrangler(["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", s], {
      allowFail,
    }),
  );
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/* ------------------------------------------- the pipeline's own field names */

function canonicalTargets() {
  const src = readFileSync(SCHEMA_FILE, "utf8");
  const targets = new Set();
  for (const m of src.matchAll(/target:\s*"([^"]+)"/g)) targets.add(m[1]);
  if (targets.size < 150) {
    throw new Error(`only ${targets.size} targets parsed from ${SCHEMA_FILE} — mapping changed shape`);
  }
  return targets;
}
const TARGETS = canonicalTargets();
const has = (f) => TARGETS.has(f);

/** Field groups, every name checked against the schema so a typo cannot pass. */
const GROUPS = {
  identity: ["title", "titleAr", "slug", "platform", "edition", "region", "category", "kind"],
  basic: [
    "developer", "publisher", "releaseDate", "genres", "ageRating", "numberOfPlayers",
    "supportedLanguages", "languagesAudio", "languagesText", "size", "downloadSizeGb", "youtubeTrailer",
  ],
  pricing: ["price", "cost", "stock", "isInfiniteStock", "options", "types"],
  media: ["cartridgeImage", "nintendoCardImage", "coverImage", "coverHiResImage", "bannerImages", "galleryImages"],
  nintendo: [
    "nintendoNotes", "nintendoPlayModes", "nintendoCloudSaves", "nintendoOnlineRequired",
    "nintendoGameKeyCard", "tvMode", "tabletopMode", "handheldMode",
  ],
  switch2: ["switch2Enhanced", "switch2Exclusive", "switch2UpgradePrice", "switch2Features"],
  performance: ["devicePerformance", "perfResolutionHandheld", "perfResolutionDocked", "perfFps"],
  detail: [
    "tagline", "fitFor", "notFitFor", "gameplayPillars", "worldSummary", "storyChapters",
    "editionsList", "dlc", "guides", "faq", "verdictScore", "verdictPros", "verdictCons",
    "reviews", "timeline", "patchNotes", "soundtrack", "seriesName", "seriesEntries",
    "studioName", "sources", "features", "completionMain", "playTimeMain",
    "mpLocalPlayers", "mpOnlinePlayers", "mpCoop", "storageNotes",
  ],
};
for (const [group, fields] of Object.entries(GROUPS)) {
  const unknown = fields.filter((f) => !has(f));
  if (unknown.length) throw new Error(`group ${group} names fields the schema does not define: ${unknown.join(", ")}`);
}

/* ------------------------------------------------------------------ helpers */

const filled = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "string") return v.trim() ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? 1 : 0;
  /*
    `false` is an answer, not a gap. Counting it as missing put
    nintendoGameKeyCard on 84 of 89 games and nintendoOnlineRequired on 62 into
    the research list, when for most titles the stored `false` is already
    correct and researching it would confirm what is there.
  */
  if (typeof v === "boolean") return 1;
  if (Array.isArray(v)) return v.filter((x) => filled(x) > 0).length;
  if (typeof v === "object") return Object.values(v).some((x) => filled(x) > 0) ? 1 : 0;
  return 0;
};

const OWN_HOSTS = /(^|\.)(banan\.to|r2\.dev|r2\.cloudflarestorage\.com)$/i;
function classifyUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "empty";
  if (raw.startsWith("data:")) return "external";
  if (!/^https?:\/\//i.test(raw)) return "r2";
  try {
    return OWN_HOSTS.test(new URL(raw).hostname) ? "r2" : "external";
  } catch {
    return "external";
  }
}
function assetKey(url) {
  let p = String(url ?? "");
  try {
    if (p.startsWith("http")) p = new URL(p).pathname;
  } catch {
    /* not a URL */
  }
  p = p.replace(/^\/+/, "").replace(/^api\//, "");
  const i = p.indexOf("files/");
  return i > 0 ? p.slice(i) : p;
}
const probeCache = new Map();
let probes = 0;
function r2Has(url) {
  const key = assetKey(url);
  if (!key) return false;
  if (probeCache.has(key)) return probeCache.get(key);
  if (probes >= PROBE_BUDGET) return null; // unknown, budget spent
  probes++;
  const got = wrangler(["r2", "object", "get", `${PRIVATE_BUCKET}/${key}`, "--remote", "--pipe"], {
    allowFail: true,
    timeoutMs: 8_000,
  });
  const found = Boolean(got && got.length > 0);
  probeCache.set(key, found);
  return found;
}

const normalizeTitle = (t) =>
  String(t ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bnintendo switch 2 edition\b/g, "switch2edition")
    .replace(/\s+/g, " ")
    .trim();
const normalizePlatform = (p) => {
  const s = String(p ?? "").toLowerCase();
  if (/switch\s*2|switch2/.test(s)) return "switch2";
  if (/switch/.test(s)) return "switch1";
  return s || "unknown";
};

/* --------------------------------------------------------- load production */

say("# Catalogue audit — dry run, nothing is written");
say();
say(`Run at ${new Date().toISOString()}.`);
say(`Canonical fields parsed from \`${SCHEMA_FILE}\`: **${TARGETS.size}**.`);
say();

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
const live = new Map();
for (const p of JSON.parse(raw || "[]")) if (p?.id) live.set(String(p.id), p);
for (const row of d1("SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'")) {
  let doc = null;
  try {
    doc = JSON.parse(row.value);
  } catch {
    continue;
  }
  if (!doc?.id) continue;
  if (doc._deleted === true) live.delete(String(doc.id));
  else live.set(String(doc.id), doc);
}
const indexRows = d1("SELECT id, slug, title FROM product_index");
const indexed = new Set(indexRows.map((r) => String(r.id)));

const perfBy = new Map();
for (const r of d1("SELECT game_id, COUNT(*) AS n FROM game_device_performance WHERE active = 1 GROUP BY game_id"))
  perfBy.set(String(r.game_id), Number(r.n));
const aliasBy = new Map();
for (const r of d1("SELECT game_id, alias, normalized FROM game_aliases", { allowFail: true }) ?? []) {
  aliasBy.set(String(r.normalized ?? r.alias).toLowerCase(), String(r.game_id));
}

/*
  What a game actually looks like in this catalogue.

  The first attempt filtered on `kind === "game"` and matched nothing: every
  product carries `kind=account`, because what is sold is a game account, and
  the templates say the same. The distribution is printed before the filter is
  applied so a filter that selects nothing is visible as such rather than
  reported as an empty audit.
*/
const tally = (get) => {
  const counts = new Map();
  for (const [, doc] of live) {
    const k = String(get(doc) ?? "").trim() || "(empty)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
say(`- Live products: **${live.size}**`);
say(`- \`kind\` values: ${tally((d) => d.kind).map(([k, n]) => `\`${k}\` ${n}`).join(", ")}`);
say(`- \`category\` values: ${tally((d) => d.category ?? d.categoryId).map(([k, n]) => `\`${k}\` ${n}`).join(", ")}`);

/** A game is decided by its category; hardware, amiibo and gift cards are not. */
const isGame = (doc) => {
  const cat = `${doc?.categoryId ?? ""} ${doc?.category ?? ""}`.toLowerCase();
  if (/hardware|accessor|amiibo|gift|console|controller/.test(cat)) return false;
  return /game/.test(cat);
};
const games = [...live.entries()].filter(([, doc]) => isGame(doc));
say(`- **Nintendo games selected for Report A: ${games.length}**`);
if (!games.length) say("- **the category filter matched nothing — see the distribution above**");
say();

/* ------------------------------------------------------------------ Report A */

/*
  A factory, not a shared object. `{ ...TOTALS }` seeded every product's tally
  with the running totals, so each one started from the sum of all the products
  before it: the verdict counts grew exponentially (COMPLETE reached 3.8e+28)
  and every per-product score and broken-reference flag was computed from
  another product's numbers.
*/
const emptyTally = () => ({
  COMPLETE: 0,
  INCOMPLETE: 0,
  BROKEN_REFERENCE: 0,
  WRONG_ROLE: 0,
  NEEDS_RESEARCH: 0,
  NOT_APPLICABLE: 0,
});
const TOTALS = emptyTally();
const rows = [];

for (const [id, doc] of games) {
  const platform = normalizePlatform(doc.platform ?? doc.compatibility);
  const perField = {};
  const tally = emptyTally();

  const applicable = (group, field) => {
    if (group === "switch2" && platform !== "switch2") return false;
    return true;
  };

  // Media roles are compared against each other so a reused asset is visible.
  const roleValues = {};
  for (const f of ["cartridgeImage", "nintendoCardImage", "coverImage", "coverHiResImage"]) {
    const v = doc[f];
    if (filled(v)) roleValues[f] = assetKey(v);
  }
  const duplicateRole = new Set();
  const seen = new Map();
  for (const [f, k] of Object.entries(roleValues)) {
    if (seen.has(k)) {
      duplicateRole.add(f);
      duplicateRole.add(seen.get(k));
    } else seen.set(k, f);
  }

  for (const [group, fields] of Object.entries(GROUPS)) {
    for (const field of fields) {
      if (!applicable(group, field)) {
        perField[field] = "NOT_APPLICABLE";
        tally.NOT_APPLICABLE++;
        continue;
      }
      const value = doc[field];
      const n = filled(value);
      let verdict;
      if (group === "media") {
        if (!n) verdict = field === "coverHiResImage" ? "NOT_APPLICABLE" : "NEEDS_RESEARCH";
        else if (duplicateRole.has(field)) verdict = "WRONG_ROLE";
        else {
          const urls = Array.isArray(value) ? value : [value];
          const ours = urls.filter((u) => classifyUrl(u) === "r2");
          const dead = ours.filter((u) => r2Has(u) === false);
          verdict = dead.length ? "BROKEN_REFERENCE" : "COMPLETE";
        }
      } else if (group === "performance" && field === "devicePerformance") {
        if (!n) verdict = "NEEDS_RESEARCH";
        else {
          const entries = Array.isArray(value) ? value : [];
          const good = entries.filter((e) => {
            const hh = e?.handheld ?? {};
            const tv = e?.tv ?? {};
            return filled(hh.resolution ?? hh.outputResolution) || filled(hh.fps) || filled(tv.resolution) || filled(tv.fps);
          });
          verdict = good.length ? "COMPLETE" : "INCOMPLETE";
        }
      } else {
        verdict = n ? "COMPLETE" : "NEEDS_RESEARCH";
      }
      perField[field] = verdict;
      tally[verdict]++;
    }
  }

  const scoreable = tally.COMPLETE + tally.INCOMPLETE + tally.BROKEN_REFERENCE + tally.WRONG_ROLE + tally.NEEDS_RESEARCH;
  const score = scoreable ? Math.round((tally.COMPLETE / scoreable) * 100) : 0;
  const gaps = Object.entries(perField)
    .filter(([, v]) => v !== "COMPLETE" && v !== "NOT_APPLICABLE")
    .map(([f, v]) => `${f}:${v === "NEEDS_RESEARCH" ? "R" : v === "BROKEN_REFERENCE" ? "B" : v === "WRONG_ROLE" ? "W" : "I"}`);

  for (const k of Object.keys(TOTALS)) TOTALS[k] += tally[k];
  rows.push({
    id,
    slug: String(doc.slug ?? ""),
    title: String(doc.title ?? ""),
    platform,
    score,
    indexed: indexed.has(id),
    hidden: doc.isHidden === true,
    perfTable: perfBy.get(id) ?? 0,
    perfDoc: filled(doc.devicePerformance),
    tally,
    gaps,
  });
}

rows.sort((a, b) => a.score - b.score);

say("## REPORT A — existing production Nintendo games");
say();
say("```");
say("score  platform  idx hid perfDoc perfTbl  id                     slug");
for (const r of rows) {
  say(
    `${String(r.score).padStart(4)}%  ${r.platform.padEnd(8)}  ${r.indexed ? " Y" : " N"}  ${r.hidden ? "Y" : "-"}  ${String(r.perfDoc).padStart(6)} ${String(r.perfTable).padStart(6)}   ${r.id.padEnd(21)} ${r.slug.slice(0, 38)}`,
  );
}
say("```");
say();
say("### Gaps per product (R = needs research, B = broken reference, W = wrong role, I = incomplete)");
say();
for (const r of rows) {
  say(`- \`${r.id}\` **${r.title.slice(0, 44)}** (${r.score}%) — ${r.gaps.join(" ") || "no gaps"}`);
}
say();
say("### Totals");
say();
say(`- Total existing Nintendo games: **${rows.length}**`);
say(`- Fully complete (100%): **${rows.filter((r) => r.score === 100).length}**`);
say(`- Incomplete: **${rows.filter((r) => r.score < 100).length}**`);
say(`- With at least one broken image reference: **${rows.filter((r) => r.tally.BROKEN_REFERENCE > 0).length}**`);
say(`- With an image role reused from another role: **${rows.filter((r) => r.tally.WRONG_ROLE > 0).length}**`);
say(`- Missing a Front Box Cover: **${rows.filter((r) => r.gaps.includes("cartridgeImage:R")).length}** (present but reused from another role: ${rows.filter((r) => r.gaps.includes("cartridgeImage:W")).length})`);
say(`- Missing a Square Card Image: **${rows.filter((r) => r.gaps.includes("nintendoCardImage:R")).length}** (present but reused from another role: ${rows.filter((r) => r.gaps.includes("nintendoCardImage:W")).length})`);
say(`- Missing a Cover Image: **${rows.filter((r) => r.gaps.includes("coverImage:R")).length}** (present but reused from another role: ${rows.filter((r) => r.gaps.includes("coverImage:W")).length})`);
say(`- No performance in the document: **${rows.filter((r) => r.perfDoc === 0).length}**`);
say(`- Performance in the document but not in the relational table: **${rows.filter((r) => r.perfDoc > 0 && r.perfTable === 0).length}**`);
say(`- Live but absent from \`product_index\`: **${rows.filter((r) => !r.indexed).length}** — ${rows.filter((r) => !r.indexed).map((r) => r.slug).join(", ") || "none"}`);
say(`- Hidden: **${rows.filter((r) => r.hidden).length}**`);
say();
say(`Field verdicts across all games: ${Object.entries(TOTALS).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
say(`R2 probes used: ${probes}/${PROBE_BUDGET}${probes >= PROBE_BUDGET ? " — **budget spent, some media unverified**" : ""}`);
say();

/* ------------------------------------------------------------------ Report B */

say("## REPORT B — attached import templates");
say();

const bySlug = new Map();
const byTitlePlatform = new Map();
for (const [id, doc] of live) {
  if (doc.slug) bySlug.set(String(doc.slug).toLowerCase(), id);
  byTitlePlatform.set(`${normalizeTitle(doc.title)}|${normalizePlatform(doc.platform)}`, id);
}

const files = existsSync(TEMPLATE_DIR) ? readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".txt")).sort() : [];
const parseTemplate = (text) => {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*=\s*(.*)$/);
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
  }
  return out;
};

const bRows = [];
for (const file of files) {
  const t = parseTemplate(readFileSync(path.join(TEMPLATE_DIR, file), "utf8"));
  const title = t.title || t.name || "";
  const platform = normalizePlatform(t.platform);
  const slug = (t.slug || "").toLowerCase();
  const nt = normalizeTitle(title);

  let matchId = "";
  let how = "";
  if (slug && bySlug.has(slug)) {
    matchId = bySlug.get(slug);
    how = "slug";
  } else if (byTitlePlatform.has(`${nt}|${platform}`)) {
    matchId = byTitlePlatform.get(`${nt}|${platform}`);
    how = "title+platform";
  } else if (aliasBy.has(nt) && live.has(aliasBy.get(nt))) {
    /*
      `game_aliases.game_id` points into the game-records tables, not the
      catalogue, and those ids (`gme_…`) frequently name nothing live —
      game_records is empty in production. An alias only counts as a match when
      it resolves to a product that actually exists, or the template gets
      reported as an update to a product that is not there.
    */
    matchId = aliasBy.get(nt);
    how = "alias";
  }

  // Same title on the other platform is a genuinely separate edition, never a match.
  const other = platform === "switch2" ? "switch1" : "switch2";
  const crossPlatform = !matchId && byTitlePlatform.has(`${nt}|${other}`);

  const action = matchId
    ? "UPDATE_EXISTING"
    : crossPlatform
      ? "MANUAL_REVIEW"
      : "CREATE_NEW";
  bRows.push({ file, title, platform, slug, matchId, how, action, crossPlatform });
}

say("```");
say("action           how              platform  file");
for (const r of bRows) {
  say(`${r.action.padEnd(16)} ${(r.how || "-").padEnd(16)} ${r.platform.padEnd(9)} ${r.file}`);
}
say("```");
say();
for (const r of bRows.filter((x) => x.action !== "CREATE_NEW")) {
  say(`- **${r.action}** \`${r.file}\` → ${r.matchId ? `\`${r.matchId}\` via ${r.how}` : `same title on ${r.platform === "switch2" ? "switch1" : "switch2"} — separate edition, needs a human`}`);
}
say();
say("### Totals");
say();
say(`- Total TXT files: **${bRows.length}**`);
say(`- Unique canonical slugs: **${new Set(bRows.map((r) => r.slug)).size}**`);
say(`- Matched to an existing product (UPDATE_EXISTING): **${bRows.filter((r) => r.action === "UPDATE_EXISTING").length}**`);
say(`- Genuinely new (CREATE_NEW): **${bRows.filter((r) => r.action === "CREATE_NEW").length}**`);
say(`- Manual review (same title, other platform): **${bRows.filter((r) => r.action === "MANUAL_REVIEW").length}**`);
const dupSlugs = [...new Set(bRows.map((r) => r.slug).filter((s, i, a) => a.indexOf(s) !== i))];
say(`- Duplicate slugs inside the ZIP: **${dupSlugs.length}** ${dupSlugs.join(", ")}`);
say(`- Switch 1 / Switch 2 split: ${bRows.filter((r) => r.platform === "switch1").length} / ${bRows.filter((r) => r.platform === "switch2").length}`);
say();
say(`_Queries: ${queries}, all read-only. Nothing was written._`);

writeFileSync("catalogue-audit.md", lines.join("\n") + "\n");
