#!/usr/bin/env node
/**
 * Read-only anatomy of a single product document, largest field first.
 *
 * For working out why a document is oversized before touching it: what the
 * biggest fields are, whether they hold base64 or data URIs, and whether an
 * array repeats the same entries.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
const TARGET = process.argv[2];
if (!TARGET) throw new Error("usage: inspect-product.mjs <product-id-or-slug>");

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function d1(sql) {
  if (!/^\s*select\b/i.test(sql) || MUTATING.test(sql) || sql.replace(/;\s*$/, "").includes(";")) {
    throw new Error(`REFUSED: ${sql.slice(0, 60)}`);
  }
  const raw = execFileSync(
    WRANGLER,
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: ENV, timeout: 120_000 },
  );
  const i = raw.search(/[[{]/);
  const parsed = JSON.parse(raw.slice(i));
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/* Find the product across the aggregate and its overlay. */
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
const products = JSON.parse(raw || "[]");
let doc = products.find((p) => String(p?.id) === TARGET || String(p?.slug) === TARGET);
let source = "aggregate";
const overlay = d1(
  `SELECT value FROM store_kv WHERE key = 'store:product:${String(doc?.id ?? TARGET).replace(/'/g, "''")}'`,
)?.[0]?.value;
if (overlay) {
  const parsed = JSON.parse(overlay);
  if (!parsed._deleted) {
    doc = parsed;
    source = "overlay";
  }
}
/*
  A miss used to end the run with the target echoed back, which tells you the
  slug you already typed and nothing about the one you wanted. Product slugs
  are not guessable — "nintendo-eshop-gift-card-5-usa" is a perfectly sensible
  guess and is not what the catalogue calls it — so a miss now answers the
  question that was actually being asked: which products are near this?
*/
if (!doc) {
  const needle = TARGET.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const near = products
    .filter((p) => p?.id && !p._deleted)
    .map((p) => ({
      slug: String(p.slug ?? ""),
      title: String(p.title ?? p.titleEn ?? ""),
      id: String(p.id),
    }))
    .filter((p) => {
      const hay = `${p.slug}${p.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
      /* Any run of four or more characters in common is enough to be worth showing. */
      for (let i = 0; i + 4 <= needle.length; i++) {
        if (hay.includes(needle.slice(i, i + 4))) return true;
      }
      return false;
    })
    .slice(0, 40);

  say(`# no product matching \`${TARGET}\``);
  say();
  if (near.length) {
    say(`${near.length} product${near.length > 1 ? "s" : ""} whose slug or title looks related:`);
    say();
    for (const p of near) say(`- \`${p.slug}\` — ${p.title}`);
  } else {
    say("Nothing in the catalogue resembles it.");
  }
  writeFileSync("inspect-product.md", lines.join("\n") + "\n");
  process.exit(1);
}

const total = JSON.stringify(doc).length;
say(`# ${doc.title ?? TARGET}`);
say();
say(`- id \`${doc.id}\` · slug \`${doc.slug}\` · live copy from the **${source}**`);
say(`- total document: **${(total / 1024 / 1024).toFixed(2)} MB** (${total.toLocaleString()} bytes)`);
say(`- top-level keys: ${Object.keys(doc).length}`);
say();

const rows = Object.entries(doc)
  .map(([k, v]) => {
    const json = JSON.stringify(v ?? null);
    const bytes = json.length;
    const isArray = Array.isArray(v);
    const entries = isArray ? v.length : "";
    const distinct = isArray ? new Set(v.map((x) => JSON.stringify(x))).size : "";
    const base64 = /data:[a-z/+.-]+;base64,/i.test(json) ? "DATA-URI" : /[A-Za-z0-9+/]{400,}={0,2}/.test(json) ? "base64-ish" : "";
    return { key: k, bytes, pct: ((bytes / total) * 100).toFixed(1), entries, distinct, base64 };
  })
  .sort((a, b) => b.bytes - a.bytes);

say("| field | bytes | % of doc | entries | distinct | payload |");
say("| --- | ---: | ---: | ---: | ---: | --- |");
for (const r of rows.slice(0, 25)) {
  say(`| \`${r.key}\` | ${r.bytes.toLocaleString()} | ${r.pct}% | ${r.entries} | ${r.distinct} | ${r.base64} |`);
}
say();

/* Duplication inside the biggest arrays is the usual cause. */
for (const r of rows.slice(0, 6)) {
  const v = doc[r.key];
  if (!Array.isArray(v) || v.length < 2) continue;
  const seen = new Map();
  for (const item of v) {
    const k = JSON.stringify(item);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const repeats = [...seen.entries()].filter(([, n]) => n > 1);
  if (repeats.length) {
    say(`**\`${r.key}\`** holds ${v.length} entries but only ${seen.size} distinct — ${repeats.length} repeated.`);
    for (const [k, n] of repeats.slice(0, 5)) say(`  - ×${n}: \`${k.slice(0, 110)}\``);
    say();
  }
}

writeFileSync("inspect-product.md", lines.join("\n") + "\n");
