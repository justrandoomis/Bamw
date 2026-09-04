#!/usr/bin/env node
/**
 * Which field is pricing this card, and which is picturing it. Read-only.
 *
 * A gift card whose admin screen shows 7,500 everywhere renders 7,000 on its
 * product page, and no edit to the base price or the option price moves it.
 * That is the signature of a surface reading a *different* field from the one
 * the editor writes, so this prints every list that can price a product, in
 * the order the detail page consults them, next to the price the admin sees.
 *
 * The same for the picture: the role each image field feeds, so a cover that
 * "cannot be changed" can be traced to the field actually on screen.
 *
 * Cost is deliberately not printed. It is not needed to diagnose a selling
 * price, and a workflow artifact outlives the question it was run for.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
const TARGET = process.argv[2];
if (!TARGET) throw new Error("usage: inspect-card-pricing.mjs <product-id-or-slug>");

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

/** The same guard `inspect-product.mjs` uses: selects only, one statement. */
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

const list = (value) => (Array.isArray(value) ? value : []);

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

const chunkKeys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((r) => String(r.key));
const numbered = chunkKeys
  .filter((k) => /^store:products#\d+$/.test(k))
  .sort((a, b) => Number(a.split("#")[1]) - Number(b.split("#")[1]));
let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}
const products = JSON.parse(raw || "[]");

/*
  `--all`: every product whose two type-lists disagree.

  Aligning the displays with the till changes which number some products print,
  and a price is commercial data — so the set that moves is listed before
  anything ships, rather than discovered on the storefront.
*/
if (TARGET === "--all") {
  const affected = [];
  for (const p of products) {
    if (!p?.id || p._deleted) continue;
    const types = list(p.types);
    const variants = list(p.variants);
    if (!types.length || !variants.length) continue;
    const key = (rows) =>
      rows
        .map((r) => `${String(r?.name ?? "")}=${r?.price === "" || r?.price == null ? "-" : r.price}`)
        .join(" | ");
    const before = key(variants);
    const after = key(types);
    if (before === after) continue;
    affected.push({ slug: String(p.slug ?? p.id), title: String(p.title ?? ""), before, after, base: p.price });
  }
  say(`# Products whose two type-lists disagree — ${affected.length} of ${products.length}`);
  say();
  if (!affected.length) {
    say("None. Every product's `types` and `variants` already say the same thing.");
  } else {
    say("`variants` is what the page printed until now; `types` is what the admin edits");
    say("and what the server charges. Where they differ, the page was showing a price the");
    say("shop would not honour.");
    say();
    for (const row of affected) {
      say(`## ${row.title}`);
      say();
      say(`- slug: \`${row.slug}\` · base price: **${row.base ?? "—"}**`);
      say(`- was shown from \`variants\`: ${row.before}`);
      say(`- now shown from \`types\`: ${row.after}`);
      say();
    }
  }
  writeFileSync("card-pricing.md", lines.join("\n") + "\n");
  process.exit(0);
}

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

if (!doc) {
  say(`# no product matching \`${TARGET}\``);
  const cards = products
    .filter((p) => p?.id && !p._deleted && /gift|card|eshop|تعبئة/i.test(`${p.slug} ${p.title}`))
    .slice(0, 40);
  if (cards.length) {
    say();
    say("Gift-card-looking products in the catalogue:");
    say();
    for (const p of cards) say(`- \`${p.slug}\` — ${p.title}`);
  }
  writeFileSync("card-pricing.md", lines.join("\n") + "\n");
  process.exit(1);
}

const priceOf = (row) => {
  const v = row?.price;
  if (v === "" || v === null || v === undefined) return "— (inherits)";
  return String(v);
};

say(`# ${doc.title ?? TARGET}`);
say();
say(`- id: \`${doc.id}\` · slug: \`${doc.slug ?? ""}\` · read from the **${source}**`);
say(`- base \`price\`: **${doc.price ?? "—"}**`);
say();

/*
  The order matters: `buildEditions` in `src/hub/data/fromProduct.ts` takes the
  first of these that has rows, and the detail page prices the selected entry
  before it falls back to the option or the base price. Whichever list appears
  first below is the one a customer is charged from.
*/
say("## The lists that can price this product, in the order the detail page reads them");
say();
const LISTS = ["editions", "types", "variants", "options"];
let winner = null;
for (const key of LISTS) {
  const rows = list(doc[key]);
  const isPricingList = key !== "options";
  if (rows.length && isPricingList && !winner) winner = key;
  say(`### \`${key}\` — ${rows.length} row(s)${rows.length && winner === key ? "  ← **the page reads this one**" : ""}`);
  if (!rows.length) {
    say();
    say("_empty_");
    say();
    continue;
  }
  say();
  say("| # | name | price |");
  say("|---|---|---|");
  rows.forEach((row, i) => {
    const name = String(row?.name ?? row?.id ?? "").replace(/\|/g, "\\|");
    say(`| ${i + 1} | ${name} | ${priceOf(row)} |`);
  });
  say();
}

if (winner && winner !== "types") {
  say(
    `> The admin editor writes \`types\`. This product is priced from \`${winner}\`, which no` +
      " admin screen edits — so every price the owner sets is ignored by the page.",
  );
  say();
}

say("## Media");
say();
const MEDIA = [
  ["coverImage", "detail-cover — the product page's main picture, and what the gift-card editor writes"],
  ["cardArtwork", "legacy name the editor falls back to when reading"],
  ["mainImage", "legacy name the editor falls back to when reading"],
  ["cartridgeImage", "front-box — listing cards"],
  ["regionBanner", "the region banner the editor writes"],
  ["bannerImage", "banner (legacy)"],
  ["image", "legacy thumbnail"],
];
say("| field | set? | role |");
say("|---|---|---|");
for (const [field, role] of MEDIA) {
  const has = typeof doc[field] === "string" && doc[field].trim() ? "yes" : "—";
  say(`| \`${field}\` | ${has} | ${role} |`);
}
say();
const gallery = list(doc.gallery).filter(Boolean);
const galleryImages = list(doc.galleryImages).filter(Boolean);
say(`- \`gallery\`: ${gallery.length} entr(y/ies) · \`galleryImages\`: ${galleryImages.length}`);
say();

/*
  The description is printed because a card whose copy states a selling price
  and an exchange rate carries a *second* price the editor does not govern —
  one the customer reads even when every field above is right.
*/
const desc = String(doc.description ?? doc.description_ar ?? doc.descriptionAr ?? "");
const money = desc.match(/[\d,]{3,}\s*(?:د\.?ع|IQD)/g) ?? [];
const rates = desc.match(/1\s*USD\s*=\s*[\d,]+/gi) ?? [];
say("## Prices written into the description text");
say();
if (money.length || rates.length) {
  for (const m of [...new Set([...money, ...rates])]) say(`- \`${m}\``);
  say();
  say("> These are copy, not fields. Changing a price never rewrites them.");
} else {
  say("_none_");
}
say();

writeFileSync("card-pricing.md", lines.join("\n") + "\n");
