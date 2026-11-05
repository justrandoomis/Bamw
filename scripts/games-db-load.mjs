#!/usr/bin/env node
/**
 * The games database loader: Nintendo Europe's whole Switch / Switch 2 index
 * (about twenty thousand titles) into `nintendo_titles`, the table behind
 * /games-db.
 *
 *   node scripts/games-db-load.mjs [--index <saved index .json>] [--save-index <file>]
 *                                  [--catalogue <catalogue .json>] [--limit <n>] [--apply true]
 *
 * Reads (public, no key): https://search.nintendo-europe.com/en/select, through
 * `scripts/lib/nintendo-eu-index.mjs` — the same reader the catalogue
 * enrichment uses, so the two describe a game the same way.
 *
 * WRITES ONLY `nintendo_titles` and `nintendo_title_genres` (and claims its
 * token in `console_runs`). It never touches `store_kv`: the catalogue, its
 * prices and the `/api/data` payload are not this script's business. A title
 * the shop sells gets the product's id in `shop_product_id`, read from the
 * catalogue as the app reads it; nothing about the product is copied, and no
 * price is stored anywhere.
 *
 * DRY unless the pushed commit carries an unspent token in
 * `scripts/games-db-load.apply-token` (claimed in `console_runs` before the
 * first write, so a re-run cannot write twice) or `--apply true` is passed by
 * hand. A dry run with Cloudflare credentials also reads what the table holds
 * and says how many rows are new, changed and unchanged; without them it
 * reports what Nintendo's index holds.
 *
 * Over D1 REST no two statements share a transaction, so every write is safe
 * to repeat (INSERT OR REPLACE / INSERT OR IGNORE, in batches of 100), and a
 * load that stops part way is finished by running it again — see
 * `scripts/lib/games-db-rows.mjs` for the order that makes that true.
 *
 * Outputs (counts and game titles only — this repository is public):
 * `games-db-load.md` and `games-db-load.json`.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { genreLabel, PLATFORM_LABELS } from "../src/lib/games-db.ts";
import { d1Rest } from "./lib/d1-rest.mjs";
import {
  BATCH_ROWS,
  MIN_INDEX_TITLES,
  chunk,
  describeRows,
  insertGenresStatement,
  linkShopProducts,
  migrationStatements,
  planWrites,
  pruneGenresStatement,
  rowsFor,
  stampRevisionStatement,
  upsertDetailsStatement,
  upsertTitlesStatement,
} from "./lib/games-db-rows.mjs";
import { fetchSwitchIndex } from "./lib/nintendo-eu-index.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const fileArg = (name) => (args[name] && args[name] !== "true" ? args[name] : "");

const TOKEN_FILE = "scripts/games-db-load.apply-token";
const MIGRATION_FILE = "migrations/20261105_nintendo_titles.sql";
const OUT_REPORT = "games-db-load.md";
const OUT_JSON = "games-db-load.json";
const BUNDLE = path.resolve(".games-db-load-bundle.mjs");
const LIMIT = Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : 0;

const lines = [];
const say = (line = "") => {
  lines.push(line);
  console.log(line);
};
const finish = (summary) => {
  writeFileSync(OUT_REPORT, lines.join("\n") + "\n");
  writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1));
};
const fail = (message) => {
  say(`**توقف:** ${message}`);
  finish({ error: message });
  process.exit(1);
};

/* --------------------------------------------------------------- the token */
let token = null;
if (existsSync(TOKEN_FILE)) {
  const firstLine = readFileSync(TOKEN_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  token = firstLine && /^[\w.-]{6,80}$/.test(firstLine) ? firstLine : null;
}
const WANT_APPLY = args.apply === "true" || Boolean(token);

/* --------------------------------------------------------- the credentials */
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
if (!process.env["D1_DATABASE_ID"] && existsSync("wrangler.jsonc")) {
  const found = readFileSync(path.resolve("wrangler.jsonc"), "utf8").match(
    /"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/,
  );
  if (found) process.env["D1_DATABASE_ID"] = found[1];
}
const HAVE_D1 = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"].every((key) =>
  Boolean(process.env[key]),
);
if (WANT_APPLY && !HAVE_D1) fail("الكتابة تحتاج CLOUDFLARE_ACCOUNT_ID و CLOUDFLARE_API_TOKEN و D1_DATABASE_ID");
const d1 = HAVE_D1
  ? d1Rest({
      accountId: process.env["CLOUDFLARE_ACCOUNT_ID"],
      token: process.env["CLOUDFLARE_API_TOKEN"],
      databaseId: process.env["D1_DATABASE_ID"],
    })
  : null;

/**
 * The app's own catalogue read, bundled the way `catalogue-enrich.mjs` bundles
 * it: TanStack Start's virtual modules are stubbed, which is safe because no
 * request handler runs on this path — the catalogue is read as a document.
 */
async function loadApp() {
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["scripts/lib/games-db-entry.ts"],
    outfile: BUNDLE,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    alias: { "@": path.resolve("src") },
    external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
    plugins: [
      {
        name: "stub-start-virtuals",
        setup(pluginBuild) {
          const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
          pluginBuild.onResolve({ filter: virtual }, (a) => ({ path: a.path, namespace: "start-virtual" }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "start-virtual" }, () => ({
            contents: "export default {}; export const getStartManifest = () => ({});",
            loader: "js",
          }));
        },
      },
    ],
  });
  try {
    return await import(pathToFileURL(BUNDLE).href);
  } finally {
    rmSync(BUNDLE, { force: true });
  }
}

say(`# قاعدة بيانات ألعاب نينتندو — ${WANT_APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();

/* --------------------------------------------------- 1. Nintendo's index */
let index;
let total;
const indexFile = fileArg("index");
if (indexFile) {
  if (!existsSync(indexFile)) fail(`لا يوجد ملف ${indexFile}`);
  index = JSON.parse(readFileSync(indexFile, "utf8"));
  if (!Array.isArray(index)) fail(`${indexFile} ليس قائمة عناوين`);
  total = index.length;
} else {
  try {
    ({ total, index } = await fetchSwitchIndex({
      onProgress: (read, all) => process.stdout.write(`\rindex ${read}/${all}`),
    }));
    process.stdout.write("\n");
  } catch (error) {
    fail(`تعذّرت قراءة فهرس نينتندو: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const saveIndex = fileArg("save-index");
if (saveIndex) writeFileSync(saveIndex, JSON.stringify(index));
const readInFull = index.length >= total * 0.98;
if (LIMIT) index = index.slice(0, LIMIT);

/*
  A short read is a broken answer, not a smaller catalogue. Written anyway, it
  would only leave old rows in place (nothing is deleted), but it would report
  a database half the size it is, so an apply stops. A deliberate `--limit` is
  an operator testing on a slice, and is allowed to be small.
*/
if (WANT_APPLY && !LIMIT && (!readInFull || index.length < MIN_INDEX_TITLES)) {
  fail(`فهرس نينتندو أعاد ${index.length} عنواناً من ${total}، وهذا أقل من المتوقع — لم يُكتب شيء`);
}

/* ------------------------------------------------------ 2. the shop's games */
/*
  Only a product a customer can buy is linked, judged by the app's own rules.
  When the catalogue cannot be read the links cannot be computed — and an apply
  without them would overwrite every link already stored with an empty one, so
  it stops instead.
*/
let products = null;
let catalogueNote = "";
let isSellable = (product) =>
  String(product?.kind ?? "") !== "hardware" && Number(product?.price) > 0;
const catalogueFile = fileArg("catalogue");
if (catalogueFile) {
  if (!existsSync(catalogueFile)) fail(`لا يوجد ملف ${catalogueFile}`);
  const doc = JSON.parse(readFileSync(catalogueFile, "utf8"));
  products = Array.isArray(doc?.products) ? doc.products : null;
  if (!products) catalogueNote = `${catalogueFile} بلا منتجات`;
} else if (HAVE_D1) {
  try {
    const app = await loadApp();
    const store = await app.getStore();
    if (app.isStoreDegraded(store) || (store?.products?.length ?? 0) < 100) {
      catalogueNote = "الكتالوج قُرئ ناقصاً";
    } else {
      products = store.products;
      isSellable = (product) => app.isProductPurchasable(product) && app.isGameProduct(product);
    }
  } catch (error) {
    catalogueNote = `تعذّرت قراءة الكتالوج: ${error instanceof Error ? error.message : String(error)}`;
  }
} else {
  catalogueNote = "لا توجد بيانات اعتماد Cloudflare في هذا التشغيل";
}
if (WANT_APPLY && !products) fail(`لا يمكن ربط العناوين بمنتجات المتجر (${catalogueNote}) — لم يُكتب شيء`);
const links = products ? linkShopProducts(index, products, { isSellable }) : new Map();

/* --------------------------------------------------------------- 3. rows */
const loadedAt = new Date().toISOString();
const rows = rowsFor(index, links, loadedAt);
const facts = describeRows(rows);

/* ------------------------------------------------ 4. what the table holds */
let existing = new Map();
let tableState = "unread";
if (d1) {
  try {
    // Paged by key, so no single answer carries twenty thousand rows.
    let cursor = "";
    for (;;) {
      const page = await d1.all(
        "SELECT eu_id, content_hash FROM nintendo_titles WHERE eu_id > ? ORDER BY eu_id LIMIT 5000",
        [cursor],
      );
      for (const row of page) existing.set(String(row.eu_id), String(row.content_hash ?? ""));
      if (page.length < 5000) break;
      cursor = String(page[page.length - 1].eu_id);
    }
    tableState = "present";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(message)) tableState = "missing";
    else fail(`تعذّرت قراءة الجدول: ${message}`);
  }
}
const plan = planWrites(rows, existing);

/* ------------------------------------------------------------- the report */
const howCounts = {};
for (const link of links.values()) howCounts[link.how] = (howCounts[link.how] ?? 0) + 1;

say(`- المصدر: ${indexFile ? `\`${indexFile}\`` : "فهرس Nintendo Europe الرسمي"} — قُرئ ${index.length} من ${total}${LIMIT ? ` (محدود بـ ${LIMIT})` : ""}`);
say(
  `- عناوين صالحة: **${facts.titles}** — ${PLATFORM_LABELS.switch1}: ${facts.byPlatform.switch1}، ` +
    `${PLATFORM_LABELS.switch2}: ${facts.byPlatform.switch2}، الجهازان: ${facts.byPlatform.both}`,
);
say(
  `- الصور: علبة أمامية ${facts.withBox}، مربعة ${facts.withSquare}، عريضة ${facts.withWide}، بلا أي صورة ${facts.withoutPicture}`,
);
say(`- أُزيلت من المتجر الرقمي: ${facts.delisted}`);
say(`- لها ترتيب تنزيلات عند نينتندو: ${facts.ranked}، ولها أوضاع لعب مذكورة: ${facts.withModes}`);
say(`- تواريخ الإصدار: من ${facts.oldest || "—"} إلى ${facts.newest || "—"}، بلا تاريخ: ${facts.undated}`);
say(
  products
    ? `- يبيعها المتجر (رابط لصفحة المنتج): **${facts.linked}** — ` +
        Object.entries(howCounts)
          .map(([how, n]) => `${how}: ${n}`)
          .join("، ")
    : `- الربط بمنتجات المتجر: لم يُحسب (${catalogueNote})`,
);
say(
  tableState === "present"
    ? `- الجدول الآن: ${existing.size} عنواناً`
    : tableState === "missing"
      ? "- الجدول الآن: غير موجود بعد (يُنشأ من ملف الترحيل قبل أول كتابة)"
      : "- الجدول الآن: لم يُقرأ (لا بيانات اعتماد)",
);
say(
  tableState === "unread"
    ? `- سيُكتب عند التطبيق: حتى ${rows.length} عنواناً`
    : `- سيُكتب: **${plan.toWrite.length}** (جديد ${plan.fresh}، متغيّر ${plan.changed})، بلا تغيير ${plan.unchanged}، ` +
        `في الجدول وليس في الفهرس ${plan.notInIndex} (يبقى كما هو)`,
);
say(`- دفعات الكتابة: ${Math.ceil(plan.toWrite.length / BATCH_ROWS)} × ${BATCH_ROWS} عنوان`);
say();
say("| التصنيف | عدد العناوين |");
say("| --- | --- |");
for (const [id, n] of facts.genres.slice(0, 40)) say(`| ${genreLabel(id)} (${id}) | ${n} |`);
say();
say("أمثلة:");
for (const row of rows.slice(0, 8)) {
  say(`- ${row.title} — ${PLATFORM_LABELS[row.platform]}، ${row.release_date || "بلا تاريخ"}`);
}
say();

const summary = {
  source: indexFile || "search.nintendo-europe.com",
  indexTotal: total,
  indexRead: index.length,
  limit: LIMIT || null,
  ...facts,
  genres: Object.fromEntries(facts.genres),
  linkedBy: howCounts,
  catalogue: products ? "read" : catalogueNote,
  table: tableState,
  tableTitles: existing.size,
  toWrite: plan.toWrite.length,
  fresh: plan.fresh,
  changed: plan.changed,
  unchanged: plan.unchanged,
  notInIndex: plan.notInIndex,
};

if (!WANT_APPLY) {
  say("تشغيل جاف: لم يُكتب شيء. للكتابة ضع رمزاً جديداً في `scripts/games-db-load.apply-token`.");
  finish({ ...summary, applied: false });
  process.exit(0);
}

/* --------------------------------------------------------------- 5. apply */
if (token && args.apply !== "true") {
  await d1.run("CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  try {
    // Once, never retried: a retry after a lost answer would meet its own row.
    await d1.run("INSERT INTO console_runs (id, applied_at) VALUES (?, ?)", [`games-db-load:${token}`, Date.now()], {
      attempts: 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) {
      say(`الرمز \`${token}\` استُخدم من قبل. هذا التشغيل يبقى جافاً — لم يُكتب شيء.`);
      finish({ ...summary, applied: false, reason: "token_spent" });
      process.exit(0);
    }
    fail(`تعذّر تسجيل الرمز: ${message}`);
  }
  say(`استُلم الرمز \`${token}\`. الكتابة تبدأ.`);
}

// The table and its indexes, from the migration file itself. IF NOT EXISTS
// throughout, so this changes nothing once `wrangler d1 migrations apply` ran.
for (const statement of migrationStatements(readFileSync(MIGRATION_FILE, "utf8"))) {
  await d1.run(statement);
}

const batches = chunk(plan.toWrite, BATCH_ROWS);
let written = 0;
let batchesDone = 0;
for (const batch of batches) {
  try {
    // Genres first, then the details, the title row (and its hash) last: see games-db-rows.mjs.
    const add = insertGenresStatement(batch);
    if (add.params[0] !== "[]") await d1.run(add.sql, add.params);
    const prune = pruneGenresStatement(batch);
    await d1.run(prune.sql, prune.params);
    const details = upsertDetailsStatement(batch);
    await d1.run(details.sql, details.params);
    const upsert = upsertTitlesStatement(batch);
    await d1.run(upsert.sql, upsert.params);
  } catch (error) {
    say(
      `توقف عند الدفعة ${batchesDone + 1} من ${batches.length}: ${error instanceof Error ? error.message : String(error)}. ` +
        `ما كُتب قبلها باقٍ (${written} عنواناً)، وتشغيل برمز جديد يكمل الباقي.`,
    );
    finish({ ...summary, applied: "partial", batchesDone, written });
    process.exit(1);
  }
  batchesDone += 1;
  written += batch.length;
  if (batchesDone % 20 === 0 || batchesDone === batches.length) {
    console.log(`  ${batchesDone}/${batches.length} دفعة (${written} عنواناً)`);
  }
}

/*
  The stamp, after the last batch: until it lands the API keeps answering under
  the previous revision, and nothing it cached while this load ran is served
  once it does (src/lib/games-db.server.ts). Without it the rows are still
  right; only answers cached during the load stay up to an hour.
*/
try {
  const stamp = stampRevisionStatement(loadedAt);
  await d1.run(stamp.sql, stamp.params);
} catch (error) {
  say(
    `كُتب ${written} عنواناً، لكن تعذّر ختم المراجعة: ${error instanceof Error ? error.message : String(error)}. ` +
      "ما خُزّن مؤقتاً أثناء التحميل يبقى حتى ساعة؛ تشغيل برمز جديد يختمها.",
  );
  finish({ ...summary, applied: true, written, batches: batchesDone, stamped: false });
  process.exit(1);
}

const [after] = await d1.all(
  "SELECT COUNT(*) AS n, SUM(CASE WHEN shop_product_id <> '' THEN 1 ELSE 0 END) AS linked FROM nintendo_titles",
);
const [genreRows] = await d1.all("SELECT COUNT(*) AS n FROM nintendo_title_genres");
say(
  `كُتب ${written} عنواناً في ${batchesDone} دفعة. الجدول الآن: ${after?.n ?? "?"} عنواناً ` +
    `(${after?.linked ?? "?"} يبيعها المتجر)، و${genreRows?.n ?? "?"} صف تصنيف. المراجعة: \`${loadedAt}\`.`,
);
finish({
  ...summary,
  applied: true,
  written,
  batches: batchesDone,
  revision: loadedAt,
  tableTitlesAfter: Number(after?.n ?? 0),
  linkedAfter: Number(after?.linked ?? 0),
});
