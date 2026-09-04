#!/usr/bin/env node
/**
 * Takes supplier bookkeeping out of the stored copy, instead of hiding it at
 * read time.
 *
 * ## Why a repair and not the filter that already exists
 *
 * `toPublicProduct` strips these lines on the way out, and it works: a
 * customer has not been able to read the gift card's cost derivation since
 * that shipped. But `/api/product` and `/api/data` hand an **admin** the
 * stored record untouched — deliberately, because the admin screens need the
 * cost fields — so the one person who checks the page after a fix is the one
 * person still shown the fault. The owner reported the same line twice for
 * that reason, and they were right to: the shop's own copy still says it.
 *
 * A read-time filter also only protects the surfaces that go through it. The
 * text is still in the record for search indexing, for a future export, and
 * for whatever reads the catalogue next. Removing it from the document is the
 * repair; the filter stays as the guard for whatever arrives after it.
 *
 * ## What it will and will not change
 *
 * It edits **text only**, and only text a customer reads: the product's own
 * description fields, and the `description`-family strings on option, type,
 * variant, edition and DLC rows. Every line is kept unless
 * `looksLikeInternalNote` — the application's own detector, unit-tested in
 * `src/lib/internalMetadata.ts` — says it is bookkeeping.
 *
 * It cannot change anything else, and does not take that on trust: before
 * writing, the document is hashed with every text field blanked, and the
 * write is refused unless that hash is identical before and after. Price,
 * cost, stock, visibility, the option and type rows themselves, trade-in
 * values, display order and sales are structurally unreachable from here.
 *
 * Dry run by default. `--apply` writes, and reads every row back to verify.
 *
 * Usage:
 *   node scripts/product-text-repair.mjs --needle=gift
 *   node scripts/product-text-repair.mjs --ids=prd_x,prd_y --apply
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

const argOf = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const APPLY = process.argv.includes("--apply");
const AUDIT = process.argv.includes("--audit");
const NEEDLE = argOf("needle").toLowerCase();
const IDS = argOf("ids").split(",").map((s) => s.trim()).filter(Boolean);
if (!NEEDLE && IDS.length === 0) throw new Error("pass --needle= or --ids=");

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

/*
  A removed line is bookkeeping, and bookkeeping is where the cost lives. The
  log says which line went and why; the figures in it are masked, because this
  report is a CI artifact and a supplier cost in one is the leak the filter
  exists to prevent.
*/
const maskFigures = (text) => String(text).replace(/\d/g, "#");

const outfile = path.resolve(".product-text-repair-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/text-repair-entry.ts"],
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

/* Every field name whose value a customer reads, at any depth. */
const TEXT_FIELDS = new Set([
  ...app.CUSTOMER_TEXT_FIELDS,
  "shortDescription",
  "short_description",
  "summary",
  "details",
  "longDescription",
  "long_description",
  "descriptionArabic",
  "customerNote",
]);

/** Rows nested under a product that carry their own customer text. */
const ROW_COLLECTIONS = new Set([
  "options",
  "types",
  "variants",
  "editions",
  "editionsList",
  "dlcs",
  "dlc",
  "contents",
  "features",
  "perks",
  "includes",
]);

const changes = [];

/**
 * Returns a copy with internal lines removed from customer text.
 *
 * Recurses only into the row collections above, so a `description` buried in
 * some unrelated blob is left alone rather than rewritten by accident.
 */
function cleanDocument(node, trail, productId) {
  if (Array.isArray(node)) return node.map((item, i) => cleanDocument(item, `${trail}[${i}]`, productId));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && TEXT_FIELDS.has(key)) {
      const kept = [];
      const dropped = [];
      for (const line of value.split(/\r?\n/)) {
        if (app.looksLikeInternalNote(line)) dropped.push(line);
        else kept.push(line);
      }
      if (dropped.length === 0) {
        out[key] = value;
        continue;
      }
      const next = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      changes.push({ productId, path: `${trail}.${key}`, dropped, empty: next.length === 0 });
      /*
        An emptied field is deleted rather than written as "". A blank string
        still renders as an empty paragraph, and a missing field lets the page
        fall back to whatever it uses when there is no description.
      */
      if (next) out[key] = next;
      continue;
    }
    if (Array.isArray(value) && ROW_COLLECTIONS.has(key)) {
      out[key] = cleanDocument(value, `${trail}.${key}`, productId);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** The document with every text field blanked — what must not change. */
function skeleton(doc) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .map((k) => [k, TEXT_FIELDS.has(k) && typeof node[k] === "string" ? "" : walk(node[k])]),
    );
  };
  return createHash("sha256").update(JSON.stringify(walk(doc))).digest("hex");
}

/**
 * Every customer-facing string in a cleaned document, in full.
 *
 * Printed only after the bookkeeping lines are out, so what reaches the log is
 * exactly what a shopper reads — which is the point: a wrong price line is not
 * the only thing wrong with copy nobody has read end to end.
 */
function reportText(doc, trail = "") {
  if (Array.isArray(doc)) {
    doc.forEach((item, i) => reportText(item, `${trail}[${i}]`));
    return;
  }
  if (!doc || typeof doc !== "object") return;
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === "string" && TEXT_FIELDS.has(key) && value.trim()) {
      say(`  ▸ \`${trail}.${key}\``);
      for (const line of value.split(/\r?\n/)) say(`    | ${line}`);
    } else if (Array.isArray(value) && ROW_COLLECTIONS.has(key)) {
      value.forEach((item, i) => reportText(item, `${trail}.${key}[${i}]${item?.name ? ` (${item.name})` : ""}`));
    }
  }
}

/* ── the live catalogue ─────────────────────────────────────────────── */

const chunks = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
);
let raw = "";
for (const row of chunks) raw += String(row.value ?? "");
const aggregate = JSON.parse(raw || "[]");

const overlayRows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'",
);
const overlays = new Map(
  overlayRows.map((row) => [String(row.key).replace("store:product:", ""), String(row.value ?? "")]),
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

const selected = aggregate
  .filter((p) => p?.id && !p._deleted)
  .filter((p) =>
    IDS.length
      ? IDS.includes(String(p.id)) || IDS.includes(String(p.slug ?? ""))
      : `${p.slug ?? ""} ${p.title ?? ""} ${p.titleEn ?? ""} ${p.categoryId ?? ""}`
          .toLowerCase()
          .includes(NEEDLE),
  )
  .map(live)
  .filter(Boolean);

say(`# Stored-copy repair — ${APPLY ? "APPLY" : "dry run"}`);
say();
say(`Products selected: ${selected.length}`);
say();

let written = 0;
let clean = 0;
let refused = 0;

for (const record of selected) {
  const id = String(record.id);
  const before = changes.length;
  const cleaned = cleanDocument(record, "", id);
  const mine = changes.slice(before);

  say(`## ${record.title ?? record.titleEn ?? id}`);
  say(`- id \`${id}\` · slug \`${record.slug ?? ""}\``);

  if (mine.length === 0) {
    say("- stored copy already carries no bookkeeping line — nothing to write");
    if (AUDIT) reportText(cleaned);
    say();
    clean++;
    continue;
  }

  for (const change of mine) {
    say(`- \`${change.path || "(root)"}\` — ${change.dropped.length} line(s) removed${change.empty ? ", field now empty and deleted" : ""}`);
    for (const line of change.dropped) say(`    · ${maskFigures(line).slice(0, 200)}`);
  }

  if (AUDIT) reportText(cleaned);

  if (skeleton(record) !== skeleton(cleaned)) {
    say("- **REFUSED**: something other than text would change. Nothing written.");
    say();
    refused++;
    continue;
  }

  if (!APPLY) {
    say("- dry run — nothing written");
    say();
    continue;
  }

  await app.d1Run(
    "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    `store:product:${id}`,
    JSON.stringify(cleaned),
    new Date().toISOString(),
  );

  const back = await app.d1All("SELECT value FROM store_kv WHERE key = ?", `store:product:${id}`);
  let stored = null;
  try {
    stored = back?.[0]?.value ? JSON.parse(String(back[0].value)) : null;
  } catch {
    stored = null;
  }
  if (!stored || JSON.stringify(stored) !== JSON.stringify(cleaned)) {
    say("- **read-after-write verification FAILED**");
    say();
    refused++;
    continue;
  }
  say("- written and read back clean");
  say();
  written++;
}

/*
  Every isolate and every edge holds the catalogue against `store_rev`. A row
  written behind their backs is invisible until something moves that number,
  which is why a repair that only writes the overlay looks like it did nothing
  for as long as the cache lives.
*/
if (APPLY && written > 0) {
  const rev = await app.bumpCatalogVersion();
  say(`Catalogue revision bumped to ${rev} — caches now see the repaired copy.`);
  say();
}

say(`## Summary — written: ${written} · already clean: ${clean} · refused: ${refused} · mode: ${APPLY ? "APPLY" : "dry run"}`);
writeFileSync("product-text-repair.md", lines.join("\n") + "\n");
if (refused > 0) process.exitCode = 1;
