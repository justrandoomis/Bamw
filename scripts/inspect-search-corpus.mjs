#!/usr/bin/env node
/**
 * What a customer can actually search, and what they cannot. Read-only.
 *
 * The header searches `title`, `titleEn` and `description` with a plain
 * substring test. Two things make that much narrower than it looks:
 *
 *   1. `buildProductSavePayload` writes `titleEn || title` into *both* `title`
 *      and `titleEn`, so the two fields hold the same English string and the
 *      search tests it twice;
 *   2. the Arabic title lives in `titleAr`, which is not in `LIST_FIELDS` —
 *      the projection the storefront's catalogue is served through — so it
 *      never reaches the browser at all.
 *
 * The shop's interface is Arabic. This measures what that costs: how many
 * products carry an Arabic name, and how many of a set of ordinary Arabic
 * queries find anything today.
 *
 * Titles only. No price, no cost, no supplier name — the Chinese supplier name
 * is not loaded into a product document and this never asks for it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function d1(sql) {
  if (!/^\s*select\b/i.test(sql) || MUTATING.test(sql) || sql.replace(/;\s*$/, "").includes(";")) {
    throw new Error(`REFUSED: ${sql.slice(0, 60)}`);
  }
  const raw = execFileSync(
    WRANGLER,
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: ENV, timeout: 120_000 },
  );
  const i = raw.search(/[[{]/);
  const parsed = JSON.parse(raw.slice(i));
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

const lines = [];
const say = (t = "") => { lines.push(t); console.log(t); };

const keys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((r) => String(r.key));
const numbered = keys.filter((k) => /^store:products#\d+$/.test(k));
let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}
let products = [];
try { products = JSON.parse(raw); } catch (e) { say(`_catalogue would not parse: ${String(e).slice(0,100)}_`); }

const text = (v) => (typeof v === "string" ? v.trim() : "");
const games = products.filter((p) => {
  const hay = `${p.category ?? ""} ${p.categoryId ?? ""} ${p.kind ?? ""}`.toLowerCase();
  return !/gift|card|eshop|بطاق|amiibo|bundle|used|مستعمل|accessor|ملحق|hardware|device|console|جهاز|حزم/.test(hay);
});

say("# What a customer can search for today");
say();
say(`${products.length} products, ${games.length} of them games.`);
say();

const withAr = products.filter((p) => text(p.titleAr));
const sameTitle = products.filter((p) => text(p.title) && text(p.title) === text(p.titleEn));
say("| fact | count |");
say("|---|---:|");
say(`| products carrying an Arabic name (\`titleAr\`) | ${withAr.length} of ${products.length} |`);
say(`| products where \`title\` and \`titleEn\` are the same string | ${sameTitle.length} of ${products.length} |`);
say(`| products with a \`description\` the search could match | ${products.filter((p) => text(p.description)).length} |`);
say();

/* The normalisation the new search will apply, so the gap is measured against
   what is actually being proposed rather than against an ideal. */
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Exactly what the header does today. */
const todayFinds = (q) => {
  const needle = q.toLowerCase();
  return products.filter((p) => {
    const t = text(p.title).toLowerCase();
    const te = text(p.titleEn).toLowerCase();
    const d = text(p.description).toLowerCase();
    return t.includes(needle) || te.includes(needle) || d.includes(needle);
  }).length;
};

/** What a normalised search across the Arabic name as well would find. */
const wouldFind = (q) => {
  const needle = norm(q);
  if (!needle) return 0;
  return products.filter((p) => {
    const hay = norm(`${text(p.title)} ${text(p.titleEn)} ${text(p.titleAr)} ${text(p.subtitle)}`);
    return needle.split(" ").every((tok) => hay.includes(tok));
  }).length;
};

const QUERIES = [
  "زيلدا", "ماريو", "ماريو كارت", "سماش", "بوكيمون", "بيكمين",
  "أسطورة زيلدا", "سوبر ماريو", "نينتندو سويتش ٢",
  "zelda", "mario kart", "smash", "pokemon", "MARIO", "mario  kart",
];

say("## Ordinary queries, today against what they would find");
say();
say("| query | finds today | would find |");
say("|---|---:|---:|");
for (const q of QUERIES) say(`| \`${q}\` | ${todayFinds(q)} | ${wouldFind(q)} |`);
say();

const deadArabic = QUERIES.filter((q) => /[؀-ۿ]/.test(q) && todayFinds(q) === 0);
say(
  deadArabic.length
    ? `**${deadArabic.length} of ${QUERIES.filter((q) => /[؀-ۿ]/.test(q)).length} Arabic queries return nothing at all today.**`
    : "Every Arabic query above already returns something.",
);
say();

say("## A sample of the Arabic names nobody can search");
say();
for (const p of withAr.slice(0, 12)) {
  say(`- \`${text(p.titleEn).slice(0, 44)}\` → **${text(p.titleAr).slice(0, 44)}**`);
}
say();

writeFileSync("search-corpus.md", lines.join("\n") + "\n");
