#!/usr/bin/env node
/**
 * Fills the Chinese supplier name for every game in the catalogue.
 *
 * ## Where the name comes from
 *
 * Two sources, in this order, and nothing else. A machine translation is not a
 * source: a name nobody can trace back is worse than a blank, because a blank
 * shows up in the admin report as work to do while a wrong name gets an order
 * placed for the wrong game.
 *
 * 1. **Nintendo Hong Kong**, the storefront the game is actually sold from,
 *    matched on the English title the way the language audit matches it.
 * 2. **Wikidata**, for everything the first cannot reach — which is nearly all
 *    of it. Hong Kong writes its Chinese-named games in Chinese on every field
 *    and our catalogue is titled in English, so the first run against
 *    production matched 0 of 143 games. Wikidata is reachable from an English
 *    title by construction, publishes `zh-hans` separately from `zh-hant`, and
 *    gives a URL per item that a person can open and check.
 *
 * A game neither source answers for is left empty and reported. It is never
 * filled in from the English title, and never guessed at.
 *
 * ## Every row is written `needs_review`
 *
 * `verified` is a claim that a person checked this name against the supplier's
 * own listing. Nothing here can do that, so nothing here claims it. What this
 * gives the admin report is a candidate and its source URL per game, which is
 * the difference between reviewing 140 names and finding 140 of them.
 *
 * ## Nothing Chinese is printed
 *
 * This runs in GitHub Actions and the repository is public, so the log carries
 * product ids, English titles and counts, and never the name that was written.
 * The names are read back in the admin screen, behind `requireAdmin`, which is
 * the only place they are meant to be readable at all.
 *
 * DRY RUN BY DEFAULT. `--apply` is what writes. It touches exactly one table,
 * `product_admin_metadata`; no product document, price, cost, stock, option or
 * order is read for writing or written at all.
 *
 * Usage:
 *   node scripts/supplier-name-fill.mjs [--apply] [--limit=N] [--only=id,id]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

import { hkNameIndex, matchSupplierName } from "./lib/supplier-name-source.mjs";
import {
  baseTitle,
  editionFallbacks,
  entitiesUrl,
  isVideoGame,
  pickWikidataName,
  searchUrl,
  titleMatches,
} from "./lib/supplier-name-wikidata.mjs";
import { langlinkUrl, readLanglink } from "./lib/supplier-name-wikipedia.mjs";

const HK_INDEX = "data/nintendo-hong-kong-languages.json";
const UPDATED_BY = "supplier-name-fill";

const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(flag("limit", "0"));
const OFFSET = Math.max(0, Number(flag("offset", "0")) || 0);
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redact(t));

/* ------------------------------------------------ the application's own code */
const outfile = path.resolve(".supplier-name-bundle.mjs");
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
if (!rows.length) throw new Error("D1 unreachable or empty — refusing to act on nothing");

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
    /* an unparseable overlay is the recovery tooling's problem, not this one's */
  }
}

let games = [...live.values()]
  .filter((p) => !p["_deleted"] && !p["isDeleted"])
  .filter((p) => app.getProductCategory(p) === "game")
  .sort((a, b) => String(a.slug || a.id).localeCompare(String(b.slug || b.id)));

if (ONLY.length) {
  games = games.filter((g) => ONLY.includes(String(g.id)) || ONLY.includes(String(g.slug)));
}
/*
  Offset before limit, so a long fill can be done in batches that each finish
  inside a job's lifetime. The order is the stable one this list is already
  sorted by, so batch 2 picks up exactly where batch 1 stopped.
*/
const total = games.length;
if (OFFSET > 0) games = games.slice(OFFSET);
if (LIMIT > 0) games = games.slice(0, LIMIT);

say(`games in the catalogue: ${total}`);
if (OFFSET > 0 || LIMIT > 0) {
  say(`this batch: ${games.length} — from ${OFFSET + 1} to ${OFFSET + games.length}`);
}
if (!games.length) throw new Error("no games matched — refusing to report an empty pass as a fill");

/* --------------------------------------------- Nintendo Hong Kong, by title */
/*
  A wider index than the language audit's: that one skips a row with no
  language list, because a row that cannot answer "which languages" is no use
  to it. Here the question is "what does Nintendo call this in Chinese", which
  a row answers whether or not it lists languages.
*/
const hk = JSON.parse(readFileSync(HK_INDEX, "utf8"));
if (!Array.isArray(hk?.titles) || !hk.titles.length) {
  throw new Error(`${HK_INDEX} carries no titles — rebuild it with scripts/build-hong-kong-index.mjs`);
}
const byTitle = hkNameIndex(hk.titles);
say(`Hong Kong catalogue entries: ${hk.titles.length} · index keys: ${byTitle.size} · built ${hk.builtAt}`);

/* ------------------------------------------------------- Wikidata, by title */
/*
  Nintendo Hong Kong is the better source and reaches almost none of this
  shelf: it writes its Chinese-named games in Chinese on every field, our
  catalogue is titled in English, and the first run against production matched
  0 of 143. Wikidata is reachable from an English title by construction, and
  every rule in `supplier-name-wikidata.mjs` is a way of refusing a wrong item.
*/
const UA =
  "bananto-supplier-names/1.0 (https://github.com/justrandoomis/Bamw) node-fetch";

/* Wikidata asks for an unhurried caller; this is two requests a game. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
  A request that failed and a game with no Chinese name are not the same
  finding, and the first version of this returned `null` for both. That is the
  worst shape this report can take: it would print "no Chinese name in either
  source" for a game whose name Wikidata holds perfectly well, and an admin
  reading the report would go and type it in by hand for nothing — or worse,
  trust the report and leave the game empty.

  So a transport failure is carried through as a failure, retried first, and
  named separately in the tally.
*/
async function fetchJson(url, { timeout = 12_000, attempts = 2 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: ctl.signal,
      });
      if (res.ok) return { ok: true, json: await res.json() };
      /* 429 and 5xx are worth waiting out; a 400 will say the same thing twice. */
      if (res.status !== 429 && res.status < 500) return { ok: false, status: res.status };
      if (attempt < attempts) await pause(1_000 * attempt);
    } catch (err) {
      if (attempt < attempts) await pause(1_000 * attempt);
      else return { ok: false, status: 0, error: String(err?.message ?? err) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 429 };
}

/**
 * One game against Wikidata.
 *
 * Returns the hit, `null` for "asked and there is nothing", or
 * `{ failed: true }` for "could not ask" — which the caller reports as its own
 * outcome rather than as an empty answer.
 */
async function askWikidata(title) {
  const found = await fetchJson(searchUrl(title));
  if (!found.ok) return { failed: true, why: `search HTTP ${found.status}` };
  const ids = (found.json?.search ?? []).map((hit) => hit?.id).filter(Boolean).slice(0, 5);
  if (!ids.length) return null;

  await pause(150);
  const got = await fetchJson(entitiesUrl(ids));
  if (!got.ok) return { failed: true, why: `entities HTTP ${got.status}` };
  if (!got.json?.entities) return null;

  return pickWikidataName(got.json.entities, title);
}

async function resolveFromWikidata(englishTitle) {
  /*
    Matched against the base title, not the shelf title: `Hollow Knight switch 1`
    is this shop's way of saying which console, and no item is named that.
  */
  const title = baseTitle(englishTitle);
  if (!title) return null;

  const first = await askWikidata(title);
  if (first) return first;

  /*
    Only now the edition comes off. Wikidata has its own item for `Xenoblade
    Chronicles: Definitive Edition`, and asking for the base game first would
    answer with the wrong product; asking second finds `The Witcher 3: Wild
    Hunt`, which has no `Complete Edition` item at all.
  */
  /*
    Bounded. Every candidate is two requests against an API that rate-limits,
    and the difference between the third reading of an edition suffix and the
    fifth is not worth a job that runs out of time before it finishes the
    shelf.
  */
  for (const candidate of editionFallbacks(title).slice(0, 3)) {
    await pause(150);
    const next = await askWikidata(candidate);
    if (next?.failed) return next;
    if (next) return { ...next, searchedAs: candidate };
  }
  return null;
}

/* ------------------------------------------- Wikipedia, for what Wikidata misses */
/*
  A Wikidata label and a Chinese Wikipedia article are different things, and
  plenty of games have the second without the first. The identity check is
  borrowed rather than skipped: the English article names its Wikidata item, and
  that item goes through the same two tests the Wikidata source uses. `Stray` is
  a disambiguation page and `Hades` is a Greek god; following either would put a
  god's name on a game order.
*/
async function resolveFromWikipedia(englishTitle) {
  const title = baseTitle(englishTitle);
  if (!title) return null;

  const got = await fetchJson(langlinkUrl(title));
  if (!got.ok) return { failed: true, why: `wikipedia HTTP ${got.status}` };
  const link = readLanglink(got.json);
  if (!link) return null;

  await pause(150);
  const entity = await fetchJson(entitiesUrl([link.itemId]));
  if (!entity.ok) return { failed: true, why: `entities HTTP ${entity.status}` };

  const item = entity.json?.entities?.[link.itemId];
  if (!item || !isVideoGame(item) || !titleMatches(item, title)) return null;

  return {
    name: link.zhTitle,
    lang: "zh-wikipedia",
    itemId: link.itemId,
    sourceUrl: link.sourceUrl,
  };
}

/* ------------------------------------------------------------------- the pass */
const table = await app.d1All(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_admin_metadata'",
);
if (!table.length) {
  throw new Error(
    "product_admin_metadata does not exist yet — deploy the release that creates it and let one request run ensureSchema()",
  );
}

const report = [];
let fromHongKong = 0;
let fromWikidata = 0;
let fromWikipedia = 0;
let noSource = 0;
let unreachable = 0;
let written = 0;

for (const game of games) {
  const id = String(game.id);
  const english = String(game.titleEn || game.title || "").trim();

  /*
    Nintendo's own storefront first, whenever it can be reached: it is the
    catalogue the game is actually sold from. Wikidata answers for the rest.
  */
  const hkHit = matchSupplierName(game, byTitle);
  let found = hkHit.outcome === "found" ? { ...hkHit, source: "Nintendo Hong Kong" } : null;
  let failure = "";
  if (!found) {
    const wd = await resolveFromWikidata(english);
    if (wd?.failed) failure = wd.why;
    else if (wd) found = { ...wd, source: `Wikidata ${wd.itemId} (${wd.lang})` };
    await pause(150);
  }
  if (!found && !failure) {
    const wp = await resolveFromWikipedia(english);
    if (wp?.failed) failure = wp.why;
    else if (wp) found = { ...wp, source: `Chinese Wikipedia (${wp.itemId})` };
    await pause(150);
  }

  if (!found) {
    if (failure) {
      unreachable += 1;
      report.push({ id, english, outcome: `could not ask Wikidata — ${failure}`, filled: false });
      continue;
    }
    noSource += 1;
    const why =
      hkHit.outcome === "latin_name"
        ? "Hong Kong sells it in Latin, and neither Wikidata nor Wikipedia names it in Chinese"
        : "no Chinese name in any source";
    report.push({ id, english, outcome: why, filled: false });
    continue;
  }

  if (found.source === "Nintendo Hong Kong") fromHongKong += 1;
  else if (found.source.startsWith("Chinese Wikipedia")) fromWikipedia += 1;
  else fromWikidata += 1;

  const check = app.checkSupplierNameZh(found.name, english);
  const note = check.ok ? "" : ` — ${check.reason}`;
  const searched = found.searchedAs ?? baseTitle(english);
  const asked = searched === english ? "" : ` [searched as "${searched}"]`;
  report.push({
    id,
    english,
    outcome: `${found.source}${note}${asked}`,
    filled: true,
  });

  if (APPLY) {
    await app.writeSupplierNameZh({
      productId: id,
      supplierNameZhCn: found.name,
      sourceUrl: found.sourceUrl,
      /*
        Never `verified`. This matched a title against a catalogue; it did not
        check the name against the supplier's own listing, which is what that
        status claims.
      */
      status: "needs_review",
      englishTitle: english,
      updatedBy: UPDATED_BY,
    });
    written += 1;
  }
}

/* ----------------------------------------------------------------- the report */
say("");
say(APPLY ? "APPLIED" : "DRY RUN — nothing was written");
say("");
for (const row of report) {
  say(`${row.filled ? "\u2713" : "\u00b7"} ${row.english || row.id} \u2014 ${row.outcome}`);
}
say("");
say(`games in this pass: ${games.length}`);
say(`  from Nintendo Hong Kong: ${fromHongKong}`);
say(`  from Wikidata: ${fromWikidata}`);
say(`  from Chinese Wikipedia: ${fromWikipedia}`);
say(`  no source, left empty: ${noSource}`);
say(`  could not ask, left untouched: ${unreachable}`);
say(`  rows written: ${written}`);
say("");
say("Names are never printed here. Read them in the admin screen, which is the only place they are meant to be readable.");

if (fromHongKong + fromWikidata + fromWikipedia + noSource + unreachable !== games.length) {
  throw new Error("the tallies do not add up to the number of games — refusing to report a pass that lost rows");
}
