#!/usr/bin/env node
/**
 * The ordinary offline price beside the front box cover, for every game that
 * has one — packed as a ZIP. READ ONLY.
 *
 * The owner:
 *
 *   «احتاج الالعاب التي لديها صورة العلبه الامامي المستطيل مع سعر اللعبه خيار
 *    اوفلاين عادي … يعني فقط الالعاب التي لديها غلاف العلبة الأمامي (Front Box
 *    Cover) ضعها في ملف zip»
 *
 * and, by name, the offline price of seventeen games on the shop's cards.
 *
 * NOTHING HERE IS A SECOND COPY OF A RULE. Which products the storefront hides,
 * which picture is the front box cover, which row is the ordinary offline
 * account and what the till charges for it are all answered by the app's own
 * functions, bundled from `lib/offline-cover-entry.ts` and applied by
 * `lib/offline-cover.mjs`, where a test holds them:
 *
 *   - the cover is `getNintendoMedia(product, "front-box")` — the role the
 *     shop's cover cards draw. A product whose answer is the placeholder has
 *     no front box cover and is not in the ZIP;
 *   - the price is the ordinary offline row priced through `resolveUnitPrice`,
 *     the function checkout charges with — or, with no such row, the base
 *     price the till charges with nothing selected;
 *   - a product whose page does not offer «حساب أوفلاين» at all has no offline
 *     price, and is left out rather than given one.
 *
 * Every cover is DOWNLOADED and decoded, not assumed from its URL: a stored
 * link can 404, answer an HTML page, or hold a square card filed in the cover
 * field. What goes in the ZIP is the picture itself, framed the way the shop
 * frames it, and only when the framed picture is a vertical rectangle.
 *
 * WRITES NOTHING to D1 or R2: its only statements are the SELECTs `getStore`
 * makes, and its R2 calls are GETs. Cost is never read into the output.
 *
 * Output:
 *   offline-covers.zip          the package (covers, CSV, gallery page, README)
 *   offline-cover-export.md     the full report, including what was left out
 *   offline-cover-summary.md    the named games and the headline numbers
 */

import { build } from "esbuild";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  PORTRAIT_MIN,
  REQUESTED,
  arabicTitle,
  englishTitle,
  filesKey,
  fold,
  frameCover,
  matchRequested,
  offlineOf,
  onlineOf,
  safeName,
} from "./lib/offline-cover.mjs";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const ORIGIN = "https://banan.to";
const OUT_ZIP = "offline-covers.zip";
const OUT_REPORT = "offline-cover-export.md";
const OUT_SUMMARY = "offline-cover-summary.md";
const ZIP_ROOT = "banan-offline-covers";
const CONCURRENCY = 8;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0 Safari/537.36";

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const summary = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};
const flush = () => {
  writeFileSync(OUT_REPORT, `${lines.join("\n")}\n`);
  const brief = `${summary.map(redact).join("\n")}\n`;
  writeFileSync(OUT_SUMMARY, brief);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, brief, { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  summary.push(`## توقف: ${message}`);
  flush();
  process.exit(1);
};
const money = (n) => Number(n || 0).toLocaleString("en-US");
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const FROM = { type: "صف الأوفلاين", option: "خيار الأوفلاين", base: "السعر الأساسي" };

if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
if (!process.env["D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported by the guard below. */
  }
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

const outfile = path.resolve(".offline-cover-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/offline-cover-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
  plugins: [
    {
      /*
        `getStore` reaches `db.server`, which pulls in TanStack Start's server
        core and its virtual modules. Nothing on this path runs a request
        handler — the catalogue is read as a document — so they are stubbed,
        exactly as the pricing reports do.
      */
      name: "stub-start-virtuals",
      setup(pluginBuild) {
        const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
        pluginBuild.onResolve({ filter: virtual }, (a) => ({
          path: a.path,
          namespace: "start-virtual",
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "start-virtual" }, () => ({
          contents: "export default {}; export const getStartManifest = () => ({});",
          loader: "js",
        }));
      },
    },
  ],
});
const app = await import(outfile);
rmSync(outfile, { force: true });

const startedAt = new Date().toISOString();
say(`# أسعار الأوفلاين وأغلفة العلب الأمامية — قراءة فقط`);
say();
say(`- وقت التشغيل: ${startedAt}`);
say(`- المصدر: قاعدة بيانات المتجر الحيّة (D1)، والصور من مواقعها المخزّنة.`);
say();

const store = await app.getStore();
const products = (Array.isArray(store?.products) ? store.products : []).filter(
  (p) => p && typeof p === "object" && p.id && !p._deleted,
);
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);

/* ---------------------------------------------------------------- fetching */

const API = "https://api.cloudflare.com/client/v4";
const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
let r2Rest = true;

async function r2Get(key) {
  if (r2Rest) {
    const url = `${API}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${SERVING_BUCKET}/objects/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) r2Rest = false;
    } catch {
      /* Falls through to wrangler below. */
    }
  }
  try {
    const bytes = execFileSync(
      WRANGLER,
      ["r2", "object", "get", `${SERVING_BUCKET}/${key}`, "--remote", "--pipe"],
      {
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 90_000,
        killSignal: "SIGKILL",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
      },
    );
    return bytes?.length ? bytes : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with patience for 429 and 5xx — «ask me later» is not «no». */
async function httpGet(url) {
  let last = "no response";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return { bytes: Buffer.from(await res.arrayBuffer()) };
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      last = String(error?.message ?? error).slice(0, 80);
    }
  }
  return { error: last };
}

/** A stored `/api/files/...` cover is read from the bucket the shop serves it from. */
async function fetchCover(url) {
  const key = filesKey(url);
  if (key) {
    const bytes = await r2Get(key);
    if (bytes) return { bytes, via: "R2" };
  }
  const absolute = /^https?:\/\//i.test(url) ? url : `${ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  const got = await httpGet(absolute);
  return got.bytes ? { bytes: got.bytes, via: "HTTP" } : { error: got.error };
}

/* ------------------------------------------------------------- the census */

const census = products.map((product) => {
  const media = app.getNintendoMedia(product, "front-box");
  const title = englishTitle(product);
  return {
    product,
    id: String(product.id),
    title,
    titleAr: arabicTitle(product),
    folded: fold(title),
    switch2: app.isNintendoSwitch2Product(product),
    platform: app.isNintendoSwitch2Product(product) ? "Nintendo Switch 2" : "Nintendo Switch",
    hidden: app.isProductHidden(product),
    game: app.isGameProduct(product),
    cover: media && !media.isPlaceholder ? media : null,
    offline: offlineOf(app, product),
    link: `${ORIGIN}${app.getProductPath(product)}`,
  };
});

const visibleGames = census.filter((row) => row.game && !row.hidden);
const withCover = visibleGames.filter((row) => row.cover);
const candidates = withCover.filter((row) => row.offline?.price > 0);

say(`## الكتالوج`);
say();
say(`- المنتجات: **${products.length}**`);
say(`- ألعاب ظاهرة في المتجر: **${visibleGames.length}**`);
say(`- منها لها غلاف علبة أمامي مخزّن: **${withCover.length}**`);
say(`- ومنها تبيع حساب أوفلاين بسعر: **${candidates.length}**`);
say();

/* ------------------------------------------------ download, check, and frame */

const results = new Array(candidates.length);
let cursor = 0;
let finished = 0;
async function worker() {
  while (cursor < candidates.length) {
    const index = cursor++;
    const row = candidates[index];
    const got = await fetchCover(row.cover.url);
    if (!got.bytes) {
      results[index] = { row, error: `تعذّر التنزيل (${got.error})` };
    } else {
      try {
        const framed = await frameCover(app, got.bytes, row.cover.trim);
        results[index] = {
          row,
          via: got.via,
          hash: createHash("sha256").update(got.bytes).digest("hex").slice(0, 16),
          ...framed,
        };
      } catch (error) {
        results[index] = { row, error: `لم تُقرأ كصورة (${String(error?.message ?? error).slice(0, 60)})` };
      }
    }
    finished++;
    if (finished % 100 === 0) console.log(`… ${finished}/${candidates.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const broken = results.filter((r) => r.error);
const notPortrait = results.filter((r) => !r.error && !r.portrait);
const kept = results
  .filter((r) => !r.error && r.portrait)
  .sort((a, b) => a.row.title.localeCompare(b.row.title, "en", { sensitivity: "base" }));

/*
  One picture on two products whose titles differ means one of them may be
  wearing the other's cover — the import found 25 such URLs. They stay in the
  package (two editions of one game can share a box), but they are named so
  they can be looked at.
*/
const byHash = new Map();
for (const r of kept) {
  if (!byHash.has(r.hash)) byHash.set(r.hash, []);
  byHash.get(r.hash).push(r);
}
const shared = [...byHash.values()].filter((group) => new Set(group.map((r) => r.row.folded)).size > 1);

/* ------------------------------------------------------------- the package */

const digits = Math.max(3, String(kept.length).length);
const entries = kept.map((r, i) => ({
  ...r,
  number: i + 1,
  file: `covers/${String(i + 1).padStart(digits, "0")} - ${safeName(r.row.title)}.jpg`,
}));
const coverFileById = new Map(entries.map((e) => [e.row.id, e.file]));

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (header, rows) =>
  `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

const gamesCsv = csv(
  [
    "#",
    "اسم اللعبة (Game)",
    "الاسم بالعربي",
    "المنصة (Platform)",
    "سعر حساب أوفلاين عادي (د.ع)",
    "صورة الغلاف الأمامي (Cover file)",
    "رابط المنتج",
  ],
  entries.map((e) => [
    e.number,
    e.row.title,
    e.row.titleAr,
    e.row.platform,
    e.row.offline.price,
    e.file,
    e.row.link,
  ]),
);

const requested = REQUESTED.map((ask) => ({ ask, hits: matchRequested(ask, census) }));
const requestedCsv = csv(
  [
    "المجموعة",
    "اللعبة المطلوبة",
    "المنتج في المتجر",
    "المنصة",
    "سعر حساب أوفلاين عادي (د.ع)",
    "صورة الغلاف في الملف",
    "رابط المنتج",
  ],
  requested.flatMap(({ ask, hits }) => {
    const visible = hits.filter((h) => !h.hidden);
    if (!visible.length) return [[ask.group, ask.label, "غير موجودة في المتجر", "", "", "", ""]];
    return visible.map((h) => [
      ask.group,
      ask.label,
      h.title,
      h.platform,
      h.offline?.price > 0 ? h.offline.price : "لا تُباع أوفلاين",
      coverFileById.get(h.id) ?? "—",
      h.link,
    ]);
  }),
);

const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const galleryHtml = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>أسعار الأوفلاين — ${entries.length} لعبة</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --card: #ffffff; --ink: #1d1d1b; --muted: #6b6b66; --accent: #a87b00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151514; --card: #22221f; --ink: #f1f1ec; --muted: #a3a39c; --accent: #f2c230; } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; background: var(--bg); color: var(--ink); }
  header { padding: 20px 16px 8px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  header p { margin: 0; color: var(--muted); font-size: .9rem; }
  input { width: 100%; margin-top: 12px; padding: 10px 12px; font-size: 1rem; border-radius: 10px; border: 1px solid #8884; background: var(--card); color: var(--ink); }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; padding: 12px 16px 32px; max-width: 1200px; margin: 0 auto; }
  figure { margin: 0; background: var(--card); border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px #0002; display: flex; flex-direction: column; }
  figure img { width: 100%; aspect-ratio: 5 / 8; object-fit: contain; display: block; background: #8881; }
  figcaption { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .name { direction: ltr; text-align: left; font-size: .85rem; font-weight: 600; line-height: 1.3; }
  .platform { direction: ltr; text-align: left; font-size: .72rem; color: var(--muted); }
  .price { margin-top: auto; font-weight: 700; color: var(--accent); font-size: 1rem; }
</style>
</head>
<body>
<header>
  <h1>أسعار حساب أوفلاين عادي — ${entries.length} لعبة</h1>
  <p>متجر بنانا · banan.to · ${startedAt.slice(0, 10)}</p>
  <input type="search" placeholder="ابحث باسم اللعبة…" oninput="const q=this.value.trim().toLowerCase();document.querySelectorAll('figure').forEach(f=>f.hidden=Boolean(q)&&!f.dataset.q.includes(q))">
</header>
<main>
${entries
  .map(
    (e) => `<figure data-q="${escapeHtml(`${e.row.title} ${e.row.titleAr}`.toLowerCase())}">
  <img src="${escapeHtml(e.file)}" alt="${escapeHtml(e.row.title)}" loading="lazy">
  <figcaption><span class="name">${escapeHtml(e.row.title)}</span><span class="platform">${escapeHtml(e.row.platform)}</span><span class="price">${money(e.row.offline.price)} د.ع</span></figcaption>
</figure>`,
  )
  .join("\n")}
</main>
</body>
</html>
`;

const readme = `ملف أسعار حساب أوفلاين عادي — متجر بنانا (banan.to)
تاريخ الاستخراج: ${startedAt}
عدد الألعاب: ${entries.length}

المحتوى
-------
- covers/              صورة غلاف العلبة الأمامي (Front Box Cover) لكل لعبة، بصيغة JPG.
                       اسم الصورة = رقم اللعبة في الجدول + اسم اللعبة.
- games.csv            الجدول: الرقم، اسم اللعبة، الاسم بالعربي، المنصة،
                       سعر حساب أوفلاين عادي بالدينار العراقي، اسم ملف الصورة، رابط المنتج.
                       يُفتح مباشرة في Excel أو Google Sheets.
- index.html           معرض يعرض كل لعبة بصورتها واسمها وسعرها (يُفتح بالمتصفح بعد فك الضغط).
- requested-games.csv  أسعار الألعاب المطلوبة بالاسم (ألعاب نينتندو والناشرين الآخرين).

كيف حُدِّد كل شيء
-----------------
- السعر: سعر «حساب أوفلاين» العادي كما يحاسب عليه المتجر عند الشراء
  (بدون نسخة الإضافات/DLC وبدون حساب الأونلاين).
- الصورة: غلاف العلبة الأمامي المخزّن للعبة نفسها في المتجر، نُزّل وتُحقّق أنه
  صورة سليمة مستطيلة عمودية، وقُصّت حوافه البيضاء كما يعرضه المتجر.
- فقط الألعاب الظاهرة في المتجر التي لها غلاف أمامي وتُباع كحساب أوفلاين.
`;

const zip = new AdmZip();
for (const e of entries) zip.addFile(`${ZIP_ROOT}/${e.file}`, e.jpeg);
zip.addFile(`${ZIP_ROOT}/games.csv`, Buffer.from(gamesCsv, "utf8"));
zip.addFile(`${ZIP_ROOT}/requested-games.csv`, Buffer.from(requestedCsv, "utf8"));
zip.addFile(`${ZIP_ROOT}/index.html`, Buffer.from(galleryHtml, "utf8"));
zip.addFile(`${ZIP_ROOT}/README.txt`, Buffer.from(readme, "utf8"));
zip.addFile(
  `${ZIP_ROOT}/manifest.json`,
  Buffer.from(
    JSON.stringify(
      {
        generatedAt: startedAt,
        source: "banan.to live catalogue (D1), read-only",
        count: entries.length,
        games: entries.map((e) => ({
          number: e.number,
          id: e.row.id,
          title: e.row.title,
          titleAr: e.row.titleAr || undefined,
          platform: e.row.platform,
          offlinePriceIqd: e.row.offline.price,
          priceFrom: e.row.offline.from,
          offlineRow: e.row.offline.row || undefined,
          cover: e.file,
          coverSource: e.row.cover.url,
          coverField: e.row.cover.source,
          sourceSize: e.source,
          size: e.size,
          aspect: Number(e.aspect.toFixed(3)),
          framed: e.framed,
          sourceHash: e.hash,
          link: e.row.link,
        })),
      },
      null,
      2,
    ),
    "utf8",
  ),
);
zip.writeZip(OUT_ZIP);

/* -------------------------------------------------------------- the report */

say(`## الحصيلة`);
say();
say(`- أغلفة نُزّلت وقُرئت: **${results.length - broken.length}** من ${results.length}`);
say(`- تعذّر تنزيلها أو قراءتها: **${broken.length}**`);
say(`- ليست مستطيلًا عموديًا بعد القص (النسبة أقل من ${PORTRAIT_MIN}): **${notPortrait.length}**`);
say(`- **في ملف الـ ZIP: ${entries.length} لعبة**`);
say(`- حجم الملف: ${(statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1)} MB`);
say();

const disagree = entries.filter(
  (e) =>
    e.row.offline.from === "base" &&
    e.row.offline.offerPrice > 0 &&
    e.row.offline.offerPrice !== e.row.offline.price,
);
if (disagree.length) {
  say(`### سعر العرض يخالف سعر الدفع (${disagree.length})`);
  say();
  say(`صفحة المنتج تعرض «حساب أوفلاين» بسعر \`accountPrice\` والدفع يحاسب بالسعر الأساسي. الملف يستخدم سعر الدفع.`);
  say();
  say(`| اللعبة | سعر الدفع | سعر العرض |`);
  say(`| --- | ---: | ---: |`);
  for (const e of disagree) {
    say(`| ${cell(e.row.title)} | ${money(e.row.offline.price)} | ${money(e.row.offline.offerPrice)} |`);
  }
  say();
}

if (shared.length) {
  say(`### صورة واحدة على أكثر من لعبة (${shared.length} مجموعة) — للمراجعة`);
  say();
  for (const group of shared) {
    say(`- ${group.map((r) => `${cell(r.row.title)} (\`${r.row.id}\`)`).join(" · ")}`);
  }
  say();
}

if (broken.length) {
  say(`### تعذّر تنزيلها أو قراءتها (${broken.length})`);
  say();
  say(`| اللعبة | السبب | الرابط المخزّن |`);
  say(`| --- | --- | --- |`);
  for (const r of broken) {
    say(`| ${cell(r.row.title)} | ${cell(r.error)} | ${cell(r.row.cover.url).slice(0, 120)} |`);
  }
  say();
}

if (notPortrait.length) {
  say(`### ليست غلافًا عموديًا (${notPortrait.length})`);
  say();
  say(`| اللعبة | المقاس بعد القص | النسبة | الحقل |`);
  say(`| --- | --- | ---: | --- |`);
  for (const r of notPortrait) {
    say(`| ${cell(r.row.title)} | ${r.size} | ${r.aspect.toFixed(2)} | \`${r.row.cover.source}\` |`);
  }
  say();
}

const noOffline = withCover.filter((row) => !(row.offline?.price > 0));
if (noOffline.length) {
  say(`### لها غلاف لكن لا تُباع كحساب أوفلاين (${noOffline.length})`);
  say();
  for (const row of noOffline) say(`- ${cell(row.title)} — ${row.platform}`);
  say();
}

say(`## الألعاب في الملف`);
say();
say(`| # | اللعبة | المنصة | أوفلاين (د.ع) | من | الصورة |`);
say(`| ---: | --- | --- | ---: | --- | --- |`);
for (const e of entries) {
  say(
    `| ${e.number} | ${cell(e.row.title)} | ${e.row.platform} | ${money(e.row.offline.price)} | ` +
      `${FROM[e.row.offline.from]} | ${e.source} → ${e.size} (${e.framed}, ${e.via}) |`,
  );
}
say();

/*
  LAST, and into its own file as well: a job log is read from its tail, and
  these are the numbers the owner asked for by name.
*/
const named = [`## الألعاب المطلوبة بالاسم — سعر حساب أوفلاين عادي`, ""];
for (const { ask, hits } of requested) {
  named.push(`### ${ask.label} — ${ask.group}`);
  if (!hits.length) named.push(`- غير موجودة في الكتالوج`);
  for (const h of hits) {
    const offline =
      h.offline?.price > 0
        ? `**${money(h.offline.price)}** د.ع (${FROM[h.offline.from]}${h.offline.row ? ` «${cell(h.offline.row)}»` : ""})`
        : "لا تُباع أوفلاين";
    const online = onlineOf(app, h.product);
    const cover = coverFileById.has(h.id) ? "في الملف" : h.cover ? "مخزّن ولم يدخل الملف" : "لا يوجد";
    named.push(
      `- ${cell(h.title)} · ${h.platform}${h.hidden ? " · **مخفية**" : ""} · أوفلاين: ${offline}` +
        `${online ? ` · أونلاين: ${money(online)}` : ""} · الغلاف: ${cover} · \`${h.id}\``,
    );
  }
  named.push("");
}
for (const line of named) say(line);

summary.push(`# أسعار الأوفلاين وأغلفة العلب — ${startedAt}`);
summary.push("");
summary.push(
  `- ألعاب ظاهرة: ${visibleGames.length} · لها غلاف أمامي: ${withCover.length} · تبيع أوفلاين: ${candidates.length}`,
);
summary.push(
  `- تعذّر تنزيلها: ${broken.length} · ليست عمودية: ${notPortrait.length} · صورة مشتركة: ${shared.length} مجموعة`,
);
summary.push(`- **في ملف الـ ZIP: ${entries.length} لعبة** (${(statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1)} MB)`);
summary.push("");
summary.push(...named);
flush();
