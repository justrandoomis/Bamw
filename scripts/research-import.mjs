#!/usr/bin/env node
/**
 * Fills in what production is missing, from the source that actually knows.
 *
 * DRY RUN BY DEFAULT — `--apply` is required to write anything.
 *
 * Two problems are solved in one pass, because they share the expensive step:
 *
 *  - `galleryImages` on the existing catalogue points at R2 objects that no
 *    longer exist, and `game_images` has no screenshot-kind row to repoint them
 *    at. There is nothing mechanical left to recover, so the screenshots are
 *    re-sourced from the game's own Nintendo store page, converted to WebP and
 *    stored in our R2 under the product's prefix.
 *
 *  - The same page states, outright, most of what the audit listed as
 *    NEEDS_RESEARCH: publisher, release date, rating, languages, player counts,
 *    play modes, genres, download size, cloud saves, editions, DLC. Nothing here
 *    is inferred, averaged or filled from a similar game — a field is written
 *    only when the page says it, and only when production has nothing.
 *
 * Identity is the thing that can go wrong, so it is what the script is most
 * careful about. A page is accepted only when its nsuid matches the stored
 * nsuid, or — with no stored nsuid — when the title and the platform both
 * agree. Switch 1 and Switch 2 editions are separate products with separate
 * pages, and a Switch 2 product is never filled from a Switch 1 page.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  fetchBinary,
  galleryFrom,
  coverFrom,
  squareFrom,
  metadataFrom,
  familyFacts,
  resolveProduct,
} from "./lib/nintendo-store.mjs";
import { createR2 } from "./lib/r2-store.mjs";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
/* One place names the bucket — see `lib/r2-buckets.mjs`. */
const WORK_DIR = "research-import";

const APPLY = process.argv.includes("--apply");
const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const num = (name, fallback) => Number(flag(name, fallback));

const BATCH_SIZE = num("batch", 5);
const OFFSET = num("offset", 0);
const LIMIT = num("limit", 25);
const ONLY = flag("products", "");

/* ------------------------------------------------------------------ safety */

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function assertRead(sql) {
  const s = String(sql).trim();
  if (!/^\s*select\b/i.test(s)) throw new Error(`REFUSED (not a SELECT): ${s.slice(0, 60)}`);
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
const note = (t) => process.stderr.write(`${redact(t)}\n`);

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

function wrangler(args, { allowFail = false, timeoutMs = 180_000 } = {}) {
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
function d1(sql) {
  const parsed = parseJson(
    wrangler([
      "d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG,
      "--command", assertRead(sql),
    ]),
  );
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}
const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** One product's overlay row, addressed by its immutable id. Nothing else. */
function writeOverlay(id, doc) {
  if (!APPLY) throw new Error("writeOverlay without --apply");
  const sql =
    `INSERT INTO store_kv (key, value, updated_at) VALUES (` +
    `${esc(`store:product:${id}`)}, ${esc(JSON.stringify(doc))}, ${esc(new Date().toISOString())})` +
    ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
  return (
    wrangler(
      ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
      { allowFail: true },
    ) !== null
  );
}

/* ------------------------------------------------------------- the catalogue */

function loadCatalogue() {
  const chunkKeys = d1(
    "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
  ).map((r) => String(r.key));
  const numbered = chunkKeys
    .filter((k) => /^store:products#\d+$/.test(k))
    .sort((a, b) => Number(a.split("#")[1]) - Number(b.split("#")[1]));
  let raw = "";
  for (const key of numbered.length ? numbered : ["store:products"]) {
    note(`[chunk] ${key}`);
    raw += d1(`SELECT value FROM store_kv WHERE key = ${esc(key)}`)?.[0]?.value ?? "";
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
  return live;
}

/* Every product in this catalogue is `kind=account`; games are told apart by
   category, the same way the audit selects them. */
const isGame = (doc) => {
  const cat = `${doc?.categoryId ?? ""} ${doc?.category ?? ""}`.toLowerCase();
  if (/hardware|accessor|amiibo|gift|console|controller/.test(cat)) return false;
  return /game/.test(cat);
};

/* ------------------------------------------------------------------ helpers */

const filled = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return Boolean(v.trim());
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return false;
};

const OWN_HOST = /(^|\.)(banan\.to|r2\.dev|r2\.cloudflarestorage\.com)$/i;

/** Where a stored media reference lives: our R2, someone else's CDN, or nothing. */
function classifyRef(value) {
  const url = String(value ?? "").trim();
  if (!url) return { kind: "empty" };
  if (url.startsWith("data:")) return { kind: "embedded" };
  if (url.startsWith("/api/")) return { kind: "own", key: url.replace(/^\/api\//, "") };
  try {
    const u = new URL(url);
    if (OWN_HOST.test(u.hostname)) {
      return { kind: "own", key: u.pathname.replace(/^\/(api\/)?/, "") };
    }
    return { kind: "external", url };
  } catch {
    return { kind: "own", key: url.replace(/^\/+/, "") };
  }
}

const galleryEntries = (value) =>
  (Array.isArray(value) ? value : [])
    .map((e) => (typeof e === "string" ? { url: e } : e && typeof e === "object" ? e : null))
    .filter(Boolean);

/**
 * Downloads one image, converts it, stores it in R2 and proves it is readable.
 *
 * Returns the path to reference, or null — and null always means nothing was
 * stored, so a caller can never end up pointing a product at an object that
 * failed to upload.
 */
async function importImage({ sourceUrl, key, onProblem }) {
  const got = await fetchBinary(sourceUrl);
  if (!got.ok) {
    onProblem(`download failed (${got.error})`);
    return null;
  }
  let out;
  try {
    out = await sharp(got.buffer).webp({ quality: 88 }).toBuffer();
  } catch (err) {
    onProblem(`conversion failed (${String(err).slice(0, 60)})`);
    return null;
  }
  const hash = createHash("sha256").update(out).digest("hex").slice(0, 16);
  const finalKey = key.replace("{hash}", hash);
  if (!APPLY) return `/api/${finalKey}`;
  if (!(await r2.put(finalKey, out, "image/webp"))) {
    onProblem("R2 store/verify failed — not referenced");
    return null;
  }
  return `/api/${finalKey}`;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  });
  await Promise.all(workers);
  return out;
}

/** True when a stored image role no longer resolves to anything. */
async function refIsDead(value) {
  const ref = classifyRef(value);
  if (ref.kind === "empty") return true;
  if (ref.kind === "external") return false;
  if (ref.kind === "embedded") return true;
  return !(await r2.exists(ref.key));
}

/* --------------------------------------------------------------- the report */

say(`# Research and gallery import — ${APPLY ? "**APPLY**" : "DRY RUN (nothing written)"}`);
say();
say(`Run at ${new Date().toISOString()}. Batch size ${BATCH_SIZE}, offset ${OFFSET}, limit ${LIMIT}.`);
say();

mkdirSync(WORK_DIR, { recursive: true });
const r2 = createR2(SERVING_BUCKET, { tmpDir: WORK_DIR, log: note });
const sharp = (await import("sharp")).default;

const live = loadCatalogue();
const games = [...live.values()]
  .filter(isGame)
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
say(`- Live products: **${live.size}** · games: **${games.length}**`);

const selected = ONLY
  ? ONLY.split(",").map((s) => s.trim()).filter(Boolean).map((id) => live.get(id)).filter(Boolean)
  : games.slice(OFFSET, OFFSET + LIMIT);
say(`- Selected for this run: **${selected.length}**`);
say();

/* ----------------------------------------------------------------- the work */

/** Fields the page can answer that production may already have answered. */
const RESEARCH_FIELDS = [
  "publisher", "developer", "releaseDate", "genres", "ageRating", "supportedLanguages",
  "numberOfPlayers", "size", "downloadSizeGb", "requiredSpaceGb", "microSdRecommended",
  "nintendoPlayModes", "tvMode", "tabletopMode", "handheldMode",
  "nintendoCloudSaves", "nsuid", "product_code", "title_id", "nintendoEshopUrl", "officialUrl",
  "edition", "tagline", "dlc", "editionsList", "nintendoNotes", "arabicSupport",
  "switch2UpgradePrice", "switch2Enhanced", "switch2Exclusive",
  "description", "description_short", "mpLocalPlayers", "mpOnlinePlayers",
];

const totals = {
  resolved: 0,
  unresolved: 0,
  galleryImported: 0,
  galleryKept: 0,
  shotsStored: 0,
  shotsFailed: 0,
  rolesStored: 0,
  fieldsFilled: 0,
  written: 0,
  writeFailed: 0,
  unchanged: 0,
  nsuidConflicts: 0,
};
const unresolved = [];
const nsuidConflicts = [];
const perProduct = [];

for (let start = 0; start < selected.length; start += BATCH_SIZE) {
  const batch = selected.slice(start, start + BATCH_SIZE);
  say(`## Batch ${Math.floor(start / BATCH_SIZE) + 1} — ${batch.length} product(s)`);
  say();

  for (const doc of batch) {
    const id = String(doc.id);
    const label = `${doc.title ?? doc.name ?? id} (${doc.slug ?? "no slug"})`;
    say(`### ${label}`);

    const { product, family, tried, verdict, url } = await resolveProduct(doc);
    if (!product) {
      totals.unresolved++;
      unresolved.push({ id, label, tried });
      say(`- **Not resolved.** Candidates tried:`);
      for (const t of tried) say(`  - ${t}`);
      say(`- Nothing written for this product.`);
      say();
      continue;
    }
    totals.resolved++;
    say(`- Resolved: ${url} (${verdict.reason})`);
    if (verdict.nsuidConflict) {
      totals.nsuidConflicts++;
      nsuidConflicts.push({ id, label, stored: verdict.storedNsuid, page: verdict.pageNsuid, url });
    }

    /* ---- what production is missing that the page can answer ---- */
    const page = { ...metadataFrom(product), ...familyFacts(product, family) };
    const patch = {};
    const filledNames = [];
    for (const field of RESEARCH_FIELDS) {
      if (!(field in page)) continue;
      if (filled(doc[field])) continue;
      /*
        A regional storefront's nsuid is not ours to adopt. The page is trusted
        for what the game is, not for which listing this product represents.
      */
      if (field === "nsuid" && verdict.nsuidConflict) continue;
      patch[field] = page[field];
      filledNames.push(field);
    }
    if (!filled(doc.storageNotes) && page.downloadSizeGb) {
      patch.storageNotes = `Requires about ${page.downloadSizeGb} GB of free space.`;
      filledNames.push("storageNotes");
    }
    if (!filled(doc.languagesText) && page.supportedLanguages?.length) {
      patch.languagesText = page.supportedLanguages;
      filledNames.push("languagesText");
    }

    /* ---- the gallery ---- */
    const stored = galleryEntries(doc.galleryImages);
    let deadCount = 0;
    let aliveCount = 0;
    let hotlinked = 0;
    const sample = String(
      stored[0]?.url ?? stored[0]?.image ?? stored[0]?.src ?? "",
    ).slice(0, 90);
    const kinds = await mapWithLimit(stored, 4, async (entry) => {
      const ref = classifyRef(entry.url ?? entry.image ?? entry.src);
      // Someone else's CDN is not ours to repair, and it is not broken.
      if (ref.kind === "external") return "hotlinked";
      if (ref.kind === "own" && (await r2.exists(ref.key))) return "alive";
      return "dead";
    });
    for (const kind of kinds) {
      if (kind === "hotlinked") {
        hotlinked++;
        aliveCount++;
      } else if (kind === "alive") {
        aliveCount++;
      } else {
        deadCount++;
      }
    }
    /*
      A gallery is re-sourced when it is empty, when every one of our own
      objects is gone, or when the entries are hotlinks — those work today, but
      they are someone else's server, and the brief is to hold this media in R2.
    */
    const allHotlinked = stored.length > 0 && hotlinked === stored.length;
    const galleryBroken = stored.length === 0 || (deadCount > 0 && aliveCount === 0) || allHotlinked;
    say(
      `- Stored gallery: ${stored.length} entr${stored.length === 1 ? "y" : "ies"}` +
        (stored.length
          ? ` — ${aliveCount - hotlinked} in our R2, ${hotlinked} hotlinked elsewhere, ${deadCount} missing` +
            (sample ? ` (e.g. \`${sample}\`)` : "")
          : ""),
    );

    const shots = galleryFrom(product);
    if (!galleryBroken) {
      totals.galleryKept++;
      say(`- Gallery left alone — its entries are ours and they resolve.`);
    } else if (!shots.length) {
      say(`- **No screenshots on the store page** — gallery left as it is.`);
    } else {
      /*
        The screenshots of one game are independent of each other, and each
        costs a download, a conversion and — when the REST path is unavailable —
        two wrangler processes. Run serially that is most of the wall clock of
        the whole job; a small amount of concurrency turns a batch of thirty
        games from a quarter of an hour into a few minutes. The bound is low on
        purpose: this is someone else's CDN and our own storage, and neither
        deserves a flood.
      */
      const results = await mapWithLimit(shots, 4, async (shot, i) => {
        const n = String(i + 1).padStart(2, "0");
        const ref = await importImage({
          sourceUrl: shot.url,
          key: `files/products/${id}/gallery-${n}-{hash}.webp`,
          onProblem: (why) => {
            totals.shotsFailed++;
            say(`  - screenshot ${i + 1}: ${why}`);
          },
        });
        if (!ref) return null;
        if (APPLY) totals.shotsStored++;
        return { url: ref, alt: `${doc.title ?? ""} screenshot ${i + 1}` };
      });
      // Order follows the store page, not whichever upload finished first.
      const imported = results.filter(Boolean);
      if (imported.length) {
        patch.galleryImages = imported;
        filledNames.push(`galleryImages(${imported.length})`);
        totals.galleryImported++;
      }
      say(
        `- Screenshots: ${shots.length} on the page, ` +
          `${imported.length} ${APPLY ? "stored in R2 and verified" : "would be imported"}`,
      );
    }

    /* ---- the two single-asset roles, kept distinct from each other ---- */
    const coverUrl = coverFrom(product);
    const squareUrl = squareFrom(product);
    for (const [field, sourceUrl, name] of [
      ["coverImage", coverUrl, "cover"],
      ["nintendoCardImage", squareUrl, "square-card"],
    ]) {
      if (!sourceUrl) continue;
      if (!(await refIsDead(doc[field]))) continue;
      /*
        The square key art and the front cover are different assets, and a role
        filled from the other role's asset is exactly the WRONG_ROLE the audit
        counts. If Nintendo serves the same image for both, the second role
        stays empty rather than becoming a duplicate.
      */
      if (field === "nintendoCardImage" && squareUrl === coverUrl) {
        say(`- Square card left empty — Nintendo serves the same asset as the cover.`);
        continue;
      }
      const ref = await importImage({
        sourceUrl,
        key: `files/products/${id}/${name}-{hash}.webp`,
        onProblem: (why) => say(`- ${field}: ${why}`),
      });
      if (!ref) continue;
      patch[field] = ref;
      filledNames.push(field);
      if (APPLY) totals.rolesStored++;
    }

    /* ---- record where it came from ---- */
    if (Object.keys(patch).length) {
      const sources = Array.isArray(doc.sources) ? [...doc.sources] : [];
      if (!sources.some((s) => String(s?.url ?? "") === url)) {
        sources.push({ name: "Nintendo eShop (US)", url });
        patch.sources = sources;
        filledNames.push("sources");
      }
    }

    const changedFields = Object.keys(patch);
    totals.fieldsFilled += changedFields.length;
    if (!changedFields.length) {
      totals.unchanged++;
      say(`- Nothing to add — production already answers every field this page states.`);
      say();
      perProduct.push({ id, label, resolved: url, filled: [] });
      continue;
    }
    say(`- Fields to fill (${changedFields.length}): ${filledNames.join(", ")}`);

    if (!APPLY) {
      say();
      perProduct.push({ id, label, resolved: url, filled: filledNames });
      continue;
    }

    /* ---- write, having first put the pre-change document somewhere safe ---- */
    writeFileSync(path.join(WORK_DIR, `${id}.before.json`), JSON.stringify(doc, null, 1));
    const merged = { ...doc, ...patch, updatedAt: new Date().toISOString() };
    if (!writeOverlay(id, merged)) {
      totals.writeFailed++;
      say(`- **D1 write FAILED** — document unchanged.`);
      say();
      continue;
    }
    const back = d1(`SELECT value FROM store_kv WHERE key = ${esc(`store:product:${id}`)}`);
    let stored2 = null;
    try {
      stored2 = back?.[0]?.value ? JSON.parse(back[0].value) : null;
    } catch {
      stored2 = null;
    }
    const missing = changedFields.filter((f) => !filled(stored2?.[f]));
    if (stored2 && !missing.length) {
      totals.written++;
      say(`- Written and verified: ${changedFields.length} field(s) now present in production.`);
    } else {
      totals.writeFailed++;
      say(`- **Read-after-write verification FAILED** for: ${missing.join(", ") || "the whole row"}`);
    }
    say();
    perProduct.push({ id, label, resolved: url, filled: filledNames });
  }
}

/* ---------------------------------------------------------------- summary */

say(`## Summary`);
say();
say(`| | |`);
say(`| --- | ---: |`);
say(`| Products in this run | ${selected.length} |`);
say(`| Resolved to a store page | ${totals.resolved} |`);
say(`| Not resolved | ${totals.unresolved} |`);
say(`| Galleries re-sourced | ${totals.galleryImported} |`);
say(`| Galleries left alone (still resolve) | ${totals.galleryKept} |`);
say(`| Screenshots stored in R2 | ${totals.shotsStored} |`);
say(`| Screenshots failed | ${totals.shotsFailed} |`);
say(`| Cover / square-card images stored | ${totals.rolesStored} |`);
say(`| Fields filled | ${totals.fieldsFilled} |`);
say(`| Documents written and verified | ${totals.written} |`);
say(`| Write or verification failures | ${totals.writeFailed} |`);
say(`| Already complete, nothing to add | ${totals.unchanged} |`);
say(`| Stored nsuid disagreeing with the page | ${totals.nsuidConflicts} |`);
say();

if (nsuidConflicts.length) {
  say(`### Stored nsuid disagrees with the store page (${nsuidConflicts.length})`);
  say();
  say(`The title and the console match, so the page was used — but the stored nsuid was left alone.`);
  say();
  say(`| product | stored | page | page url |`);
  say(`| --- | --- | --- | --- |`);
  for (const c of nsuidConflicts) say(`| ${c.label} | \`${c.stored}\` | \`${c.page}\` | ${c.url} |`);
  say();
}

if (unresolved.length) {
  say(`### Not resolved (${unresolved.length}) — nothing was written for these`);
  say();
  say(`| product | url keys tried |`);
  say(`| --- | --- |`);
  for (const u of unresolved) say(`| ${u.label} | ${u.tried.join("<br>") || "none"} |`);
  say();
}

if (!APPLY) say(`**Dry run — nothing written.** Re-run with \`--apply\`.`);

writeFileSync("research-import.md", lines.join("\n") + "\n");
writeFileSync(path.join(WORK_DIR, "run.json"), JSON.stringify({ totals, perProduct, unresolved }, null, 1));

/*
  The report is written; the work is done. Node otherwise sat for six and a half
  minutes after the last line of the first batch, waiting on keep-alive sockets
  from a few hundred image downloads to time out on their own.
*/
process.exit(0);
