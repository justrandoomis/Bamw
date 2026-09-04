#!/usr/bin/env node
/**
 * What a customer actually receives for one product, and what is wrong with it.
 *
 * Written to answer a specific report — the Nintendo gift card showing two
 * different prices and a set of images that repeat, one of them hotlinked from
 * a retailer's CDN — from the record rather than from a screenshot.
 *
 * READ ONLY. One SELECT, no writes.
 *
 * ## Why it prints through the public serializer
 *
 * The output goes to a CI log, and a product document holds cost, supplier
 * fields and internal notes. Rather than maintain a second list of what must
 * not be printed, the record is passed through `toPublicProduct` — the same
 * function the storefront answers through — so anything a customer may not see
 * is already gone before anything is printed. Prices are printed: they are on
 * the storefront already.
 *
 * Usage:
 *   node scripts/product-public-anatomy.mjs "gift"
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import path from "node:path";
import { writeFileSync } from "node:fs";

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}
const NEEDLE = (process.argv[2] || "gift").toLowerCase();
const LIMIT = Number(process.argv[3] || 3);

const SECRETS = [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.D1_DATABASE_ID,
].filter((v) => v && v.length >= 8);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};

const outfile = path.resolve(".product-public-anatomy-bundle.mjs");
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

/* The aggregate, then each product's overlay, which is the live copy. */
const chunks = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
);
let raw = "";
for (const row of chunks) raw += String(row.value ?? "");
const products = JSON.parse(raw || "[]");

const overlays = new Map(
  (await app.d1All("SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'")).map(
    (row) => [String(row.key).replace("store:product:", ""), String(row.value ?? "")],
  ),
);

const live = (product) => {
  const overlay = overlays.get(String(product?.id ?? ""));
  if (!overlay) return product;
  try {
    const parsed = JSON.parse(overlay);
    return parsed?._deleted ? null : parsed;
  } catch {
    return product;
  }
};

const matches = products
  .filter((p) => p?.id && !p._deleted)
  .filter((p) =>
    `${p.slug ?? ""} ${p.title ?? ""} ${p.titleEn ?? ""} ${p.categoryId ?? ""}`
      .toLowerCase()
      .includes(NEEDLE),
  )
  .map(live)
  .filter(Boolean)
  .slice(0, LIMIT);

say(`# Public anatomy — '${NEEDLE}' — READ ONLY`);
say();
if (matches.length === 0) {
  say(`Nothing in the catalogue matches '${NEEDLE}'.`);
  writeFileSync("product-public-anatomy.md", lines.join("\n") + "\n");
  process.exit(1);
}

const IMAGE_SINGLE = [
  "image",
  "mainImage",
  "coverImage",
  "cartridgeImage",
  "nintendoCardImage",
  "coverHiResImage",
  "bannerImage",
  "banner",
  "cardArtwork",
  "listingImage",
  "thumbnailImage",
  "frontImage",
];
const IMAGE_ARRAY = ["gallery", "galleryImages", "screenshots", "bannerImages", "lifestyleImages"];

for (const record of matches) {
  const pub = app.toPublicProduct(record);
  say(`## ${pub.title ?? pub.titleEn ?? pub.id}`);
  say();
  say(`- slug \`${pub.slug ?? ""}\` · id \`${pub.id}\``);
  say(`- base price: ${pub.price ?? "(none)"}`);
  say(`- hidden: ${record.isHidden === true ? "yes" : "no"}`);
  say();

  for (const field of ["description", "description_ar", "descriptionEn", "shortDescription"]) {
    const value = pub[field];
    if (typeof value !== "string" || !value.trim()) continue;
    say(`**${field}**`);
    say("```");
    for (const line of value.split(/\r?\n/)) say(line);
    say("```");
    say();
  }

  for (const collection of ["options", "variants", "types", "editions"]) {
    const rows = pub[collection];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    say(`**${collection}** (${rows.length})`);
    say();
    say("| name | price | description |");
    say("| --- | ---: | --- |");
    for (const row of rows) {
      const description = String(row?.description ?? "").replace(/\n/g, " ⏎ ").slice(0, 120);
      say(`| ${row?.name ?? row?.id ?? ""} | ${row?.price ?? ""} | ${description} |`);
    }
    say();
  }

  /*
    Which URL sits in which role, and which roles share one. Three fields
    holding one file is not visible from the admin form, where each is its own
    box; it is only visible side by side, like this.
  */
  say("**images**");
  say();
  const byUrl = new Map();
  for (const field of IMAGE_SINGLE) {
    const value = record[field];
    if (typeof value !== "string" || !value.trim()) continue;
    const url = value.trim();
    say(`- \`${field}\`: ${url}`);
    byUrl.set(url, [...(byUrl.get(url) ?? []), field]);
  }
  for (const field of IMAGE_ARRAY) {
    const value = record[field];
    if (!Array.isArray(value) || value.length === 0) continue;
    const distinct = new Set(value.map((v) => String(v)));
    say(`- \`${field}\`: ${value.length} entr${value.length === 1 ? "y" : "ies"}, ${distinct.size} distinct`);
    for (const entry of value.slice(0, 8)) say(`    - ${String(entry)}`);
  }
  say();

  const shared = [...byUrl.entries()].filter(([, fields]) => fields.length > 1);
  if (shared.length) {
    for (const [url, fields] of shared) {
      say(`  ⚠ one file in ${fields.length} roles — ${fields.join(", ")}`);
      say(`    ${url}`);
    }
  }

  /* Hotlinked from somewhere that is not ours: a broken image waiting to happen. */
  const foreign = [...byUrl.keys()].filter(
    (url) => /^https?:\/\//i.test(url) && !/(?:banan\.to|r2\.dev|cloudflarestorage|nintendo)/i.test(url),
  );
  for (const url of foreign) say(`  ⚠ hosted off our own storage: ${url}`);

  for (const issue of app.auditMediaRoles(record)) say(`  ⚠ ${issue.message}`);
  say();
}

writeFileSync("product-public-anatomy.md", lines.join("\n") + "\n");
