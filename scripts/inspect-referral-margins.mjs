#!/usr/bin/env node
/**
 * Can the shop afford a referral on each kind of product? Read-only.
 *
 * The programme pays twice on one sale — ten per cent off for the friend and
 * ten per cent into the referrer's wallet — so a referred order gives away a
 * fifth of the price. Whether that is a promotion or a loss depends entirely
 * on the margin, and the margin is different for a game account, a console and
 * a top-up card. The gift card already proved the point: 7,500 against a 6,800
 * cost is a 700 margin, and 1,500 given away on it sells at a loss.
 *
 * This asks the live catalogue rather than guessing. It prints, per category,
 * how many products there are and how their margins are distributed — and how
 * many of them could not absorb twenty per cent.
 *
 * **Percentages only.** No product's cost, and no product's price, is written
 * to the artifact: a workflow artifact outlives the question it was run for,
 * and the shop's cost sheet is not something to leave lying in one. The margin
 * ratio is what the decision needs, and the ratio does not disclose either
 * number on its own.
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
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/* --------------------------- the catalogue -------------------------------- */

/*
  The catalogue is one JSON array split across numbered rows.

  `store:products#000`, `#001` … are *fragments of one string*, not an array
  each: the value is chopped at a byte boundary that lands wherever it lands,
  so a row on its own is not valid JSON. They are concatenated in key order and
  parsed once. Reading them as separate documents parses nothing and reports an
  empty catalogue — which reads exactly like a shop with no products in it.

  This is the aggregate the storefront serves. Per-product `store:product:<id>`
  overlay rows exist too; the aggregate is what a customer is priced from, so
  it is what the programme sees.
*/
const keys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((row) => String(row.key));
const numbered = keys.filter((key) => /^store:products#\d+$/.test(key));

let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}

let products = [];
try {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) products = parsed;
} catch (error) {
  say(`_the catalogue would not parse: ${String(error).slice(0, 120)}_`);
}

/** The same category resolution the programme uses, in the shape a script can. */
function categoryOf(product) {
  const id = String(product.category ?? product.categoryId ?? product.category_id ?? "")
    .trim()
    .toLowerCase();
  const kind = String(product.kind ?? "").trim().toLowerCase();
  const hay = `${id} ${String(product.categoryTitle ?? "").toLowerCase()} ${kind}`;
  if (/gift|card|eshop|بطاق/.test(hay)) return "gift_card";
  if (/amiibo/.test(hay)) return "amiibo";
  if (/bundle|حزم/.test(hay)) return "bundle";
  if (/used|مستعمل/.test(hay)) return "used";
  if (/accessor|ملحق/.test(hay)) return "accessory";
  if (/hardware|device|console|جهاز/.test(hay)) return "hardware";
  return "game";
}

/**
 * The lowest price a customer can actually pay for this product.
 *
 * The referral discount comes off the selection, not the headline, so the
 * cheapest sellable option is the one that decides whether twenty per cent
 * fits. Reading the headline `price` alone would flatter every product whose
 * options undercut it.
 */
function lowestPrice(product) {
  const candidates = [];
  const push = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  };
  push(product.price);
  for (const key of ["options", "types", "variants", "editions"]) {
    const list = product[key];
    if (Array.isArray(list)) for (const entry of list) push(entry?.price);
  }
  return candidates.length ? Math.min(...candidates) : 0;
}

function costOf(product) {
  for (const key of ["cost", "costPrice", "cost_price", "purchasePrice", "buyPrice"]) {
    const n = Number(product[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

const GIVEAWAY = 0.2; // ten per cent to the friend, ten to the referrer.

const byCategory = new Map();
for (const product of products) {
  const category = categoryOf(product);
  const bucket = byCategory.get(category) ?? {
    total: 0,
    priced: 0,
    withCost: 0,
    margins: [],
    tooThin: 0,
  };
  bucket.total += 1;
  const price = lowestPrice(product);
  const cost = costOf(product);
  if (price > 0) bucket.priced += 1;
  if (price > 0 && cost > 0) {
    bucket.withCost += 1;
    const margin = (price - cost) / price;
    bucket.margins.push(margin);
    if (margin < GIVEAWAY) bucket.tooThin += 1;
  }
  byCategory.set(category, bucket);
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

say("# Can a referral be afforded, per category?");
say();
say(
  `A referred order gives away **${pct(GIVEAWAY)}** of the selection's price —` +
    " ten per cent off for the friend and ten per cent into the referrer's" +
    " wallet. A product whose margin is below that is sold at a loss when it" +
    " is referred.",
);
say();
say(`${products.length} product(s) read from the live catalogue.`);
say();
say("| category | products | with a cost on record | margin min | median | max | below 20% |");
say("|---|---:|---:|---:|---:|---:|---:|");

for (const [category, bucket] of [...byCategory].sort((a, b) => b[1].total - a[1].total)) {
  const sorted = [...bucket.margins].sort((a, b) => a - b);
  say(
    `| ${category} | ${bucket.total} | ${bucket.withCost} | ` +
      (sorted.length
        ? `${pct(sorted[0])} | ${pct(quantile(sorted, 0.5))} | ${pct(sorted[sorted.length - 1])} | ${bucket.tooThin}`
        : "— | — | — | —") +
      " |",
  );
}
say();

/*
  A product with no cost on record cannot be judged either way, and saying so
  matters: a category whose costs are simply not filled in reads as "no
  products below twenty per cent" when nothing has been checked at all.
*/
say("## Products that could not be judged");
say();
say("| category | no price | no cost |");
say("|---|---:|---:|");
for (const [category, bucket] of [...byCategory].sort((a, b) => b[1].total - a[1].total)) {
  say(`| ${category} | ${bucket.total - bucket.priced} | ${bucket.priced - bucket.withCost} |`);
}
say();

writeFileSync("referral-margins.md", lines.join("\n") + "\n");
