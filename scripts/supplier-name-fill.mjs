#!/usr/bin/env node
/**
 * Fills the Chinese supplier name for every game in the catalogue.
 *
 * ## Where the name comes from
 *
 * Nintendo's own Hong Kong catalogue, which publishes a Chinese name per SKU
 * and is the only source here that can be pointed at afterwards. A machine
 * translation is not a source, and a name nobody can trace back is worse than
 * a blank: a blank shows up in the admin report as work to do, while a wrong
 * name gets an order placed for the wrong game.
 *
 * The match is on the English title, normalised the same way
 * `scripts/lib/region-language.mjs` normalises it for the language audit —
 * punctuation, trademark signs and case removed — and on the Latin name a
 * Chinese title carries in brackets. A game with no entry in that catalogue is
 * reported as `missing` and left alone. It is never filled in from the English
 * title, and never guessed at.
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

const HK_INDEX = "data/nintendo-hong-kong-languages.json";
const UPDATED_BY = "supplier-name-fill";

const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(flag("limit", "0"));
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
if (LIMIT > 0) games = games.slice(0, LIMIT);

say(`games in the catalogue: ${games.length}`);
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
let matched = 0;
let noChineseName = 0;
let notInCatalogue = 0;
let written = 0;

for (const game of games) {
  const id = String(game.id);
  const english = String(game.titleEn || game.title || "").trim();
  const hit = matchSupplierName(game, byTitle);

  if (hit.outcome === "not_in_catalogue") {
    notInCatalogue += 1;
    report.push({ id, slug: game.slug ?? "", english, outcome: "not in Nintendo Hong Kong's catalogue" });
    continue;
  }
  if (hit.outcome === "latin_name") {
    noChineseName += 1;
    report.push({ id, slug: game.slug ?? "", english, outcome: "Hong Kong sells it under a Latin name" });
    continue;
  }

  matched += 1;
  const check = app.checkSupplierNameZh(hit.name, english);
  const outcome = check.ok ? "candidate found" : `candidate found (${check.reason})`;
  report.push({ id, slug: game.slug ?? "", english, outcome });

  if (APPLY) {
    await app.writeSupplierNameZh({
      productId: id,
      supplierNameZhCn: hit.name,
      sourceUrl: hit.sourceUrl,
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
  say(`${row.outcome === "not in Nintendo Hong Kong's catalogue" ? "·" : "✓"} ${row.english || row.slug || row.id} — ${row.outcome}`);
}
say("");
say(`games: ${games.length}`);
say(`  candidate found: ${matched}`);
say(`  Hong Kong sells under a Latin name: ${noChineseName}`);
say(`  not in Hong Kong's catalogue: ${notInCatalogue}`);
say(`  rows written: ${written}`);
say("");
say("Names are never printed here. Read them in the admin screen, which is the only place they are meant to be readable.");

if (matched + noChineseName + notInCatalogue !== games.length) {
  throw new Error("the tallies do not add up to the number of games — refusing to report a pass that lost rows");
}
